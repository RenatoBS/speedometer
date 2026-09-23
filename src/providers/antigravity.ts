import * as fs from 'fs';
import * as vscode from 'vscode';
import { antigravityGlobalStateDb } from '../paths';
import { wasmPath } from '../sqlite';
import { AntigravityExtras, UsageResult, UsageWindow } from '../types';
import { DatabaseReader } from './antigravityDb';

export async function fetchAntigravityUsage(context: vscode.ExtensionContext): Promise<{ result: UsageResult; extras?: AntigravityExtras }> {
  const dbPath = antigravityGlobalStateDb();
  if (!fs.existsSync(dbPath)) {
    return { result: { status: 'absent', message: 'Antigravity não encontrado neste computador' } };
  }

  const reader = new DatabaseReader(wasmPath(context));
  const auth = await reader.readAuthStatus();
  if (!auth?.userStatusProtoBinaryBase64) {
    return { result: { status: 'missing', message: 'Faça login no Antigravity' } };
  }

  const snapshot = reader.parseUserStatusProto(auth.userStatusProtoBinaryBase64);
  if (!snapshot || snapshot.models.length === 0) {
    return { result: { status: 'error', message: 'Não foi possível ler as cotas do Antigravity' } };
  }

  const windows: UsageWindow[] = snapshot.models.map((model) => {
    const used = model.remainingPercentage !== undefined ? 100 - model.remainingPercentage : 0;
    return {
      kind: 'plan' as const,
      label: model.label,
      percent: used,
      resetsAt: model.resetTime ?? null
    };
  });

  return {
    result: {
      status: 'ok',
      data: {
        windows,
        plan: snapshot.planName ?? null,
        account: auth.email || null,
        fetchedAt: snapshot.timestamp,
        sourceNote: 'Cotas locais do Antigravity (state.vscdb)'
      }
    },
    extras: {
      models: snapshot.models.map((model) => ({
        label: model.label,
        usedPercent: model.remainingPercentage !== undefined ? 100 - model.remainingPercentage : 0,
        remainingPercent: model.remainingPercentage,
        resetTime: model.timeUntilResetFormatted
      }))
    }
  };
}
