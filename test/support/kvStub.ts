import type { KvLike } from '../../src/extensions/kvValueCache';

/** In-memory KVNamespace stand-in: get/put with expirationTtl on an injectable clock. */
export function createKvStub(now: () => number = Date.now) {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const puts: { key: string; ttl: number | undefined }[] = [];
  const kv: KvLike & { store: typeof store; puts: typeof puts; gets: string[] } = {
    store,
    puts,
    gets: [],
    async get(key) {
      kv.gets.push(key);
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt !== null && e.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    async put(key, value, opts) {
      puts.push({ key, ttl: opts?.expirationTtl });
      const ttl = opts?.expirationTtl;
      store.set(key, { value, expiresAt: ttl === undefined ? null : now() + ttl * 1000 });
    },
  };
  return kv;
}
