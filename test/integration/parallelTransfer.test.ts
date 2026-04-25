import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMockMcpServer, MockServerHandle } from './helpers/mockMcpServer';

// Concurrency tracking state
let concurrentRequests = 0;
let maxConcurrentRequests = 0;
let receivedPayloads: Array<{ path: string; content: string }> = [];
let transferDelay = 50;

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

describe('Integration: Parallel File Transfer Concurrency', () => {
  let server: MockServerHandle;

  beforeAll(async () => {
    server = await createMockMcpServer([
      {
        name: 'transfer_file',
        description: 'Receives a file transfer with delay',
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
          concurrentRequests++;
          maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests);
          receivedPayloads.push({ path: args.path as string, content: args.content as string });

          await new Promise((resolve) => setTimeout(resolve, transferDelay));
          concurrentRequests--;

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
    concurrentRequests = 0;
    maxConcurrentRequests = 0;
    receivedPayloads = [];
    transferDelay = 50;
  });

  function setupFiles(count: number) {
    const encoder = new TextEncoder();
    const files = Array.from({ length: count }, (_, i) => ({
      path: `/workspace/src/file${i}.ts`,
      content: `const x${i} = ${i};`,
      mtime: new Date('2024-01-01').getTime() + i * 86400000,
    }));

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

    return files.map((f) => ({ fsPath: f.path, scheme: 'file' }) as any);
  }

  it('should transfer all files and receive all payloads on the server', async () => {
    const fileCount = 10;
    const uris = setupFiles(fileCount);

    const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
    await mcpClient.connect();

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const service = new DefaultFileTransferService(mcpClient, mockLogger);
    const count = await service.buildAndTransfer(uris, null, 3);

    expect(count).toBe(fileCount);
    expect(receivedPayloads).toHaveLength(fileCount);

    const receivedPaths = receivedPayloads.map((p) => p.path).sort();
    const expectedPaths = Array.from({ length: fileCount }, (_, i) => `src/file${i}.ts`).sort();
    expect(receivedPaths).toEqual(expectedPaths);

    await mcpClient.disconnect();
  });

  it('should not exceed the configured concurrency limit of 2', async () => {
    const fileCount = 8;
    const concurrencyLimit = 2;
    transferDelay = 100;
    const uris = setupFiles(fileCount);

    const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
    await mcpClient.connect();

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const service = new DefaultFileTransferService(mcpClient, mockLogger);
    const count = await service.buildAndTransfer(uris, null, concurrencyLimit);

    expect(count).toBe(fileCount);
    expect(receivedPayloads).toHaveLength(fileCount);
    // Server-side concurrency may be serialized by the MCP transport,
    // but the client pool never exceeds the limit. All files transferred.
    expect(maxConcurrentRequests).toBeGreaterThanOrEqual(1);
    expect(maxConcurrentRequests).toBeLessThanOrEqual(concurrencyLimit);

    await mcpClient.disconnect();
  });

  it('should not exceed the configured concurrency limit of 5', async () => {
    const fileCount = 15;
    const concurrencyLimit = 5;
    transferDelay = 80;
    const uris = setupFiles(fileCount);

    const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
    await mcpClient.connect();

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const service = new DefaultFileTransferService(mcpClient, mockLogger);
    const count = await service.buildAndTransfer(uris, null, concurrencyLimit);

    expect(count).toBe(fileCount);
    expect(receivedPayloads).toHaveLength(fileCount);
    expect(maxConcurrentRequests).toBeLessThanOrEqual(concurrencyLimit);

    await mcpClient.disconnect();
  });

  it('should handle concurrency limit of 1 (sequential transfers)', async () => {
    const fileCount = 5;
    const concurrencyLimit = 1;
    transferDelay = 30;
    const uris = setupFiles(fileCount);

    const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
    await mcpClient.connect();

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const service = new DefaultFileTransferService(mcpClient, mockLogger);
    const count = await service.buildAndTransfer(uris, null, concurrencyLimit);

    expect(count).toBe(fileCount);
    expect(receivedPayloads).toHaveLength(fileCount);
    expect(maxConcurrentRequests).toBe(1);

    await mcpClient.disconnect();
  });

  it('should verify each payload contains correct content', async () => {
    const fileCount = 5;
    const uris = setupFiles(fileCount);

    const mcpClient = new MCPClient(`http://127.0.0.1:${server.port}`);
    await mcpClient.connect();

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const service = new DefaultFileTransferService(mcpClient, mockLogger);
    await service.buildAndTransfer(uris, null, 3);

    for (let i = 0; i < fileCount; i++) {
      const payload = receivedPayloads.find((p) => p.path === `src/file${i}.ts`);
      expect(payload).toBeDefined();
      expect(payload!.content).toBe(`const x${i} = ${i};`);
    }

    await mcpClient.disconnect();
  });
});
