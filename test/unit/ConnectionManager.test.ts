import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultConnectionManager } from '../../src/connection/ConnectionManager';

// Mock vscode module
const { mockShowErrorMessage, mockEventEmitter } = vi.hoisted(() => {
  const listeners: Array<(value: boolean) => void> = [];
  return {
    mockShowErrorMessage: vi.fn(),
    mockEventEmitter: {
      fire: vi.fn((value: boolean) => {
        listeners.forEach((l) => l(value));
      }),
      event: vi.fn((listener: (value: boolean) => void) => {
        listeners.push(listener);
        return { dispose: vi.fn() };
      }),
      dispose: vi.fn(),
      _listeners: listeners,
    },
  };
});

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
  },
  EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
}));

// Mock MCPClient
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../../src/connection/MCPClient', () => ({
  MCPClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    isConnected: false,
    getClient: vi.fn().mockReturnValue(null),
  })),
}));

describe('ConnectionManager', () => {
  let connectionManager: DefaultConnectionManager;
  let mockConfigManager: any;
  let mockLogger: any;
  let delayCallArgs: number[];
  let delayFn: (ms: number) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventEmitter._listeners.length = 0;
    delayCallArgs = [];

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: 'http://localhost:3000/mcp',
        requestTimeoutMs: 30000,
        showInformationFindings: true,
        sortField: 'priority',
        filter: {
          minPriority: 0.0,
          minSeverity: 0.0,
          minConfidence: 0.0,
          minImportance: 0.0,
        },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    };

    mockLogger = {
      log: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };

    // Capture delay calls but resolve immediately
    delayFn = vi.fn(async (ms: number) => {
      delayCallArgs.push(ms);
    });

    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);

    connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);
  });

  describe('connect', () => {
    it('should set isConnected to true on successful connect', async () => {
      await connectionManager.connect();

      expect(connectionManager.isConnected).toBe(true);
    });

    it('should log a success message on connect', async () => {
      await connectionManager.connect();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        'Connected to MCP server',
        expect.objectContaining({ serverUrl: 'http://localhost:3000/mcp' }),
      );
    });

    it('should fire onDidChangeConnection with true on successful connect', async () => {
      const listener = vi.fn();
      connectionManager.onDidChangeConnection(listener);

      await connectionManager.connect();

      expect(listener).toHaveBeenCalledWith(true);
    });

    it('should not retry on successful first attempt', async () => {
      await connectionManager.connect();

      expect(delayFn).not.toHaveBeenCalled();
    });

    it('should disconnect existing connection before reconnecting', async () => {
      await connectionManager.connect();

      // Reset mocks for second connect
      mockConnect.mockResolvedValue(undefined);
      mockDisconnect.mockResolvedValue(undefined);

      await connectionManager.connect();

      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('retry on failure', () => {
    it('should retry with correct delay values: 1s, 2s, 4s', async () => {
      // Fail first 3 attempts, succeed on 4th
      mockConnect
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      await connectionManager.connect();

      expect(delayCallArgs).toEqual([1000, 2000, 4000]);
      expect(connectionManager.isConnected).toBe(true);
    });

    it('should succeed on second attempt after one failure', async () => {
      mockConnect
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      await connectionManager.connect();

      expect(delayCallArgs).toEqual([1000]);
      expect(connectionManager.isConnected).toBe(true);
    });

    it('should succeed on third attempt after two failures', async () => {
      mockConnect
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(undefined);

      await connectionManager.connect();

      expect(delayCallArgs).toEqual([1000, 2000]);
      expect(connectionManager.isConnected).toBe(true);
    });

    it('should log a warning for each failed attempt', async () => {
      mockConnect
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce(undefined);

      await connectionManager.connect();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'warn',
        'Connection attempt 1 failed',
        expect.objectContaining({ error: 'fail 1' }),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'warn',
        'Connection attempt 2 failed',
        expect.objectContaining({ error: 'fail 2' }),
      );
    });
  });

  describe('all retries exhausted', () => {
    beforeEach(() => {
      mockConnect.mockRejectedValue(new Error('Server down'));
    });

    it('should show a VS Code error notification', async () => {
      await connectionManager.connect();

      expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect to MCP server after 4 attempts'),
      );
    });

    it('should include the error message in the notification', async () => {
      await connectionManager.connect();

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Server down'),
      );
    });

    it('should set isConnected to false', async () => {
      await connectionManager.connect();

      expect(connectionManager.isConnected).toBe(false);
    });

    it('should log an error message', async () => {
      await connectionManager.connect();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Failed to connect'),
      );
    });

    it('should have attempted all 3 retry delays', async () => {
      await connectionManager.connect();

      expect(delayCallArgs).toEqual([1000, 2000, 4000]);
    });

    it('should have made 4 total connection attempts (1 initial + 3 retries)', async () => {
      await connectionManager.connect();

      expect(mockConnect).toHaveBeenCalledTimes(4);
    });

    it('should set client to null after all retries exhausted', async () => {
      await connectionManager.connect();

      expect(connectionManager.getClient()).toBeNull();
    });
  });

  describe('disconnect', () => {
    it('should set isConnected to false', async () => {
      await connectionManager.connect();
      expect(connectionManager.isConnected).toBe(true);

      await connectionManager.disconnect();
      expect(connectionManager.isConnected).toBe(false);
    });

    it('should fire onDidChangeConnection with false', async () => {
      await connectionManager.connect();

      const listener = vi.fn();
      connectionManager.onDidChangeConnection(listener);

      await connectionManager.disconnect();

      expect(listener).toHaveBeenCalledWith(false);
    });

    it('should call MCPClient.disconnect()', async () => {
      await connectionManager.connect();
      await connectionManager.disconnect();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should set client to null after disconnect', async () => {
      await connectionManager.connect();
      await connectionManager.disconnect();

      expect(connectionManager.getClient()).toBeNull();
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw
      await connectionManager.disconnect();

      expect(connectionManager.isConnected).toBe(false);
    });

    it('should handle disconnect error gracefully', async () => {
      await connectionManager.connect();
      mockDisconnect.mockRejectedValueOnce(new Error('Disconnect failed'));

      // Should not throw
      await connectionManager.disconnect();

      expect(connectionManager.isConnected).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'warn',
        'Error during disconnect',
        expect.objectContaining({ error: 'Disconnect failed' }),
      );
    });
  });

  describe('onDidChangeConnection', () => {
    it('should not fire when connection state does not change', async () => {
      const listener = vi.fn();
      connectionManager.onDidChangeConnection(listener);

      // Disconnect when already disconnected — state doesn't change
      await connectionManager.disconnect();

      expect(listener).not.toHaveBeenCalled();
    });

    it('should return a disposable', () => {
      const disposable = connectionManager.onDidChangeConnection(vi.fn());

      expect(disposable).toBeDefined();
      expect(typeof disposable.dispose).toBe('function');
    });
  });

  describe('configuration integration', () => {
    it('should read server URL from config manager', async () => {
      await connectionManager.connect();

      expect(mockConfigManager.getConfig).toHaveBeenCalled();
    });

    it('should read auth token from config manager', async () => {
      await connectionManager.connect();

      expect(mockConfigManager.getAuthToken).toHaveBeenCalled();
    });
  });
});
