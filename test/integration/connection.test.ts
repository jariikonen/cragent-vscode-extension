import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMockMcpServer, MockServerHandle } from './helpers/mockMcpServer';
import { MCPClient } from '../../src/connection/MCPClient';

// Mock vscode module — ConnectionManager imports it
const mockShowErrorMessage = vi.fn();
const mockEventListeners: Array<(value: boolean) => void> = [];

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    fire: vi.fn((value: boolean) => {
      mockEventListeners.forEach((l) => l(value));
    }),
    event: vi.fn((listener: (value: boolean) => void) => {
      mockEventListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    dispose: vi.fn(),
  })),
}));

import { DefaultConnectionManager } from '../../src/connection/ConnectionManager';

describe('Integration: MCP Connection Lifecycle', () => {
  let server: MockServerHandle;

  beforeAll(async () => {
    server = await createMockMcpServer([
      {
        name: 'echo',
        description: 'Echoes back the input',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        handler: async (args) => ({
          content: [{ type: 'text', text: `Echo: ${args.message}` }],
        }),
      },
      {
        name: 'review_code',
        description: 'Reviews code',
        inputSchema: {
          type: 'object',
          properties: { source: { type: 'string' } },
          required: ['source'],
        },
        handler: async () => ({
          content: [{ type: 'text', text: JSON.stringify([]) }],
        }),
      },
    ]);
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventListeners.length = 0;
  });

  describe('MCPClient direct connection', () => {
    it('should connect to the mock MCP server and report isConnected = true', async () => {
      const client = new MCPClient(`http://127.0.0.1:${server.port}`, undefined);

      expect(client.isConnected).toBe(false);
      await client.connect();
      expect(client.isConnected).toBe(true);

      await client.disconnect();
      expect(client.isConnected).toBe(false);
    });

    it('should call a tool and receive a response', async () => {
      const client = new MCPClient(`http://127.0.0.1:${server.port}`, undefined);
      await client.connect();

      const result = (await client.callTool('echo', { message: 'hello' })) as any;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toBe('Echo: hello');

      await client.disconnect();
    });

    it('should throw when calling a tool while disconnected', async () => {
      const client = new MCPClient(`http://127.0.0.1:${server.port}`, undefined);

      await expect(client.callTool('echo', { message: 'test' })).rejects.toThrow(
        'MCPClient is not connected',
      );
    });

    it('should handle full connect → call tool → disconnect lifecycle', async () => {
      const client = new MCPClient(`http://127.0.0.1:${server.port}`, undefined);

      // Phase 1: Connect
      expect(client.isConnected).toBe(false);
      await client.connect();
      expect(client.isConnected).toBe(true);

      // Phase 2: Call tool
      const result = (await client.callTool('review_code', { source: 'const x = 1;' })) as any;
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();

      // Phase 3: Disconnect
      await client.disconnect();
      expect(client.isConnected).toBe(false);

      // Phase 4: Verify tool calls fail after disconnect
      await expect(client.callTool('echo', { message: 'test' })).rejects.toThrow();
    });
  });

  describe('ConnectionManager integration', () => {
    it('should connect via ConnectionManager and report isConnected = true', async () => {
      const mockConfigManager = {
        getConfig: vi.fn().mockReturnValue({
          serverUrl: `http://127.0.0.1:${server.port}`,
          requestTimeoutMs: 30000,
          maxConcurrentTransfers: 5,
          showInformationFindings: true,
          sortField: 'priority',
          filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
        }),
        getAuthToken: vi.fn().mockResolvedValue(undefined),
        isLocalAddress: vi.fn().mockReturnValue(true),
      } as any;

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger);

      expect(connectionManager.isConnected).toBe(false);
      await connectionManager.connect();
      expect(connectionManager.isConnected).toBe(true);

      const client = connectionManager.getClient();
      expect(client).not.toBeNull();

      await connectionManager.disconnect();
      expect(connectionManager.isConnected).toBe(false);
      expect(connectionManager.getClient()).toBeNull();
    });

    it('should fire onDidChangeConnection events during lifecycle', async () => {
      const mockConfigManager = {
        getConfig: vi.fn().mockReturnValue({
          serverUrl: `http://127.0.0.1:${server.port}`,
          requestTimeoutMs: 30000,
          maxConcurrentTransfers: 5,
          showInformationFindings: true,
          sortField: 'priority',
          filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
        }),
        getAuthToken: vi.fn().mockResolvedValue(undefined),
        isLocalAddress: vi.fn().mockReturnValue(true),
      } as any;

      const mockLogger = { log: vi.fn(), show: vi.fn(), dispose: vi.fn() };
      const connectionManager = new DefaultConnectionManager(mockConfigManager, mockLogger);

      const stateChanges: boolean[] = [];
      connectionManager.onDidChangeConnection((connected) => {
        stateChanges.push(connected);
      });

      await connectionManager.connect();
      await connectionManager.disconnect();

      expect(stateChanges).toEqual([true, false]);
    });
  });
});
