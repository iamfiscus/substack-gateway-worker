import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import type { GatewayEnv } from '../../src/config';
import { encodeCredentials, TEST_ENV } from '../bdd/steps/common';
import { MCP_HEADERS, readJsonRpc } from '../bdd/steps/mcp';
import { createFakeSubstack, sample } from '../support/fakeSubstack';

const OWNER_COOKIE = 'substack.sid=owner-sid; connect.sid=owner-connect';
const TOKEN_COOKIE = 'substack.sid=tok-sid; connect.sid=tok-connect';

const OWNER_ENV: GatewayEnv = {
  ...TEST_ENV,
  GATEWAY_API_KEYS: 'ci:abc',
  OWNER_PUBLICATION_URL: 'https://owner.substack.com',
  OWNER_SUBSTACK_SID: 'owner-sid',
  OWNER_CONNECT_SID: 'owner-connect',
};

const TOKEN = encodeCredentials({
  publication_url: 'https://tok.substack.com',
  substack_sid: 'tok-sid',
  connect_sid: 'tok-connect',
});

const KEY = { authorization: 'Bearer abc' };

function setup(env: GatewayEnv = OWNER_ENV) {
  const fake = createFakeSubstack({
    'GET substack.com/api/v1/handle/options': { potentialHandles: [{ handle: 'owner' }] },
    'GET substack.com/api/v1/user/owner/public_profile': { id: 1, name: 'Owner', handle: 'owner' },
    'GET substack.com/api/v1/feed/following': {},
    'GET tok.substack.com/api/v1/reader/comment/1': sample('reader/comment/131648795'),
    'GET owner.substack.com/api/v1/reader/comment/1': sample('reader/comment/131648795'),
    'POST substack.com/api/v1/comment/feed/': sample('comment/response'),
  });
  const app = createApp({ fetcher: fake });
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.request(path, init, env);
  // One entry per distinct cookie, in order: `/me` makes two Substack calls with one cookie.
  const cookies = () => [...new Set(fake.calls.map((r) => r.headers.get('cookie')))];
  return { app, fake, request, cookies };
}

