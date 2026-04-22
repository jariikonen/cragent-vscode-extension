import * as vscode from 'vscode';
import { MCPClient } from './MCPClient';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { Logger } from '../ui/OutputChannelLogger';

/** Delays between retries (not including the initial attempt). */
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length; // 1 initial + 3 retries = 4

export interface ConnectionManager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getClient(): MCPClient | null;
  readonly isConnected: boolean;
  onDidChangeConnection(listener: (connected: boolean) => void): vscode.Disposable;
}

/**
 * Manages the lifecycle of the MCP client connection with exponential backoff retry.
 *
 * Makes one initial attempt, then retries up to 3 more times with delays of
 * 1 s, 2 s, 4 s between each retry. After all attempts are exhausted, shows a
 * VS Code error notification.
 */
export class DefaultConnectionManager implements ConnectionManager {
  private client: MCPClient | null = null;
  private _isConnected = false;
  private readonly emitter = new vscode.EventEmitter<boolean>();

  /** Injected delay function — overridable for testing. */
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(
    private readonly configManager: ConfigurationManager,
    private readonly logger: Logger,
    delayFn?: (ms: number) => Promise<void>,
  ) {
    this.delayFn = delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  getClient(): MCPClient | null {
    return this.client;
  }

  /**
   * Connects to the MCP server using the current configuration.
   * Makes one initial attempt, then retries up to 3 more times with
   * exponential backoff (1 s → 2 s → 4 s) on failure.
   */
  async connect(): Promise<void> {
    // Disconnect any existing connection first
    if (this.client) {
      await this.disconnect();
    }

    const config = this.configManager.getConfig();
    const authToken = await this.configManager.getAuthToken();

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        this.client = new MCPClient(config.serverUrl, authToken);
        await this.client.connect();
        this.setConnected(true);
        this.logger.log('info', 'Connected to MCP server', { serverUrl: config.serverUrl });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.log('warn', `Connection attempt ${attempt + 1} failed`, {
          error: lastError.message,
          serverUrl: config.serverUrl,
        });

        // Wait before the next retry (no delay after the last attempt)
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.delayFn(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    // All attempts exhausted
    this.setConnected(false);
    this.client = null;

    const message = `Code Review: Failed to connect to MCP server after ${MAX_ATTEMPTS} attempts. ${lastError?.message ?? ''}`;
    this.logger.log('error', message);
    vscode.window.showErrorMessage(message);
  }

  /**
   * Disconnects from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        this.logger.log('warn', 'Error during disconnect', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.client = null;
    }
    this.setConnected(false);
  }

  /**
   * Registers a listener that fires when the connection state changes.
   */
  onDidChangeConnection(listener: (connected: boolean) => void): vscode.Disposable {
    return this.emitter.event(listener);
  }

  private setConnected(connected: boolean): void {
    if (this._isConnected !== connected) {
      this._isConnected = connected;
      this.emitter.fire(connected);
    }
  }
}
