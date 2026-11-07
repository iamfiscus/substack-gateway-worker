import { describe, expect, it } from 'vitest';
import { SubstackHTTPBase } from '../../src/clients/base';
import { SubstackAPIError, SubstackAuthError } from '../../src/clients/errors';
import { PublicationClient } from '../../src/clients/publication';
import { SubstackClient } from '../../src/clients/substack';
import { createFakeSubstack, sample } from '../support/fakeSubstack';

const mk = (fetcher: ReturnType<typeof createFakeSubstack>, extra = {}) =>
  new SubstackHTTPBase({
    base: 'https://substack.com/api/v1',
    substackSid: 'S1',
    connectSid: 'C1',
    fetcher,
    timeoutMs: 1000,
    requestId: 'rid-1',
    ...extra,
  });

describe('SubstackHTTPBase', () => {
  it('sends exact cookie header and X-Request-ID', async () => {
    const f = createFakeSubstack({ 'GET substack.com/api/v1/x': { ok: 1 } });
    expect(await mk(f).get('x')).toEqual({ ok: 1 });
    const req = f.calls[0] as Request;
    expect(req.headers.get('cookie')).toBe('substack.sid=S1; connect.sid=C1');
    expect(req.headers.get('x-request-id')).toBe('rid-1');
  });

  it('omits undefined query values', async () => {
    const f = createFakeSubstack({ 'GET substack.com/api/v1/x': {} });
    await mk(f).get('/x', { query: { a: 1, b: undefined, c: 'z' } });
    expect(new URL((f.calls[0] as Request).url).search).toBe('?a=1&c=z');
  });

  it('maps 401, 403, 404 and 500', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/a': () => new Response('', { status: 401 }),
      'GET substack.com/api/v1/b': () => new Response('', { status: 403 }),
      'GET substack.com/api/v1/c': () => Response.json({ error: 'nope' }, { status: 404 }),
      'GET substack.com/api/v1/d': () => new Response('<html>', { status: 500 }),
      'GET substack.com/api/v1/e': () => Response.json({ message: 'm' }, { status: 400 }),
    });
    const c = mk(f);
    const a = await c.get('a').catch((e) => e);
    expect(a).toBeInstanceOf(SubstackAuthError);
    expect(a).toMatchObject({ status: 401, message: 'Invalid or expired Substack session token' });
    const b = await c.get('b').catch((e) => e);
    expect(b).toBeInstanceOf(SubstackAuthError);
    expect(b).toMatchObject({
      status: 403,
      message: 'Forbidden: insufficient permissions for this resource',
    });
    expect(await c.get('c').catch((e) => e)).toMatchObject({
      status: 404,
      message: 'Substack returned 404: nope',
    });
    expect(await c.get('d').catch((e) => e)).toMatchObject({
      status: 500,
      message: 'Substack returned 500: HTTP 500',
    });
    expect(await c.get('e').catch((e) => e)).toMatchObject({
      status: 400,
      message: 'Substack returned 400: m',
    });
  });

  it('maps a 200 HTML body to SubstackAPIError 502', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/x': () => new Response('<html>challenge</html>', { status: 200 }),
    });
    const err = await mk(f)
      .get('x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(SubstackAPIError);
    expect(err).toMatchObject({ status: 502, message: 'Substack returned non-JSON response' });
  });

  it('resolves a 204 to null', async () => {
    const f = createFakeSubstack({
      'DELETE substack.com/api/v1/x': () => new Response(null, { status: 204 }),
    });
    expect(await mk(f).delete('x')).toBeNull();
  });

  it('sends a JSON body on DELETE and POST', async () => {
    const f = createFakeSubstack({
      'DELETE substack.com/api/v1/x': {},
      'POST substack.com/api/v1/y': {},
    });
    const c = mk(f);
    await c.delete('x', { json: { id: 7 } });
    await c.post('y', { json: { t: 'é' } });
    expect(await (f.calls[0] as Request).json()).toEqual({ id: 7 });
    expect(await (f.calls[1] as Request).json()).toEqual({ t: 'é' });
  });

  it('maps a timeout against a never-resolving fetcher to 502', async () => {
    const never = Object.assign(() => new Promise<Response>(() => {}), { calls: [] });
    const err = await mk(never, { timeoutMs: 10 })
      .get('x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(SubstackAPIError);
    expect(err).toMatchObject({ status: 502, message: expect.stringMatching(/^Network error: /) });
  });

  it('logs Set-Cookie names only, never values', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/x': () => {
        const h = new Headers();
        h.append('set-cookie', 'substack.sid=SECRETVALUE; Path=/');
        h.append('set-cookie', 'connect.sid=OTHERSECRET; Path=/');
        return new Response('{}', { headers: h });
      },
    });
    const lines: string[] = [];
    await mk(f, { log: (l: string, m: string) => lines.push(`${l} ${m}`) }).get('x');
    expect(lines).toEqual(['info substack set-cookie names=substack.sid,connect.sid']);
  });
});

