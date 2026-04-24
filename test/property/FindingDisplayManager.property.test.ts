import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
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

/**
 * Arbitrary generator for Finding objects with random scores.
 */
function findingArbitrary(): fc.Arbitrary<Finding> {
  return fc
    .nat({ max: 10000 })
    .chain((a) =>
      fc.nat({ max: 10000 }).map((b) => ({
        startLine: Math.min(a, b),
        endLine: Math.max(a, b),
      })),
    )
    .chain((lines) =>
      fc.record({
        id: fc.uuid(),
        filePath: fc.string({ minLength: 1 }),
        startLine: fc.constant(lines.startLine),
        endLine: fc.constant(lines.endLine),
        message: fc.string({ minLength: 1 }),
        suggestion: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        confidence: fc.float({ min: 0, max: 1, noNaN: true }),
        severity: fc.float({ min: 0, max: 1, noNaN: true }),
        importance: fc.float({ min: 0, max: 1, noNaN: true }),
        priority: fc.float({ min: 0, max: 1, noNaN: true }),
        dismissed: fc.boolean(),
      }) as fc.Arbitrary<Finding>,
    );
}

/**
 * Creates mock delegates that capture setFindings calls.
 */
function createMocks() {
  const commentCalls: { uri: any; findings: Finding[] }[] = [];
  const diagnosticCalls: { uri: any; findings: Finding[] }[] = [];

  const mockCommentController = {
    setFindings: vi.fn((uri: any, findings: Finding[]) => {
      commentCalls.push({ uri, findings: [...findings] });
    }),
    clearUri: vi.fn(),
    clearAll: vi.fn(),
    dismissThread: vi.fn(),
    dispose: vi.fn(),
  };

  const mockDiagnosticCollection = {
    setFindings: vi.fn((uri: any, findings: Finding[]) => {
      diagnosticCalls.push({ uri, findings: [...findings] });
    }),
    clearUri: vi.fn(),
    clearAll: vi.fn(),
    dispose: vi.fn(),
  };

  return { mockCommentController, mockDiagnosticCollection, commentCalls, diagnosticCalls };
}

