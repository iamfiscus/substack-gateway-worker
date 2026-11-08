// KV-backed StatsCache, owner mode only. Upstream's cache is
// keyed by publication_url alone, so serving it to a caller who merely names
// that URL would leak one tenant's stats to another. createApp therefore
// refuses it without owner mode, and the request scope hands it only to
// requests whose credentials came from the resolver.

import type { GatewayEnv } from '../config';
import type { StatsCache, StatsRow } from '../context';
import { type KvLike, kvBinding } from './kvValueCache';
import type { GatewayExtension } from './types';

/** Snapshots expire; timeseries rows are append-only history and do not. */
const SNAPSHOT_TTL_SEC = 300;

function makeStatsCache(kv: KvLike | null): StatsCache {
  const tsKey = (pub: string, series: string) =>
    `stats:ts:${encodeURIComponent(pub)}:${encodeURIComponent(series)}`;
  const snapKey = (pub: string, key: string) =>
    `stats:snap:${encodeURIComponent(pub)}:${encodeURIComponent(key)}`;

  async function readJson<T>(key: string): Promise<T | null> {
    if (!kv) return null;
    try {
      const raw = await kv.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  return {
    async readTimeseries(pub, series) {
      return (await readJson<Record<string, StatsRow>>(tsKey(pub, series))) ?? {};
    },
    async writeTimeseries(pub, series, rows) {
      if (!kv) return;
      try {
        const merged = { ...(await this.readTimeseries(pub, series)), ...rows };
        await kv.put(tsKey(pub, series), JSON.stringify(merged));
      } catch {
        // Best effort.
      }
    },
    getSnapshot(pub, key) {
      return readJson<Record<string, unknown>>(snapKey(pub, key));
    },
    async setSnapshot(pub, key, value) {
      if (!kv) return;
      try {
        await kv.put(snapKey(pub, key), JSON.stringify(value), {
          expirationTtl: SNAPSHOT_TTL_SEC,
        });
      } catch {
        // Best effort.
      }
    },
  };
}

export function kvStatsCache(bindingName: string): GatewayExtension {
  return {
    name: 'kv-stats-cache',
    requiresOwnerMode: true,
    statsCache: (env: GatewayEnv) => makeStatsCache(kvBinding(env, bindingName)),
  };
}
