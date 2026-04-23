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

  function setupFile(path: string, content: string, mtime: number) {
    const uri = makeUri(path);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(content);

    mockReadFile.mockImplementation((u: any) => {
      if (u.fsPath === path) {
        return Promise.resolve(encoded);
      }
      return Promise.reject(new Error('File not found'));
    });

    mockStat.mockImplementation((u: any) => {
      if (u.fsPath === path) {
        return Promise.resolve({ mtime });
      }
      return Promise.reject(new Error('File not found'));
    });

    return uri;
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

  describe('buildFilePayloads', () => {
    it('should include all files when sinceTimestamp is null', async () => {
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
        {
          path: '/workspace/src/c.ts',
          content: 'const c = 3;',
          mtime: new Date('2024-01-03T00:00:00Z').getTime(),
        },
      ]);

      const payloads = await service.buildFilePayloads(uris, null);

      expect(payloads).toHaveLength(3);
      expect(payloads.map((p) => p.content)).toEqual([
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
      ]);
    });

    it('should include only newer files when sinceTimestamp is provided', async () => {
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

      const sinceTimestamp = '2024-01-02T00:00:00.000Z';
      const payloads = await service.buildFilePayloads(uris, sinceTimestamp);

      expect(payloads).toHaveLength(1);
      expect(payloads[0].content).toBe('new file');
    });

    it('should exclude files with lastModified equal to sinceTimestamp (strictly after)', async () => {
      const exactTime = new Date('2024-01-02T00:00:00Z');
      const uris = setupMultipleFiles([
        {
          path: '/workspace/src/exact.ts',
          content: 'exact time file',
          mtime: exactTime.getTime(),
        },
        {
          path: '/workspace/src/after.ts',
          content: 'after time file',
          mtime: new Date('2024-01-03T00:00:00Z').getTime(),
        },
      ]);

      const sinceTimestamp = exactTime.toISOString();
      const payloads = await service.buildFilePayloads(uris, sinceTimestamp);

      expect(payloads).toHaveLength(1);
      expect(payloads[0].content).toBe('after time file');
    });

    it('should return empty array for empty URI list', async () => {
      const payloads = await service.buildFilePayloads([], null);

      expect(payloads).toHaveLength(0);
      expect(payloads).toEqual([]);
    });
  });

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

  describe('transferFilesParallel', () => {
    it('should call MCP tool for each payload in parallel', async () => {
      mockMcpClient.callTool.mockResolvedValue(undefined);

      const payloads = [
        {
          path: 'src/a.ts',
          content: 'const a = 1;',
          languageId: 'typescript',
          lastModified: '2024-01-01T00:00:00.000Z',
        },
        {
          path: 'src/b.ts',
          content: 'const b = 2;',
          languageId: 'typescript',
          lastModified: '2024-01-02T00:00:00.000Z',
        },
      ];

      await service.transferFilesParallel(payloads);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith('transfer_file', {
        path: 'src/a.ts',
        content: 'const a = 1;',
        languageId: 'typescript',
        lastModified: '2024-01-01T00:00:00.000Z',
      });
      expect(mockMcpClient.callTool).toHaveBeenCalledWith('transfer_file', {
        path: 'src/b.ts',
        content: 'const b = 2;',
        languageId: 'typescript',
        lastModified: '2024-01-02T00:00:00.000Z',
      });
    });
  });
});
