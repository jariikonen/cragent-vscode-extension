import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { ConnectionManager } from '../connection/ConnectionManager';
import { FileTransferService } from './FileTransferService';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { Finding, parseFinding } from '../models/Finding';
import { Logger } from '../ui/OutputChannelLogger';

export type ReviewScope =
  | { kind: 'file'; uri: vscode.Uri }
  | { kind: 'selection'; uri: vscode.Uri; range: vscode.Range }
  | { kind: 'workspace' };

export interface ReviewSession {
  id: string;
  scope: ReviewScope;
  cancellationToken: vscode.CancellationToken;
  startedAt: Date;
}

/**
 * Callback interface for applying parsed findings to the display layer.
 * Matches the `applyFindings` method on `FindingDisplayManager`.
 */
export interface FindingApplier {
  applyFindings(uri: vscode.Uri, findings: Finding[]): void;
}

export interface ReviewSessionManager {
  startSession(scope: ReviewScope): Promise<void>;
  cancelSession(uri?: vscode.Uri): void;
  cancelWorkspaceSession(): void;
  readonly activeSessions: Map<string, ReviewSession>;
}

/**
 * Orchestrates review sessions: file transfer, MCP tool invocation,
 * finding parsing, and display delegation.
 *
 * Enforces a single-session-per-URI rule — starting a new session for a URI
 * that already has an active session cancels the old one first.
 */
