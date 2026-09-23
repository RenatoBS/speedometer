import * as vscode from 'vscode';
import { cfg, getClipboardTokenPattern, getConfig } from '../config';
import { log } from '../log';

export class ClipboardMonitor {
  private lastToken: string | null = null;

  async check(): Promise<void> {
    const pattern = getClipboardTokenPattern();
    if (!pattern) return;
    try {
      const text = await vscode.env.clipboard.readText();
      const match = text.match(pattern);
      if (!match?.[1]) return;
      const token = match[0];
      const existing = getConfig().additionalSessionTokens;
      if (existing.includes(token) || existing.includes(match[1])) {
        if (this.lastToken !== token) {
          this.lastToken = token;
          void vscode.window.showInformationMessage('Token já está nas contas adicionais.');
        }
        return;
      }
      if (this.lastToken === token) return;
      const choice = await vscode.window.showInformationMessage(
        'Token de sessão encontrado na área de transferência. Adicionar como conta extra?',
        'Adicionar',
        'Ignorar'
      );
      this.lastToken = token;
      if (choice !== 'Adicionar') return;
      if (existing.length >= 3) {
        void vscode.window.showWarningMessage('Máximo de 3 contas extras. Remova uma nas configurações.');
        return;
      }
      await cfg().update('additionalSessionTokens', [...existing, token].join('\n'), vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage('Conta extra adicionada.');
      void vscode.commands.executeCommand('speedometer.refresh');
    } catch (error) {
      log(`Clipboard monitor: ${error}`);
    }
  }
}
