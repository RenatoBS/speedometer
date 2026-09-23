import * as fs from 'fs';
import * as vscode from 'vscode';
import { cfg, getAppType, getConfig } from './config';
import { exportSessionLogs, getOutputChannel, log } from './log';
import { ClipboardMonitor } from './monitors/clipboard';
import { DbMonitor } from './monitors/dbMonitor';
import { PromptCacheTimer } from './monitors/promptCache';
import { DashboardPanel } from './panel';
import { fetchAntigravityUsage } from './providers/antigravity';
import { fetchClaudeUsage } from './providers/claude';
import { fetchCodexUsage, resolveSessionsPath } from './providers/codex';
import { fetchCursorUsage } from './providers/cursor';
import { fetchTraeUsage } from './providers/trae';
import { RetryingWatcher } from './retrying-watcher';
import { SingleFlight } from './single-flight';
import { initTeamClient } from './team/client';
import { DashboardData, DashboardTool, ProviderId, UsageResult } from './types';
import { buildStatusText, buildTooltip, pickSeverity, Severity } from './view';

interface ProviderBinding {
  id: ProviderId;
  title: string;
  icon: string;
  item: vscode.StatusBarItem;
  fetch: () => Promise<{ result: UsageResult; extras?: DashboardTool['extras'] }>;
}

const TITLES: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  cursor: 'Cursor',
  trae: 'Trae',
  antigravity: 'Antigravity'
};

const ICONS: Record<ProviderId, string> = {
  claude: 'speedometer-claude',
  codex: 'speedometer-codex',
  cursor: 'speedometer-cursor',
  trae: 'speedometer-trae',
  antigravity: 'speedometer-antigravity'
};

let refreshTimer: ReturnType<typeof setInterval> | undefined;
let watchDebounce: ReturnType<typeof setTimeout> | undefined;
let configDebounce: ReturnType<typeof setTimeout> | undefined;
let refreshSkippedWhileUnfocused = false;
const providerRequests = new SingleFlight<{ result: UsageResult; extras?: DashboardTool['extras'] }>();
const sessionsWatcher = new RetryingWatcher(15_000);
const latest = new Map<ProviderId, DashboardTool>();
let extensionContext: vscode.ExtensionContext;

function enabled(id: ProviderId): boolean {
  const c = getConfig();
  if (id === 'claude') return c.claudeEnabled;
  if (id === 'codex') return c.codexEnabled;
  if (id === 'cursor') return c.cursorEnabled;
  if (id === 'trae') return c.traeEnabled;
  return c.antigravityEnabled;
}

function visibleForIde(id: ProviderId): boolean {
  if (id === 'claude' || id === 'codex') return true;
  if (getConfig().showAllProviders) return true;
  const app = getAppType();
  if (app === 'unknown') return id === 'cursor';
  return app === id;
}

function severityBackground(severity: Severity): vscode.ThemeColor | undefined {
  if (severity === 'error') return new vscode.ThemeColor('statusBarItem.errorBackground');
  if (severity === 'warning') return new vscode.ThemeColor('statusBarItem.warningBackground');
  return undefined;
}

function render(binding: ProviderBinding, result: UsageResult): void {
  const config = getConfig();
  const { item } = binding;
  if (!enabled(binding.id) || !visibleForIde(binding.id) || result.status === 'absent') {
    item.hide();
    return;
  }
  if (result.status === 'ok') {
    item.text = `$(${binding.icon}) ${buildStatusText(result.data, config.displayMode)}`;
    item.tooltip = buildTooltip(binding.icon, binding.title, result.data, config.warningThreshold, config.errorThreshold);
    item.backgroundColor = severityBackground(pickSeverity(result.data, config.warningThreshold, config.errorThreshold));
  } else {
    item.text = `$(${binding.icon}) --`;
    item.tooltip = `${binding.title}: ${result.message}`;
    item.backgroundColor = undefined;
  }
  item.show();
}

async function refreshOne(binding: ProviderBinding): Promise<void> {
  if (!enabled(binding.id) || !visibleForIde(binding.id)) {
    binding.item.hide();
    latest.delete(binding.id);
    return;
  }
  const custom =
    binding.id === 'claude' ? getConfig().claudeCredentialsPath : binding.id === 'codex' ? getConfig().codexSessionsPath : '';
  const payload = await providerRequests.run(`${binding.id}:${custom}`, () => binding.fetch());
  if (!enabled(binding.id) || !visibleForIde(binding.id)) {
    binding.item.hide();
    return;
  }
  let result = payload.result;
  if (binding.id === 'claude' && result.status === 'ok' && getConfig().claudeAccountLabel) {
    result = { ...result, data: { ...result.data, account: getConfig().claudeAccountLabel } };
  }
  latest.set(binding.id, { id: binding.id, label: TITLES[binding.id], result, extras: payload.extras });
  render(binding, result);
}

