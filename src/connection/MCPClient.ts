import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];

/**
 * Interface describing the public surface of an MCP client.
 * Used to decouple consumers (e.g. FileTransferService) from the concrete class.
 */
export interface MCPClientInterface {
  readonly isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  getClient(): unknown | null;
}

/**
 * Thin wrapper around the MCP SDK Client + StreamableHTTPClientTransport.
 *
 * When an auth token is provided and the server URL is not a local address,
 * an Authorization: Bearer header is attached to every request.
 */
export class MCPClient implements MCPClientInterface {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private _isConnected = false;

  private readonly serverUrl: string;
  private readonly authToken: string | undefined;

  constructor(serverUrl: string, authToken?: string) {
    this.serverUrl = serverUrl;
    this.authToken = authToken;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Establishes a connection to the MCP server.
   * Throws if the connection fails.
   */
  async connect(): Promise<void> {
    const url = new URL(this.serverUrl);

    const requestInit: RequestInit = {};

    // Attach Bearer token for remote addresses when a token is provided
    if (this.authToken && !this.isLocalUrl(url)) {
      requestInit.headers = {
        'Authorization': `Bearer ${this.authToken}`,
      };
    }

    this.transport = new StreamableHTTPClientTransport(url, { requestInit });

    this.client = new Client(
      { name: 'vscode-code-review', version: '0.1.0' },
    );

    // Track connection state via transport lifecycle
    this.transport.onclose = () => {
      this._isConnected = false;
    };

    await this.client.connect(this.transport);
    this._isConnected = true;
  }

  /**
   * Disconnects from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.transport = null;
    this._isConnected = false;
  }

  /**
   * Calls an MCP tool by name with the given arguments.
   * Returns the tool result content.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client || !this._isConnected) {
      throw new Error('MCPClient is not connected');
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  /**
   * Returns the underlying MCP Client instance, or null if not connected.
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Checks whether a URL points to a local address.
   */
  private isLocalUrl(url: URL): boolean {
    let hostname = url.hostname.toLowerCase();

    // Strip brackets from IPv6 addresses
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    return LOCAL_HOSTNAMES.includes(hostname);
  }
}
