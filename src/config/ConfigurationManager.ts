import * as vscode from 'vscode';

export interface ExtensionConfig {
  serverUrl: string;
  requestTimeoutMs: number;
  maxConcurrentTransfers: number;
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
  deleteAuthToken(): Promise<void>;
  onDidChangeConfig(listener: (config: ExtensionConfig) => void): vscode.Disposable;
  isLocalAddress(url: string): boolean;
  validateUrl(url: string): boolean;
}

export class DefaultConfigurationManager implements ConfigurationManager {
  private hasShownUrlValidationError = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Validate URL on startup
    this.validateAndWarnServerUrl();
    
    // Validate URL whenever configuration changes
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeReview.serverUrl')) {
        this.hasShownUrlValidationError = false; // Reset flag on config change
        this.validateAndWarnServerUrl();
      }
    });
  }

  private validateAndWarnServerUrl(): void {
    const config = vscode.workspace.getConfiguration('codeReview');
    const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000/mcp');
    
    if (!this.validateUrl(serverUrl)) {
      if (!this.hasShownUrlValidationError) {
        vscode.window.showErrorMessage(
          `Code Review: Invalid server URL "${serverUrl}". Please provide a valid URL in settings.`,
          'Open Settings'
        ).then(selection => {
          if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'codeReview.serverUrl');
          }
        });
        this.hasShownUrlValidationError = true;
      }
    }
  }

  getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('codeReview');
    
    return {
      serverUrl: config.get<string>('serverUrl', 'http://localhost:3000/mcp'),
      requestTimeoutMs: config.get<number>('requestTimeoutMs', 30000),
      maxConcurrentTransfers: config.get<number>('maxConcurrentTransfers', 5),
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

  async deleteAuthToken(): Promise<void> {
    await this.context.secrets.delete('codeReview.authToken');
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

  validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
