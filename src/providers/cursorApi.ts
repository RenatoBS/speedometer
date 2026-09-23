const CURSOR_API_BASE_URL = 'https://cursor.com/api';
const TIMEOUT_MS = 8000;

export interface CursorUsageSummary {
  billingCycleStart: string;
  billingCycleEnd: string;
  membershipType: string;
  individualUsage: {
    plan: {
      enabled: boolean;
      used: number;
      limit: number;
      remaining: number;
      breakdown?: { included: number; bonus: number; total: number };
      autoPercentUsed?: number;
      apiPercentUsed?: number;
      totalPercentUsed?: number;
    };
    onDemand?: {
      enabled: boolean;
      used: number;
      limit: number | null;
      remaining: number | null;
    };
  };
}

export interface CursorBillingCycle {
  startDateEpochMillis: string;
  endDateEpochMillis: string;
}

export interface CursorAggregatedEvent {
  modelIntent: string;
  inputTokens?: string;
  outputTokens?: string;
  cacheWriteTokens?: string;
  cacheReadTokens?: string;
  totalCents: number;
}

export interface CursorAggregatedUsage {
  aggregations: CursorAggregatedEvent[];
  totalInputTokens: string;
  totalOutputTokens: string;
  totalCacheWriteTokens: string;
  totalCacheReadTokens: string;
  totalCostCents: number;
}

export interface CursorUserInfo {
  email: string;
}

function headers(sessionToken: string, referer = 'https://cursor.com/dashboard'): Record<string, string> {
  return {
    Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    'Content-Type': 'application/json',
    Origin: 'https://cursor.com',
    Referer: referer
  };
}

async function request<T>(url: string, sessionToken: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers(sessionToken), ...(init?.headers as Record<string, string> | undefined) },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCursorUsageSummary(sessionToken: string): Promise<CursorUsageSummary> {
  return request<CursorUsageSummary>(`${CURSOR_API_BASE_URL}/usage-summary`, sessionToken);
}

export async function fetchCursorUserInfo(sessionToken: string): Promise<CursorUserInfo> {
  return request<CursorUserInfo>(`${CURSOR_API_BASE_URL}/dashboard/get-me`, sessionToken);
}

export async function fetchCursorBillingCycle(sessionToken: string): Promise<CursorBillingCycle> {
  return request<CursorBillingCycle>(`${CURSOR_API_BASE_URL}/dashboard/get-current-billing-cycle`, sessionToken, {
    method: 'POST',
    body: '{}'
  });
}

export async function fetchCursorAggregatedUsage(sessionToken: string, startDateEpochMillis: number): Promise<CursorAggregatedUsage> {
  return request<CursorAggregatedUsage>(`${CURSOR_API_BASE_URL}/dashboard/get-aggregated-usage-events`, sessionToken, {
    method: 'POST',
    body: JSON.stringify({ teamId: -1, startDate: startDateEpochMillis })
  });
}

export function constructSessionToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string };
    const sub = payload.sub;
    if (!sub) return null;
    const userId = sub.includes('|') ? sub.split('|')[1] : sub;
    if (!userId) return null;
    return `${userId}%3A%3A${accessToken}`;
  } catch {
    return null;
  }
}

export function spendFromAggregated(data: CursorAggregatedUsage | null): { apiCents: number; autoCents: number } {
  if (!data?.aggregations) return { apiCents: 0, autoCents: 0 };
  let apiCents = 0;
  let autoCents = 0;
  for (const event of data.aggregations) {
    if (event.modelIntent === 'default') autoCents += event.totalCents || 0;
    else apiCents += event.totalCents || 0;
  }
  return { apiCents, autoCents };
}

export function modelsFromAggregated(data: CursorAggregatedUsage | null): Array<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUSD: number;
}> {
  if (!data?.aggregations) return [];
  return [...data.aggregations]
    .sort((a, b) => (b.totalCents || 0) - (a.totalCents || 0))
    .map((agg) => ({
      model: agg.modelIntent === 'default' ? 'Auto' : agg.modelIntent,
      inputTokens: Number(agg.inputTokens || 0),
      outputTokens: Number(agg.outputTokens || 0),
      cacheWriteTokens: Number(agg.cacheWriteTokens || 0),
      cacheReadTokens: Number(agg.cacheReadTokens || 0),
      costUSD: (agg.totalCents || 0) / 100
    }));
}