async function refreshAll(bindings: ProviderBinding[]): Promise<void> {
  await Promise.all(bindings.map((binding) => refreshOne(binding)));
  DashboardPanel.postData(collectDashboard());
}

function collectDashboard(): DashboardData {
  return { generatedAt: new Date().toISOString(), tools: [...latest.values()] };
}

function restartCodexWatcher(bindings: ProviderBinding[]): void {
  sessionsWatcher.stop();
  if (!getConfig().codexEnabled) return;
  sessionsWatcher.start(() => {
    const sessionsDir = resolveSessionsPath(getConfig().codexSessionsPath);
    if (!fs.existsSync(sessionsDir)) throw new Error('sessions directory missing');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(sessionsDir), '**/*.jsonl')
    );
    const schedule = () => {
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        void refreshAll(bindings.filter((b) => b.id === 'codex'));
      }, 2000);
    };
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(schedule);
    return { close: () => watcher.dispose() };
  });
}

function restartTimer(bindings: ProviderBinding[]): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!vscode.window.state.focused) {
      refreshSkippedWhileUnfocused = true;
      return;
    }
    void refreshAll(bindings);
  }, getConfig().refreshIntervalSeconds * 1000);
}

interface MenuPick extends vscode.QuickPickItem {
  action?: string;
}

async function showQuickMenu(bindings: ProviderBinding[]): Promise<void> {
  const c = getConfig();
  const onOff = (v: boolean) => (v ? 'ligado' : 'desligado');
  const items: MenuPick[] = [
    { label: `$(speedometer-claude) Claude Code`, description: onOff(c.claudeEnabled), action: 'toggleClaude' },
    { label: `$(speedometer-codex) Codex CLI`, description: onOff(c.codexEnabled), action: 'toggleCodex' },
    { label: `$(speedometer-cursor) Cursor`, description: onOff(c.cursorEnabled), action: 'toggleCursor' },
    { label: `$(speedometer-trae) Trae`, description: onOff(c.traeEnabled), action: 'toggleTrae' },
    { label: `$(speedometer-antigravity) Antigravity`, description: onOff(c.antigravityEnabled), action: 'toggleAntigravity' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: c.showAllProviders ? '$(check) Mostrar todos os IDEs' : '$(circle-slash) Mostrar todos os IDEs',
      description: c.showAllProviders ? 'ligado' : 'desligado',
      action: 'toggleShowAll'
    },
    { label: `$(dashboard) Abrir dashboard`, action: 'dashboard' },
    { label: `$(globe) Abrir dashboard oficial`, action: 'official' },
    { label: `$(gear) Abrir configurações`, action: 'settings' },
    { label: `$(refresh) Atualizar agora`, action: 'refresh' }
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Speedometer — uso de IA' });
  if (!picked?.action) return;
  const map: Record<string, string> = {
    toggleClaude: 'claude.enabled',
    toggleCodex: 'codex.enabled',
    toggleCursor: 'cursor.enabled',
    toggleTrae: 'trae.enabled',
    toggleAntigravity: 'antigravity.enabled'
  };
  if (map[picked.action]) {
    const key = map[picked.action];
    const current = cfg().get<boolean>(key, true);
    await cfg().update(key, !current, vscode.ConfigurationTarget.Global);
    void showQuickMenu(bindings);
    return;
  }
  if (picked.action === 'toggleShowAll') {
    await cfg().update('showAllProviders', !c.showAllProviders, vscode.ConfigurationTarget.Global);
    const reload = await vscode.window.showInformationMessage('Reinicie a janela para aplicar Mostrar todos os IDEs.', 'Recarregar');
    if (reload === 'Recarregar') void vscode.commands.executeCommand('workbench.action.reloadWindow');
    return;
  }
  if (picked.action === 'dashboard') {
    DashboardPanel.createOrShow(extensionContext, collectDashboard(), async () => {
      await refreshAll(bindings);
      return collectDashboard();
    });
    return;
  }
  if (picked.action === 'official') {
    const app = getAppType();
    const url =
      app === 'trae' ? 'https://www.trae.ai/account-setting#usage' : 'https://cursor.com/dashboard?tab=usage';
    void vscode.env.openExternal(vscode.Uri.parse(url));
    return;
  }
  if (picked.action === 'settings') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'speedometer.');
    return;
  }
  void refreshAll(bindings);
}

