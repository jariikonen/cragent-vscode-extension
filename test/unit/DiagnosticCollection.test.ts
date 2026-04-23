import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeReviewDiagnosticCollection } from '../../src/display/DiagnosticCollection';
import type { Finding } from '../../src/models/Finding';

// Mock vscode module
vi.mock('vscode', () => ({
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
    file: (path: string) => ({ scheme: 'file', path, toString: () => `file://${path}` }),
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

describe('CodeReviewDiagnosticCollection', () => {
  let mockCollection: any;
  let diagnosticCollection: CodeReviewDiagnosticCollection;

  beforeEach(() => {
    mockCollection = {
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    };

    diagnosticCollection = new CodeReviewDiagnosticCollection(mockCollection);
  });

  describe('setFindings', () => {
    it('should produce one diagnostic per finding', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [
        makeFinding({ id: 'f1', message: 'First' }),
        makeFinding({ id: 'f2', message: 'Second' }),
        makeFinding({ id: 'f3', message: 'Third' }),
      ];

      diagnosticCollection.setFindings(uri, findings);

      expect(mockCollection.set).toHaveBeenCalledTimes(1);
      const [setUri, diagnostics] = mockCollection.set.mock.calls[0];
      expect(setUri).toBe(uri);
      expect(diagnostics).toHaveLength(3);
    });

    it('should set correct range from finding line numbers (0-indexed)', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ startLine: 5, endLine: 12 });

      diagnosticCollection.setFindings(uri, [finding]);

      const [, diagnostics] = mockCollection.set.mock.calls[0];
      const diag = diagnostics[0];
      expect(diag.range.startLine).toBe(5);
      expect(diag.range.startCharacter).toBe(0);
      expect(diag.range.endLine).toBe(12);
      expect(diag.range.endCharacter).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should set message from finding', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ message: 'Avoid using any type' });

      diagnosticCollection.setFindings(uri, [finding]);

      const [, diagnostics] = mockCollection.set.mock.calls[0];
      expect(diagnostics[0].message).toBe('Avoid using any type');
    });

    it('should map severity <= 0.33 to Information', async () => {
      const { Uri, DiagnosticSeverity } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ severity: 0.2 });

      diagnosticCollection.setFindings(uri, [finding]);

      const [, diagnostics] = mockCollection.set.mock.calls[0];
      expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Information);
    });

    it('should map severity 0.34–0.66 to Warning', async () => {
      const { Uri, DiagnosticSeverity } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ severity: 0.5 });

      diagnosticCollection.setFindings(uri, [finding]);

      const [, diagnostics] = mockCollection.set.mock.calls[0];
      expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    });

    it('should map severity >= 0.67 to Error', async () => {
      const { Uri, DiagnosticSeverity } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const finding = makeFinding({ severity: 0.8 });

      diagnosticCollection.setFindings(uri, [finding]);

      const [, diagnostics] = mockCollection.set.mock.calls[0];
      expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    });

    it('should set source to "Code Review" on each diagnostic', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');
      const findings = [makeFinding(), makeFinding({ id: 'f2' })];

      diagnosticCollection.setFindings(uri, findings);

      const [, diagnostics] = mockCollection.set.mock.calls[0];
      for (const diag of diagnostics) {
        expect(diag.source).toBe('Code Review');
      }
    });

    it('should handle empty findings array', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      diagnosticCollection.setFindings(uri, []);

      expect(mockCollection.set).toHaveBeenCalledTimes(1);
      const [, diagnostics] = mockCollection.set.mock.calls[0];
      expect(diagnostics).toHaveLength(0);
    });

    it('should replace previous diagnostics for the same URI', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      diagnosticCollection.setFindings(uri, [makeFinding({ message: 'First' })]);
      diagnosticCollection.setFindings(uri, [makeFinding({ message: 'Second' })]);

      expect(mockCollection.set).toHaveBeenCalledTimes(2);
      const [, secondDiagnostics] = mockCollection.set.mock.calls[1];
      expect(secondDiagnostics).toHaveLength(1);
      expect(secondDiagnostics[0].message).toBe('Second');
    });
  });

  describe('clearUri', () => {
    it('should delete diagnostics for the specified URI', async () => {
      const { Uri } = await import('vscode');
      const uri = Uri.file('/path/to/file.ts');

      diagnosticCollection.clearUri(uri);

      expect(mockCollection.delete).toHaveBeenCalledTimes(1);
      expect(mockCollection.delete).toHaveBeenCalledWith(uri);
    });

    it('should only remove the specified URI, not others', async () => {
      const { Uri } = await import('vscode');
      const uri1 = Uri.file('/path/to/file1.ts');
      const uri2 = Uri.file('/path/to/file2.ts');

      // Set findings for both URIs
      diagnosticCollection.setFindings(uri1, [makeFinding()]);
      diagnosticCollection.setFindings(uri2, [makeFinding()]);

      // Clear only uri1
      diagnosticCollection.clearUri(uri1);

      // delete should only have been called with uri1
      expect(mockCollection.delete).toHaveBeenCalledTimes(1);
      expect(mockCollection.delete).toHaveBeenCalledWith(uri1);
      // clear should not have been called
      expect(mockCollection.clear).not.toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should clear all diagnostics', () => {
      diagnosticCollection.clearAll();

      expect(mockCollection.clear).toHaveBeenCalledTimes(1);
    });

    it('should remove diagnostics for all URIs', async () => {
      const { Uri } = await import('vscode');
      const uri1 = Uri.file('/path/to/file1.ts');
      const uri2 = Uri.file('/path/to/file2.ts');

      diagnosticCollection.setFindings(uri1, [makeFinding()]);
      diagnosticCollection.setFindings(uri2, [makeFinding()]);

      diagnosticCollection.clearAll();

      expect(mockCollection.clear).toHaveBeenCalledTimes(1);
      // delete should not have been called — clear handles everything
      expect(mockCollection.delete).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should dispose the underlying diagnostic collection', () => {
      diagnosticCollection.dispose();

      expect(mockCollection.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
