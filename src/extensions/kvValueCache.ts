// KV-backed ValueCache. Coalesces concurrent calls for one key within an isolate
// (port of the gateway_core/caching.py contract); KV adds cross-isolate reuse.

import type { GatewayEnv } from '../config';
import type { ValueCache } from '../context';
import type { GatewayExtension } from './types';

/** The slice of Workers KV these caches use (also implemented by the test stub). */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** KV rejects expirationTtl below 60 seconds. */
const KV_MIN_TTL_SEC = 60;

export function kvBinding(env: GatewayEnv, name: string): KvLike | null {
  const b = (env as Record<string, unknown>)[name];
  return b && typeof (b as KvLike).get === 'function' ? (b as KvLike) : null;
}

export function kvValueCache(bindingName: string, ttlSec: number): GatewayExtension {
  // One map for the isolate's lifetime, shared by every per-request cache object.
  const inflight = new Map<string, Promise<unknown>>();
  return {
    name: 'kv-value-cache',
    valueCache: (env: GatewayEnv): ValueCache => {
      const kv = kvBinding(env, bindingName);
      return {
        getOrCall<T>(key: string, factory: () => Promise<T>): Promise<T> {
          const pending = inflight.get(key);
          if (pending) return pending as Promise<T>;
          const run = (async (): Promise<T> => {
            if (kv) {
              try {
                const raw = await kv.get(`vc:${key}`);
                if (raw !== null) return (JSON.parse(raw) as { v: T }).v;
              } catch {
                // A broken cache entry or KV outage must not fail the request.
              }
            }
            const value = await factory();
            if (kv && value !== undefined) {
              try {
                await kv.put(`vc:${key}`, JSON.stringify({ v: value }), {
                  expirationTtl: Math.max(KV_MIN_TTL_SEC, Math.ceil(ttlSec)),
                });
              } catch {
                // Cache write is best effort.
              }
            }
            return value;
          })().finally(() => inflight.delete(key));
          inflight.set(key, run);
          return run;
        },
      };
    },
  };
}
