// Runtime checks under workerd (@cloudflare/vitest-pool-workers). No node:fs here:
// every fixture is inline.

import { describe, expect, it } from 'vitest';
import { SubstackHTTPBase } from '../../src/clients/base';
import { markdownToDraftDoc } from '../../src/converters/draftMarkdown';
import { htmlToMarkdown } from '../../src/converters/htmlToMarkdown';
import { createGateway } from '../../src/index';
import { createFakeSubstack } from '../support/fakeSubstack';

const b64 = (o: unknown) => btoa(JSON.stringify(o));
const TOKEN = b64({
  publication_url: 'https://tok.substack.com',
  substack_sid: 'tok-sid',
  connect_sid: 'tok-connect',
});
const KEY = { authorization: 'Bearer abc' };
const BASE_ENV = {
  SUBSTACK_BASE_URL: 'https://substack.com',
  SUBSTACK_TIMEOUT_SEC: '5',
  LOG_LEVEL: 'error',
};
const OWNER_ENV = {
  ...BASE_ENV,
  GATEWAY_API_KEYS: 'ci:abc',
  OWNER_PUBLICATION_URL: 'https://owner.substack.com',
  OWNER_SUBSTACK_SID: 'owner-sid',
  OWNER_CONNECT_SID: 'owner-connect',
};

describe('workerd: HTTP client', () => {
  it('sends a JSON body on DELETE', async () => {
    const f = createFakeSubstack({ 'DELETE substack.com/api/v1/x': {} });
    const c = new SubstackHTTPBase({
      base: 'https://substack.com/api/v1',
      substackSid: 'S1',
      connectSid: 'C1',
      fetcher: f,
      timeoutMs: 1000,
      requestId: 'rid',
    });
    await c.delete('x', { json: { id: 7, t: 'é' } });
    expect(f.calls[0]?.method).toBe('DELETE');
    expect(await f.calls[0]?.json()).toEqual({ id: 7, t: 'é' });
  });
});

describe('workerd: image upload', () => {
  it('turns a 1 MB multipart PNG into one POST image with a data URI', async () => {
    const png = new Uint8Array(1024 * 1024);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 8; i < png.length; i++) png[i] = i % 251;
    const fake = createFakeSubstack({
      'POST tok.substack.com/api/v1/image': {
        id: 1,
        url: 'https://substack-post-media.s3.amazonaws.com/x.png',
        contentType: 'image/png',
        bytes: png.length,
        imageWidth: 10,
        imageHeight: 20,
      },
    });
    const gw = createGateway({ fetcher: fake });
    const form = new FormData();
    form.append('file', new File([png], 'big.png', { type: 'image/png' }));
    const res = await gw.fetch(
      new Request('https://gw.test/api/v1/images', {
        method: 'POST',
        headers: { 'x-gateway-token': TOKEN },
        body: form,
      }),
      BASE_ENV,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const posts = fake.calls.filter((r) => r.method === 'POST' && r.url.endsWith('/api/v1/image'));
    console.log(`SUBREQUESTS image upload=${fake.calls.length}`);
    expect(fake.calls).toHaveLength(1);
    expect(posts).toHaveLength(1);
    const sent = (await posts[0]?.json()) as { image: string };
    expect(sent.image.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(sent.image.split(',')[1] as string), (c) => c.charCodeAt(0));
    expect(bytes).toEqual(png);
  });
});

function corpus(words: number): string {
  const para = (i: number) =>
    `Paragraph ${i} has **bold text**, *emphasis*, \`inline code\` and a [link](https://example.com/${i}) ` +
    'followed by plain words that fill the line so the parser sees realistic prose with commas, ' +
    'periods and a few more tokens to round out the sentence.';
  const out: string[] = [];
  let n = 0;
  for (let i = 0; n < words; i++) {
    const chunk =
      i % 10 === 0
        ? [
            `## Heading ${i}`,
            para(i),
            `- item one ${i}\n- item two ${i}\n- item three ${i}`,
            `> quote ${i} with some words`,
          ]
        : [para(i), para(i + 1)];
    for (const c of chunk) {
      out.push(c);
      n += c.split(/\s+/).length;
    }
  }
  return out.join('\n\n');
}

describe('workerd: converters', () => {
  it('markdownToDraftDoc on a 5,000-word body is fast', async () => {
    const md = corpus(5000);
    const wc = md.split(/\s+/).length;
    expect(wc).toBeGreaterThanOrEqual(5000);
    markdownToDraftDoc(md.slice(0, 2000)); // warm up
    const t0 = performance.now();
    const w0 = Date.now();
    const doc = markdownToDraftDoc(md);
    const perf = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0));
    const wall = Date.now() - w0;
    console.log(`CPU-TEST words=${wc} performance.now=${perf.toFixed(3)}ms Date.now=${wall}ms`);
    expect(doc.content?.length).toBeGreaterThan(100);
    expect(perf).toBeLessThan(50);
  });

  it('htmlToMarkdown runs', () => {
    expect(htmlToMarkdown('<h2>T</h2><p>a<br>b <strong>x</strong></p><ul><li>y</li></ul>')).toBe(
      '## T\n\na\\\nb **x**\n\n- y',
    );
  });
});

describe('workerd: owner mode gates', () => {
  function setup() {
    const fake = createFakeSubstack({
      'GET substack.com/api/v1/handle/options': { potentialHandles: [{ handle: 'owner' }] },
      'GET substack.com/api/v1/user/owner/public_profile': {
        id: 1,
        name: 'Owner',
        handle: 'owner',
      },
      'POST substack.com/api/v1/comment/feed/': { id: 131648796 },
    });
    const gw = createGateway({ fetcher: fake });
    const call = (path: string, init: RequestInit = {}) =>
      gw.fetch(new Request(`https://gw.test${path}`, init), OWNER_ENV);
    return { fake, call };
  }
  const post = (extra: Record<string, string>) => ({
    method: 'POST',
    headers: { ...extra, 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello' }),
  });

  it('401 without a key, zero Substack calls', async () => {
    const { call, fake } = setup();
    const res = await call('/api/v1/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: 'Invalid gateway key' });
    expect(fake.calls).toHaveLength(0);
  });

  it('403 for show=true with resolved credentials', async () => {
    const { call, fake } = setup();
    const res = await call('/api/v1/health/ready?show=true', { headers: KEY });
    expect(res.status).toBe(403);
    expect(fake.calls).toHaveLength(0);
  });

  it('gates notes:create for owner credentials', async () => {
    const { call, fake } = setup();
    const res = await call('/api/v1/notes', post(KEY));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      detail: 'feature api:notes:create disabled for owner credentials',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('explicit token bypasses the gate and uses the token cookie', async () => {
    const { call, fake } = setup();
    const res = await call('/api/v1/notes', post({ ...KEY, 'x-gateway-token': TOKEN }));
    expect(res.status).toBe(201);
    expect(fake.calls[0]?.headers.get('cookie')).toBe(
      'substack.sid=tok-sid; connect.sid=tok-connect',
    );
  });
});
