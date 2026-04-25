import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultReviewSessionManager } from '../../src/review/ReviewSessionManager';

// --- vscode mock setup ---

const mockShowErrorMessage = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockFindFiles = vi.fn();

// Track CancellationTokenSource instances to inspect cancel calls
interface MockCTS {
  token: { isCancellationRequested: boolean; onCancellationRequested: ReturnType<typeof vi.fn> };
  cancelled: boolean;
  disposed: boolean;
  cancel(): void;
  dispose(): void;
}

const cancellationTokenSources: MockCTS[] = [];

// withProgress: immediately invokes the callback, passing a mock progress and a non-cancelled token
let withProgressImpl: (
  options: any,
  task: (progress: any, token: any) => Promise<any>,
) => Promise<any>;

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: (...args: any[]) => mockShowErrorMessage(...args),
    showInformationMessage: (...args: any[]) => mockShowInformationMessage(...args),
    withProgress: (options: any, task: any) => withProgressImpl(options, task),
  },
  workspace: {
    findFiles: (...args: any[]) => mockFindFiles(...args),
  },
  ProgressLocation: {
    Notification: 15,
  },
  Uri: {
    file: (path: string) => ({
      fsPath: path,
      scheme: 'file',
      toString: () => `file://${path}`,
    }),
  },
  CancellationTokenSource: vi.fn().mockImplementation(function() {
    const source: MockCTS = {
      token: {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      },
      cancelled: false,
      disposed: false,
      cancel() {
        source.cancelled = true;
        source.token.isCancellationRequested = true;
      },
      dispose() {
        source.disposed = true;
      },
    };
    cancellationTokenSources.push(source);
    return source;
  }),
  CancellationError: class CancellationError extends Error {
    constructor() {
      super('Cancelled');
      this.name = 'CancellationError';
    }
  },
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
}));

