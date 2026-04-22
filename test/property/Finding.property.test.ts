import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { parseFinding, mapSeverity, clampScore, type Finding, type RawFindingResult } from '../../src/models/Finding';
import * as vscode from 'vscode';

// Mock vscode module
vi.mock('vscode', () => ({
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3
  }
}));

describe('Finding Property-Based Tests', () => {
  // Feature: vscode-code-review-extension, Property 1: Finding Serialization Round-Trip
  describe('Property 1: Finding Serialization Round-Trip', () => {
    it('should preserve all fields through JSON serialization round-trip', () => {
      // Arbitrary Finding generator - use noNaN to avoid NaN values that don't round-trip through JSON
      const findingArbitrary = fc.record({
        id: fc.uuid(),
        filePath: fc.string({ minLength: 1 }),
        startLine: fc.nat(),
        endLine: fc.nat(),
        message: fc.string({ minLength: 1 }),
        suggestion: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        confidence: fc.float({ min: 0, max: 1, noNaN: true }),
        severity: fc.float({ min: 0, max: 1, noNaN: true }),
        importance: fc.float({ min: 0, max: 1, noNaN: true }),
        priority: fc.float({ min: 0, max: 1, noNaN: true }),
        dismissed: fc.boolean()
      }) as fc.Arbitrary<Finding>;

      fc.assert(
        fc.property(findingArbitrary, (finding) => {
          // Serialize
          const serialized = JSON.stringify(finding);
          
          // Deserialize
          const deserialized = JSON.parse(serialized) as Finding;

          // Assert all fields are identical
          expect(deserialized.id).toBe(finding.id);
          expect(deserialized.filePath).toBe(finding.filePath);
          expect(deserialized.startLine).toBe(finding.startLine);
          expect(deserialized.endLine).toBe(finding.endLine);
          expect(deserialized.message).toBe(finding.message);
          expect(deserialized.suggestion).toBe(finding.suggestion);
          expect(deserialized.confidence).toBe(finding.confidence);
          expect(deserialized.severity).toBe(finding.severity);
          expect(deserialized.importance).toBe(finding.importance);
          expect(deserialized.priority).toBe(finding.priority);
          expect(deserialized.dismissed).toBe(finding.dismissed);
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: vscode-code-review-extension, Property 2: Invalid Finding Rejection
  describe('Property 2: Invalid Finding Rejection', () => {
    it('should return null for raw results missing at least one required field', () => {
      // Generator for raw results with at least one required field missing
      const invalidRawFindingArbitrary = fc
        .record({
          filePath: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          startLine: fc.option(fc.nat(), { nil: undefined }),
          endLine: fc.option(fc.nat(), { nil: undefined }),
          message: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          suggestion: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          confidence: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
          severity: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
          importance: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
          priority: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined })
        })
        .filter((raw) => {
          // Ensure at least one required field is undefined
          return (
            raw.filePath === undefined ||
            raw.startLine === undefined ||
            raw.endLine === undefined ||
            raw.message === undefined ||
            raw.confidence === undefined ||
            raw.severity === undefined ||
            raw.importance === undefined ||
            raw.priority === undefined
          );
        });

      // Mock console.warn to suppress output during tests
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      fc.assert(
        fc.property(invalidRawFindingArbitrary, (raw) => {
          const result = parseFinding(raw);
          expect(result).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: vscode-code-review-extension, Property 10: Severity Threshold Mapping
  describe('Property 10: Severity Threshold Mapping', () => {
    it('should map severity scores to correct DiagnosticSeverity thresholds', () => {
      const scoreArbitrary = fc.float({ min: 0, max: 1 });

      fc.assert(
        fc.property(scoreArbitrary, (score) => {
          const severity = mapSeverity(score);

          if (score <= 0.33) {
            expect(severity).toBe(vscode.DiagnosticSeverity.Information);
          } else if (score <= 0.66) {
            expect(severity).toBe(vscode.DiagnosticSeverity.Warning);
          } else {
            expect(severity).toBe(vscode.DiagnosticSeverity.Error);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should clamp out-of-range values before mapping', () => {
      // Generate values outside [0, 1] range using double precision
      const outOfRangeArbitrary = fc.oneof(
        fc.double({ max: -0.01, noNaN: true }), // negative values
        fc.double({ min: 1.01, noNaN: true })    // values > 1.0
      );

      fc.assert(
        fc.property(outOfRangeArbitrary, (score) => {
          const clamped = clampScore(score);
          
          // Verify clamping
          expect(clamped).toBeGreaterThanOrEqual(0.0);
          expect(clamped).toBeLessThanOrEqual(1.0);

          // Verify mapping works on clamped value
          const severity = mapSeverity(score);
          
          if (score < 0) {
            // Clamped to 0.0, should map to Information
            expect(severity).toBe(vscode.DiagnosticSeverity.Information);
          } else {
            // Clamped to 1.0, should map to Error
            expect(severity).toBe(vscode.DiagnosticSeverity.Error);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
