import { describe, expect, it } from 'vitest';
import type { ValueCache } from '../../src/context';
import { kvValueCache } from '../../src/extensions/kvValueCache';
import { createKvStub } from '../support/kvStub';

function cacheFor(kv: ReturnType<typeof createKvStub>, ttl = 300): ValueCache {
  const ext = kvValueCache('CACHE', ttl);
  return (ext.valueCache as (env: unknown) => ValueCache)({ CACHE: kv });
}

describe('kvValueCache', () => {
  it('runs the factory once for two concurrent calls on the same key', async () => {
    const kv = createKvStub();
    const cache = cacheFor(kv);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const factory = async () => {
      calls++;
      await gate;
      return { n: 1 };
    };
    const a = cache.getOrCall('k', factory);
    const b = cache.getOrCall('k', factory);
    release();
    expect(await a).toEqual({ n: 1 });
    expect(await b).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it('coalesces across per-request cache objects (per-isolate in-flight map)', async () => {
    const kv = createKvStub();
    const ext = kvValueCache('CACHE', 300);
    const make = ext.valueCache as (env: unknown) => ValueCache;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const factory = async () => {
      calls++;
      await gate;
      return 1;
    };
    const a = make({ CACHE: kv }).getOrCall('k', factory);
    const b = make({ CACHE: kv }).getOrCall('k', factory);
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  it('serves a later call from KV with the ttl, without calling the factory', async () => {
    const kv = createKvStub();
    const cache = cacheFor(kv, 300);
    await cache.getOrCall('k', async () => ({ v: 1 }));
    expect(kv.puts).toEqual([{ key: 'vc:k', ttl: 300 }]);
    let called = false;
    const again = await cacheFor(kv).getOrCall('k', async () => {
      called = true;
      return { v: 2 };
    });
    expect(again).toEqual({ v: 1 });
    expect(called).toBe(false);
  });

  it('expires entries after the ttl', async () => {
    let t = 0;
    const kv = createKvStub(() => t);
    const cache = cacheFor(kv, 120);
    await cache.getOrCall('k', async () => 1);
    t = 121_000;
    expect(await cache.getOrCall('k', async () => 2)).toBe(2);
  });

  it('clamps the ttl to the KV minimum of 60 seconds', async () => {
    const kv = createKvStub();
    await cacheFor(kv, 5).getOrCall('k', async () => 1);
    expect(kv.puts[0]?.ttl).toBe(60);
  });

  it('does not cache a failure and lets the next call retry', async () => {
    const kv = createKvStub();
    const cache = cacheFor(kv);
    await expect(
      cache.getOrCall('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await cache.getOrCall('k', async () => 7)).toBe(7);
  });

  it('works as a pass-through when the binding is missing', async () => {
    const make = kvValueCache('CACHE', 60).valueCache as (env: unknown) => ValueCache;
    expect(await make({}).getOrCall('k', async () => 3)).toBe(3);
  });
});
