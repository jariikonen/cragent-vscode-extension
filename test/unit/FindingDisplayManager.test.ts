import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindingDisplayManager } from '../../src/display/FindingDisplayManager';
import type { Finding } from '../../src/models/Finding';

// Mock vscode module
vi.mock('vscode', () => ({
  CommentMode: {
    Preview: 1,
    Editing: 0,
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  Range: class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
  },
  Diagnostic: class Diagnostic {
    source?: string;
    constructor(
      public range: any,
      public message: string,
      public severity: number,
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

describe('FindingDisplayManager', () => {
  let mockCommentController: any;
  let mockDiagnosticCollection: any;
  let manager: FindingDisplayManager;

  beforeEach(() => {
    mockCommentController = {
      setFindings: vi.fn(),
      clearUri: vi.fn(),
      clearAll: vi.fn(),
      dismissThread: vi.fn(),
      dispose: vi.fn(),
    };

    mockDiagnosticCollection = {
      setFindings: vi.fn(),
      clearUri: vi.fn(),
      clearAll: vi.fn(),
      dispose: vi.fn(),
    };

    manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection);
  });

  describe('applyFindings', () => {
    it('should call setFindings on both delegates', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [makeFinding()];

      manager.applyFindings(uri, findings);

      expect(mockCommentController.setFindings).toHaveBeenCalledTimes(1);
      expect(mockDiagnosticCollection.setFindings).toHaveBeenCalledTimes(1);
    });

    it('should pass the same filtered/sorted list to both delegates', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'f1', priority: 0.5 }),
        makeFinding({ id: 'f2', priority: 0.9 }),
      ];

      manager.applyFindings(uri, findings);

      const commentFindings = mockCommentController.setFindings.mock.calls[0][1];
      const diagnosticFindings = mockDiagnosticCollection.setFindings.mock.calls[0][1];

      // Both should receive the same sorted list (descending by priority)
      expect(commentFindings).toEqual(diagnosticFindings);
      expect(commentFindings[0].id).toBe('f2'); // higher priority first
      expect(commentFindings[1].id).toBe('f1');
    });

    it('should filter out information-severity findings when showInformationFindings is false', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        showInformationFindings: false,
      });

      const findings = [
        makeFinding({ id: 'info', severity: 0.2 }),    // information (<=0.33)
        makeFinding({ id: 'warning', severity: 0.5 }), // warning
        makeFinding({ id: 'error', severity: 0.8 }),    // error
      ];

      manager.applyFindings(uri, findings);

      const commentFindings = mockCommentController.setFindings.mock.calls[0][1];
      expect(commentFindings).toHaveLength(2);
      expect(commentFindings.every((f: Finding) => f.severity > 0.33)).toBe(true);
    });

    it('should handle empty findings array', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      manager.applyFindings(uri, []);

      expect(mockCommentController.setFindings).toHaveBeenCalledWith(uri, []);
      expect(mockDiagnosticCollection.setFindings).toHaveBeenCalledWith(uri, []);
    });
  });

  describe('clearFindings', () => {
    it('should call clearUri on both delegates', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      manager.clearFindings(uri);

      expect(mockCommentController.clearUri).toHaveBeenCalledWith(uri);
      expect(mockDiagnosticCollection.clearUri).toHaveBeenCalledWith(uri);
    });

    it('should remove stored findings for the URI', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      manager.applyFindings(uri, [makeFinding()]);
      manager.clearFindings(uri);

      // After clearing, updateSortFilter should not re-apply to this URI
      mockCommentController.setFindings.mockClear();
      mockDiagnosticCollection.setFindings.mockClear();

      manager.updateSortFilter({ sortField: 'severity' });

      expect(mockCommentController.setFindings).not.toHaveBeenCalled();
      expect(mockDiagnosticCollection.setFindings).not.toHaveBeenCalled();
    });
  });

  describe('clearAllFindings', () => {
    it('should call clearAll on both delegates', () => {
      manager.clearAllFindings();

      expect(mockCommentController.clearAll).toHaveBeenCalledTimes(1);
      expect(mockDiagnosticCollection.clearAll).toHaveBeenCalledTimes(1);
    });

    it('should remove all stored findings', async () => {
      const { Uri } = await import('vscode');
      const uri1 = Uri.file('/path/to/file1.ts');
      const uri2 = Uri.file('/path/to/file2.ts');

      manager.applyFindings(uri1, [makeFinding()]);
      manager.applyFindings(uri2, [makeFinding()]);
      manager.clearAllFindings();

      mockCommentController.setFindings.mockClear();
      mockDiagnosticCollection.setFindings.mockClear();

      manager.updateSortFilter({ sortField: 'severity' });

      expect(mockCommentController.setFindings).not.toHaveBeenCalled();
      expect(mockDiagnosticCollection.setFindings).not.toHaveBeenCalled();
    });
  });

  describe('dismissThread', () => {
    it('should delegate to CommentController', () => {
      const mockThread = { dispose: vi.fn() } as any;

      manager.dismissThread(mockThread);

      expect(mockCommentController.dismissThread).toHaveBeenCalledWith(mockThread);
    });
  });

  describe('updateSortFilter', () => {
    it('should re-apply sort/filter to all URIs without a new session', async () => {
      const { Uri } = await import('vscode');
      const uri1 = Uri.file('/path/to/file1.ts');
      const uri2 = Uri.file('/path/to/file2.ts');

      manager.applyFindings(uri1, [makeFinding({ id: 'f1' })]);
      manager.applyFindings(uri2, [makeFinding({ id: 'f2' })]);

      mockCommentController.setFindings.mockClear();
      mockDiagnosticCollection.setFindings.mockClear();

      manager.updateSortFilter({ sortField: 'severity' });

      // Both URIs should be re-applied
      expect(mockCommentController.setFindings).toHaveBeenCalledTimes(2);
      expect(mockDiagnosticCollection.setFindings).toHaveBeenCalledTimes(2);
    });

    it('should sort descending by priority', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'low', priority: 0.2 }),
        makeFinding({ id: 'high', priority: 0.9 }),
        makeFinding({ id: 'mid', priority: 0.5 }),
      ];

      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('low');
    });

    it('should sort descending by severity', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'low', severity: 0.1 }),
        makeFinding({ id: 'high', severity: 0.95 }),
        makeFinding({ id: 'mid', severity: 0.5 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        sortField: 'severity',
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('low');
    });

    it('should sort descending by confidence', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'low', confidence: 0.3 }),
        makeFinding({ id: 'high', confidence: 0.99 }),
        makeFinding({ id: 'mid', confidence: 0.6 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        sortField: 'confidence',
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('low');
    });

    it('should sort descending by importance', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'low', importance: 0.15 }),
        makeFinding({ id: 'high', importance: 0.88 }),
        makeFinding({ id: 'mid', importance: 0.45 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        sortField: 'importance',
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('low');
    });

    it('should filter out findings below minPriority threshold', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'below', priority: 0.3 }),
        makeFinding({ id: 'above', priority: 0.7 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        filter: { minPriority: 0.5, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('above');
    });

    it('should filter out findings below minSeverity threshold', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'below', severity: 0.2 }),
        makeFinding({ id: 'above', severity: 0.8 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        filter: { minPriority: 0, minSeverity: 0.5, minConfidence: 0, minImportance: 0 },
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('above');
    });

    it('should filter out findings below minConfidence threshold', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'below', confidence: 0.1 }),
        makeFinding({ id: 'above', confidence: 0.9 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0.5, minImportance: 0 },
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('above');
    });

    it('should filter out findings below minImportance threshold', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'below', importance: 0.2 }),
        makeFinding({ id: 'above', importance: 0.7 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        filter: { minPriority: 0, minSeverity: 0, minConfidence: 0, minImportance: 0.5 },
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('above');
    });

    it('should apply combined filter thresholds (all must pass)', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'all-high', priority: 0.8, severity: 0.8, confidence: 0.8, importance: 0.8 }),
        makeFinding({ id: 'one-low', priority: 0.8, severity: 0.8, confidence: 0.1, importance: 0.8 }),
      ];

      manager = new FindingDisplayManager(mockCommentController, mockDiagnosticCollection, {
        filter: { minPriority: 0.5, minSeverity: 0.5, minConfidence: 0.5, minImportance: 0.5 },
      });
      manager.applyFindings(uri, findings);

      const result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('all-high');
    });

    it('should apply updated sort field on updateSortFilter', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'f1', priority: 0.9, severity: 0.1 }),
        makeFinding({ id: 'f2', priority: 0.1, severity: 0.9 }),
      ];

      manager.applyFindings(uri, findings);

      // Initially sorted by priority (default)
      let result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result[0].id).toBe('f1');

      // Switch to sort by severity
      manager.updateSortFilter({ sortField: 'severity' });

      result = mockCommentController.setFindings.mock.calls[1][1];
      expect(result[0].id).toBe('f2');
    });

    it('should apply updated filter thresholds on updateSortFilter', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'low', priority: 0.3 }),
        makeFinding({ id: 'high', priority: 0.8 }),
      ];

      manager.applyFindings(uri, findings);

      // Initially no filter — both should appear
      let result = mockCommentController.setFindings.mock.calls[0][1];
      expect(result).toHaveLength(2);

      // Apply filter
      manager.updateSortFilter({
        filter: { minPriority: 0.5, minSeverity: 0, minConfidence: 0, minImportance: 0 },
      });

      result = mockCommentController.setFindings.mock.calls[1][1];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('high');
    });
  });
});
