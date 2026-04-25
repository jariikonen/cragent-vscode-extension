import * as vscode from 'vscode';
import { Finding } from '../models/Finding.js';

/**
 * Formats a Finding's scores into the label string.
 * Format: "P: X.XX | S: X.XX | C: X.XX | I: X.XX"
 */
function formatScoreLabel(finding: Finding): string {
  return `P: ${finding.priority.toFixed(2)} | S: ${finding.severity.toFixed(2)} | C: ${finding.confidence.toFixed(2)} | I: ${finding.importance.toFixed(2)}`;
}

/**
 * Wraps a VS Code CommentController to display code review findings
 * as inline comment threads in the editor.
 */
export class CodeReviewCommentController {
  private readonly controller: vscode.CommentController;
  private readonly threadsByUri: Map<string, vscode.CommentThread[]> = new Map();

  constructor(controller?: vscode.CommentController) {
    this.controller =
      controller ?? vscode.comments.createCommentController('codeReview', 'Code Review');
  }

  /**
   * Creates one CommentThread per finding at the correct range for the given URI.
   * Replaces any existing threads for that URI.
   */
  setFindings(uri: vscode.Uri, findings: Finding[]): void {
    // Clear existing threads for this URI first
    this.clearUri(uri);

    const threads: vscode.CommentThread[] = [];

    for (const finding of findings) {
      const range = new vscode.Range(
        finding.startLine,
        0,
        finding.endLine,
        Number.MAX_SAFE_INTEGER,
      );

      const thread = this.controller.createCommentThread(uri, range, []);
      thread.contextValue = 'codeReviewFinding';

      const comments: vscode.Comment[] = [];

      // First comment: finding message with score label
      const mainComment: vscode.Comment = {
        body: finding.message,
        mode: vscode.CommentMode.Preview,
        author: { name: 'Code Review' },
        label: formatScoreLabel(finding),
      };
      comments.push(mainComment);

      // Optional second comment: suggestion
      if (finding.suggestion !== undefined) {
        const suggestionComment: vscode.Comment = {
          body: finding.suggestion,
          mode: vscode.CommentMode.Preview,
          author: { name: 'Code Review' },
          label: 'Suggestion',
        };
        comments.push(suggestionComment);
      }

      thread.comments = comments;
      threads.push(thread);
    }

    this.threadsByUri.set(uri.toString(), threads);
  }

  /**
   * Clears all comment threads for a single URI.
   */
  clearUri(uri: vscode.Uri): void {
    const key = uri.toString();
    const threads = this.threadsByUri.get(key);
    if (threads) {
      for (const thread of threads) {
        thread.dispose();
      }
      this.threadsByUri.delete(key);
    }
  }

  /**
   * Clears all comment threads across all URIs.
   */
  clearAll(): void {
    for (const [, threads] of this.threadsByUri) {
      for (const thread of threads) {
        thread.dispose();
      }
    }
    this.threadsByUri.clear();
  }

  /**
   * Dismisses (disposes) a single comment thread and removes it from tracking.
   */
  dismissThread(thread: vscode.CommentThread): void {
    // Find and remove the thread from our tracking map
    for (const [key, threads] of this.threadsByUri) {
      const index = threads.indexOf(thread);
      if (index !== -1) {
        threads.splice(index, 1);
        if (threads.length === 0) {
          this.threadsByUri.delete(key);
        }
        break;
      }
    }
    thread.dispose();
  }

  /**
   * Disposes the underlying CommentController and all tracked threads.
   */
  dispose(): void {
    this.clearAll();
    this.controller.dispose();
  }
}
