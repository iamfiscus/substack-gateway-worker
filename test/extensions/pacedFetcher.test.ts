import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { pacedFetcher } from '../../src/extensions/pacedFetcher';
import { TEST_ENV } from '../bdd/steps/common';

function harness(responses: (() => Response)[]) {
  const seen: Request[] = [];
  let i = 0;
  const inner = async (req: Request) => {
    seen.push(req);
    const make = responses[Math.min(i++, responses.length - 1)] as () => Response;
    return make();
  };
  const sleeps: number[] = [];
  let t = 1000;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    t += ms;
  };
  return { inner, seen, sleeps, sleep, now: () => t };
}

const get = () => new Request('https://substack.com/api/v1/x', { redirect: 'manual' });

describe('pacedFetcher', () => {
  it('retries a 429 once, then returns', async () => {
    const h = harness([
      () => new Response('slow', { status: 429 }),
      () => Response.json({ ok: 1 }),
    ]);
    const f = pacedFetcher({ minIntervalMs: 0, retry429: 1, ...h }).fetcher;
    const res = await f?.(get());
    expect(res?.status).toBe(200);
    expect(h.seen).toHaveLength(2);
    expect(h.sleeps).toEqual([1000]);
  });

  it('returns the 429 once retries are spent', async () => {
    const h = harness([() => new Response('slow', { status: 429 })]);
    const f = pacedFetcher({ minIntervalMs: 0, retry429: 1, ...h }).fetcher;
    expect((await f?.(get()))?.status).toBe(429);
    expect(h.seen).toHaveLength(2);
  });

  it('honours Retry-After seconds and never retries a non-idempotent method', async () => {
    const h = harness([
      () => new Response('', { status: 429, headers: { 'retry-after': '3' } }),
      () => new Response('ok'),
    ]);
    const f = pacedFetcher({ minIntervalMs: 0, retry429: 2, ...h }).fetcher;
    await f?.(get());
    expect(h.sleeps).toEqual([3000]);
    const h2 = harness([() => new Response('', { status: 429 })]);
    const f2 = pacedFetcher({ minIntervalMs: 0, retry429: 2, ...h2 }).fetcher;
    const post = new Request('https://substack.com/api/v1/x', { method: 'POST', body: '{}' });
    expect((await f2?.(post))?.status).toBe(429);
    expect(h2.seen).toHaveLength(1);
  });

  it('spaces request starts by minIntervalMs', async () => {
    const h = harness([() => new Response('ok')]);
    const f = pacedFetcher({ minIntervalMs: 500, retry429: 0, ...h }).fetcher;
    await f?.(get());
    await f?.(get());
    await f?.(get());
    expect(h.sleeps).toEqual([500, 500]);
  });

  it('passes the original Request through unchanged and does not follow a 302', async () => {
    const h = harness([
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    ]);
    const paced = pacedFetcher({ minIntervalMs: 0, retry429: 1, ...h });
    const req = get();
    const res = await paced.fetcher?.(req);
    expect(res?.status).toBe(302);
    expect(h.seen).toEqual([req]);
    expect(h.seen[0]?.redirect).toBe('manual');
  });

  it('keeps redirect manual end to end when installed as the gateway fetcher', async () => {
    const h = harness([
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    ]);
    const app = createApp({ extensions: [pacedFetcher({ minIntervalMs: 0, retry429: 1, ...h })] });
    const token = btoa(
      JSON.stringify({
        publication_url: 'https://p.substack.com',
        substack_sid: 's',
        connect_sid: 'c',
      }),
    );
    const res = await app.request(
      '/api/v1/me',
      { headers: { 'x-gateway-token': token } },
      TEST_ENV,
    );
    expect(res.status).toBe(502);
    expect(h.seen.length).toBeGreaterThan(0);
    for (const r of h.seen) expect(r.redirect).toBe('manual');
    expect(h.seen.every((r) => r.url.startsWith('https://substack.com/'))).toBe(true);
  });
});
