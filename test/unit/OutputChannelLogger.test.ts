import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputChannelLogger } from '../../src/ui/OutputChannelLogger';

describe('OutputChannelLogger', () => {
  let mockChannel: any;
  let logger: OutputChannelLogger;

  beforeEach(() => {
    mockChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };

    logger = new OutputChannelLogger(mockChannel);
  });

  describe('log', () => {
    it('should include ISO 8601 timestamp prefix', () => {
      logger.log('info', 'Test message');

      expect(mockChannel.appendLine).toHaveBeenCalledTimes(1);
      const logLine = mockChannel.appendLine.mock.calls[0][0];
      
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
      expect(logLine).toMatch(iso8601Regex);
    });

    it('should include the level string for info', () => {
      logger.log('info', 'Test message');

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toContain('[INFO]');
    });

    it('should include the level string for warn', () => {
      logger.log('warn', 'Warning message');

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toContain('[WARN]');
    });

    it('should include the level string for error', () => {
      logger.log('error', 'Error message');

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toContain('[ERROR]');
    });

    it('should include the message text', () => {
      logger.log('info', 'This is my test message');

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toContain('This is my test message');
    });

    it('should format log line with timestamp, level, and message', () => {
      logger.log('info', 'Test message');

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      
      // Should match pattern: YYYY-MM-DDTHH:mm:ss.sssZ [LEVEL] message
      expect(logLine).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] Test message$/);
    });

    it('should include context object when provided', () => {
      const context = { userId: 123, action: 'review' };
      logger.log('info', 'User action', context);

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toContain('{"userId":123,"action":"review"}');
    });

    it('should not include context when not provided', () => {
      logger.log('info', 'Simple message');

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      // Should end with the message, no extra JSON
      expect(logLine).toMatch(/Simple message$/);
    });

    it('should handle empty message', () => {
      logger.log('info', '');

      expect(mockChannel.appendLine).toHaveBeenCalledTimes(1);
      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] $/);
    });

    it('should handle complex context objects', () => {
      const context = {
        error: 'Connection failed',
        details: { code: 500, retries: 3 },
        timestamp: '2024-01-01T00:00:00Z'
      };
      logger.log('error', 'Request failed', context);

      const logLine = mockChannel.appendLine.mock.calls[0][0];
      expect(logLine).toContain('"error":"Connection failed"');
      expect(logLine).toContain('"code":500');
      expect(logLine).toContain('"retries":3');
    });
  });

  describe('show', () => {
    it('should call the underlying channel show() method', () => {
      logger.show();

      expect(mockChannel.show).toHaveBeenCalledTimes(1);
    });

    it('should call show() without arguments', () => {
      logger.show();

      expect(mockChannel.show).toHaveBeenCalledWith();
    });
  });

  describe('dispose', () => {
    it('should call the underlying channel dispose() method', () => {
      logger.dispose();

      expect(mockChannel.dispose).toHaveBeenCalledTimes(1);
    });

    it('should call dispose() without arguments', () => {
      logger.dispose();

      expect(mockChannel.dispose).toHaveBeenCalledWith();
    });
  });

  describe('integration', () => {
    it('should support multiple log calls', () => {
      logger.log('info', 'First message');
      logger.log('warn', 'Second message');
      logger.log('error', 'Third message');

      expect(mockChannel.appendLine).toHaveBeenCalledTimes(3);
      
      const firstLog = mockChannel.appendLine.mock.calls[0][0];
      const secondLog = mockChannel.appendLine.mock.calls[1][0];
      const thirdLog = mockChannel.appendLine.mock.calls[2][0];

      expect(firstLog).toContain('[INFO]');
      expect(firstLog).toContain('First message');
      
      expect(secondLog).toContain('[WARN]');
      expect(secondLog).toContain('Second message');
      
      expect(thirdLog).toContain('[ERROR]');
      expect(thirdLog).toContain('Third message');
    });

    it('should maintain timestamp ordering for sequential logs', () => {
      logger.log('info', 'Message 1');
      logger.log('info', 'Message 2');

      const firstLog = mockChannel.appendLine.mock.calls[0][0];
      const secondLog = mockChannel.appendLine.mock.calls[1][0];

      const timestamp1 = firstLog.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)?.[1];
      const timestamp2 = secondLog.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)?.[1];

      expect(timestamp1).toBeDefined();
      expect(timestamp2).toBeDefined();
      
      // Second timestamp should be >= first timestamp
      expect(new Date(timestamp2!).getTime()).toBeGreaterThanOrEqual(new Date(timestamp1!).getTime());
    });
  });
});
