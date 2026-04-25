import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Feature: vscode-code-review-extension, Property 9: Remote Address Authentication

/**
 * Property 9: Remote Address Authentication
 *
 * For any configured server URL whose hostname is not localhost, 127.0.0.1,
 * or ::1, and for any configured auth token, every MCP request SHALL include
 * an Authorization: Bearer <token> header; and for any URL whose hostname is
 * one of those three local values, no Authorization header SHALL be added.
 *
 * Validates: Requirements 1.3, 1.4
 */

// Collect all transport constructor calls for inspection
const transportConstructorCalls: Array<{ url: URL; opts: any }> = [];

const mockClientConnect = vi.fn().mockResolvedValue(undefined);
const mockClientClose = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: vi.fn().mockImplementation(function() { return {
    connect: mockClientConnect,
    close: mockClientClose,
    callTool: vi.fn(),
  }; }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function(url: URL, opts: any) {
    transportConstructorCalls.push({ url, opts });
    return {
      onclose: null,
      onerror: null,
      onmessage: null,
      start: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    };
  }),
}));

import { MCPClient } from '../../src/connection/MCPClient';

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];

describe('Property 9: Remote Address Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportConstructorCalls.length = 0;
  });

  it('should include Authorization: Bearer header for remote addresses with a token', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.domain().filter((d) => !LOCAL_HOSTNAMES.includes(d.toLowerCase())),
        fc.string({ minLength: 1 }),
        async (hostname, token) => {
          transportConstructorCalls.length = 0;

          const url = `http://${hostname}:3000/mcp`;
          const client = new MCPClient(url, token);
          await client.connect();

          expect(transportConstructorCalls).toHaveLength(1);
          const { opts } = transportConstructorCalls[0];
          const headers = opts?.requestInit?.headers;
          expect(headers).toBeDefined();
          expect(headers['Authorization']).toBe(`Bearer ${token}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should NOT include Authorization header for local addresses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('localhost', '127.0.0.1', '[::1]'),
        fc.string({ minLength: 1 }),
        async (hostname, token) => {
          transportConstructorCalls.length = 0;

          const url = `http://${hostname}:3000/mcp`;
          const client = new MCPClient(url, token);
          await client.connect();

          expect(transportConstructorCalls).toHaveLength(1);
          const { opts } = transportConstructorCalls[0];
          const headers = opts?.requestInit?.headers;
          // Either no headers object, or no Authorization key
          if (headers) {
            expect(headers['Authorization']).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should NOT include Authorization header when no token is provided for remote addresses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.domain().filter((d) => !LOCAL_HOSTNAMES.includes(d.toLowerCase())),
        async (hostname) => {
          transportConstructorCalls.length = 0;

          const url = `http://${hostname}:3000/mcp`;
          const client = new MCPClient(url, undefined);
          await client.connect();

          expect(transportConstructorCalls).toHaveLength(1);
          const { opts } = transportConstructorCalls[0];
          const headers = opts?.requestInit?.headers;
          if (headers) {
            expect(headers['Authorization']).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should correctly distinguish local from remote hostnames', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // Local hostnames
          fc.constantFrom('localhost', '127.0.0.1', '[::1]').map((h) => ({
            hostname: h,
            isLocal: true,
          })),
          // Remote hostnames
          fc.domain()
            .filter((d) => !LOCAL_HOSTNAMES.includes(d.toLowerCase()))
            .map((h) => ({ hostname: h, isLocal: false })),
        ),
        fc.string({ minLength: 1 }),
        async ({ hostname, isLocal }, token) => {
          transportConstructorCalls.length = 0;

          const url = `http://${hostname}:3000/mcp`;
          const client = new MCPClient(url, token);
          await client.connect();

          expect(transportConstructorCalls).toHaveLength(1);
          const { opts } = transportConstructorCalls[0];
          const headers = opts?.requestInit?.headers;

          if (isLocal) {
            // Local: no Authorization header
            if (headers) {
              expect(headers['Authorization']).toBeUndefined();
            }
          } else {
            // Remote with token: Authorization header present
            expect(headers).toBeDefined();
            expect(headers['Authorization']).toBe(`Bearer ${token}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