describe('ReviewSessionManager', () => {
  let manager: DefaultReviewSessionManager;
  let mockConnectionManager: any;
  let mockFileTransferService: any;
  let mockConfigManager: any;
  let mockFindingApplier: any;
  let mockLogger: any;
  let mockMcpClient: any;

  function makeUri(path: string) {
    return {
      fsPath: path,
      scheme: 'file',
      toString: () => `file://${path}`,
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cancellationTokenSources.length = 0;

    mockMcpClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '[]' }],
      }),
    };

    mockConnectionManager = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getClient: vi.fn().mockReturnValue(mockMcpClient),
      isConnected: true,
      onDidChangeConnection: vi.fn(),
    };

    mockFileTransferService = {
      queryIndexTimestamp: vi.fn().mockResolvedValue({ timestamp: null }),
      buildAndTransfer: vi.fn().mockResolvedValue(0),
    };

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        serverUrl: 'http://localhost:3000/mcp',
        requestTimeoutMs: 30000,
        maxConcurrentTransfers: 5,
        showInformationFindings: true,
        sortField: 'priority',
        filter: {
          minPriority: 0.0,
          minSeverity: 0.0,
          minConfidence: 0.0,
          minImportance: 0.0,
        },
      }),
      getAuthToken: vi.fn().mockResolvedValue(undefined),
    };

    mockFindingApplier = {
      applyFindings: vi.fn(),
    };

    mockLogger = {
      log: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };

    // Default withProgress: invoke the task immediately with a mock progress and non-cancelled token
    withProgressImpl = async (_options, task) => {
      const progress = { report: vi.fn() };
      const progressToken = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      };
      return task(progress, progressToken);
    };

    mockFindFiles.mockResolvedValue([]);

    manager = new DefaultReviewSessionManager(
      mockConnectionManager,
      mockFileTransferService,
      mockConfigManager,
      mockFindingApplier,
      mockLogger,
    );
  });

  describe('startSession — new session for a URI with no active session', () => {
    it('should create a new session and add it to activeSessions during execution', async () => {
      let capturedSessions: Map<string, any> | undefined;

      // Capture activeSessions while the session is running
      mockMcpClient.callTool.mockImplementation(async () => {
        capturedSessions = manager.activeSessions;
        return { content: [{ type: 'text', text: '[]' }] };
      });

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(capturedSessions).toBeDefined();
      expect(capturedSessions!.size).toBe(1);
      const session = capturedSessions!.values().next().value;
      expect(session.scope.kind).toBe('file');
    });

    it('should remove the session from activeSessions after completion', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(manager.activeSessions.size).toBe(0);
    });

    it('should call FileTransferService.buildAndTransfer for a file scope', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(mockFileTransferService.buildAndTransfer).toHaveBeenCalledWith(
        [uri],
        null,
        1,
      );
    });

    it('should call the MCP review tool after file transfer', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('review_code', {
        scope: 'file',
        filePath: uri.fsPath,
      });
    });

    it('should call findingApplier.applyFindings on completion', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                filePath: '/workspace/src/test.ts',
                startLine: 1,
                endLine: 5,
                message: 'Test finding',
                confidence: 0.9,
                severity: 0.7,
                importance: 0.8,
                priority: 0.85,
              },
            ]),
          },
        ],
      });

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(mockFindingApplier.applyFindings).toHaveBeenCalledTimes(1);
      expect(mockFindingApplier.applyFindings).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([
          expect.objectContaining({ message: 'Test finding' }),
        ]),
      );
    });

    it('should show a progress notification while the session runs', async () => {
      let progressReported = false;

      withProgressImpl = async (options, task) => {
        expect(options.location).toBe(15); // ProgressLocation.Notification
        expect(options.title).toBe('Code Review');
        expect(options.cancellable).toBe(true);

        const progress = {
          report: vi.fn().mockImplementation(() => {
            progressReported = true;
          }),
        };
        const progressToken = {
          isCancellationRequested: false,
          onCancellationRequested: vi.fn(),
        };
        return task(progress, progressToken);
      };

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(progressReported).toBe(true);
    });

    it('should use workspace scope for workspace reviews', async () => {
      mockFindFiles.mockResolvedValue([makeUri('/workspace/src/a.ts')]);

      await manager.startSession({ kind: 'workspace' });

      expect(mockFileTransferService.queryIndexTimestamp).toHaveBeenCalled();
      expect(mockMcpClient.callTool).toHaveBeenCalledWith('review_code', {
        scope: 'workspace',
      });
    });

    it('should pass maxConcurrentTransfers to buildAndTransfer for workspace scope', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        serverUrl: 'http://localhost:3000/mcp',
        requestTimeoutMs: 30000,
        maxConcurrentTransfers: 10,
        showInformationFindings: true,
        sortField: 'priority',
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      });

      mockFindFiles.mockResolvedValue([makeUri('/workspace/src/a.ts')]);

      await manager.startSession({ kind: 'workspace' });

      expect(mockFileTransferService.buildAndTransfer).toHaveBeenCalledWith(
        expect.any(Array),
        null,
        10,
      );
    });

    it('should include startLine and endLine for selection scope', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      const range = {
        start: { line: 5, character: 0 },
        end: { line: 15, character: 0 },
      } as any;

      await manager.startSession({ kind: 'selection', uri, range });

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('review_code', {
        scope: 'selection',
        filePath: uri.fsPath,
        startLine: 5,
        endLine: 15,
      });
    });
  });

  describe('startSession — URI with an existing active session', () => {
    it('should cancel the old session before starting the new one', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      let firstSessionRunning = false;
      let resolveFirstSession!: () => void;

      const firstSessionBlock = new Promise<void>((resolve) => {
        resolveFirstSession = resolve;
      });

      let callCount = 0;
      mockMcpClient.callTool.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          firstSessionRunning = true;
          await firstSessionBlock;
        }
        return { content: [{ type: 'text', text: '[]' }] };
      });

      // Start first session (don't await — it will block on callTool)
      const firstPromise = manager.startSession({ kind: 'file', uri });

      // Wait for the first session to be running
      await vi.waitFor(() => expect(firstSessionRunning).toBe(true));

      // The first CTS should have been created
      expect(cancellationTokenSources.length).toBeGreaterThanOrEqual(1);
      const firstCts = cancellationTokenSources[0];
      expect(firstCts.cancelled).toBe(false);

      // Start second session while the first is still blocked — should cancel the first
      const secondPromise = manager.startSession({ kind: 'file', uri });

      // The first CTS should have been cancelled
      expect(firstCts.cancelled).toBe(true);

      // Now unblock the first session so both promises can settle
      resolveFirstSession();

      await Promise.all([firstPromise, secondPromise]);
    });

    it('should allow the new session to complete successfully after cancelling the old one', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      let firstSessionRunning = false;
      let resolveFirstSession!: () => void;

      const firstSessionBlock = new Promise<void>((resolve) => {
        resolveFirstSession = resolve;
      });

      let callCount = 0;
      mockFileTransferService.buildAndTransfer.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          firstSessionRunning = true;
          await firstSessionBlock;
        }
        return 0;
      });

      // Start first session (blocks on buildAndTransfer)
      const firstPromise = manager.startSession({ kind: 'file', uri });
      await vi.waitFor(() => expect(firstSessionRunning).toBe(true));

      // Start second session while the first is still blocked — should cancel the first
      const secondPromise = manager.startSession({ kind: 'file', uri });

      // Now unblock the first session so both promises can settle
      resolveFirstSession();

      await Promise.all([firstPromise, secondPromise]);

      // Two CTS instances should have been created
      expect(cancellationTokenSources.length).toBe(2);
      // The first CTS should have been cancelled when the second session started
      expect(cancellationTokenSources[0].cancelled).toBe(true);
      // The second session should have completed successfully
      expect(mockMcpClient.callTool).toHaveBeenCalled();
    });
  });

  describe('cancelSession(uri)', () => {
    it('should cancel the session for the specified URI', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      let resolveTransfer!: () => void;

      mockFileTransferService.buildAndTransfer.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            resolveTransfer = () => resolve(0);
          }),
      );

      // Start a session (don't await — it will block on buildAndTransfer)
      const sessionPromise = manager.startSession({ kind: 'file', uri });

      // Wait for the session to be registered
      await vi.waitFor(() => expect(manager.activeSessions.size).toBe(1));

      // Cancel it
      manager.cancelSession(uri);

      // The CTS should have been cancelled
      expect(cancellationTokenSources[0].cancelled).toBe(true);

      // Resolve the blocked transfer so the promise settles
      resolveTransfer();
      await sessionPromise;
    });

    it('should not affect sessions for other URIs', async () => {
      const uri1 = makeUri('/workspace/src/a.ts');
      const uri2 = makeUri('/workspace/src/b.ts');
      let resolveTransfer1!: () => void;
      let resolveTransfer2!: () => void;

      let transferCallCount = 0;
      mockFileTransferService.buildAndTransfer.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            transferCallCount++;
            if (transferCallCount === 1) {
              resolveTransfer1 = () => resolve(0);
            } else {
              resolveTransfer2 = () => resolve(0);
            }
          }),
      );

      const p1 = manager.startSession({ kind: 'file', uri: uri1 });
      await vi.waitFor(() => expect(transferCallCount).toBe(1));

      const p2 = manager.startSession({ kind: 'file', uri: uri2 });
      await vi.waitFor(() => expect(transferCallCount).toBe(2));

      // Cancel only uri1
      manager.cancelSession(uri1);

      expect(cancellationTokenSources[0].cancelled).toBe(true);
      // The second session's CTS should NOT have been cancelled
      expect(cancellationTokenSources[1].cancelled).toBe(false);

      resolveTransfer1();
      resolveTransfer2();
      await Promise.all([p1, p2]);
    });

    it('should be a no-op if no session exists for the URI', () => {
      const uri = makeUri('/workspace/src/nonexistent.ts');

      // Should not throw
      manager.cancelSession(uri);

      expect(manager.activeSessions.size).toBe(0);
    });
  });

  describe('cancelSession() — no argument cancels all', () => {
    it('should cancel all active sessions', async () => {
      const uri1 = makeUri('/workspace/src/a.ts');
      const uri2 = makeUri('/workspace/src/b.ts');
      let resolveTransfer1!: () => void;
      let resolveTransfer2!: () => void;

      let transferCallCount = 0;
      mockFileTransferService.buildAndTransfer.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            transferCallCount++;
            if (transferCallCount === 1) {
              resolveTransfer1 = () => resolve(0);
            } else {
              resolveTransfer2 = () => resolve(0);
            }
          }),
      );

      const p1 = manager.startSession({ kind: 'file', uri: uri1 });
      await vi.waitFor(() => expect(transferCallCount).toBe(1));

      const p2 = manager.startSession({ kind: 'file', uri: uri2 });
      await vi.waitFor(() => expect(transferCallCount).toBe(2));

      // Cancel all
      manager.cancelSession();

      // Both CTSs should have been cancelled
      expect(cancellationTokenSources[0].cancelled).toBe(true);
      expect(cancellationTokenSources[1].cancelled).toBe(true);

      resolveTransfer1();
      resolveTransfer2();
      await Promise.all([p1, p2]);
    });

    it('should clear the activeSessions map', async () => {
      const uri = makeUri('/workspace/src/test.ts');
      let resolveTransfer!: () => void;

      mockFileTransferService.buildAndTransfer.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            resolveTransfer = () => resolve(0);
          }),
      );

      const p = manager.startSession({ kind: 'file', uri });
      await vi.waitFor(() => expect(manager.activeSessions.size).toBe(1));

      manager.cancelSession();

      // activeSessions should be empty after cancelSession()
      expect(manager.activeSessions.size).toBe(0);

      resolveTransfer();
      await p;
    });
  });

  describe('error handling', () => {
    it('should show an error notification when not connected', async () => {
      mockConnectionManager.getClient.mockReturnValue(null);

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Not connected to MCP server'),
      );
    });

    it('should log the error when a session fails', async () => {
      mockMcpClient.callTool.mockRejectedValue(new Error('Server error'));

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(mockLogger.log).toHaveBeenCalledWith(
        'error',
        'Review session failed',
        expect.objectContaining({ error: 'Server error' }),
      );
    });

    it('should show an information message when session is cancelled', async () => {
      // Make withProgress cancel the token immediately
      withProgressImpl = async (_options, task) => {
        const progress = { report: vi.fn() };
        const progressToken = {
          isCancellationRequested: false,
          onCancellationRequested: vi.fn((cb: () => void) => {
            // Simulate user clicking cancel
            cb();
          }),
        };
        return task(progress, progressToken);
      };

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'Code Review: Session cancelled.',
      );
    });

    it('should clean up the session from activeSessions on error', async () => {
      mockMcpClient.callTool.mockRejectedValue(new Error('Boom'));

      const uri = makeUri('/workspace/src/test.ts');
      await manager.startSession({ kind: 'file', uri });

      expect(manager.activeSessions.size).toBe(0);
    });
  });
});
