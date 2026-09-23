import * as fs from 'fs';
import { filterTokensByIdeType, getConfig, stripTokenPrefix } from '../config';
import { log } from '../log';
import { traeStorageJson } from '../paths';
import { submitTraeUsage } from '../team/client';
import { TraeExtras, UsageResult, UsageWindow } from '../types';
import { fetchTraeEntitlements, readTraeStorageAuth, TraeApiResponse, traeTokenFromSession } from './traeApi';

function statsFromResponse(data: TraeApiResponse): TraeExtras {
  const packs: TraeExtras['packs'] = [];
  let totalUsage = 0;
  let totalLimit = 0;
  for (const pack of data.user_entitlement_pack_list ?? []) {
    const used = pack.usage?.premium_model_fast_amount ?? 0;
    const limit = pack.entitlement_base_info?.quota?.premium_model_fast_request_limit ?? 0;
    if (limit <= 0) continue;
    totalUsage += used;
    totalLimit += limit;
    packs.push({
      label: pack.entitlement_base_info.product_type === 1 ? 'Pro' : 'Pack',
      used,
      limit,
      percent: (used / limit) * 100
    });
  }
  return { totalUsage, totalLimit, packs };
}

export async function fetchTraeUsage(): Promise<{ result: UsageResult; extras?: TraeExtras }> {
  if (!fs.existsSync(traeStorageJson()) && getConfig().additionalSessionTokens.length === 0) {
    return { result: { status: 'absent', message: 'Trae não encontrado neste computador' } };
  }

  const storage = readTraeStorageAuth();
  let token = storage?.token ?? null;
  const host = storage?.host ?? 'https://api-sg-central.trae.ai';
  let account = storage?.email ?? null;

  if (!token) {
    const extra = filterTokensByIdeType(getConfig().additionalSessionTokens, 'trae').map(stripTokenPrefix)[0];
    if (extra) token = await traeTokenFromSession(extra, host);
  }
  if (!token) {
    return { result: { status: 'missing', message: 'Faça login no Trae (ou cole um token de sessão)' } };
  }

  try {
    const data = await fetchTraeEntitlements(token, host);
    if (data.code === 1001) {
      return { result: { status: 'error', message: 'Token Trae expirado' } };
    }
    const extras = statsFromResponse(data);
    if (!extras.totalLimit) {
      return { result: { status: 'missing', message: 'Nenhuma assinatura Trae ativa' }, extras };
    }
    const windows: UsageWindow[] = extras.packs.map((pack) => ({
      kind: 'entitlement' as const,
      label: pack.label,
      percent: pack.percent,
      resetsAt: null,
      used: pack.used,
      limit: pack.limit,
      unit: 'requests' as const
    }));
    void submitTraeUsage(account || '', extras);
    return {
      result: {
        status: 'ok',
        data: {
          windows,
          plan: extras.packs.some((p) => p.label === 'Pro') ? 'pro' : null,
          account,
          fetchedAt: new Date(),
          sourceNote: 'API oficial de entitlements do Trae'
        }
      },
      extras
    };
  } catch (error) {
    log(`Trae usage falhou: ${error}`);
    return { result: { status: 'error', message: 'Falha ao consultar o uso do Trae' } };
  }
}
