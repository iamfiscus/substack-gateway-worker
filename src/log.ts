// Structured JSON logger that never emits credentials.

import type { LogFn } from './clients/base';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED_KEYS = new Set([
  'authorization',
  'x-gateway-token',
  'cookie',
  'token',
  'substack_sid',
  'connect_sid',
]);

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => sanitize(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) continue;
    out[k] = sanitize(v, seen);
  }
  return out;
}

export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Adapter matching the Substack client `log` option. */
  log: LogFn;
};

function parseLevel(level: string): LogLevel {
  const l = level.toLowerCase();
  return l in ORDER ? (l as LogLevel) : 'info';
}

export function createLogger(
  level: string,
  sink: (line: string) => void = (l) => console.log(l),
): Logger {
  const min = ORDER[parseLevel(level)];
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[lvl] < min) return;
    const clean = fields ? (sanitize(fields, new WeakSet()) as Record<string, unknown>) : {};
    sink(JSON.stringify({ ...clean, level: lvl, msg }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    log: (lvl, m) => emit(lvl, m),
  };
}