describe('SubstackHTTPBase hardening', () => {
  it('never follows redirects and sets redirect: manual', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/x': () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example/x?q=1' } }),
    });
    const err = await mk(f)
      .get('x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(SubstackAPIError);
    expect(err).toMatchObject({
      status: 302,
      message: 'Substack returned 302: redirect to evil.example',
    });
    expect(f.calls).toHaveLength(1);
    expect((f.calls[0] as Request).redirect).toBe('manual');
  });

  it('redirect without a usable Location is just "redirect"', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/x': () =>
        new Response(null, { status: 301, headers: { location: '/rel' } }),
    });
    expect(
      await mk(f)
        .get('x')
        .catch((e) => e),
    ).toMatchObject({
      status: 301,
      message: 'Substack returned 301: redirect',
    });
  });

  it('pre-aborted timeout (0ms) yields 502 with no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const h = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', h);
    const f = createFakeSubstack({
      'GET substack.com/api/v1/x': () => Promise.reject(new Error('late')),
    });
    const err = await mk(f, { timeoutMs: 0 })
      .get('x')
      .catch((e) => e);
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', h);
    expect(err).toMatchObject({ status: 502 });
    expect(unhandled).toEqual([]);
  });

  it('rejects cookie values with CR/LF as 400', async () => {
    const f = createFakeSubstack({ 'GET substack.com/api/v1/x': {} });
    const err = await mk(f, { substackSid: 'a\r\nX: y' })
      .get('x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(SubstackAPIError);
    expect(err).toMatchObject({
      status: 400,
      message: 'Invalid credentials: cookie contains invalid characters',
    });
    expect(f.calls).toHaveLength(0);
  });
});

describe('SubstackClient / PublicationClient', () => {
  const opts = (fetcher: ReturnType<typeof createFakeSubstack>) => ({
    substackSid: 'S1',
    connectSid: 'C1',
    fetcher,
    timeoutMs: 1000,
  });

  it('resolves own slug and user id; checks connectivity', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/handle/options': sample('handle/options'),
      'GET substack.com/api/v1/user-settings': { userSettings: [{ user_id: 42 }] },
      'GET substack.com/api/v1/feed/following': {},
    });
    const c = new SubstackClient({ ...opts(f), baseUrl: 'https://substack.com' });
    expect(await c.getOwnSlug()).toBe('jakubslys');
    expect(await c.getOwnUserId()).toBe(42);
    expect(await c.checkConnectivity()).toBe(true);
  });

  it('checkConnectivity: auth error true, other failures false', async () => {
    const auth = createFakeSubstack({
      'GET substack.com/api/v1/feed/following': () => new Response('', { status: 401 }),
    });
    expect(
      await new SubstackClient({
        ...opts(auth),
        baseUrl: 'https://substack.com',
      }).checkConnectivity(),
    ).toBe(true);
    const down = createFakeSubstack({
      'GET substack.com/api/v1/feed/following': () => new Response('x', { status: 503 }),
    });
    expect(
      await new SubstackClient({
        ...opts(down),
        baseUrl: 'https://substack.com',
      }).checkConnectivity(),
    ).toBe(false);
  });

  it('502s on empty handles / settings', async () => {
    const f = createFakeSubstack({
      'GET substack.com/api/v1/handle/options': { potentialHandles: [] },
      'GET substack.com/api/v1/user-settings': { userSettings: [] },
    });
    const c = new SubstackClient({ ...opts(f), baseUrl: 'https://substack.com/' });
    expect(await c.getOwnSlug().catch((e) => e)).toMatchObject({ status: 502 });
    expect(await c.getOwnUserId().catch((e) => e)).toMatchObject({
      status: 502,
      message: 'Substack returned no user settings',
    });
  });

  it('PublicationClient targets the publication api/v1', async () => {
    const f = createFakeSubstack({ 'GET pub.substack.com/api/v1/posts': [] });
    const c = new PublicationClient({ ...opts(f), publicationUrl: 'https://pub.substack.com/' });
    expect(await c.get('posts')).toEqual([]);
  });

  it('unmatched fake route returns 404', async () => {
    const f = createFakeSubstack({});
    expect(
      await mk(f)
        .get('zzz')
        .catch((e) => e),
    ).toMatchObject({
      status: 404,
      message: 'Substack returned 404: no fake route',
    });
  });
});
