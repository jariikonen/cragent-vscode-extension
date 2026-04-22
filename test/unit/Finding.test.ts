import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { parseFinding, mapSeverity, clampScore, type RawFindingResult } from '../../src/models/Finding';

// Mock vscode module
vi.mock('vscode', () => ({
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3
  }
}));

describe('Finding Parser', () => {
  beforeEach(() => {
    // Clear console.warn spy before each test
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('parseFinding', () => {
    it('should parse a valid finding with all fields', () => {
      const raw: RawFindingResult = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        message: 'This is a finding',
        suggestion: 'Try this instead',
        confidence: 0.85,
        severity: 0.72,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);

      expect(finding).not.toBeNull();
      expect(finding?.filePath).toBe('/path/to/file.ts');
      expect(finding?.startLine).toBe(10);
      expect(finding?.endLine).toBe(15);
      expect(finding?.message).toBe('This is a finding');
      expect(finding?.suggestion).toBe('Try this instead');
      expect(finding?.confidence).toBe(0.85);
      expect(finding?.severity).toBe(0.72);
      expect(finding?.importance).toBe(0.90);
      expect(finding?.priority).toBe(0.82);
      expect(finding?.dismissed).toBe(false);
      expect(finding?.id).toBeDefined();
      expect(typeof finding?.id).toBe('string');
    });

    it('should parse a valid finding without optional suggestion', () => {
      const raw: RawFindingResult = {
        filePath: '/path/to/file.ts',
        startLine: 5,
        endLine: 8,
        message: 'Another finding',
        confidence: 0.75,
        severity: 0.60,
        importance: 0.80,
        priority: 0.70
      };

      const finding = parseFinding(raw);

      expect(finding).not.toBeNull();
      expect(finding?.filePath).toBe('/path/to/file.ts');
      expect(finding?.suggestion).toBeUndefined();
    });

    // Test each required field missing individually (8 cases)
    it('should return null when filePath is missing', () => {
      const raw = {
        startLine: 10,
        endLine: 15,
        message: 'Test',
        confidence: 0.85,
        severity: 0.72,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "filePath"'),
        raw
      );
    });

    it('should return null when startLine is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        endLine: 15,
        message: 'Test',
        confidence: 0.85,
        severity: 0.72,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "startLine"'),
        raw
      );
    });

    it('should return null when endLine is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        message: 'Test',
        confidence: 0.85,
        severity: 0.72,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "endLine"'),
        raw
      );
    });

    it('should return null when message is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        confidence: 0.85,
        severity: 0.72,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "message"'),
        raw
      );
    });

    it('should return null when confidence is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        message: 'Test',
        severity: 0.72,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "confidence"'),
        raw
      );
    });

    it('should return null when severity is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        message: 'Test',
        confidence: 0.85,
        importance: 0.90,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "severity"'),
        raw
      );
    });

    it('should return null when importance is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        message: 'Test',
        confidence: 0.85,
        severity: 0.72,
        priority: 0.82
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "importance"'),
        raw
      );
    });

    it('should return null when priority is missing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        message: 'Test',
        confidence: 0.85,
        severity: 0.72,
        importance: 0.90
      };

      const finding = parseFinding(raw);
      expect(finding).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing required field "priority"'),
        raw
      );
    });
  });

  describe('mapSeverity', () => {
    it('should map 0.0 to Information', () => {
      expect(mapSeverity(0.0)).toBe(vscode.DiagnosticSeverity.Information);
    });

    it('should map 0.33 to Information', () => {
      expect(mapSeverity(0.33)).toBe(vscode.DiagnosticSeverity.Information);
    });

    it('should map 0.34 to Warning', () => {
      expect(mapSeverity(0.34)).toBe(vscode.DiagnosticSeverity.Warning);
    });

    it('should map 0.66 to Warning', () => {
      expect(mapSeverity(0.66)).toBe(vscode.DiagnosticSeverity.Warning);
    });

    it('should map 0.67 to Error', () => {
      expect(mapSeverity(0.67)).toBe(vscode.DiagnosticSeverity.Error);
    });

    it('should map 1.0 to Error', () => {
      expect(mapSeverity(1.0)).toBe(vscode.DiagnosticSeverity.Error);
    });
  });

  describe('clampScore', () => {
    it('should clamp negative values to 0.0', () => {
      expect(clampScore(-0.5)).toBe(0.0);
      expect(clampScore(-1.0)).toBe(0.0);
      expect(clampScore(-100)).toBe(0.0);
    });

    it('should clamp values above 1.0 to 1.0', () => {
      expect(clampScore(1.5)).toBe(1.0);
      expect(clampScore(2.0)).toBe(1.0);
      expect(clampScore(100)).toBe(1.0);
    });

    it('should not modify values within [0.0, 1.0]', () => {
      expect(clampScore(0.0)).toBe(0.0);
      expect(clampScore(0.5)).toBe(0.5);
      expect(clampScore(1.0)).toBe(1.0);
    });
  });

  describe('parseFinding with score clamping', () => {
    it('should clamp out-of-range scores when parsing', () => {
      const raw = {
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 15,
        message: 'Test',
        confidence: -0.5,
        severity: 1.5,
        importance: 2.0,
        priority: -1.0
      };

      const finding = parseFinding(raw);

      expect(finding).not.toBeNull();
      expect(finding?.confidence).toBe(0.0);
      expect(finding?.severity).toBe(1.0);
      expect(finding?.importance).toBe(1.0);
      expect(finding?.priority).toBe(0.0);
    });
  });
});
