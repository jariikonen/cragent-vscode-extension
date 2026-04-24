import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMockMcpServer, MockServerHandle } from './helpers/mockMcpServer';

// Track files received by the mock server
let receivedFiles: Array<{
  path: string;
  content: string;
  languageId: string;
  lastModified: string;
}> = [];

let indexTimestamp: string | null = null;

// Mock vscode module
const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockAsRelativePath = vi.fn();

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: (...args: any[]) => mockReadFile(...args),
      stat: (...args: any[]) => mockStat(...args),
    },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    asRelativePath: (...args: any[]) => mockAsRelativePath(...args),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  },
}));

import { MCPClient } from '../../src/connection/MCPClient';
import { DefaultFileTransferService } from '../../src/review/FileTransferService';

describe('Integration: File Transfer with MCP Server', () => {
  let server: MockServerHandle;

  beforeAll(async () => {
    server = await createMockMcpServer([
      {
        name: 'get_index_timestamp',
        description: 'Returns the index timestamp',
        handler: async () => ({
          content: [{ type: 'text', text: JSON.stringify({ timestamp: indexTimestamp }) }],
        }),
      },
      {
        name: 'transfer_file',
        description: 'Receives a file transfer',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            languageId: { type: 'string' },
            lastModified: { type: 'string' },
          },
          required: ['path', 'content', 'languageId', 'lastModified'],
        },
        handler: async (args) => {
          receivedFiles.push({
            path: args.path as string,
            content: args.content as string,
            languageId: args.languageId as string,
            lastModified: args.lastModified as string,
          });
          return { content: [{ type: 'text', text: 'OK' }] };
        },
      },
    ]);
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    receivedFiles = [];
    indexTimestamp = null;
  });

  function makeUri(path: string) {
    return { fsPath: path, scheme: 'file' } as any;
  }

  function setupFiles(files: Array<{ path: string; content: string; mtime: number }>) {
    const encoder = new TextEncoder();

    mockReadFile.mockImplementation((u: any) => {
      const file = files.find((f) => f.path === u.fsPath);
      if (file) return Promise.resolve(encoder.encode(file.content));
      return Promise.reject(new Error('File not found'));
    });

    mockStat.mockImplementation((u: any) => {
      const file = files.find((f) => f.path === u.fsPath);
      if (file) return Promise.resolve({ mtime: file.mtime });
      return Promise.reject(new Error('File not found'));
    });

    mockAsRelativePath.mockImplementation((uri: any) => {
      const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
      return fsPath.replace('/workspace/', '');
    });

    return files.map((f) => makeUri(f.path));
  }

  describe('with null timestamp (send all files)', () => {
    it('should transfer all files when sinceTimestamp is null', async () => {
      const uris = setupFiles([
        { path: '/workspace/src/a.ts', content: 'const a = 1;', mtime: new Date('2024-01-01').getTime() },
        { path: '/workspace/src/b.ts', content: 'const b = 2;', mtime: new Date('2024-01-02').getTime() },
        { path: '/workspace/src/c.ts', content: 'const c = 3;', mtime: new Date('2024-01-03').getTime() },
      ]);

      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const service = new DefaultFileTransferService(mcpClient, mockLogger);
      const count = await service.buildAndTransfer(uris, null);

      expect(count).toBe(3);
      expect(receivedFiles).toHaveLength(3);
      expect(receivedFiles.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

      await mcpClient.disconnect();
    });
  });

  describe('with non-null timestamp (incremental sync)', () => {
    it('should transfer only files newer than the timestamp', async () => {
      const uris = setupFiles([
        { path: '/workspace/src/old.ts', content: 'old', mtime: new Date('2024-01-01').getTime() },
        { path: '/workspace/src/also-old.ts', content: 'also old', mtime: new Date('2024-01-15').getTime() },
        { path: '/workspace/src/new.ts', content: 'new', mtime: new Date('2024-02-01').getTime() },
        { path: '/workspace/src/newest.ts', content: 'newest', mtime: new Date('2024-03-01').getTime() },
      ]);

      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const service = new DefaultFileTransferService(mcpClient, mockLogger);
      const count = await service.buildAndTransfer(uris, '2024-01-15T00:00:00.000Z');

      expect(count).toBe(2);
      expect(receivedFiles).toHaveLength(2);
      expect(receivedFiles.map((f) => f.path).sort()).toEqual(['src/new.ts', 'src/newest.ts']);

      await mcpClient.disconnect();
    });

    it('should exclude files with lastModified exactly equal to the timestamp', async () => {
      const timestamp = '2024-01-15T12:00:00.000Z';
      const uris = setupFiles([
        { path: '/workspace/src/exact.ts', content: 'exact', mtime: new Date(timestamp).getTime() },
        { path: '/workspace/src/after.ts', content: 'after', mtime: new Date('2024-01-15T12:00:01.000Z').getTime() },
      ]);

      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const service = new DefaultFileTransferService(mcpClient, mockLogger);
      const count = await service.buildAndTransfer(uris, timestamp);

      expect(count).toBe(1);
      expect(receivedFiles[0].path).toBe('src/after.ts');

      await mcpClient.disconnect();
    });

    it('should transfer zero files when all are older than the timestamp', async () => {
      const uris = setupFiles([
        { path: '/workspace/src/old1.ts', content: 'old 1', mtime: new Date('2024-01-01').getTime() },
        { path: '/workspace/src/old2.ts', content: 'old 2', mtime: new Date('2024-01-02').getTime() },
      ]);

      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const service = new DefaultFileTransferService(mcpClient, mockLogger);
      const count = await service.buildAndTransfer(uris, '2024-12-31T00:00:00.000Z');

      expect(count).toBe(0);
      expect(receivedFiles).toHaveLength(0);

      await mcpClient.disconnect();
    });
  });

  describe('queryIndexTimestamp integration', () => {
    it('should retrieve the index timestamp from the server via tool call', async () => {
      indexTimestamp = '2024-06-15T10:30:00.000Z';

      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const result = (await mcpClient.callTool('get_index_timestamp')) as any;
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.timestamp).toBe('2024-06-15T10:30:00.000Z');

      await mcpClient.disconnect();
    });
  });

  describe('empty file list', () => {
    it('should handle empty URI list gracefully', async () => {
      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const service = new DefaultFileTransferService(mcpClient, mockLogger);
      const count = await service.buildAndTransfer([], null);

      expect(count).toBe(0);
      expect(receivedFiles).toHaveLength(0);

      await mcpClient.disconnect();
    });
  });

  describe('file content verification', () => {
    it('should send correct file content and metadata to the server', async () => {
      const uris = setupFiles([
        {
          path: '/workspace/src/hello.ts',
          content: 'export function hello() { return "world"; }',
          mtime: new Date('2024-06-01T00:00:00Z').getTime(),
        },
      ]);

      const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
      await mcpClient.connect();

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const service = new DefaultFileTransferService(mcpClient, mockLogger);
      await service.buildAndTransfer(uris, null);

      expect(receivedFiles).toHaveLength(1);
      expect(receivedFiles[0]).toEqual({
        path: 'src/hello.ts',
        content: 'export function hello() { return "world"; }',
        languageId: 'typescript',
        lastModified: '2024-06-01T00:00:00.000Z',
      });

      await mcpClient.disconnect();
    });
  });
});