async function migrateLegacySettings(): Promise<void> {
  const tokens = cfg().inspect('additionalSessionTokens');
  for (const [value, target] of [
    [tokens?.globalValue, vscode.ConfigurationTarget.Global],
    [tokens?.workspaceValue, vscode.ConfigurationTarget.Workspace]
  ] as const) {
    if (Array.isArray(value)) {
      await cfg().update(
        'additionalSessionTokens',
        value.map((t) => String(t).trim()).filter(Boolean).join('\n'),
        target
      );
    }
  }
  const leftoverKey = cfg().inspect<string>('clientApiKey')?.globalValue;
  if (leftoverKey) {
    await extensionContext.globalState.update('clientApiKey', leftoverKey);
    await cfg().update('clientApiKey', undefined, vscode.ConfigurationTarget.Global);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  initTeamClient(context.globalState);
  log('Speedometer ativado');
  getOutputChannel();
  void migrateLegacySettings();

  const makeItem = (id: ProviderId, priority: number) => {
    const item = vscode.window.createStatusBarItem(`speedometer.${id}`, vscode.StatusBarAlignment.Right, priority);
    item.name = TITLES[id];
    item.command = 'speedometer.openMenu';
    return item;
  };

  const claudeItem = makeItem('claude', 105);
  const codexItem = makeItem('codex', 104);
  const cursorItem = makeItem('cursor', 103);
  const traeItem = makeItem('trae', 102);
  const antigravityItem = makeItem('antigravity', 101);

  const bindings: ProviderBinding[] = [
    {
      id: 'claude',
      title: TITLES.claude,
      icon: ICONS.claude,
      item: claudeItem,
      fetch: async () => ({ result: await fetchClaudeUsage(getConfig().claudeCredentialsPath) })
    },
    {
      id: 'codex',
      title: TITLES.codex,
      icon: ICONS.codex,
      item: codexItem,
      fetch: async () => ({ result: await fetchCodexUsage(getConfig().codexSessionsPath) })
    },
    {
      id: 'cursor',
      title: TITLES.cursor,
      icon: ICONS.cursor,
      item: cursorItem,
      fetch: () => fetchCursorUsage(context)
    },
    {
      id: 'trae',
      title: TITLES.trae,
      icon: ICONS.trae,
      item: traeItem,
      fetch: () => fetchTraeUsage()
    },
    {
      id: 'antigravity',
      title: TITLES.antigravity,
      icon: ICONS.antigravity,
      item: antigravityItem,
      fetch: () => fetchAntigravityUsage(context)
    }
  ];

  const clipboard = new ClipboardMonitor();
  const promptCache = new PromptCacheTimer();
  const dbMonitor = new DbMonitor(
    () => void refreshAll(bindings.filter((b) => b.id === 'cursor' || b.id === 'trae')),
    (ms) => promptCache.startFrom(ms)
  );

  const openDashboard = async () => {
    await refreshAll(bindings);
    DashboardPanel.createOrShow(context, collectDashboard(), async () => {
      await refreshAll(bindings);
      return collectDashboard();
    });
  };

  context.subscriptions.push(
    claudeItem,
    codexItem,
    cursorItem,
    traeItem,
    antigravityItem,
    promptCache.statusBarItem,
    vscode.commands.registerCommand('speedometer.refresh', () => void refreshAll(bindings)),
    vscode.commands.registerCommand('speedometer.openMenu', () => void showQuickMenu(bindings)),
    vscode.commands.registerCommand('speedometer.openDashboard', () => void openDashboard()),
    vscode.commands.registerCommand('speedometer.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'speedometer.');
    }),
    vscode.commands.registerCommand('speedometer.showOutput', () => getOutputChannel().show()),
    vscode.commands.registerCommand('speedometer.exportLogs', () => void exportSessionLogs()),
    vscode.commands.registerCommand('speedometer.togglePromptCache', () => void promptCache.handleClick()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('speedometer')) return;
      if (configDebounce) clearTimeout(configDebounce);
      configDebounce = setTimeout(() => {
        restartTimer(bindings);
        restartCodexWatcher(bindings);
        void refreshAll(bindings);
      }, 400);
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void clipboard.check();
        if (refreshSkippedWhileUnfocused) {
          refreshSkippedWhileUnfocused = false;
          void refreshAll(bindings);
        }
      }
    }),
    { dispose: () => dbMonitor.stop() },
    { dispose: () => promptCache.dispose() }
  );

  for (const binding of bindings) {
    if (enabled(binding.id) && visibleForIde(binding.id)) {
      binding.item.text = `$(${binding.icon}) $(loading~spin)`;
      binding.item.show();
    }
  }

  void refreshAll(bindings);
  restartTimer(bindings);
  restartCodexWatcher(bindings);
  void dbMonitor.start();
}

export function deactivate(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  if (watchDebounce) clearTimeout(watchDebounce);
  sessionsWatcher.stop();
}
