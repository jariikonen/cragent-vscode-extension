import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeReviewCommentController } from '../../src/display/CommentController';
import type { Finding } from '../../src/models/Finding';

// Mock vscode module
vi.mock('vscode', () => ({
  CommentMode: {
    Preview: 1,
    Editing: 0,
  },
  Range: class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
  },
  Uri: {
    file: (path: string) => ({
      scheme: 'file',
      path,
      toString: () => `file://${path}`,
    }),
  },
}));

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'test-id-1',
    filePath: '/path/to/file.ts',
    startLine: 10,
    endLine: 15,
    message: 'Test finding message',
    confidence: 0.85,
    severity: 0.72,
    importance: 0.90,
    priority: 0.82,
    dismissed: false,
    ...overrides,
  };
}

describe('CodeReviewCommentController', () => {
  let mockController: any;
  let commentController: CodeReviewCommentController;
  let createdThreads: any[];

  beforeEach(() => {
    createdThreads = [];

    mockController = {
      createCommentThread: vi.fn((uri: any, range: any, comments: any[]) => {
        const thread: any = {
          uri,
          range,
          comments,
          contextValue: undefined,
          dispose: vi.fn(),
        };
        createdThreads.push(thread);
        return thread;
      }),
      dispose: vi.fn(),
    };

    commentController = new CodeReviewCommentController(mockController);
  });

  describe('setFindings', () => {
    it('should create one thread per finding', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'f1', message: 'First' }),
        makeFinding({ id: 'f2', message: 'Second' }),
        makeFinding({ id: 'f3', message: 'Third' }),
      ];

      commentController.setFindings(uri, findings);

      expect(mockController.createCommentThread).toHaveBeenCalledTimes(3);
      expect(createdThreads).toHaveLength(3);
    });

    it('should set thread range matching finding line numbers', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ startLine: 5, endLine: 12 });

      commentController.setFindings(uri, [finding]);

      const thread = createdThreads[0];
      expect(thread.range.startLine).toBe(5);
      expect(thread.range.startCharacter).toBe(0);
      expect(thread.range.endLine).toBe(12);
      expect(thread.range.endCharacter).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should set first comment body to finding.message', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ message: 'Avoid using any type' });

      commentController.setFindings(uri, [finding]);

      const thread = createdThreads[0];
      expect(thread.comments[0].body).toBe('Avoid using any type');
    });

    it('should set label matching the score format pattern', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({
        priority: 0.82,
        severity: 0.72,
        confidence: 0.85,
        importance: 0.90,
      });

      commentController.setFindings(uri, [finding]);

      const thread = createdThreads[0];
      expect(thread.comments[0].label).toBe('P: 0.82 | S: 0.72 | C: 0.85 | I: 0.90');
    });

    it('should include suggestion reply when finding.suggestion is defined', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ suggestion: 'Use string instead of any' });

      commentController.setFindings(uri, [finding]);

      const thread = createdThreads[0];
      expect(thread.comments).toHaveLength(2);
      expect(thread.comments[1].body).toBe('Use string instead of any');
      expect(thread.comments[1].label).toBe('Suggestion');
    });

    it('should not include suggestion reply when finding.suggestion is undefined', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding(); // no suggestion

      commentController.setFindings(uri, [finding]);

      const thread = createdThreads[0];
      expect(thread.comments).toHaveLength(1);
    });

    it('should set contextValue to "codeReviewFinding"', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, [makeFinding()]);

      const thread = createdThreads[0];
      expect(thread.contextValue).toBe('codeReviewFinding');
    });

    it('should handle empty findings array', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, []);

      expect(mockController.createCommentThread).not.toHaveBeenCalled();
      expect(createdThreads).toHaveLength(0);
    });

    it('should replace previous threads for the same URI', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, [makeFinding({ message: 'First' })]);
      const firstThread = createdThreads[0];

      commentController.setFindings(uri, [makeFinding({ message: 'Second' })]);

      // First thread should have been disposed
      expect(firstThread.dispose).toHaveBeenCalled();
      // New thread should have the second message
      const secondThread = createdThreads[1];
      expect(secondThread.comments[0].body).toBe('Second');
    });
  });

  describe('clearUri', () => {
    it('should dispose threads for the specified URI', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, [makeFinding()]);
      const thread = createdThreads[0];

      commentController.clearUri(uri);

      expect(thread.dispose).toHaveBeenCalledTimes(1);
    });

    it('should only remove the specified URI threads, not others', async () => {
      const { Uri } = await import('vscode');
      const uri1 = Uri.file('/path/to/file1.ts');
      const uri2 = Uri.file('/path/to/file2.ts');

      commentController.setFindings(uri1, [makeFinding()]);
      commentController.setFindings(uri2, [makeFinding()]);

      const thread1 = createdThreads[0];
      const thread2 = createdThreads[1];

      commentController.clearUri(uri1);

      expect(thread1.dispose).toHaveBeenCalled();
      expect(thread2.dispose).not.toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should dispose all threads across all URIs', async () => {
      const { Uri } = await import('vscode');
      const uri1 = Uri.file('/path/to/file1.ts');
      const uri2 = Uri.file('/path/to/file2.ts');

      commentController.setFindings(uri1, [makeFinding()]);
      commentController.setFindings(uri2, [makeFinding()]);

      commentController.clearAll();

      for (const thread of createdThreads) {
        expect(thread.dispose).toHaveBeenCalled();
      }
    });
  });

  describe('dismissThread', () => {
    it('should dispose the specified thread', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, [
        makeFinding({ id: 'f1', message: 'First' }),
        makeFinding({ id: 'f2', message: 'Second' }),
      ]);

      const threadToDismiss = createdThreads[0];
      commentController.dismissThread(threadToDismiss);

      expect(threadToDismiss.dispose).toHaveBeenCalledTimes(1);
    });

    it('should remove the thread from internal tracking', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, [makeFinding()]);
      const thread = createdThreads[0];

      commentController.dismissThread(thread);

      // Clearing the URI should not try to dispose the already-dismissed thread again
      commentController.clearUri(uri);
      // dispose was called once by dismissThread, not again by clearUri
      expect(thread.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('should dispose the underlying comment controller', () => {
      commentController.dispose();

      expect(mockController.dispose).toHaveBeenCalledTimes(1);
    });

    it('should dispose all tracked threads', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      commentController.setFindings(uri, [makeFinding()]);
      const thread = createdThreads[0];

      commentController.dispose();

      expect(thread.dispose).toHaveBeenCalled();
    });
  });
});
