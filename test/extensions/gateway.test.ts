import { describe, expect, it, vi } from 'vitest';
import type { AuthInfo } from '../../src/auth/gatewayKey';
import type { GatewayExtension } from '../../src/context';
import { createGateway, kvStatsCache, kvValueCache } from '../../src/index';
import { encodeCredentials, TEST_ENV } from '../bdd/steps/common';
import { createFakeSubstack } from '../support/fakeSubstack';
import { createKvStub } from '../support/kvStub';

const OWNER_ENV = {
  ...TEST_ENV,
  GATEWAY_API_KEYS: 'ci:abc',
  OWNER_PUBLICATION_URL: 'https://owner.substack.com',
  OWNER_SUBSTACK_SID: 'owner-sid',
  OWNER_CONNECT_SID: 'owner-connect',
};
const KEY = { authorization: 'Bearer abc' };
const VIEWS = 'publication/stats/publication_traffic/30d_views';
const TOKEN = encodeCredentials({
  publication_url: 'https://owner.substack.com',
  substack_sid: 'tok-sid',
  connect_sid: 'tok-connect',
});

describe('createGateway', () => {
  it('lists each extension moduleInfo under /', async () => {
    const ext: GatewayExtension = {
      name: 'demo',
      moduleInfo: { name: 'demo-module', version: '1.2.3', features: ['x:y'] },
    };
    const gw = createGateway({ extensions: [ext] });
    const body = (await (await gw.fetch(new Request('https://w/'), TEST_ENV)).json()) as {
      modules: { name: string; version: string }[];
    };
    expect(body.modules.map((m) => m.name)).toContain('demo-module');
    expect(body.modules).toHaveLength(2);
  });

  it('throws at startup for a duplicate single provider', () => {
    const cache = { getOrCall: <T>(_k: string, f: () => Promise<T>) => f() };
    expect(() =>
      createGateway({
        extensions: [
          { name: 'a', valueCache: cache },
          { name: 'b', valueCache: cache },
        ],
      }),
    ).toThrow('duplicate provider valueCache from a and b');
  });

  it('throws when kvStatsCache is installed without owner mode', async () => {
    const msg = 'kvStatsCache requires owner mode (GATEWAY_API_KEYS and OWNER_*)';
    // Eagerly when the env is known up front ...
    expect(() => createGateway({ extensions: [kvStatsCache('STATS')], env: TEST_ENV })).toThrow(
      msg,
    );
    // ... and on every request otherwise (a Worker's env exists only per request).
    const gw = createGateway({ extensions: [kvStatsCache('STATS')] });
    await expect(gw.fetch(new Request('https://w/'), TEST_ENV)).rejects.toThrow(msg);
    // GATEWAY_API_KEYS alone, or OWNER_* alone, is not owner mode.
    const { GATEWAY_API_KEYS: _k, ...ownerOnly } = OWNER_ENV;
    await expect(gw.fetch(new Request('https://w/'), ownerOnly)).rejects.toThrow(msg);
    const keysOnly = { ...TEST_ENV, GATEWAY_API_KEYS: 'ci:abc' };
    await expect(gw.fetch(new Request('https://w/'), keysOnly)).rejects.toThrow(msg);
    expect(
      (await gw.fetch(new Request('https://w/'), { ...OWNER_ENV, STATS: createKvStub() } as never))
        .status,
    ).toBe(200);
  });

  describe('stats cache is owner-only (C9, spec 10.4)', () => {
    function setup() {
      const kv = createKvStub();
      let hits = 0;
      const fake = createFakeSubstack({
        [`GET owner.substack.com/api/v1/${VIEWS}`]: () => {
          hits++;
          return { views30d: 10 * hits, viewsDelta30d: 1 };
        },
      });
      const gw = createGateway({
        fetcher: fake,
        extensions: [kvStatsCache('STATS')],
      });
      const env = { ...OWNER_ENV, STATS: kv } as never;
      const get = (headers: Record<string, string>) =>
        gw.fetch(new Request('https://w/api/v1/stats/30d-views', { headers }), env);
      return { kv, fake, get };
    }

    it('caches resolved (owner) requests', async () => {
      const { fake, get, kv } = setup();
      const a = await get(KEY);
      const b = await get(KEY);
      expect(await a.json()).toEqual(await b.json());
      expect(fake.calls).toHaveLength(1);
      expect(kv.store.size).toBe(1);
    });

    it('bypasses the cache for a token source: no read, no write', async () => {
      const { fake, get, kv } = setup();
      await get(KEY); // warm the owner entry for the same publication url
      const putsBefore = kv.puts.length;
      const getsBefore = kv.gets.length;
      const res = await get({ ...KEY, 'x-gateway-token': TOKEN });
      expect(res.status).toBe(200);
      // The token caller reached Substack with its own cookie instead of being served A's data.
      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[1]?.headers.get('cookie')).toBe(
        'substack.sid=tok-sid; connect.sid=tok-connect',
      );
      expect(kv.puts.length).toBe(putsBefore);
      expect(kv.gets.length).toBe(getsBefore);
    });
  });

  it('wires kvValueCache into the profile lookup', async () => {
    const kv = createKvStub();
    const fake = createFakeSubstack({
      'GET substack.com/api/v1/user/someone/public_profile': {
        id: 1,
        name: 'S',
        handle: 'someone',
      },
    });
    const gw = createGateway({ fetcher: fake, extensions: [kvValueCache('VC', 300)] });
    const env = { ...TEST_ENV, VC: kv } as never;
    for (let i = 0; i < 2; i++) {
      const res = await gw.fetch(
        new Request('https://w/api/v1/profiles/someone', { headers: { 'x-gateway-token': TOKEN } }),
        env,
      );
      expect(res.status).toBe(200);
    }
    expect(fake.calls).toHaveLength(1);
  });

  it('uses an extension credentialResolver and authenticate in place of the built-ins', async () => {
    const auth: AuthInfo = { token: 't', clientId: 'ext', scopes: [] };
    const fake = createFakeSubstack({
      'GET substack.com/api/v1/handle/options': { potentialHandles: [{ handle: 'x' }] },
      'GET substack.com/api/v1/user/x/public_profile': { id: 1, name: 'X', handle: 'x' },
      'GET substack.com/api/v1/feed/following': {},
    });
    const gw = createGateway({
      fetcher: fake,
      extensions: [
        {
          name: 'auth',
          authenticate: async (r) => (r.headers.get('x-ext') === 'ok' ? auth : null),
        },
        {
          name: 'res',
          credentialResolver: {
            resolve: async () => ({
              publication_url: 'https://e.substack.com',
              substack_sid: 'es',
              connect_sid: 'ec',
            }),
          },
        },
      ],
    });
    expect((await gw.fetch(new Request('https://w/api/v1/me'), TEST_ENV)).status).toBe(401);
    const ok = await gw.fetch(
      new Request('https://w/api/v1/me', { headers: { 'x-ext': 'ok' } }),
      TEST_ENV,
    );
    expect(ok.status).toBe(200);
    expect(fake.calls[0]?.headers.get('cookie')).toBe('substack.sid=es; connect.sid=ec');
  });

  it('runs registerApi, registerApp and registerMcp', async () => {
    const calls: string[] = [];
    const ext: GatewayExtension = {
      name: 'reg',
      registerApi: (api) => {
        calls.push('api');
        api.get('/v1/ext-ping', (c) => c.json({ api: true }));
      },
      registerApp: (app) => {
        calls.push('app');
        app.get('/ext-app', (c) => c.json({ app: true }));
      },
      registerMcp: () => calls.push('mcp'),
    };
    const gw = createGateway({ extensions: [ext] });
    expect(
      await (await gw.fetch(new Request('https://w/api/v1/ext-ping'), TEST_ENV)).json(),
    ).toEqual({ api: true });
    expect(await (await gw.fetch(new Request('https://w/ext-app'), TEST_ENV)).json()).toEqual({
      app: true,
    });
    expect(calls).toEqual(['api', 'app']);
    vi.restoreAllMocks();
  });
});
