import * as fs from 'fs';
import * as vscode from 'vscode';
import { filterTokensByIdeType, getConfig, stripTokenPrefix } from '../config';
import { log } from '../log';
import { cursorGlobalStateDb } from '../paths';
import { queryItemTable } from '../sqlite';
import { submitCursorUsage } from '../team/client';
import { CursorAccountUsage, CursorExtras, CursorModelSpend, UsageResult, UsageSnapshot, UsageWindow } from '../types';
import {
  constructSessionToken,
  CursorAggregatedUsage,
  CursorUsageSummary,
  fetchCursorAggregatedUsage,
  fetchCursorBillingCycle,
  fetchCursorUsageSummary,
  fetchCursorUserInfo,
  modelsFromAggregated,
  spendFromAggregated
} from './cursorApi';

function snapshotFromSummary(
  summary: CursorUsageSummary,
  aggregated: CursorAggregatedUsage | null,
  account: string | null
): { snapshot: UsageSnapshot; models: CursorModelSpend[] } {
  const plan = summary.individualUsage.plan;
  const { apiCents, autoCents } = spendFromAggregated(aggregated);
  const apiPercent = plan.apiPercentUsed ?? 0;
  const autoPercent = plan.autoPercentUsed ?? 0;
  const windows: UsageWindow[] = [];
  const billingEnd = summary.billingCycleEnd ? new Date(summary.billingCycleEnd) : null;

  const autoLimitCents = autoCents > 0 && autoPercent > 0 ? (autoCents / autoPercent) * 100 : 0;
  windows.push({
    kind: 'auto',
    label: 'Auto',
    percent: autoPercent,
    resetsAt: billingEnd,
    used: autoCents > 0 ? autoCents / 100 : undefined,
    limit: autoLimitCents > 0 ? autoLimitCents / 100 : undefined,
    unit: autoCents > 0 ? 'usd' : 'percent'
  });

  const apiLimitCents = apiCents > 0 && apiPercent > 0 ? (apiCents / apiPercent) * 100 : 0;
  windows.push({
    kind: 'plan',
    label: 'API',
    percent: apiPercent,
    resetsAt: billingEnd,
    used: apiCents > 0 ? apiCents / 100 : undefined,
    limit: apiLimitCents > 0 ? apiLimitCents / 100 : undefined,
    unit: apiCents > 0 ? 'usd' : 'percent'
  });

  const onDemand = summary.individualUsage.onDemand;
  if (onDemand?.enabled && onDemand.limit) {
    windows.push({
      kind: 'ondemand',
      label: 'On-demand',
      percent: (onDemand.used / onDemand.limit) * 100,
      resetsAt: billingEnd,
      used: onDemand.used / 100,
      limit: onDemand.limit / 100,
      unit: 'usd'
    });
  }

  return {
    snapshot: {
      windows,
      plan: summary.membershipType,
      account,
      fetchedAt: new Date(),
      sourceNote: 'API oficial do dashboard Cursor (não documentada)'
    },
    models: modelsFromAggregated(aggregated)
  };
}

async function loadAggregated(sessionToken: string, summary: CursorUsageSummary): Promise<CursorAggregatedUsage | null> {
  try {
    const billing = await fetchCursorBillingCycle(sessionToken);
    const start = Number(billing.startDateEpochMillis) || new Date(summary.billingCycleStart).getTime();
    return await fetchCursorAggregatedUsage(sessionToken, start);
  } catch (error) {
    log(`Cursor aggregations falhou: ${error}`);
    return null;
  }
}

const AUTH_TTL_MS = 15 * 60 * 1000;

let authCache: {
  dbPath: string;
  expiresAt: number;
  accessToken: string | null;
  email: string | null;
} | null = null;

async function loadCursorAuth(
  context: vscode.ExtensionContext,
  dbPath: string
): Promise<{ accessToken: string | null; email: string | null }> {
  if (authCache && authCache.dbPath === dbPath && Date.now() < authCache.expiresAt) {
    return authCache;
  }
  const accessToken = await queryItemTable(context, dbPath, 'cursorAuth/accessToken');
  const email = await queryItemTable(context, dbPath, 'cursorAuth/cachedEmail');
  authCache = { dbPath, expiresAt: Date.now() + AUTH_TTL_MS, accessToken, email };
  return authCache;
}

export async function fetchCursorUsage(context: vscode.ExtensionContext): Promise<{ result: UsageResult; extras?: CursorExtras }> {
  const dbPath = cursorGlobalStateDb();
  if (!fs.existsSync(dbPath)) {
    return { result: { status: 'absent', message: 'Cursor não encontrado neste computador' } };
  }

  const { accessToken, email } = await loadCursorAuth(context, dbPath);
  log(`Cursor DB ${dbPath} token=${accessToken ? `ok (${accessToken.length} chars)` : 'ausente'}`);
  const primaryToken = accessToken ? constructSessionToken(accessToken) : null;
  if (!primaryToken) {
    return {
      result: {
        status: 'missing',
        message: accessToken
          ? 'Token do Cursor encontrado, mas o formato JWT é inválido'
          : 'Não foi possível ler o token em state.vscdb (banco grande demais para sql.js; instale sqlite3 no PATH)'
      }
    };
  }

  try {
    const summary = await fetchCursorUsageSummary(primaryToken);
    const aggregated = await loadAggregated(primaryToken, summary);
    const { snapshot, models } = snapshotFromSummary(summary, aggregated, email);
    const accounts: CursorAccountUsage[] = [{ email: email || 'conta principal', primary: true, snapshot, models }];

    const extraTokens = filterTokensByIdeType(getConfig().additionalSessionTokens, 'cursor').map(stripTokenPrefix);
    for (const token of extraTokens) {
      try {
        const info = await fetchCursorUserInfo(token);
        const extraSummary = await fetchCursorUsageSummary(token);
        const extraAgg = await loadAggregated(token, extraSummary);
        const extra = snapshotFromSummary(extraSummary, extraAgg, info.email);
        accounts.push({ email: info.email, primary: false, snapshot: extra.snapshot, models: extra.models });
      } catch (error) {
        log(`Conta extra Cursor falhou: ${error}`);
      }
    }

    void submitCursorUsage(email || '', summary, aggregated);

    return {
      result: { status: 'ok', data: snapshot },
      extras: {
        accounts,
        models,
        billingStart: summary.billingCycleStart,
        billingEnd: summary.billingCycleEnd
      }
    };
  } catch (error) {
    log(`Cursor usage falhou: ${error}`);
    return { result: { status: 'error', message: 'Falha ao consultar a API de uso do Cursor' } };
  }
}
