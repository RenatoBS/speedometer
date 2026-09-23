import * as fs from 'fs';
import { traeStorageJson } from '../paths';

const TRAE_DEFAULT_HOST = 'https://api-sg-central.trae.ai';
const TIMEOUT_MS = 8000;

export interface TraeStorageAuth {
  token: string;
  host: string;
  userId: string;
  email: string;
}

export interface TraeEntitlementPack {
  entitlement_base_info: {
    end_time: number;
    quota: { premium_model_fast_request_limit: number };
    user_id: string;
    product_type?: number;
  };
  usage: { premium_model_fast_amount: number };
}

export interface TraeApiResponse {
  code?: number;
  message?: string;
  user_entitlement_pack_list: TraeEntitlementPack[];
}

export function readTraeStorageAuth(): TraeStorageAuth | null {
  try {
    const file = traeStorageJson();
    if (!fs.existsSync(file)) return null;
    const storage = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const raw = storage['iCubeAuthInfo://icube.cloudide'];
    if (typeof raw !== 'string') return null;
    const auth = JSON.parse(raw) as {
      token?: string;
      expiredAt?: string;
      host?: string;
      userId?: string;
      account?: { email?: string };
    };
    if (auth.expiredAt && new Date(auth.expiredAt) < new Date()) return null;
    if (!auth.token) return null;
    return {
      token: auth.token,
      host: auth.host || TRAE_DEFAULT_HOST,
      userId: auth.userId || '',
      email: auth.account?.email || ''
    };
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function traeTokenFromSession(sessionId: string, host = TRAE_DEFAULT_HOST): Promise<string | null> {
  try {
    const data = await postJson<{ Result?: { Token?: string } }>(
      `${host}/cloudide/api/v3/common/GetUserToken`,
      { Cookie: `X-Cloudide-Session=${sessionId}`, Host: new URL(host).hostname },
      {}
    );
    return data.Result?.Token ?? null;
  } catch {
    return null;
  }
}

export async function fetchTraeEntitlements(authToken: string, host: string): Promise<TraeApiResponse> {
  return postJson<TraeApiResponse>(
    `${host}/trae/api/v1/pay/user_current_entitlement_list`,
    { authorization: `Cloud-IDE-JWT ${authToken}`, Host: new URL(host).hostname },
    {}
  );
}
