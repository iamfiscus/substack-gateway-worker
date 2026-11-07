// Worker vars and secrets. Names are upstream `SUBSTACK_GATEWAY_*` settings without the prefix.

export type GatewayEnv = {
  SUBSTACK_BASE_URL?: string;
  SUBSTACK_TIMEOUT_SEC?: string;
  LOG_LEVEL?: string;
  STATS_TIMESERIES_WATERMARK_LAG_DAYS?: string;
  OWNER_ALLOWED_FEATURES?: string;
  GATEWAY_API_KEYS?: string;
  OWNER_PUBLICATION_URL?: string;
  OWNER_SUBSTACK_SID?: string;
  OWNER_CONNECT_SID?: string;
  ADMIN_TOKEN?: string;
};

export type GatewayConfig = {
  substackBaseUrl: string;
  timeoutMs: number;
  watermarkLagDays: number;
  logLevel: string;
};

const DEFAULT_BASE_URL = 'https://substack.com';
const DEFAULT_TIMEOUT_SEC = 120;
const DEFAULT_WATERMARK_LAG_DAYS = 2;

function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: GatewayEnv): GatewayConfig {
  const base = env.SUBSTACK_BASE_URL?.trim();
  return {
    substackBaseUrl: base ? base : DEFAULT_BASE_URL,
    timeoutMs: nonNegativeNumber(env.SUBSTACK_TIMEOUT_SEC, DEFAULT_TIMEOUT_SEC) * 1000,
    watermarkLagDays: Math.floor(
      nonNegativeNumber(env.STATS_TIMESERIES_WATERMARK_LAG_DAYS, DEFAULT_WATERMARK_LAG_DAYS),
    ),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  };
}
