import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Feature: vscode-code-review-extension, Property 3: Incremental Sync Correctness

/**
 * Property 3: Incremental Sync Correctness
 *
 * For any set of workspace files and any non-null Index_Timestamp value T,
 * the set of files selected for transfer SHALL be exactly the subset whose
 * lastModified time is strictly after T — no more, no fewer. When T is null,
 * all files SHALL be included.
 *
 * **Validates: Requirements 2.5**
 */

const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockAsRelativePath = vi.fn();
const mockCallTool = vi.fn();

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: (...args: any[]) => mockReadFile(...args),
      stat: (...args: any[]) => mockStat(...args),
    },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    asRelativePath: (...args: any[]) => mockAsRelativePath(...args),
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

import { DefaultFileTransferService } from '../../src/review/FileTransferService';

/**
 * Generates a random ISO 8601 timestamp within a reasonable date range.
 */
const isoTimestampArb = fc
  .integer({
    min: new Date('2020-01-01T00:00:00Z').getTime(),
    max: new Date('2030-12-31T23:59:59Z').getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/**
 * Generates a file descriptor with a path and mtime.
 */
const fileDescArb = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
  mtime: fc.integer({
    min: new Date('2020-01-01T00:00:00Z').getTime(),
    max: new Date('2030-12-31T23:59:59Z').getTime(),
  }),
});

/**
 * Generates a sinceTimestamp that is either null or a random ISO 8601 timestamp.
 */
const sinceTimestampArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  isoTimestampArb,
);

describe('Property 3: Incremental Sync Correctness', () => {
  let service: DefaultFileTransferService;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockMcpClient = {
      callTool: mockCallTool,
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: true,
      getClient: vi.fn(),
    } as any;

    const mockLogger = {
      log: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    } as any;

    service = new DefaultFileTransferService(mockMcpClient, mockLogger);
  });

  it('should transfer exactly the files with lastModified > sinceTimestamp when non-null, or all files when null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fileDescArb, { minLength: 0, maxLength: 20 }),
        sinceTimestampArb,
        async (files, sinceTimestamp) => {
          vi.clearAllMocks();

          const encoder = new TextEncoder();
          const uris = files.map((f) => ({
            fsPath: `/workspace/src/${f.name}.ts`,
            scheme: 'file',
          }));

          mockStat.mockImplementation((u: any) => {
            const file = files.find(
              (f) => `/workspace/src/${f.name}.ts` === u.fsPath,
            );
            return Promise.resolve({ mtime: file!.mtime });
          });

          mockReadFile.mockImplementation((u: any) => {
            const file = files.find(
              (f) => `/workspace/src/${f.name}.ts` === u.fsPath,
            );
            return Promise.resolve(encoder.encode(`content of ${file!.name}`));
          });

          mockAsRelativePath.mockImplementation((uri: any) => {
            const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
            return fsPath.replace('/workspace/', '');
          });

          mockCallTool.mockResolvedValue(undefined);

          const count = await service.buildAndTransfer(
            uris as any[],
            sinceTimestamp,
          );

          const expectedFiles = files.filter((f) => {
            const lastModified = new Date(f.mtime).toISOString();
            return sinceTimestamp === null || lastModified > sinceTimestamp;
          });

          expect(count).toBe(expectedFiles.length);
          expect(mockCallTool).toHaveBeenCalledTimes(expectedFiles.length);

          // Verify no file with lastModified <= sinceTimestamp was transferred
          if (sinceTimestamp !== null) {
            for (const call of mockCallTool.mock.calls) {
              const payload = call[1];
              expect(payload.lastModified > sinceTimestamp).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should transfer all files when sinceTimestamp is null regardless of lastModified values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fileDescArb, { minLength: 0, maxLength: 20 }),
        async (files) => {
          vi.clearAllMocks();

          const encoder = new TextEncoder();
          const uris = files.map((f) => ({
            fsPath: `/workspace/src/${f.name}.ts`,
            scheme: 'file',
          }));

          mockStat.mockImplementation((u: any) => {
            const file = files.find(
              (f) => `/workspace/src/${f.name}.ts` === u.fsPath,
            );
            return Promise.resolve({ mtime: file!.mtime });
          });

          mockReadFile.mockImplementation((u: any) => {
            return Promise.resolve(encoder.encode('content'));
          });

          mockAsRelativePath.mockImplementation((uri: any) => {
            const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
            return fsPath.replace('/workspace/', '');
          });

          mockCallTool.mockResolvedValue(undefined);

          const count = await service.buildAndTransfer(uris as any[], null);

          expect(count).toBe(files.length);
          expect(mockCallTool).toHaveBeenCalledTimes(files.length);
        },
      ),
      { numRuns: 100 },
    );
  });

});
