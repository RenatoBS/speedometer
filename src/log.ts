import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;
const sessionLogs: string[] = [];
const MAX_LOGS = 1000;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Speedometer');
  }
  return channel;
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  sessionLogs.push(line);
  if (sessionLogs.length > MAX_LOGS) sessionLogs.shift();
  const short = message.length > 200 ? `${message.slice(0, 200)}...` : message;
  getOutputChannel().appendLine(`[${new Date().toLocaleTimeString('pt-BR')}] ${short}`);
}

export function getSessionLogs(): string[] {
  return [...sessionLogs];
}

export async function exportSessionLogs(): Promise<void> {
  if (sessionLogs.length === 0) {
    void vscode.window.showInformationMessage('Nenhum log para exportar.');
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`speedometer-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.log`),
    filters: { Log: ['log', 'txt'] }
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(sessionLogs.join('\n'), 'utf8'));
  void vscode.window.showInformationMessage(`Logs exportados para ${uri.fsPath}`);
}
