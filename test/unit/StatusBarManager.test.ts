import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBarManager } from '../../src/ui/StatusBarManager';
import type { StatusBarItem } from '../../src/ui/StatusBarManager';

describe('StatusBarManager', () => {
  let mockItem: StatusBarItem;
  let manager: StatusBarManager;

  beforeEach(() => {
    mockItem = {
      text: '',
      tooltip: undefined,
      show: vi.fn(),
      dispose: vi.fn(),
    };

    manager = new StatusBarManager(mockItem);
  });

  describe('constructor', () => {
    it('should call show() on the status bar item', () => {
      expect(mockItem.show).toHaveBeenCalledTimes(1);
    });
  });

  describe('setConnected', () => {
    it('should set text to "$(check) Code Review: Connected"', () => {
      manager.setConnected('http://localhost:3000/mcp');

      expect(mockItem.text).toBe('$(check) Code Review: Connected');
    });

    it('should set tooltip to the server URL', () => {
      manager.setConnected('http://localhost:3000/mcp');

      expect(mockItem.tooltip).toBe('http://localhost:3000/mcp');
    });

    it('should update tooltip when called with a different URL', () => {
      manager.setConnected('http://localhost:3000/mcp');
      manager.setConnected('https://review.example.com/mcp');

      expect(mockItem.tooltip).toBe('https://review.example.com/mcp');
    });
  });

  describe('setDisconnected', () => {
    it('should set text to "$(x) Code Review: Disconnected"', () => {
      manager.setDisconnected();

      expect(mockItem.text).toBe('$(x) Code Review: Disconnected');
    });

    it('should clear the tooltip', () => {
      manager.setConnected('http://localhost:3000/mcp');
      manager.setDisconnected();

      expect(mockItem.tooltip).toBeUndefined();
    });
  });

  describe('setReviewing', () => {
    it('should set text to "$(sync~spin) Code Review: Reviewing…"', () => {
      manager.setReviewing();

      expect(mockItem.text).toBe('$(sync~spin) Code Review: Reviewing…');
    });
  });

  describe('dispose', () => {
    it('should dispose the underlying status bar item', () => {
      manager.dispose();

      expect(mockItem.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
