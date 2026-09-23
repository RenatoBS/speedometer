import * as vscode from 'vscode';
import { DisplayMode } from './types';

export type AppType = 'cursor' | 'trae' | 'antigravity' | 'unknown';

export function getAppType(): AppType {
  const name = (vscode.env.appName || '').toLowerCase();
  if (name.includes('cursor')) return 'cursor';
  if (name.includes('trae')) return 'trae';
  if (name.includes('antigravity')) return 'antigravity';
  return 'unknown';
}

export interface ExtensionConfig {
  refreshIntervalSeconds: number;
  displayMode: DisplayMode;
  warningThreshold: number;
  errorThreshold: number;
  showAllProviders: boolean;
  showPromptCacheTimer: boolean;
  additionalSessionTokens: string[];
  teamServerUrl: string;
  enableReporting: boolean;
  claudeEnabled: boolean;
  claudeCredentialsPath: string;
  claudeAccountLabel: string;
  codexEnabled: boolean;
  codexSessionsPath: string;
  cursorEnabled: boolean;
  traeEnabled: boolean;
  antigravityEnabled: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('speedometer');
}

function parseTokens(raw: unknown): string[] {
  const lines = Array.isArray(raw)
    ? raw.map((v) => String(v))
    : typeof raw === 'string'
      ? raw.split(/\n+/)
      : [];
  return lines.map((t) => t.trim()).filter(Boolean).slice(0, 3);
}

export function getConfig(): ExtensionConfig {
  const c = cfg();
  const warningThreshold = clamp(c.get<number>('warningThreshold', 80), 0, 100);
  const errorThreshold = Math.max(warningThreshold, clamp(c.get<number>('errorThreshold', 95), 0, 100));
  return {
    refreshIntervalSeconds: Math.max(15, c.get<number>('refreshIntervalSeconds', 60)),
    displayMode: c.get<DisplayMode>('displayMode', 'full'),
    warningThreshold,
    errorThreshold,
    showAllProviders: c.get<boolean>('showAllProviders', false),
    showPromptCacheTimer: c.get<boolean>('showPromptCacheTimer', true),
    additionalSessionTokens: parseTokens(c.get('additionalSessionTokens')),
    teamServerUrl: (c.get<string>('teamServerUrl', '') ?? '').trim(),
    enableReporting: c.get<boolean>('enableReporting', false),
    claudeEnabled: c.get<boolean>('claude.enabled', true),
    claudeCredentialsPath: c.get<string>('claude.credentialsPath', '') ?? '',
    claudeAccountLabel: (c.get<string>('claude.accountLabel', '') ?? '').trim(),
    codexEnabled: c.get<boolean>('codex.enabled', true),
    codexSessionsPath: c.get<string>('codex.sessionsPath', '') ?? '',
    cursorEnabled: c.get<boolean>('cursor.enabled', true),
    traeEnabled: c.get<boolean>('trae.enabled', true),
    antigravityEnabled: c.get<boolean>('antigravity.enabled', true)
  };
}

export function getTokenIdeType(token: string): 'cursor' | 'trae' | 'unknown' {
  if (!token) return 'unknown';
  if (token.includes('WorkosCursorSessionToken=') || token.includes('%3A%3A')) return 'cursor';
  const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  if (jwt.test(token)) return 'cursor';
  if (token.includes('X-Cloudide-Session=')) return 'trae';
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)) return 'trae';
  return 'unknown';
}

export function filterTokensByIdeType(tokens: string[], ideType: 'cursor' | 'trae'): string[] {
  return tokens.filter((token) => {
    const type = getTokenIdeType(token);
    return type === ideType || type === 'unknown';
  });
}

export function stripTokenPrefix(token: string): string {
  const cursor = token.match(/^WorkosCursorSessionToken=(.+)$/);
  if (cursor) return cursor[1];
  const trae = token.match(/^X-Cloudide-Session=(.+)$/);
  if (trae) return trae[1];
  return token;
}

export function getClipboardTokenPattern(): RegExp | null {
  const app = getAppType();
  if (app === 'cursor') return /WorkosCursorSessionToken=([^\n\s;]+)/;
  if (app === 'trae') return /X-Cloudide-Session=([^\s;]+)/;
  return null;
}
