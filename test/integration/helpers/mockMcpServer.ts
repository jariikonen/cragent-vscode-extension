/**
 * Shared helper for creating in-process mock MCP servers for integration tests.
 *
 * Uses the MCP SDK's Server + StreamableHTTPServerTransport with proper
 * session management. Each client session gets its own transport, and the
 * Server instance handles multiple concurrent transports.
 */
import * as http from 'http';
import * as crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

export interface MockServerHandle {
  /** The HTTP server instance */
  httpServer: http.Server;
  /** The port the server is listening on */
  port: number;
  /** Stop the server and clean up all transports */
  stop(): Promise<void>;
}

/**
 * Creates and starts a mock MCP server on a random available port.
 *
 * Each client session gets its own Server + Transport pair, avoiding the
 * "already connected" error that occurs when sharing a single McpServer.
 *
 * @param tools - Array of tool definitions to register
 * @returns A handle to the running server
 */
export async function createMockMcpServer(
  tools: ToolDefinition[],
): Promise<MockServerHandle> {
  const transports = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

  function createServerForSession(): { server: Server; transport: StreamableHTTPServerTransport } {
    const server = new Server(
      { name: 'mock-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    // Register list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: 'object' as const, properties: {} },
        })),
      };
    });

    // Register call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) {
        return {
          content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
          isError: true,
        };
      }
      return tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    return { server, transport };
  }

  const httpServer = http.createServer(async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const entry = transports.get(sessionId)!;
      await entry.transport.handleRequest(req, res);
      return;
    }

    // New session — create a fresh server + transport pair
    const { server, transport } = createServerForSession();

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);

    // Store after handleRequest so sessionId is populated
    if (transport.sessionId && !transports.has(transport.sessionId)) {
      transports.set(transport.sessionId, { transport, server });
    }
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address() as { port: number };
      resolve(addr.port);
    });
  });

  const stop = async () => {
    for (const entry of transports.values()) {
      await entry.transport.close().catch(() => {});
      await entry.server.close().catch(() => {});
    }
    transports.clear();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { httpServer, port, stop };
}
