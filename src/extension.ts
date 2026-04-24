import * as vscode from 'vscode';
import { OutputChannelLogger } from './ui/OutputChannelLogger';
import { DefaultConfigurationManager } from './config/ConfigurationManager';
import { DefaultConnectionManager } from './connection/ConnectionManager';
import { MCPClientInterface } from './connection/MCPClient';
import { DefaultFileTransferService } from './review/FileTransferService';
import { DefaultReviewSessionManager } from './review/ReviewSessionManager';
import { CodeReviewDiagnosticCollection } from './display/DiagnosticCollection';
import { CodeReviewCommentController } from './display/CommentController';
import { FindingDisplayManager } from './display/FindingDisplayManager';
import { StatusBarManager } from './ui/StatusBarManager';

export function activate(context: vscode.ExtensionContext): void {
  // 1. Logging
  const outputChannel = vscode.window.createOutputChannel('Code Review');
  const logger = new OutputChannelLogger(outputChannel);

  // 2. Configuration
  const configManager = new DefaultConfigurationManager(context);

  // 3. Connection layer
  const connectionManager = new DefaultConnectionManager(configManager, logger);

  // 4. File transfer service — uses the MCPClient from ConnectionManager
  // We create a proxy that delegates to the current client so reconnections are transparent
  const mcpClientProxy: MCPClientInterface = {
    get isConnected() {
      return connectionManager.getClient()?.isConnected ?? false;
    },
    async connect() {
      await connectionManager.getClient()?.connect();
    },
    async disconnect() {
      await connectionManager.getClient()?.disconnect();
    },
    async callTool(name: string, args?: Record<string, unknown>) {
      const client = connectionManager.getClient();
      if (!client) {
        throw new Error('MCPClient is not connected');
      }
      return client.callTool(name, args);
    },
    getClient() {
      return connectionManager.getClient()?.getClient() ?? null;
    },
  };
  const fileTransferService = new DefaultFileTransferService(
    mcpClientProxy,
    logger,
  );

  // 5. Display layer
  const diagnosticCollection = new CodeReviewDiagnosticCollection();
  const commentController = new CodeReviewCommentController();
  const config = configManager.getConfig();
  const findingDisplayManager = new FindingDisplayManager(
    commentController,
    diagnosticCollection,
    {
      sortField: config.sortField,
      showInformationFindings: config.showInformationFindings,
      filter: config.filter,
    },
  );

  // 6. Review session manager
  const reviewSessionManager = new DefaultReviewSessionManager(
    connectionManager,
    fileTransferService,
    configManager,
    findingDisplayManager,
    logger,
  );

  // 7. Status bar
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  const statusBarManager = new StatusBarManager(statusBarItem);

  // Wire connection state changes to status bar
  const connectionDisposable = connectionManager.onDidChangeConnection((connected) => {
    if (connected) {
      statusBarManager.setConnected(configManager.getConfig().serverUrl);
    } else {
      statusBarManager.setDisconnected();
    }
  });

  // Wire configuration changes to FindingDisplayManager sort/filter
  const configDisposable = configManager.onDidChangeConfig((newConfig) => {
    findingDisplayManager.updateSortFilter({
      sortField: newConfig.sortField,
      showInformationFindings: newConfig.showInformationFindings,
      filter: newConfig.filter,
    });
  });

  // 8. Register commands
  const reviewFileCmd = vscode.commands.registerCommand('codeReview.reviewFile', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Code Review: No active file to review.');
      return;
    }
    reviewSessionManager.startSession({ kind: 'file', uri: editor.document.uri });
  });

  const reviewSelectionCmd = vscode.commands.registerCommand('codeReview.reviewSelection', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Code Review: No active file to review.');
      return;
    }
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('Code Review: No text selected.');
      return;
    }
    reviewSessionManager.startSession({
      kind: 'selection',
      uri: editor.document.uri,
      range: new vscode.Range(selection.start, selection.end),
    });
  });

  const reviewWorkspaceCmd = vscode.commands.registerCommand('codeReview.reviewWorkspace', () => {
    reviewSessionManager.startSession({ kind: 'workspace' });
  });

  const clearFindingsCmd = vscode.commands.registerCommand('codeReview.clearFindings', () => {
    findingDisplayManager.clearAllFindings();
  });

  const dismissThreadCmd = vscode.commands.registerCommand(
    'codeReview.dismissThread',
    (thread: vscode.CommentThread) => {
      if (thread) {
        findingDisplayManager.dismissThread(thread);
      }
    },
  );

  const setAuthTokenCmd = vscode.commands.registerCommand('codeReview.setAuthToken', async () => {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your MCP server authentication token',
      password: true,
      placeHolder: 'Authentication token',
      ignoreFocusOut: true,
    });
    if (token === undefined) {
      return; // User pressed Escape
    }
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      const confirm = await vscode.window.showWarningMessage(
        'Code Review: Empty token entered. Do you want to clear the saved authentication token?',
        'Clear Token',
        'Cancel',
      );
      if (confirm === 'Clear Token') {
        await configManager.deleteAuthToken();
        vscode.window.showInformationMessage('Code Review: Authentication token cleared.');
      }
      return;
    }
    await configManager.setAuthToken(trimmed);
    vscode.window.showInformationMessage('Code Review: Authentication token saved.');
  });

  const clearAuthTokenCmd = vscode.commands.registerCommand('codeReview.clearAuthToken', async () => {
    const confirm = await vscode.window.showWarningMessage(
      'Code Review: Are you sure you want to remove the saved authentication token?',
      'Remove Token',
      'Cancel',
    );
    if (confirm === 'Remove Token') {
      await configManager.deleteAuthToken();
      vscode.window.showInformationMessage('Code Review: Authentication token removed.');
    }
  });

  const openOutputChannelCmd = vscode.commands.registerCommand(
    'codeReview.openOutputChannel',
    () => {
      logger.show();
    },
  );

  // 9. Push all disposables to context.subscriptions
  context.subscriptions.push(
    { dispose: () => logger.dispose() },
    connectionDisposable,
    configDisposable,
    reviewFileCmd,
    reviewSelectionCmd,
    reviewWorkspaceCmd,
    clearFindingsCmd,
    dismissThreadCmd,
    setAuthTokenCmd,
    clearAuthTokenCmd,
    openOutputChannelCmd,
    { dispose: () => statusBarManager.dispose() },
    { dispose: () => commentController.dispose() },
    { dispose: () => diagnosticCollection.dispose() },
  );

  // 10. Initial connection and auth warning
  statusBarManager.setDisconnected();
  connectionManager.connect().then(async () => {
    const currentConfig = configManager.getConfig();
    if (!configManager.isLocalAddress(currentConfig.serverUrl)) {
      const authToken = await configManager.getAuthToken();
      if (!authToken) {
        vscode.window.showWarningMessage(
          'Code Review: Remote MCP server detected but no authentication token is configured. Use "Code Review: Set Authentication Token" to set one.',
          'Set Token',
        ).then((selection) => {
          if (selection === 'Set Token') {
            vscode.commands.executeCommand('codeReview.setAuthToken');
          }
        });
      }
    }
  }).catch((err) => {
    logger.log('error', `Initial connection failed: ${err}`);
    statusBarManager.setDisconnected();
  });

  logger.log('info', 'Code Review extension activated');
}

export function deactivate(): void {
  // All disposables are cleaned up via context.subscriptions
}
