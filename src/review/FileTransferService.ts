import * as vscode from 'vscode';
import { MCPClient } from '../connection/MCPClient';
import { Logger } from '../ui/OutputChannelLogger';

export interface IndexTimestampResponse {
  timestamp: string | null; // ISO 8601 or null
}

export interface FilePayload {
  path: string; // workspace-relative path
  content: string;
  languageId: string;
  lastModified: string; // ISO 8601
}

export interface FileTransferService {
  queryIndexTimestamp(): Promise<IndexTimestampResponse>;
  buildFilePayloads(
    uris: vscode.Uri[],
    sinceTimestamp: string | null,
  ): Promise<FilePayload[]>;
  transferFilesParallel(payloads: FilePayload[]): Promise<void>;
}

/**
 * Filters file payloads by timestamp.
 *
 * When `sinceTimestamp` is non-null, returns only payloads whose
 * `lastModified` is strictly after `sinceTimestamp` (ISO 8601 comparison).
 * When `sinceTimestamp` is null, returns all payloads.
 *
 * Exported as a pure function for direct property-based testing.
 */
export function filterByTimestamp(
  payloads: FilePayload[],
  sinceTimestamp: string | null,
): FilePayload[] {
  if (sinceTimestamp === null) {
    return payloads;
  }
  return payloads.filter((p) => p.lastModified > sinceTimestamp);
}

/**
 * Default implementation of FileTransferService.
 *
 * Uses MCPClient for server communication and vscode.workspace.fs for
 * reading file content and stat information.
 */
export class DefaultFileTransferService implements FileTransferService {
  constructor(
    private readonly mcpClient: MCPClient,
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
   * Reads each file's content and lastModified time, then filters to only
   * files modified after `sinceTimestamp` (or all files when null).
   */
  async buildFilePayloads(
    uris: vscode.Uri[],
    sinceTimestamp: string | null,
  ): Promise<FilePayload[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    const allPayloads = await Promise.all(
      uris.map(async (uri) => {
        try {
          const [contentBytes, stat] = await Promise.all([
            vscode.workspace.fs.readFile(uri),
            vscode.workspace.fs.stat(uri),
          ]);

          const content = Buffer.from(contentBytes).toString('utf-8');
          const lastModified = new Date(stat.mtime).toISOString();

          // Compute workspace-relative path
          let relativePath = uri.fsPath;
          if (workspaceFolder) {
            relativePath = vscode.workspace.asRelativePath(uri, false);
          }

          // Determine language ID from the file extension
          const languageId = this.getLanguageId(uri);

          return {
            path: relativePath,
            content,
            languageId,
            lastModified,
          } as FilePayload;
        } catch (error) {
          this.logger.log('warn', `Failed to read file: ${uri.fsPath}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      }),
    );

    // Remove any files that failed to read
    const validPayloads = allPayloads.filter(
      (p): p is FilePayload => p !== null,
    );

    // Apply timestamp filtering
    return filterByTimestamp(validPayloads, sinceTimestamp);
  }

  /**
   * Sends all file payloads to the MCP server in parallel using Promise.all.
   */
  async transferFilesParallel(payloads: FilePayload[]): Promise<void> {
    this.logger.log('info', `Transferring ${payloads.length} files in parallel`);

    await Promise.all(
      payloads.map((payload) =>
        this.mcpClient.callTool('transfer_file', {
          path: payload.path,
          content: payload.content,
          languageId: payload.languageId,
          lastModified: payload.lastModified,
        }),
      ),
    );

    this.logger.log('info', `Successfully transferred ${payloads.length} files`);
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
