import * as vscode from 'vscode';
import { Finding } from '../models/Finding';
import { CodeReviewCommentController } from './CommentController';
import { CodeReviewDiagnosticCollection } from './DiagnosticCollection';

/**
 * Sort/filter options for controlling how findings are displayed.
 */
export interface FindingSortFilterOptions {
  sortField: 'priority' | 'severity' | 'confidence' | 'importance';
  showInformationFindings: boolean;
  filter: {
    minPriority: number;
    minSeverity: number;
    minConfidence: number;
    minImportance: number;
  };
}

const DEFAULT_OPTIONS: FindingSortFilterOptions = {
  sortField: 'priority',
  showInformationFindings: true,
  filter: {
    minPriority: 0,
    minSeverity: 0,
    minConfidence: 0,
    minImportance: 0,
  },
};

/**
 * Coordinates CommentController and DiagnosticCollection to display findings
 * with sort/filter logic applied consistently to both surfaces.
 */
export class FindingDisplayManager {
  private readonly commentController: CodeReviewCommentController;
  private readonly diagnosticCollection: CodeReviewDiagnosticCollection;

  /** Raw (unfiltered, unsorted) findings stored per URI for re-application on option changes. */
  private readonly findingsByUri: Map<string, { uri: vscode.Uri; findings: Finding[] }> = new Map();

  private options: FindingSortFilterOptions;

  constructor(
    commentController: CodeReviewCommentController,
    diagnosticCollection: CodeReviewDiagnosticCollection,
    options?: Partial<FindingSortFilterOptions>,
  ) {
    this.commentController = commentController;
    this.diagnosticCollection = diagnosticCollection;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Applies findings for a URI — stores the raw findings, then filters/sorts
   * and pushes the result to both display delegates.
   */
  applyFindings(uri: vscode.Uri, findings: Finding[]): void {
    // Store raw findings for later re-application
    this.findingsByUri.set(uri.toString(), { uri, findings });

    // Apply sort/filter and push to delegates
    const processed = this.filterAndSort(findings);
    this.commentController.setFindings(uri, processed);
    this.diagnosticCollection.setFindings(uri, processed);
  }

  /**
   * Clears findings for a single URI from both display surfaces.
   */
  clearFindings(uri: vscode.Uri): void {
    this.findingsByUri.delete(uri.toString());
    this.commentController.clearUri(uri);
    this.diagnosticCollection.clearUri(uri);
  }

  /**
   * Clears all findings across all URIs from both display surfaces.
   */
  clearAllFindings(): void {
    this.findingsByUri.clear();
    this.commentController.clearAll();
    this.diagnosticCollection.clearAll();
  }

  /**
   * Dismisses a single comment thread, delegating to CommentController.
   */
  dismissThread(thread: vscode.CommentThread): void {
    this.commentController.dismissThread(thread);
  }

  /**
   * Updates sort/filter options and re-applies them to all currently held
   * findings across all URIs without requiring a new review session.
   */
  updateSortFilter(options: Partial<FindingSortFilterOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.filter) {
      this.options.filter = { ...this.options.filter, ...options.filter };
    }

    // Re-apply to all stored URIs
    for (const [, entry] of this.findingsByUri) {
      const processed = this.filterAndSort(entry.findings);
      this.commentController.setFindings(entry.uri, processed);
      this.diagnosticCollection.setFindings(entry.uri, processed);
    }
  }

  /**
   * Returns the current sort/filter options (useful for testing).
   */
  getOptions(): FindingSortFilterOptions {
    return { ...this.options };
  }

  /**
   * Filters and sorts findings according to current options.
   */
  private filterAndSort(findings: Finding[]): Finding[] {
    let result = findings;

    // Filter out information-severity findings when disabled
    if (!this.options.showInformationFindings) {
      result = result.filter((f) => f.severity > 0.33);
    }

    // Apply minimum threshold filters
    result = result.filter(
      (f) =>
        f.priority >= this.options.filter.minPriority &&
        f.severity >= this.options.filter.minSeverity &&
        f.confidence >= this.options.filter.minConfidence &&
        f.importance >= this.options.filter.minImportance,
    );

    // Sort descending by the chosen field
    const field = this.options.sortField;
    result = [...result].sort((a, b) => b[field] - a[field]);

    return result;
  }
}
