import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
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

// Feature: vscode-code-review-extension, Property 7: Comment Content Fidelity
describe('Property 7: Comment Content Fidelity', () => {
  // **Validates: Requirements 5.2, 5.3**
  it('should create comment threads with correct message, label, and optional suggestion', async () => {
    const { Uri } = await import('vscode');

    // Generator for arbitrary Finding objects with optional suggestion
    const findingArbitrary: fc.Arbitrary<Finding> = fc.nat({ max: 10000 }).chain((a) =>
      fc.nat({ max: 10000 }).map((b) => ({ startLine: Math.min(a, b), endLine: Math.max(a, b) }))
    ).chain((lines) => fc.record({
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
    }) as fc.Arbitrary<Finding>);

    fc.assert(
      fc.property(findingArbitrary, (finding) => {
        // Track created threads
        const createdThreads: any[] = [];
        const mockController: any = {
          createCommentThread: vi.fn((_uri: any, _range: any, comments: any[]) => {
            const thread: any = {
              comments,
              contextValue: undefined,
              dispose: vi.fn(),
            };
            createdThreads.push(thread);
            return thread;
          }),
          dispose: vi.fn(),
        };

        const commentController = new CodeReviewCommentController(mockController);
        const uri = Uri.file('/test/file.ts');

        commentController.setFindings(uri, [finding]);

        // Exactly one thread should be created
        expect(createdThreads).toHaveLength(1);
        const thread = createdThreads[0];

        // First comment body equals finding.message
        expect(thread.comments[0].body).toBe(finding.message);

        // Label matches "P: X.XX | S: X.XX | C: X.XX | I: X.XX" with correct values
        const expectedLabel = `P: ${finding.priority.toFixed(2)} | S: ${finding.severity.toFixed(2)} | C: ${finding.confidence.toFixed(2)} | I: ${finding.importance.toFixed(2)}`;
        expect(thread.comments[0].label).toBe(expectedLabel);

        // Verify label matches the pattern
        const labelPattern = /^P: \d+\.\d{2} \| S: \d+\.\d{2} \| C: \d+\.\d{2} \| I: \d+\.\d{2}$/;
        expect(thread.comments[0].label).toMatch(labelPattern);

        // Suggestion reply present iff finding.suggestion is defined
        if (finding.suggestion !== undefined) {
          expect(thread.comments).toHaveLength(2);
          expect(thread.comments[1].body).toBe(finding.suggestion);
        } else {
          expect(thread.comments).toHaveLength(1);
        }

        // Clean up
        commentController.dispose();
      }),
      { numRuns: 100 },
    );
  });
});
