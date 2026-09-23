import * as vscode from 'vscode';
import { DashboardData } from './types';

export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(
    context: vscode.ExtensionContext,
    initialData: DashboardData,
    refresh: () => Promise<DashboardData>
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      DashboardPanel.current.postData(initialData);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'speedometerDashboard',
      'Speedometer — Uso de IA',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'media')
        ]
      }
    );
    DashboardPanel.current = new DashboardPanel(panel, context, initialData, refresh);
  }

  static postData(data: DashboardData): void {
    DashboardPanel.current?.postData(data);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    initialData: DashboardData,
    private readonly refresh: () => Promise<DashboardData>
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(initialData);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'requestRefresh') {
        this.postData(await this.refresh());
      }
    });
  }

  postData(data: DashboardData): void {
    this.panel.webview.postMessage({ type: 'data', data });
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private getHtml(initialData: DashboardData): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
    const nonce = getNonce();
    const initialJson = JSON.stringify(initialData).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Speedometer</title>
</head>
<body>
  <header class="topbar">
    <h1>Speedometer</h1>
    <div class="controls">
      <div class="segmented" id="metric-toggle">
        <button data-value="limit" class="active">% do limite</button>
        <button data-value="cost">Gasto (USD)</button>
      </div>
      <button id="refresh-btn" title="Atualizar">↻</button>
    </div>
  </header>
  <section id="cards" class="cards"></section>
  <section class="chart-wrap"><canvas id="chart"></canvas></section>
  <p id="generated-at" class="muted"></p>
  <script nonce="${nonce}">window.__INITIAL_DATA__ = ${initialJson};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