async function mcpCall(
  request: (p: string, i?: RequestInit) => Promise<Response>,
  path: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = KEY,
) {
  const res = await request(path, {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { res, payload: await readJsonRpc(res) };
}

type ToolCallResult = {
  isError?: boolean;
  content: { text: string }[];
  structuredContent?: unknown;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('owner mode: gateway key gate (C6)', () => {
  it('rejects a non-public route without a key', async () => {
    const { request, fake } = setup();
    const res = await request('/api/v1/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: 'Invalid gateway key' });
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a wrong key', async () => {
    const { request } = setup();
    const res = await request('/api/v1/me', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('keeps /api/v1/health/live and / public', async () => {
    const { request } = setup();
    expect((await request('/api/v1/health/live')).status).toBe(200);
    expect((await request('/')).status).toBe(200);
  });

  it('requires the key on /mcp too', async () => {
    const { request } = setup();
    const { res } = await mcpCall(request, '/mcp', 'tools/list', {}, {});
    expect(res.status).toBe(401);
  });

  it('answers a generic 500 for a malformed GATEWAY_API_KEYS, never echoing it', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(l));
    const env = { ...OWNER_ENV, GATEWAY_API_KEYS: 'no-colon-secret-value' };
    const { request } = setup(env);
    const res = await request('/api/v1/me', { headers: KEY });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ detail: 'gateway misconfigured' });
    expect(text).not.toContain('secret');
    expect((await request('/api/v1/health/live')).status).toBe(200);
    expect(lines.join('\n')).toContain('GATEWAY_API_KEYS is malformed');
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('answers a generic 500 for a mixed OWNER_ALLOWED_FEATURES, never echoing it', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(l));
    const env = { ...OWNER_ENV, OWNER_ALLOWED_FEATURES: '+api:notes:create,api:secretfeature' };
    const { request } = setup(env);
    const res = await request('/api/v1/me', { headers: KEY });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ detail: 'gateway misconfigured' });
    expect((await request('/api/v1/health/live')).status).toBe(200);
    const { res: mcpRes } = await mcpCall(request, '/mcp', 'tools/list', {});
    expect(mcpRes.status).toBe(500);
    expect(lines.join('\n')).toContain('OWNER_ALLOWED_FEATURES is malformed');
    expect(lines.join('\n')).not.toContain('secretfeature');
  });

  it('a `+` OWNER_ALLOWED_FEATURES list keeps the defaults and adds to them', async () => {
    const env = { ...OWNER_ENV, OWNER_ALLOWED_FEATURES: '+api:notes:create' };
    const { request } = setup(env);
    expect((await request('/api/v1/me', { headers: KEY })).status).toBe(200);
  });
});

describe('owner mode: resolved credentials', () => {
  it('uses the owner cookie with a key and no token', async () => {
    const { request, cookies } = setup();
    const res = await request('/api/v1/me', { headers: KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handle: 'owner' });
    expect(cookies()).toEqual([OWNER_COOKIE]);
  });

  it('health/ready resolves owner credentials', async () => {
    const { request, cookies } = setup();
    const res = await request('/api/v1/health/ready', { headers: KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true });
    expect(cookies()).toEqual([OWNER_COOKIE]);
  });

  it('refuses show=true for resolved credentials (C8)', async () => {
    const { request, fake } = setup();
    const res = await request('/api/v1/health/ready?show=true', { headers: KEY });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ detail: 'show is disabled for resolved credentials' });
    expect(fake.calls).toHaveLength(0);
  });

  it('gates features outside the owner allow-list', async () => {
    const { request, fake } = setup();
    const res = await request('/api/v1/notes', {
      method: 'POST',
      headers: { ...KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      detail: 'feature api:notes:create disabled for owner credentials',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('never serves owner credentials without a gateway key', async () => {
    const env = { ...OWNER_ENV, GATEWAY_API_KEYS: undefined };
    const { request, fake } = setup(env);
    const res = await request('/api/v1/me');
    expect(res.status).toBe(422);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('owner mode: explicit token wins (Review Focus 4)', () => {
  it('uses the token cookie, not the owner cookie', async () => {
    const { request, cookies } = setup();
    const res = await request('/api/v1/me', { headers: { ...KEY, 'x-gateway-token': TOKEN } });
    expect(res.status).toBe(200);
    expect(cookies()).toEqual([TOKEN_COOKIE]);
  });

  it('does not apply the feature gate to a token', async () => {
    const { request, cookies } = setup();
    const res = await request('/api/v1/notes', {
      method: 'POST',
      headers: { ...KEY, 'x-gateway-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(res.status).toBe(201);
    expect(cookies()).toEqual([TOKEN_COOKIE]);
  });

  it('echoes the token fields for show=true', async () => {
    const { request } = setup();
    const res = await request('/api/v1/health/ready?show=true', {
      headers: { ...KEY, 'x-gateway-token': TOKEN },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: true,
      tokens: {
        publication_url: 'https://tok.substack.com',
        substack_sid: 'tok-sid',
        connect_sid: 'tok-connect',
      },
    });
  });

  it('still requires the gateway key alongside a token', async () => {
    const { request } = setup();
    const res = await request('/api/v1/me', { headers: { 'x-gateway-token': TOKEN } });
    expect(res.status).toBe(401);
  });
});

describe('MCP endpoint', () => {
  it.each(['/mcp', '/mcp/'])('POST %s answers tools/list', async (path) => {
    const { request } = setup();
    const { res, payload } = await mcpCall(request, path, 'tools/list');
    expect(res.status).toBe(200);
    const tools = (payload.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_note', 'get_note', 'get_me']),
    );
    const schema = tools.find((t) => t.name === 'get_note')?.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty('token');
  });

  it('resolves owner credentials for a tool called without a token', async () => {
    const { request, fake } = setup();
    const { payload } = await mcpCall(request, '/mcp/', 'tools/call', {
      name: 'get_note',
      arguments: { note_id: 1 },
    });
    const result = payload.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 131648795, body: expect.any(String) });
    expect(fake.calls[0]?.headers.get('cookie')).toBe(
      'substack.sid=owner-sid; connect.sid=owner-connect',
    );
  });

  it('runs owner mode with substack.sid only (no OWNER_CONNECT_SID)', async () => {
    const { request, cookies } = setup({ ...OWNER_ENV, OWNER_CONNECT_SID: undefined });
    const rest = await request('/api/v1/comments/1', { headers: KEY });
    expect(rest.status).toBe(200);
    const { payload } = await mcpCall(request, '/mcp/', 'tools/call', {
      name: 'get_note',
      arguments: { note_id: 1 },
    });
    expect((payload.result as ToolCallResult).isError).toBeFalsy();
    expect(cookies()).toEqual(['substack.sid=owner-sid']);
  });

  it('gates an owner-mode write tool', async () => {
    const { request } = setup();
    const { payload } = await mcpCall(request, '/mcp', 'tools/call', {
      name: 'create_note',
      arguments: { content: 'hello' },
    });
    const result = payload.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Error calling tool 'create_note': feature mcp:notes:create disabled for owner credentials",
    );
  });

  it('lets an explicit token bypass the gate', async () => {
    const { request, cookies } = setup();
    const { payload } = await mcpCall(request, '/mcp', 'tools/call', {
      name: 'create_note',
      arguments: { content: 'hello', token: TOKEN },
    });
    const result = payload.result as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 131648796 });
    expect(cookies()).toEqual([TOKEN_COOKIE]);
  });
});

describe('request id', () => {
  it('echoes an incoming X-Request-ID', async () => {
    const { request } = setup();
    const res = await request('/api/v1/health/live', { headers: { 'X-Request-ID': 'abc' } });
    expect(res.headers.get('X-Request-ID')).toBe('abc');
  });

  it('assigns a UUID when absent, also on rejected requests', async () => {
    const { request } = setup();
    for (const path of ['/api/v1/health/live', '/api/v1/me']) {
      const res = await request(path);
      expect(res.headers.get('X-Request-ID')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('replaces an over-long or unsafe X-Request-ID with a UUID', async () => {
    const { request } = setup();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const bad of ['a'.repeat(129), 'has space', 'semi;colon', 'new\u00e9', '<x>']) {
      const res = await request('/api/v1/health/live', { headers: { 'X-Request-ID': bad } });
      expect(res.headers.get('X-Request-ID'), bad).toMatch(uuid);
    }
    const ok = 'A-z_0.9'.padEnd(128, 'x');
    const res = await request('/api/v1/health/live', { headers: { 'X-Request-ID': ok } });
    expect(res.headers.get('X-Request-ID')).toBe(ok);
  });

  it('propagates the request id to Substack', async () => {
    const { request, fake } = setup();
    await request('/api/v1/me', { headers: { ...KEY, 'X-Request-ID': 'rid-1' } });
    expect(fake.calls[0]?.headers.get('x-request-id')).toBe('rid-1');
  });
});

describe('logging and default fetcher', () => {
  it('logs no credentials, keys or tokens', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(l));
    const { request } = setup({ ...OWNER_ENV, LOG_LEVEL: 'debug' });
    await request('/api/v1/me', { headers: { ...KEY, 'x-gateway-token': TOKEN } });
    await request('/api/v1/me', { headers: KEY });
    const all = lines.join('\n');
    expect(all).toContain('"key":"ci"');
    for (const secret of ['abc', 'owner-sid', 'owner-connect', 'tok-sid', 'tok-connect', TOKEN]) {
      expect(all).not.toContain(secret);
    }
  });

  it('passes the client Request through unchanged (redirect: manual holds)', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      seen.push(input);
      return Response.json({});
    });
    const app = createApp();
    const res = await app.request(
      '/api/v1/health/ready',
      { headers: { 'x-gateway-token': TOKEN } },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Request);
    expect((seen[0] as Request).redirect).toBe('manual');
  });
});

describe('owner mode: MCP defence in depth', () => {
  const CALL = { name: 'get_note', arguments: { note_id: 1 } };

  it('keys unset + OWNER_* set + no token: MissingCredentialsError, zero Substack calls', async () => {
    const { request, fake } = setup({ ...OWNER_ENV, GATEWAY_API_KEYS: undefined });
    const { payload } = await mcpCall(request, '/mcp', 'tools/call', CALL, {});
    const result = payload.result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error calling tool 'get_note'");
    expect(result.content[0]?.text).toContain('No Substack credentials');
    expect(fake.calls).toHaveLength(0);
  });

  it('never asks an extension resolver about an unauthenticated caller', async () => {
    const resolve = vi.fn(async () => ({
      publication_url: 'https://owner.substack.com',
      substack_sid: 'owner-sid',
      connect_sid: 'owner-connect',
    }));
    const fake = createFakeSubstack({});
    const app = createApp({
      fetcher: fake,
      extensions: [{ name: 'greedy', credentialResolver: { resolve } }],
    });
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: CALL }),
      },
      TEST_ENV,
    );
    const result = (await readJsonRpc(res)).result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No Substack credentials');
    expect(resolve).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it('maps a resolver validation failure to the generic misconfigured text', async () => {
    const fake = createFakeSubstack({});
    const app = createApp({
      fetcher: fake,
      extensions: [
        {
          name: 'bad',
          credentialResolver: {
            resolve: async () =>
              ({ publication_url: 'ftp://x', substack_sid: 'SECRET-SID' }) as never,
          },
        },
      ],
    });
    const env = { ...TEST_ENV, GATEWAY_API_KEYS: 'ci:abc' };
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { ...MCP_HEADERS, ...KEY },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: CALL }),
      },
      env,
    );
    const result = (await readJsonRpc(res)).result as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Error calling tool 'get_note': gateway misconfigured");
    expect(fake.calls).toHaveLength(0);
  });
});
