import * as vscode from 'vscode';

export interface ExtensionConfig {
  serverUrl: string;
  requestTimeoutMs: number;
  showInformationFindings: boolean;
  sortField: 'priority' | 'severity' | 'confidence' | 'importance';
  filter: {
    minPriority: number;
    minSeverity: number;
    minConfidence: number;
    minImportance: number;
  };
}

export interface ConfigurationManager {
  getConfig(): ExtensionConfig;
  getAuthToken(): Promise<string | undefined>;
  setAuthToken(token: string): Promise<void>;
  onDidChangeConfig(listener: (config: ExtensionConfig) => void): vscode.Disposable;
  isLocalAddress(url: string): boolean;
}

export class DefaultConfigurationManager implements ConfigurationManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('codeReview');
    
    return {
      serverUrl: config.get<string>('serverUrl', 'http://localhost:3000/mcp'),
      requestTimeoutMs: config.get<number>('requestTimeoutMs', 30000),
      showInformationFindings: config.get<boolean>('showInformationFindings', true),
      sortField: config.get<'priority' | 'severity' | 'confidence' | 'importance'>('sortField', 'priority'),
      filter: {
        minPriority: config.get<number>('filter.minPriority', 0.0),
        minSeverity: config.get<number>('filter.minSeverity', 0.0),
        minConfidence: config.get<number>('filter.minConfidence', 0.0),
        minImportance: config.get<number>('filter.minImportance', 0.0),
      },
    };
  }

  async getAuthToken(): Promise<string | undefined> {
    return await this.context.secrets.get('codeReview.authToken');
  }

  async setAuthToken(token: string): Promise<void> {
    await this.context.secrets.store('codeReview.authToken', token);
  }

  onDidChangeConfig(listener: (config: ExtensionConfig) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeReview')) {
        listener(this.getConfig());
      }
    });
  }

  isLocalAddress(url: string): boolean {
    try {
      const parsed = new URL(url);
      // For IPv6 addresses, hostname includes the brackets, so we need to strip them
      let hostname = parsed.hostname.toLowerCase();
      
      // Remove brackets from IPv6 addresses
      if (hostname.startsWith('[') && hostname.endsWith(']')) {
        hostname = hostname.slice(1, -1);
      }
      
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
      return false;
    }
  }
}
