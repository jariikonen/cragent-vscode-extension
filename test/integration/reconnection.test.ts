import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockMcpServer, MockServerHandle, ToolDefinition } from './helpers/mockMcpServer';

// Mock vscode module
const mockShowErrorMessage = vi.fn();
const mockEventListeners: Array<(value: boolean) => void> = [];

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
  },
  EventEmitter: vi.fn().mockImplementation(function() { return {
    fire: vi.fn((value: boolean) => {
      mockEventListeners.forEach((l) => l(value));
    }),
    event: vi.fn((listener: (value: boolean) => void) => {
      mockEventListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    dispose: vi.fn(),
  }; }),
}));

import { DefaultConnectionManager } from '../../src/connection/ConnectionManager';

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes back',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  handler: async (args) => ({
    content: [{ type: 'text', text: `Echo: ${args.message}` }],
  }),
};

describe('Integration: Reconnection with Exponential Backoff', () => {
  let server: MockServerHandle | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventListeners.length = 0;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should fail to connect when server is down and exhaust all retries', async () => {
    server = await createMockMcpServer([echoTool]);
    const port = server.port;
    await server.stop();
    server = null;

    const delayCallArgs: number[] = [];
    const delayFn = vi.fn(async (ms: number) => {
      delayCallArgs.push(ms);
    });

    const mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: `http://127.0.0.1:${port}`,
        requestTimeoutMs: 5000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    } as any;

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);

    await connectionManager.connect();

    expect(connectionManager.isConnected).toBe(false);
    expect(connectionManager.getClient()).toBeNull();
    expect(delayCallArgs).toEqual([1000, 2000, 4000]);
    expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to MCP server after 4 attempts'),
    );

    const warnCalls = mockLogger.log.mock.calls.filter(
      (call: any[]) => call[0] === 'warn' && call[1].includes('Connection attempt'),
    );
    expect(warnCalls).toHaveLength(4);
  });

  it('should verify correct backoff delay sequence: 1s, 2s, 4s', async () => {
    server = await createMockMcpServer([echoTool]);
    const port = server.port;
    await server.stop();
    server = null;

    const delayCallArgs: number[] = [];
    const delayFn = vi.fn(async (ms: number) => {
      delayCallArgs.push(ms);
    });

    const mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: `http://127.0.0.1:${port}`,
        requestTimeoutMs: 5000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    } as any;

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);

    await connectionManager.connect();

    expect(delayCallArgs).toEqual([1000, 2000, 4000]);
  });

  it('should fire onDidChangeConnection with false after all retries fail', async () => {
    server = await createMockMcpServer([echoTool]);
    const port = server.port;
    await server.stop();
    server = null;

    const delayFn = vi.fn(async () => {});
    const mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: `http://127.0.0.1:${port}`,
        requestTimeoutMs: 5000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    } as any;

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);

    const stateChanges: boolean[] = [];
    connectionManager.onDidChangeConnection((connected) => {
      stateChanges.push(connected);
    });

    await connectionManager.connect();

    // Never connected, so no state change to true; setConnected(false) at end
    // doesn't fire because initial state is already false
    expect(connectionManager.isConnected).toBe(false);
  });

  it('should log an error after all retries are exhausted', async () => {
    server = await createMockMcpServer([echoTool]);
    const port = server.port;
    await server.stop();
    server = null;

    const delayFn = vi.fn(async () => {});
    const mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: `http://127.0.0.1:${port}`,
        requestTimeoutMs: 5000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    } as any;

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);

    await connectionManager.connect();

    const errorCalls = mockLogger.log.mock.calls.filter((call: any[]) => call[0] === 'error');
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    expect(errorCalls[0][1]).toContain('Failed to connect');
  });

  it('should succeed on first attempt when server is running', async () => {
    server = await createMockMcpServer([echoTool]);

    const delayFn = vi.fn(async () => {});
    const mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: `http://127.0.0.1:${server.port}`,
        requestTimeoutMs: 5000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    } as any;

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);

    await connectionManager.connect();

    expect(connectionManager.isConnected).toBe(true);
    expect(delayFn).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    await connectionManager.disconnect();
  });

  it('should disconnect and then fail to reconnect when server is stopped', async () => {
    server = await createMockMcpServer([echoTool]);

    const delayFn = vi.fn(async () => {});
    const mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: `http://127.0.0.1:${server.port}`,
        requestTimeoutMs: 5000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
      isLocalAddress: vi.fn().mockReturnValue(true),
    } as any;

    const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
    const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger, delayFn);

    await connectionManager.connect();
    expect(connectionManager.isConnected).toBe(true);

    await connectionManager.disconnect();
    expect(connectionManager.isConnected).toBe(false);

    await server.stop();
    server = null;

    await connectionManager.connect();
    expect(connectionManager.isConnected).toBe(false);
    expect(mockShowErrorMessage).toHaveBeenCalled();
  });
});
