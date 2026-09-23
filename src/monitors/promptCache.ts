import * as vscode from 'vscode';
import { cfg, getAppType, getConfig } from '../config';

const CACHE_MS = 5 * 60 * 1000;

export class PromptCacheTimer {
  private readonly item: vscode.StatusBarItem;
  private interval: ReturnType<typeof setInterval> | undefined;
  private endTime = 0;
  private lastClick = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem('speedometer.promptCache', vscode.StatusBarAlignment.Right, 90);
    this.item.command = 'speedometer.togglePromptCache';
  }

  get statusBarItem(): vscode.StatusBarItem {
    return this.item;
  }

  startFrom(lastUpdateMs: number): void {
    if (getAppType() !== 'cursor' || !getConfig().showPromptCacheTimer) {
      this.stop();
      return;
    }
    const remaining = CACHE_MS - (Date.now() - lastUpdateMs);
    if (remaining <= 0) {
      this.stop();
      return;
    }
    this.endTime = Date.now() + remaining;
    this.item.show();
    this.tick();
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    this.item.hide();
  }

  async handleClick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastClick < 500) {
      this.lastClick = 0;
      await cfg().update('showPromptCacheTimer', false, vscode.ConfigurationTarget.Global);
      this.stop();
      void vscode.window.showInformationMessage('Timer de Prompt Cache desativado.');
      return;
    }
    this.lastClick = now;
    void vscode.commands.executeCommand('speedometer.refresh');
  }

  dispose(): void {
    this.stop();
    this.item.dispose();
  }

  private tick(): void {
    const remaining = this.endTime - Date.now();
    if (remaining <= 0) {
      this.stop();
      return;
    }
    const total = Math.ceil(remaining / 1000);
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    this.item.text = `$(clock) Cache ${mm}:${ss}`;
    this.item.tooltip = 'Prompt Cache restante. Clique para atualizar. Clique duplo para desativar.';
    this.item.backgroundColor =
      total <= 120 ? new vscode.ThemeColor('statusBarItem.warningBackground') : new vscode.ThemeColor('testing.iconPassed');
  }
}
