import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import { log } from '../log';
import { CursorAggregatedUsage, CursorUsageSummary } from '../providers/cursorApi';
import { TraeExtras } from '../types';

const API_KEY_STATE = 'clientApiKey';
let store: vscode.Memento | undefined;

export function initTeamClient(memento: vscode.Memento): void {
  store = memento;
}

async function setClientApiKey(apiKey: string): Promise<void> {
  await store?.update(API_KEY_STATE, apiKey);
}

function apiKeyFor(accountId: string): string {
  const appName = vscode.env.appName || 'Unknown';
  const hash = crypto.createHash('md5').update(`${appName}-${accountId}-speedometer-team`).digest('hex');
  return `ck_${hash}`;
}

async function ensureApiKey(accountId: string): Promise<string> {
  const expected = apiKeyFor(accountId);
  if (store?.get<string>(API_KEY_STATE) !== expected) {
    await setClientApiKey(expected);
  }
  return expected;
}

async function post(path: string, body: unknown): Promise<void> {
  const { teamServerUrl, enableReporting } = getConfig();
  if (!enableReporting || !teamServerUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${teamServerUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) log(`Team server ${path} HTTP ${res.status}`);
  } catch (error) {
    log(`Team server ${path}: ${error}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function submitCursorUsage(
  email: string,
  summary: CursorUsageSummary,
  aggregated: CursorAggregatedUsage | null
): Promise<void> {
  if (!getConfig().enableReporting) return;
  const apiKey = await ensureApiKey(email || 'unknown');
  let apiSpend = 0;
  let autoSpend = 0;
  if (aggregated?.aggregations) {
    for (const event of aggregated.aggregations) {
      if (event.modelIntent === 'default') autoSpend += event.totalCents || 0;
      else apiSpend += event.totalCents || 0;
    }
  }
  await post('/api/cursor-usage', {
    client_token: apiKey,
    email,
    platform: process.platform,
    app_name: vscode.env.appName,
    membership_type: summary.membershipType,
    api_spend: apiSpend,
    auto_spend: autoSpend,
    expire_time: summary.billingCycleEnd ? new Date(summary.billingCycleEnd).getTime() : 0
  });
}

export async function submitTraeUsage(email: string, extras: TraeExtras): Promise<void> {
  if (!getConfig().enableReporting) return;
  const apiKey = await ensureApiKey(email || 'unknown');
  await post('/api/trae-usage', {
    client_token: apiKey,
    email,
    platform: process.platform,
    app_name: vscode.env.appName,
    total_usage: extras.totalLimit,
    used_usage: extras.totalUsage
  });
}

export async function checkTeamServer(): Promise<boolean> {
  const url = getConfig().teamServerUrl;
  if (!url) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { service?: string; status?: string };
    return data.service === 'speedometer' || data.service === 'coding-usage';
  } catch {
    return false;
  }
}
