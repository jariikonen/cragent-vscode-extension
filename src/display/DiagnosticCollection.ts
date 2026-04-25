import * as vscode from 'vscode';
import { Finding, mapSeverity } from '../models/Finding.js';

/**
 * Wraps a VS Code DiagnosticCollection to display code review findings
 * in the Problems panel.
 */
export class CodeReviewDiagnosticCollection {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;

  constructor(diagnosticCollection?: vscode.DiagnosticCollection) {
    this.diagnosticCollection =
      diagnosticCollection ?? vscode.languages.createDiagnosticCollection('codeReview');
  }

  /**
   * Converts each Finding to a vscode.Diagnostic and sets them on the
   * given URI, replacing any previous diagnostics for that URI.
   */
  setFindings(uri: vscode.Uri, findings: Finding[]): void {
    const diagnostics = findings.map((finding) => {
      const range = new vscode.Range(
        finding.startLine,
        0,
        finding.endLine,
        Number.MAX_SAFE_INTEGER,
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        finding.message,
        mapSeverity(finding.severity),
      );
      diagnostic.source = 'Code Review';
      return diagnostic;
    });

    this.diagnosticCollection.set(uri, diagnostics);
  }

  /**
   * Clears diagnostics for a single URI.
   */
  clearUri(uri: vscode.Uri): void {
    this.diagnosticCollection.delete(uri);
  }

  /**
   * Clears all diagnostics across all URIs.
   */
  clearAll(): void {
    this.diagnosticCollection.clear();
  }

  /**
   * Disposes the underlying DiagnosticCollection.
   */
  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
