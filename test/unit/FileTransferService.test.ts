import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultFileTransferService } from '../../src/review/FileTransferService';

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

describe('FileTransferService', () => {
  let service: DefaultFileTransferService;
  let mockMcpClient: any;
  let mockLogger: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockMcpClient = {
      callTool: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: true,
      getClient: vi.fn(),
    };

    mockLogger = {
      log: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };

    service = new DefaultFileTransferService(mockMcpClient, mockLogger);
  });

  function makeUri(path: string) {
    return { fsPath: path, scheme: 'file' } as any;
  }

  function setupMultipleFiles(
    files: Array<{ path: string; content: string; mtime: number }>,
  ) {
    const encoder = new TextEncoder();

    mockReadFile.mockImplementation((u: any) => {
      const file = files.find((f) => f.path === u.fsPath);
      if (file) {
        return Promise.resolve(encoder.encode(file.content));
      }
      return Promise.reject(new Error('File not found'));
    });

    mockStat.mockImplementation((u: any) => {
      const file = files.find((f) => f.path === u.fsPath);
      if (file) {
        return Promise.resolve({ mtime: file.mtime });
      }
      return Promise.reject(new Error('File not found'));
    });

    mockAsRelativePath.mockImplementation((uri: any) => {
      const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
      return fsPath.replace('/workspace/', '');
    });

    return files.map((f) => makeUri(f.path));
  }

  describe('queryIndexTimestamp', () => {
    it('should return the timestamp from the MCP tool response', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        timestamp: '2024-01-15T10:30:00.000Z',
      });

      const result = await service.queryIndexTimestamp();

      expect(result).toEqual({ timestamp: '2024-01-15T10:30:00.000Z' });
      expect(mockMcpClient.callTool).toHaveBeenCalledWith('get_index_timestamp');
    });

    it('should return null timestamp when server has no indexed files', async () => {
      mockMcpClient.callTool.mockResolvedValue({ timestamp: null });

      const result = await service.queryIndexTimestamp();

      expect(result).toEqual({ timestamp: null });
    });
  });

  describe('buildAndTransfer', () => {
    it('should stat, read, and transfer all files when sinceTimestamp is null', async () => {
      const uris = setupMultipleFiles([
        {
          path: '/workspace/src/a.ts',
          content: 'const a = 1;',
          mtime: new Date('2024-01-01T00:00:00Z').getTime(),
        },
        {
          path: '/workspace/src/b.ts',
          content: 'const b = 2;',
          mtime: new Date('2024-01-02T00:00:00Z').getTime(),
        },
      ]);
      mockMcpClient.callTool.mockResolvedValue(undefined);

      const count = await service.buildAndTransfer(uris, null);

      expect(count).toBe(2);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });

    it('should skip reading and transferring files older than sinceTimestamp', async () => {
      const uris = setupMultipleFiles([
        {
          path: '/workspace/src/old.ts',
          content: 'old file',
          mtime: new Date('2024-01-01T00:00:00Z').getTime(),
        },
        {
          path: '/workspace/src/new.ts',
          content: 'new file',
          mtime: new Date('2024-01-03T00:00:00Z').getTime(),
        },
      ]);
      mockMcpClient.callTool.mockResolvedValue(undefined);

      const count = await service.buildAndTransfer(
        uris,
        '2024-01-02T00:00:00.000Z',
      );

      expect(count).toBe(1);
      // stat is called for both files, but readFile only for the newer one
      expect(mockStat).toHaveBeenCalledTimes(2);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith('transfer_file', {
        path: 'src/new.ts',
        content: 'new file',
        languageId: 'typescript',
        lastModified: '2024-01-03T00:00:00.000Z',
      });
    });

    it('should return 0 for empty URI list', async () => {
      const count = await service.buildAndTransfer([], null);

      expect(count).toBe(0);
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('should respect concurrency limit', async () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        path: `/workspace/src/file${i}.ts`,
        content: `const x${i} = ${i};`,
        mtime: new Date('2024-01-01T00:00:00Z').getTime() + i * 86400000,
      }));
      const uris = setupMultipleFiles(files);

      let concurrent = 0;
      let maxConcurrent = 0;

      mockMcpClient.callTool.mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      });

      await service.buildAndTransfer(uris, null, 3);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(10);
    });

    it('should continue processing when individual files fail', async () => {
      const encoder = new TextEncoder();

      mockStat.mockImplementation((u: any) => {
        if (u.fsPath === '/workspace/src/bad.ts') {
          return Promise.reject(new Error('Permission denied'));
        }
        return Promise.resolve({
          mtime: new Date('2024-01-02T00:00:00Z').getTime(),
        });
      });

      mockReadFile.mockImplementation((u: any) => {
        return Promise.resolve(encoder.encode('good content'));
      });

      mockAsRelativePath.mockImplementation((uri: any) => {
        const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
        return fsPath.replace('/workspace/', '');
      });

      mockMcpClient.callTool.mockResolvedValue(undefined);

      const uris = [
        makeUri('/workspace/src/good.ts'),
        makeUri('/workspace/src/bad.ts'),
        makeUri('/workspace/src/also-good.ts'),
      ];

      const count = await service.buildAndTransfer(uris, null);

      expect(count).toBe(2);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    });
  });
});
