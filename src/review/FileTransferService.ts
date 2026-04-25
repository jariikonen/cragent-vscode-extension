import * as vscode from 'vscode';
import { MCPClientInterface } from '../connection/MCPClient.js';
import { Logger } from '../ui/OutputChannelLogger.js';

export interface IndexTimestampResponse {
  timestamp: string | null; // ISO 8601 or null
}

export interface FilePayload {
  path: string; // workspace-relative path
  content: string;
  languageId: string;
  lastModified: string; // ISO 8601
}

export const DEFAULT_MAX_CONCURRENT_TRANSFERS = 5;

export interface FileTransferService {
  queryIndexTimestamp(): Promise<IndexTimestampResponse>;
  buildAndTransfer(
    uris: vscode.Uri[],
    sinceTimestamp: string | null,
    concurrency?: number,
  ): Promise<number>;
}

/**
 * Default implementation of FileTransferService.
 *
 * Uses MCPClient for server communication and vscode.workspace.fs for
 * reading file content and stat information.
 */
export class DefaultFileTransferService implements FileTransferService {
  constructor(
    private readonly mcpClient: MCPClientInterface,
    private readonly logger: Logger,
  ) {}

  /**
   * Queries the MCP server for the current index timestamp.
   * Returns `{ timestamp: null }` when the server has no indexed files.
   */
  async queryIndexTimestamp(): Promise<IndexTimestampResponse> {
    this.logger.log('info', 'Querying index timestamp from MCP server');

    const result = await this.mcpClient.callTool('get_index_timestamp');
    const response = result as { timestamp?: string | null };
    const timestamp = response?.timestamp ?? null;

    this.logger.log('info', 'Received index timestamp', { timestamp });
    return { timestamp };
  }

  /**
   * Fused stat → filter → read → transfer pipeline with bounded concurrency.
   *
   * Each worker picks a URI, stats it, checks the timestamp filter, reads the
   * content only if it passes, transfers it, and moves on. At most
   * `concurrency` file contents are in memory at any time.
   *
   * Returns the number of files actually transferred.
   */
  async buildAndTransfer(
    uris: vscode.Uri[],
    sinceTimestamp: string | null,
    concurrency: number = DEFAULT_MAX_CONCURRENT_TRANSFERS,
  ): Promise<number> {
    const poolSize = Math.max(1, Math.floor(concurrency));
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    let transferred = 0;
    let index = 0;

    this.logger.log('info', `Starting build-and-transfer for ${uris.length} files with concurrency ${poolSize}`);

    const worker = async (): Promise<void> => {
      while (index < uris.length) {
        const current = index++;
        const uri = uris[current];

        try {
          // Phase 1: stat to get lastModified
          const stat = await vscode.workspace.fs.stat(uri);
          const lastModified = new Date(stat.mtime).toISOString();

          // Phase 2: filter by timestamp
          if (sinceTimestamp !== null && lastModified <= sinceTimestamp) {
            continue;
          }

          // Phase 3: read content (only for files that pass the filter)
          const contentBytes = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(contentBytes).toString('utf-8');

          let relativePath = uri.fsPath;
          if (workspaceFolder) {
            relativePath = vscode.workspace.asRelativePath(uri, false);
          }

          const languageId = this.getLanguageId(uri);

          // Phase 4: transfer immediately, then content can be GC'd
          await this.mcpClient.callTool('transfer_file', {
            path: relativePath,
            content,
            languageId,
            lastModified,
          });

          transferred++;
        } catch (error) {
          this.logger.log('warn', `Failed to process file: ${uri.fsPath}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    if (uris.length === 0) {
      this.logger.log('info', 'No files to transfers');
      return transferred;
    }

    const workers = Array.from(
      { length: Math.min(poolSize, uris.length) },
      () => worker(),
    );
    await Promise.all(workers);

    this.logger.log('info', `Successfully transferred ${transferred} of ${uris.length} files`);
    return transferred;
  }

  /**
   * Derives a language identifier from the file URI extension.
   */
  private getLanguageId(uri: vscode.Uri): string {
    const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      py: 'python',
      rb: 'ruby',
      java: 'java',
      go: 'go',
      rs: 'rust',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      json: 'json',
      md: 'markdown',
      html: 'html',
      css: 'css',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      sh: 'shellscript',
      bash: 'shellscript',
    };
    return languageMap[ext] ?? 'plaintext';
  }
}
