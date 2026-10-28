import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { log } from '../log';
import { cursorGlobalStateDb, grokbotDataRoot, grokbotUserDataDir } from '../paths';
import { UsageResult, UsageWindow } from '../types';
import { loadCursorAuth } from './cursor';

const USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus';
const TIMEOUT_MS = 10_000;

interface SandUsageStatus {
  usagePercent?: number;
  currentPeriodStart?: string;
  nextResetTimestampUtc?: string;
  hasNonZeroIncludedLimit?: boolean;
  usesPooledEnterpriseAllowance?: boolean;
  hasAvailableUsage?: boolean;
  grokPlanLabel?: string;
}

export function grokbotInstalled(): boolean {
  const home = os.homedir();
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Grok Bot.app', path.join(home, 'Applications', 'Grok Bot.app'), grokbotDataRoot(), grokbotUserDataDir()]
      : process.platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Grok Bot'), grokbotDataRoot(), grokbotUserDataDir()]
        : [grokbotDataRoot(), grokbotUserDataDir()];
  return candidates.some((p) => fs.existsSync(p));
}

async function fetchSandUsage(accessToken: string): Promise<SandUsageStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(USAGE_URL, {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'connect-protocol-version': '1'
      }
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('auth');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as SandUsageStatus;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGrokbotUsage(context: vscode.ExtensionContext): Promise<{ result: UsageResult }> {
  if (!grokbotInstalled()) {
    return { result: { status: 'absent', message: 'Grok Bot não encontrado neste computador' } };
  }

  const dbPath = cursorGlobalStateDb();
  if (!fs.existsSync(dbPath)) {
    return {
      result: {
        status: 'missing',
        message: 'Faça login no Cursor com a mesma conta do Grok Bot'
      }
    };
  }

  const { accessToken, email, safeStorageError } = await loadCursorAuth(context, dbPath);
  if (!accessToken) {
    return {
      result: {
        status: 'missing',
        message: safeStorageError
          ? 'Token do Cursor protegido pelo chaveiro; autorize quando o sistema pedir'
          : 'Faça login no Cursor com a mesma conta do Grok Bot'
      }
    };
  }

  try {
    const data = await fetchSandUsage(accessToken);
    if (data.usesPooledEnterpriseAllowance) {
      return {
        result: {
          status: 'missing',
          message: 'Grok Bot usa allowance enterprise compartilhado (sem % por conta)'
        }
      };
    }
    if (data.hasNonZeroIncludedLimit === false) {
      return {
        result: {
          status: 'missing',
          message: 'Esta conta não tem cota incluída do Grok Bot'
        }
      };
    }
    if (typeof data.usagePercent !== 'number' || !Number.isFinite(data.usagePercent)) {
      return { result: { status: 'error', message: 'Resposta de uso do Grok Bot inválida' } };
    }

    const windows: UsageWindow[] = [
      {
        kind: 'weekly',
        label: 'Weekly',
        percent: Math.min(100, Math.max(0, data.usagePercent)),
        resetsAt: data.nextResetTimestampUtc ? new Date(data.nextResetTimestampUtc) : null,
        unit: 'percent'
      }
    ];

    return {
      result: {
        status: 'ok',
        data: {
          windows,
          plan: data.grokPlanLabel?.trim() || null,
          account: email,
          fetchedAt: new Date(),
          sourceNote: 'Cota semanal oficial do Grok Bot (token do Cursor)'
        }
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Grok Bot usage falhou: ${message}`);
    if (message === 'auth') {
      return { result: { status: 'error', message: 'Sessão do Cursor rejeitada — faça login de novo' } };
    }
    return { result: { status: 'error', message: 'Falha ao consultar a cota do Grok Bot' } };
  }
}
