import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  console.log('Code Review extension is now active');
}

export function deactivate(): void {
  console.log('Code Review extension is now deactivated');
}
