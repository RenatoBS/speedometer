export type ProviderId = 'claude' | 'codex' | 'cursor' | 'trae' | 'antigravity';

export type WindowKind = 'session' | 'weekly' | 'scoped' | 'plan' | 'auto' | 'ondemand' | 'entitlement';

export interface UsageWindow {
  kind: WindowKind;
  label: string;
  percent: number;
  resetsAt: Date | null;
  used?: number;
  limit?: number;
  unit?: 'percent' | 'usd' | 'requests';
}

export interface UsageSnapshot {
  windows: UsageWindow[];
  plan: string | null;
  account: string | null;
  fetchedAt: Date;
  sourceNote: string | null;
}

export type UsageResult =
  | { status: 'ok'; data: UsageSnapshot }
  | { status: 'missing'; message: string }
  | { status: 'absent'; message: string }
  | { status: 'error'; message: string };

export interface CursorModelSpend {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUSD: number;
}

export interface CursorAccountUsage {
  email: string;
  primary: boolean;
  snapshot: UsageSnapshot;
  models: CursorModelSpend[];
}

export interface CursorExtras {
  accounts: CursorAccountUsage[];
  models: CursorModelSpend[];
  billingStart?: string;
  billingEnd?: string;
}

export interface TraeExtras {
  totalUsage: number;
  totalLimit: number;
  packs: Array<{ label: string; used: number; limit: number; percent: number }>;
}

export interface AntigravityModelQuota {
  label: string;
  usedPercent: number;
  remainingPercent?: number;
  resetTime?: string;
}

export interface AntigravityExtras {
  models: AntigravityModelQuota[];
}

export interface DashboardTool {
  id: ProviderId;
  label: string;
  result: UsageResult;
  extras?: CursorExtras | TraeExtras | AntigravityExtras;
}

export interface DashboardData {
  generatedAt: string;
  tools: DashboardTool[];
}

export type DisplayMode = 'compact' | 'full';
export type Severity = 'normal' | 'warning' | 'error';