// Feature: vscode-code-review-extension, Property 4: Information Finding Filter
describe('Property 4: Information Finding Filter', () => {
  // **Validates: Requirements 6.5**
  it('should exclude information-severity findings when showInformationFindings is false and preserve all others', async () => {
    const { Uri } = await import('vscode');

    fc.assert(
      fc.property(fc.array(findingArbitrary(), { minLength: 0, maxLength: 30 }), (findings) => {
        const { mockCommentController, mockDiagnosticCollection, commentCalls, diagnosticCalls } = createMocks();

        const manager = new FindingDisplayManager(
          mockCommentController as any,
          mockDiagnosticCollection as any,
          { showInformationFindings: false },
        );

        const uri = Uri.file('/test/file.ts');
        manager.applyFindings(uri, findings);

        const commentDisplayed = commentCalls[0]?.findings ?? [];
        const diagnosticDisplayed = diagnosticCalls[0]?.findings ?? [];

        // No finding with severity <= 0.33 should be present in either surface
        for (const f of commentDisplayed) {
          expect(f.severity).toBeGreaterThan(0.33);
        }
        for (const f of diagnosticDisplayed) {
          expect(f.severity).toBeGreaterThan(0.33);
        }

        // All findings with severity > 0.33 should be preserved in both surfaces
        const expectedIds = new Set(
          findings.filter((f) => f.severity > 0.33).map((f) => f.id),
        );
        const commentIds = new Set(commentDisplayed.map((f) => f.id));
        const diagnosticIds = new Set(diagnosticDisplayed.map((f) => f.id));
        expect(commentIds).toEqual(expectedIds);
        expect(diagnosticIds).toEqual(expectedIds);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: vscode-code-review-extension, Property 5: Diagnostic–Comment Consistency
describe('Property 5: Diagnostic–Comment Consistency', () => {
  // **Validates: Requirements 4.1, 4.2, 5.1**
  it('should produce identical finding sets in both diagnostics and comments', async () => {
    const { Uri } = await import('vscode');

    fc.assert(
      fc.property(
        fc.array(findingArbitrary(), { minLength: 0, maxLength: 30 }),
        fc.boolean(),
        (findings, showInfo) => {
          const { mockCommentController, mockDiagnosticCollection, commentCalls, diagnosticCalls } =
            createMocks();

          const manager = new FindingDisplayManager(
            mockCommentController as any,
            mockDiagnosticCollection as any,
            { showInformationFindings: showInfo },
          );

          const uri = Uri.file('/test/file.ts');
          manager.applyFindings(uri, findings);

          const commentFindings = commentCalls[0]?.findings ?? [];
          const diagnosticFindings = diagnosticCalls[0]?.findings ?? [];

          // Both surfaces should have exactly the same findings
          expect(commentFindings.length).toBe(diagnosticFindings.length);

          const commentIds = commentFindings.map((f) => f.id);
          const diagnosticIds = diagnosticFindings.map((f) => f.id);
          expect(commentIds).toEqual(diagnosticIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: vscode-code-review-extension, Property 6: Session Replacement Idempotence
describe('Property 6: Session Replacement Idempotence', () => {
  // **Validates: Requirements 4.3, 5.4**
  it('should produce the same final state as applying only the second list', async () => {
    const { Uri } = await import('vscode');

    fc.assert(
      fc.property(
        fc.array(findingArbitrary(), { minLength: 0, maxLength: 20 }),
        fc.array(findingArbitrary(), { minLength: 0, maxLength: 20 }),
        (firstFindings, secondFindings) => {
          // Apply first then second
          const mocks1 = createMocks();
          const manager1 = new FindingDisplayManager(
            mocks1.mockCommentController as any,
            mocks1.mockDiagnosticCollection as any,
          );
          const uri = Uri.file('/test/file.ts');
          manager1.applyFindings(uri, firstFindings);
          manager1.applyFindings(uri, secondFindings);

          // Apply only second
          const mocks2 = createMocks();
          const manager2 = new FindingDisplayManager(
            mocks2.mockCommentController as any,
            mocks2.mockDiagnosticCollection as any,
          );
          manager2.applyFindings(uri, secondFindings);

          // Final state of manager1 (last call) should equal manager2's only call
          const finalComment1 =
            mocks1.commentCalls[mocks1.commentCalls.length - 1]?.findings ?? [];
          const finalComment2 = mocks2.commentCalls[0]?.findings ?? [];

          const finalDiag1 =
            mocks1.diagnosticCalls[mocks1.diagnosticCalls.length - 1]?.findings ?? [];
          const finalDiag2 = mocks2.diagnosticCalls[0]?.findings ?? [];

          // Compare by IDs (order should be the same since same sort options)
          expect(finalComment1.map((f) => f.id)).toEqual(finalComment2.map((f) => f.id));
          expect(finalDiag1.map((f) => f.id)).toEqual(finalDiag2.map((f) => f.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: vscode-code-review-extension, Property 11: Sort Order Correctness
describe('Property 11: Sort Order Correctness', () => {
  // **Validates: Requirements 8.1**
  it('should display findings in non-increasing order on the chosen sort field', async () => {
    const { Uri } = await import('vscode');

    const sortFieldArb = fc.constantFrom(
      'priority' as const,
      'severity' as const,
      'confidence' as const,
      'importance' as const,
    );

    fc.assert(
      fc.property(
        fc.array(findingArbitrary(), { minLength: 0, maxLength: 30 }),
        sortFieldArb,
        (findings, sortField) => {
          const { mockCommentController, mockDiagnosticCollection, commentCalls } = createMocks();

          const manager = new FindingDisplayManager(
            mockCommentController as any,
            mockDiagnosticCollection as any,
            { sortField },
          );

          const uri = Uri.file('/test/file.ts');
          manager.applyFindings(uri, findings);

          const displayed = commentCalls[0]?.findings ?? [];

          // Verify non-increasing order on the sort field
          for (let i = 1; i < displayed.length; i++) {
            expect(displayed[i - 1][sortField]).toBeGreaterThanOrEqual(displayed[i][sortField]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: vscode-code-review-extension, Property 12: Filter Threshold Correctness
describe('Property 12: Filter Threshold Correctness', () => {
  // **Validates: Requirements 8.2**
  it('should display exactly those findings where all four scores meet or exceed their thresholds', async () => {
    const { Uri } = await import('vscode');

    const thresholdArb = fc.record({
      minPriority: fc.float({ min: 0, max: 1, noNaN: true }),
      minSeverity: fc.float({ min: 0, max: 1, noNaN: true }),
      minConfidence: fc.float({ min: 0, max: 1, noNaN: true }),
      minImportance: fc.float({ min: 0, max: 1, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.array(findingArbitrary(), { minLength: 0, maxLength: 30 }),
        thresholdArb,
        (findings, thresholds) => {
          const { mockCommentController, mockDiagnosticCollection, commentCalls } = createMocks();

          const manager = new FindingDisplayManager(
            mockCommentController as any,
            mockDiagnosticCollection as any,
            {
              showInformationFindings: true, // don't interfere with threshold test
              filter: thresholds,
            },
          );

          const uri = Uri.file('/test/file.ts');
          manager.applyFindings(uri, findings);

          const displayed = commentCalls[0]?.findings ?? [];
          const displayedIds = new Set(displayed.map((f) => f.id));

          // Compute expected set: findings where ALL scores meet thresholds
          const expectedIds = new Set(
            findings
              .filter(
                (f) =>
                  f.priority >= thresholds.minPriority &&
                  f.severity >= thresholds.minSeverity &&
                  f.confidence >= thresholds.minConfidence &&
                  f.importance >= thresholds.minImportance,
              )
              .map((f) => f.id),
          );

          // No under-threshold finding should appear
          for (const f of displayed) {
            expect(expectedIds.has(f.id)).toBe(true);
          }

          // No qualifying finding should be omitted
          expect(displayedIds).toEqual(expectedIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
