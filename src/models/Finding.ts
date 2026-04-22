import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

/**
 * A single code review finding produced by the review agent.
 */
export interface Finding {
  id: string;                  // UUID, generated on parse
  filePath: string;            // absolute path
  startLine: number;           // 0-indexed
  endLine: number;             // 0-indexed, inclusive
  message: string;
  suggestion?: string;
  confidence: number;          // 0.0–1.0
  severity: number;            // 0.0–1.0
  importance: number;          // 0.0–1.0
  priority: number;            // 0.0–1.0, combined score
  dismissed: boolean;          // runtime state, not persisted
}

/**
 * Raw finding result object returned by the MCP server.
 */
export interface RawFindingResult {
  filePath: string;       // required
  startLine: number;      // required
  endLine: number;        // required
  message: string;        // required
  suggestion?: string;    // optional
  confidence: number;     // required, 0.0–1.0
  severity: number;       // required, 0.0–1.0
  importance: number;     // required, 0.0–1.0
  priority: number;       // required, 0.0–1.0
}

/**
 * Clamps a numeric score to the range [0.0, 1.0].
 */
export function clampScore(score: number): number {
  if (score < 0.0) return 0.0;
  if (score > 1.0) return 1.0;
  return score;
}

/**
 * Maps a numeric severity score to VS Code DiagnosticSeverity.
 * Thresholds: 0.0–0.33 → Information, 0.34–0.66 → Warning, 0.67–1.0 → Error
 */
export function mapSeverity(score: number): vscode.DiagnosticSeverity {
  const clamped = clampScore(score);
  
  if (clamped <= 0.33) {
    return vscode.DiagnosticSeverity.Information;
  } else if (clamped <= 0.66) {
    return vscode.DiagnosticSeverity.Warning;
  } else {
    return vscode.DiagnosticSeverity.Error;
  }
}

/**
 * Parses a raw finding result into a Finding object.
 * Returns null and logs a warning when any required field is missing.
 */
export function parseFinding(raw: unknown): Finding | null {
  // Type guard: ensure raw is an object
  if (typeof raw !== 'object' || raw === null) {
    console.warn('[Code Review] Invalid finding: not an object', raw);
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Check all required fields
  const requiredFields = [
    'filePath',
    'startLine',
    'endLine',
    'message',
    'confidence',
    'severity',
    'importance',
    'priority'
  ];

  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null) {
      console.warn(`[Code Review] Invalid finding: missing required field "${field}"`, raw);
      return null;
    }
  }

  // Type validation for required fields
  if (typeof obj.filePath !== 'string') {
    console.warn('[Code Review] Invalid finding: filePath is not a string', raw);
    return null;
  }

  if (typeof obj.startLine !== 'number') {
    console.warn('[Code Review] Invalid finding: startLine is not a number', raw);
    return null;
  }

  if (typeof obj.endLine !== 'number') {
    console.warn('[Code Review] Invalid finding: endLine is not a number', raw);
    return null;
  }

  if (typeof obj.message !== 'string') {
    console.warn('[Code Review] Invalid finding: message is not a string', raw);
    return null;
  }

  if (typeof obj.confidence !== 'number') {
    console.warn('[Code Review] Invalid finding: confidence is not a number', raw);
    return null;
  }

  if (typeof obj.severity !== 'number') {
    console.warn('[Code Review] Invalid finding: severity is not a number', raw);
    return null;
  }

  if (typeof obj.importance !== 'number') {
    console.warn('[Code Review] Invalid finding: importance is not a number', raw);
    return null;
  }

  if (typeof obj.priority !== 'number') {
    console.warn('[Code Review] Invalid finding: priority is not a number', raw);
    return null;
  }

  // Optional suggestion field
  if (obj.suggestion !== undefined && typeof obj.suggestion !== 'string') {
    console.warn('[Code Review] Invalid finding: suggestion is not a string', raw);
    return null;
  }

  // Construct the Finding object
  const finding: Finding = {
    id: randomUUID(),
    filePath: obj.filePath,
    startLine: obj.startLine,
    endLine: obj.endLine,
    message: obj.message,
    suggestion: obj.suggestion as string | undefined,
    confidence: clampScore(obj.confidence),
    severity: clampScore(obj.severity),
    importance: clampScore(obj.importance),
    priority: clampScore(obj.priority),
    dismissed: false
  };

  return finding;
}
