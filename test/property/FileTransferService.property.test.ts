import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock vscode module (required because FileTransferService imports vscode)
vi.mock('vscode', () => ({
  workspace: {
    fs: { readFile: vi.fn(), stat: vi.fn() },
    workspaceFolders: [],
    asRelativePath: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

import { filterByTimestamp, type FilePayload } from '../../src/review/FileTransferService';

// Feature: vscode-code-review-extension, Property 3: Incremental Sync Correctness

/**
 * Property 3: Incremental Sync Correctness
 *
 * For any set of workspace files and any non-null Index_Timestamp value T,
 * the set of files selected for transfer SHALL be exactly the subset whose
 * lastModified time is strictly after T — no more, no fewer. When T is null,
 * all files SHALL be included.
 *
 * **Validates: Requirements 2.5**
 */

/**
 * Generates a random ISO 8601 timestamp within a reasonable date range.
 * Uses integer milliseconds to produce valid Date objects.
 */
const isoTimestampArb = fc
  .integer({
    min: new Date('2020-01-01T00:00:00Z').getTime(),
    max: new Date('2030-12-31T23:59:59Z').getTime(),
  })
  .map((ms) => new Date(ms).toISOString());

/**
 * Generates a random FilePayload with a random ISO 8601 lastModified timestamp.
 */
const filePayloadArb: fc.Arbitrary<FilePayload> = fc.record({
  path: fc.string({ minLength: 1, maxLength: 100 }).map((s) => `src/${s}.ts`),
  content: fc.string({ minLength: 0, maxLength: 200 }),
  languageId: fc.constantFrom('typescript', 'javascript', 'python', 'go', 'rust'),
  lastModified: isoTimestampArb,
});

/**
 * Generates a sinceTimestamp that is either null or a random ISO 8601 timestamp.
 */
const sinceTimestampArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  isoTimestampArb,
);

describe('Property 3: Incremental Sync Correctness', () => {
  it('should include exactly the files with lastModified > sinceTimestamp when non-null, or all files when null', () => {
    fc.assert(
      fc.property(
        fc.array(filePayloadArb, { minLength: 0, maxLength: 20 }),
        sinceTimestampArb,
        (payloads, sinceTimestamp) => {
          const result = filterByTimestamp(payloads, sinceTimestamp);

          if (sinceTimestamp === null) {
            // When null, all files should be included
            expect(result).toEqual(payloads);
          } else {
            // When non-null, only files strictly after the timestamp
            const expected = payloads.filter(
              (p) => p.lastModified > sinceTimestamp,
            );
            expect(result).toEqual(expected);

            // No file in the result should have lastModified <= sinceTimestamp
            for (const payload of result) {
              expect(payload.lastModified > sinceTimestamp).toBe(true);
            }

            // No file excluded from the result should have lastModified > sinceTimestamp
            const excluded = payloads.filter(
              (p) => !result.includes(p),
            );
            for (const payload of excluded) {
              expect(payload.lastModified <= sinceTimestamp).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return all files when sinceTimestamp is null regardless of lastModified values', () => {
    fc.assert(
      fc.property(
        fc.array(filePayloadArb, { minLength: 0, maxLength: 20 }),
        (payloads) => {
          const result = filterByTimestamp(payloads, null);
          expect(result).toHaveLength(payloads.length);
          expect(result).toEqual(payloads);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should never include files with lastModified <= sinceTimestamp', () => {
    fc.assert(
      fc.property(
        fc.array(filePayloadArb, { minLength: 1, maxLength: 20 }),
        isoTimestampArb,
        (payloads, sinceTimestamp) => {
          const result = filterByTimestamp(payloads, sinceTimestamp);

          for (const payload of result) {
            expect(payload.lastModified > sinceTimestamp).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
