import * as vscode from 'vscode';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, context?: object): void;
  show(): void;
  dispose(): void;
}

export class OutputChannelLogger implements Logger {
  private channel: vscode.OutputChannel;

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel;
  }

  log(level: LogLevel, message: string, context?: object): void {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const logLine = `${timestamp} [${levelStr}] ${message}${contextStr}`;
    
    this.channel.appendLine(logLine);
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}
