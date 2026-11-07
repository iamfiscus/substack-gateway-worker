// Port of the e2e `_PacedTransport` (upstream bc2e875, packages/gateway_oss/e2e/
// conftest.py): space requests out and retry idempotent ones Substack throttled.
// The original Request is handed to the inner fetcher unchanged on every attempt,
// so the client's `redirect: 'manual'` and abort signal are preserved.

import type { Fetcher } from '../clients/base';
import type { GatewayExtension } from './types';

const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type PacedFetcherOptions = {
  /** Minimum gap between request starts, across the isolate. */
  minIntervalMs: number;
  /** Retries after a 429 (idempotent methods only). */
  retry429: number;
  /** Base backoff, doubled per attempt; Retry-After (whole seconds) wins. Default 1000. */
  backoffMs?: number;
  /** The wrapped fetcher; defaults to global fetch. */
  inner?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function pacedFetcher(o: PacedFetcherOptions): GatewayExtension {
  const inner: Fetcher = o.inner ?? ((req) => fetch(req));
  const sleep = o.sleep ?? realSleep;
  const now = o.now ?? Date.now;
  const backoffMs = o.backoffMs ?? 1000;
  let lastStart = Number.NEGATIVE_INFINITY;

  async function waitForSlot(): Promise<void> {
    // Reserve synchronously so concurrent callers queue instead of racing.
    const start = Math.max(now(), lastStart + o.minIntervalMs);
    lastStart = start;
    const delay = start - now();
    if (delay > 0) await sleep(delay);
  }

  const fetcher: Fetcher = async (req) => {
    let attempt = 0;
    for (;;) {
      await waitForSlot();
      const res = await inner(req);
      if (res.status !== 429 || !RETRYABLE_METHODS.has(req.method) || attempt >= o.retry429) {
        return res;
      }
      const retryAfter = res.headers.get('retry-after') ?? '';
      const wait = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : backoffMs * 2 ** attempt;
      await res.body?.cancel();
      await sleep(wait);
      attempt += 1;
    }
  };
  return { name: 'paced-fetcher', fetcher };
}