export class DefaultReviewSessionManager implements ReviewSessionManager {
  private readonly _activeSessions = new Map<string, { session: ReviewSession; cts: vscode.CancellationTokenSource }>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly fileTransferService: FileTransferService,
    private readonly configManager: ConfigurationManager,
    private readonly findingApplier: FindingApplier,
    private readonly logger: Logger,
  ) {}

  get activeSessions(): Map<string, ReviewSession> {
    const result = new Map<string, ReviewSession>();
    for (const [key, value] of this._activeSessions) {
      result.set(key, value.session);
    }
    return result;
  }

  /**
   * Starts a review session for the given scope.
   *
   * If a session already exists for the same URI key, it is cancelled first.
   * Shows a VS Code progress notification while the session runs.
   */
  async startSession(scope: ReviewScope): Promise<void> {
    const key = this.scopeKey(scope);

    // Cancel any existing session for this key
    const existing = this._activeSessions.get(key);
    if (existing) {
      this.logger.log('info', 'Cancelling existing session before starting new one', { key, sessionId: existing.session.id });
      existing.cts.cancel();
      this._activeSessions.delete(key);
    }

    const cts = new vscode.CancellationTokenSource();
    const session: ReviewSession = {
      id: randomUUID(),
      scope,
      cancellationToken: cts.token,
      startedAt: new Date(),
    };

    this._activeSessions.set(key, { session, cts });
    this.logger.log('info', 'Starting review session', { sessionId: session.id, kind: scope.kind, key });

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Code Review',
          cancellable: true,
        },
        async (progress, progressToken) => {
          // Link the progress cancellation to our CTS
          progressToken.onCancellationRequested(() => cts.cancel());

          await this.runSession(session, cts.token, progress);
        },
      );
    } catch (error) {
      if (cts.token.isCancellationRequested) {
        this.logger.log('info', 'Review session was cancelled', { sessionId: session.id });
        vscode.window.showInformationMessage('Code Review: Session cancelled.');
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.log('error', 'Review session failed', { sessionId: session.id, error: message });
        vscode.window.showErrorMessage(`Code Review: ${message}`);
      }
    } finally {
      this._activeSessions.delete(key);
      cts.dispose();
    }
  }

  /**
   * Cancels the session for a specific URI, or all sessions if no URI is given.
   */
  cancelSession(uri?: vscode.Uri): void {
    if (uri) {
      const key = uri.toString();
      const entry = this._activeSessions.get(key);
      if (entry) {
        this.logger.log('info', 'Cancelling session', { key, sessionId: entry.session.id });
        entry.cts.cancel();
        this._activeSessions.delete(key);
      }
    } else {
      this.logger.log('info', 'Cancelling all active sessions', { count: this._activeSessions.size });
      for (const [key, entry] of this._activeSessions) {
        entry.cts.cancel();
      }
      this._activeSessions.clear();
    }
  }

  /**
   * Cancels the active workspace session, if any.
   */
  cancelWorkspaceSession(): void {
    const key = '__workspace__';
    const entry = this._activeSessions.get(key);
    if (entry) {
      this.logger.log('info', 'Cancelling workspace session', { sessionId: entry.session.id });
      entry.cts.cancel();
      this._activeSessions.delete(key);
    }
  }

  /**
   * Core session logic: transfer files, invoke the review tool, parse findings.
   */
  private async runSession(
    session: ReviewSession,
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    this.throwIfCancelled(token);

    const client = this.connectionManager.getClient();
    if (!client) {
      throw new Error('Not connected to MCP server. Please check your connection.');
    }

    const config = this.configManager.getConfig();
    const { scope } = session;

    // Phase 1: Determine files and transfer
    progress.report({ message: 'Transferring files…' });

    if (scope.kind === 'workspace') {
      await this.transferWorkspaceFiles(token, config.maxConcurrentTransfers);
    } else if (scope.kind === 'file') {
      await this.transferSingleFile(scope.uri, token);
    } else if (scope.kind === 'selection') {
      await this.transferSingleFile(scope.uri, token);
    }

    this.throwIfCancelled(token);

    // Phase 2: Invoke the review tool
    progress.report({ message: 'Reviewing code…' });

    const toolArgs = this.buildReviewToolArgs(scope);
    const result = await client.callTool('review_code', toolArgs);

    this.throwIfCancelled(token);

    // Phase 3: Parse findings and apply
    progress.report({ message: 'Processing findings…' });

    const findings = this.parseFindings(result);
    this.applyFindingsForScope(scope, findings);

    this.logger.log('info', 'Review session completed', {
      sessionId: session.id,
      findingsCount: findings.length,
    });
  }

  /**
   * Transfers workspace files using the incremental sync protocol.
   */
  private async transferWorkspaceFiles(
    token: vscode.CancellationToken,
    concurrency: number,
  ): Promise<void> {
    const { timestamp } = await this.fileTransferService.queryIndexTimestamp();
    this.throwIfCancelled(token);

    const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
    this.throwIfCancelled(token);

    await this.fileTransferService.buildAndTransfer(uris, timestamp, concurrency);
  }

  /**
   * Transfers a single file to the MCP server.
   */
  private async transferSingleFile(
    uri: vscode.Uri,
    token: vscode.CancellationToken,
  ): Promise<void> {
    await this.fileTransferService.buildAndTransfer([uri], null, 1);
    this.throwIfCancelled(token);
  }

  /**
   * Builds the arguments for the `review_code` MCP tool call.
   */
  private buildReviewToolArgs(scope: ReviewScope): Record<string, unknown> {
    if (scope.kind === 'workspace') {
      return { scope: 'workspace' };
    }

    const args: Record<string, unknown> = {
      scope: scope.kind,
      filePath: scope.uri.fsPath,
    };

    if (scope.kind === 'selection') {
      args.startLine = scope.range.start.line;
      args.endLine = scope.range.end.line;
    }

    return args;
  }

  /**
   * Parses the raw MCP tool result into Finding objects.
   */
  private parseFindings(result: unknown): Finding[] {
    const findings: Finding[] = [];

    // The result is expected to be an object with a content array
    const resultObj = result as { content?: Array<{ type: string; text: string }> };
    const content = resultObj?.content;

    if (!Array.isArray(content)) {
      this.logger.log('warn', 'Unexpected review result format', { result });
      return findings;
    }

    for (const item of content) {
      if (item.type !== 'text') {
        continue;
      }

      let parsed: unknown[];
      try {
        parsed = JSON.parse(item.text);
      } catch {
        this.logger.log('warn', 'Failed to parse review result JSON', { text: item.text });
        continue;
      }

      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }

      for (const raw of parsed) {
        const finding = parseFinding(raw);
        if (finding) {
          findings.push(finding);
        }
      }
    }

    return findings;
  }

  /**
   * Applies parsed findings to the display layer, grouped by file URI.
   */
  private applyFindingsForScope(scope: ReviewScope, findings: Finding[]): void {
    if (scope.kind === 'workspace') {
      // Group findings by file path
      const byFile = new Map<string, Finding[]>();
      for (const finding of findings) {
        const existing = byFile.get(finding.filePath) ?? [];
        existing.push(finding);
        byFile.set(finding.filePath, existing);
      }

      for (const [filePath, fileFindings] of byFile) {
        const uri = vscode.Uri.file(filePath);
        this.findingApplier.applyFindings(uri, fileFindings);
      }
    } else {
      const uri = scope.uri;
      this.findingApplier.applyFindings(uri, findings);
    }
  }

  /**
   * Throws a cancellation error if the token has been cancelled.
   */
  private throwIfCancelled(token: vscode.CancellationToken): void {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
  }

  /**
   * Derives a stable key from a review scope for session deduplication.
   */
  private scopeKey(scope: ReviewScope): string {
    if (scope.kind === 'workspace') {
      return '__workspace__';
    }
    return scope.uri.toString();
  }
}
