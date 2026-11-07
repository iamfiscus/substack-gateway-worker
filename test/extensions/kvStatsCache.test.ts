import { describe, expect, it } from 'vitest';
import type { StatsCache } from '../../src/context';
import { kvStatsCache } from '../../src/extensions/kvStatsCache';
import { createKvStub } from '../support/kvStub';

function cacheFor(kv: ReturnType<typeof createKvStub>): StatsCache {
  return (kvStatsCache('STATS').statsCache as (env: unknown) => StatsCache)({ STATS: kv });
}

describe('kvStatsCache', () => {
  it('upserts timeseries rows and reads them back by date bucket', async () => {
    const c = cacheFor(createKvStub());
    expect(await c.readTimeseries('https://p.substack.com', 'subscribers')).toEqual({});
    await c.writeTimeseries('https://p.substack.com', 'subscribers', {
      '2025/07/10': ['2025/07/10', 1],
      '2025/07/11': ['2025/07/11', 2],
    });
    await c.writeTimeseries('https://p.substack.com', 'subscribers', {
      '2025/07/11': ['2025/07/11', 9],
      '2025/07/12': ['2025/07/12', 3],
    });
    expect(await c.readTimeseries('https://p.substack.com', 'subscribers')).toEqual({
      '2025/07/10': ['2025/07/10', 1],
      '2025/07/11': ['2025/07/11', 9],
      '2025/07/12': ['2025/07/12', 3],
    });
    expect(await c.readTimeseries('https://p.substack.com', 'arr')).toEqual({});
    expect(await c.readTimeseries('https://other.substack.com', 'subscribers')).toEqual({});
  });

  it('stores snapshots per publication with an expiry, null when absent', async () => {
    const kv = createKvStub();
    const c = cacheFor(kv);
    expect(await c.getSnapshot('https://p.substack.com', 'k')).toBeNull();
    await c.setSnapshot('https://p.substack.com', 'k', { a: 1 });
    expect(await c.getSnapshot('https://p.substack.com', 'k')).toEqual({ a: 1 });
    expect(await c.getSnapshot('https://q.substack.com', 'k')).toBeNull();
    expect(kv.puts[0]?.ttl).toBeGreaterThanOrEqual(60);
  });

  it('is an inert cache when the binding is missing', async () => {
    const c = (kvStatsCache('STATS').statsCache as (env: unknown) => StatsCache)({});
    await c.setSnapshot('u', 'k', { a: 1 });
    expect(await c.getSnapshot('u', 'k')).toBeNull();
  });
});
