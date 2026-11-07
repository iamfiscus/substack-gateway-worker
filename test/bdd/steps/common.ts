// Port of upstream packages/gateway_oss/features/steps/common.py (bc2e875).
// The HTTP client is `app.request()`; Substack is the fake behind the app.

import { expect } from 'vitest';
import { createApp } from '../../../src/app';
import type { GatewayEnv } from '../../../src/config';
import type { GatewayExtension } from '../../../src/context';
import { createFakeSubstack, type FakeRoute, sample } from '../../support/fakeSubstack';
import { type StepRegistry, step } from '../runner';

export const SUBSTACK_BASE = 'https://substack.com';
export const SUBSTACK_HOST = 'substack.com';

export const TEST_ENV: GatewayEnv = {
  SUBSTACK_BASE_URL: SUBSTACK_BASE,
  SUBSTACK_TIMEOUT_SEC: '5',
  LOG_LEVEL: 'error',
};

export type McpOutcome = {
  isError: boolean;
  text: string | null;
  result: Record<string, unknown> | null;
};

export type World = {
  env: GatewayEnv;
  extensions: GatewayExtension[];
  /** Fake Substack routes: "GET substack.com/api/v1/…" → JSON value or handler. */
  routes: Record<string, FakeRoute>;
  fake: ReturnType<typeof createFakeSubstack> | null;
  headers: Record<string, string>;
  publicationUrl: string;
  response: Response | null;
  bodyText: string;
  mcpToken: string | null;
  mcp: McpOutcome | null;
  /** Free-form state for domain step files. */
  extra: Record<string, unknown>;
};

export type WorldOptions = { env?: GatewayEnv; extensions?: GatewayExtension[] };

export function createWorld(opts: WorldOptions = {}): World {
  return {
    env: { ...TEST_ENV, ...opts.env },
    extensions: opts.extensions ?? [],
    routes: {},
    fake: null,
    headers: {},
    publicationUrl: SUBSTACK_BASE,
    response: null,
    bodyText: '',
    mcpToken: null,
    mcp: null,
    extra: {},
  };
}

export { sample as loadSample };

/** Follow a dotted path through nested objects and arrays (digits index arrays). */
export function walkPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const seg of path.split('.')) {
    node = Array.isArray(node) ? node[Number(seg)] : (node as Record<string, unknown>)[seg];
  }
  return node;
}

export function pubUrl(w: World): string {
  return w.publicationUrl.replace(/\/+$/, '');
}

/** "https://x.substack.com" → "x.substack.com" (fake route key prefix). */
export function pubHost(w: World): string {
  return new URL(pubUrl(w)).host;
}

/** `base64.b64encode(json.dumps(creds).encode())`, UTF-8 safe. */
export function encodeCredentials(creds: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(creds));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function send(w: World, method: string, path: string, body?: unknown): Promise<void> {
  w.fake = createFakeSubstack(w.routes);
  const app = createApp({ fetcher: w.fake, extensions: w.extensions });
  const headers: Record<string, string> = { ...w.headers };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  w.response = await app.request(path, init, w.env);
  w.bodyText = await w.response.text();
}

export function json(w: World): Record<string, unknown> {
  try {
    return JSON.parse(w.bodyText) as Record<string, unknown>;
  } catch {
    throw new Error(`Response is not JSON (status ${w.response?.status}): ${w.bodyText}`);
  }
}

export const commonSteps: StepRegistry<World> = [
  step('a valid gateway token "{token}" and publication URL "{pub_url_}"', (w, [token, url]) => {
    w.publicationUrl = url as string;
    w.headers = {
      'x-gateway-token': encodeCredentials({
        publication_url: url as string,
        substack_sid: token as string,
        connect_sid: token as string,
      }),
    };
  }),
  step('a malformed x-gateway-token header and publication URL "{pub_url_}"', (w, [url]) => {
    w.publicationUrl = url as string;
    w.headers = { 'x-gateway-token': 'not-valid-base64!!!' };
  }),
  step('a gateway token with extra whitespace and publication URL "{pub_url_}"', (w, [url]) => {
    w.publicationUrl = url as string;
    const token = encodeCredentials({
      publication_url: url as string,
      substack_sid: 'test-token',
      connect_sid: 'test-token',
    });
    w.headers = { 'x-gateway-token': `  ${token}   ` };
  }),

  step('I send GET {path}', (w, [path]) => send(w, 'GET', path as string)),
  step('I send PUT {path} with JSON body {body}', (w, [path, body]) =>
    send(w, 'PUT', path as string, JSON.parse(body as string)),
  ),
  step('I send POST {path} with JSON body {body}', (w, [path, body]) =>
    send(w, 'POST', path as string, JSON.parse(body as string)),
  ),
  step('I send DELETE {path}', (w, [path]) => send(w, 'DELETE', path as string)),

  step('the response status code is {status:d}', (w, [status]) => {
    expect(w.response?.status, `Body: ${w.bodyText}`).toBe(Number(status));
  }),
  step('the response field "{field}" is true', (w, [field]) => {
    expect(json(w)[field as string]).toBe(true);
  }),
  step('the response field "{field}" is false', (w, [field]) => {
    expect(json(w)[field as string]).toBe(false);
  }),
  step('the response field "{field}" is "{value}"', (w, [field, value]) => {
    expect(json(w)[field as string]).toBe(value);
  }),
  step('the response field "{field}" is "{value}" followed by a newline', (w, [field, value]) => {
    expect(json(w)[field as string]).toBe(`${value}\n`);
  }),
  step('the response field "{field}" is {value:d}', (w, [field, value]) => {
    expect(json(w)[field as string]).toBe(Number(value));
  }),
  step('the response field "{field}" is not null', (w, [field]) => {
    const v = json(w)[field as string];
    expect(v).not.toBeNull();
    expect(v).not.toBeUndefined();
  }),
  step('the response field "{field}" is absent', (w, [field]) => {
    expect(json(w)).not.toHaveProperty([field as string]);
  }),
  step('the response list "{field}" has {count:d} item', (w, [field, count]) => {
    expect(json(w)[field as string]).toHaveLength(Number(count));
  }),
  step('the response list "{field}" has {count:d} items', (w, [field, count]) => {
    expect(json(w)[field as string]).toHaveLength(Number(count));
  }),
  step('the response list "{field}" contains "{value}"', (w, [field, value]) => {
    expect(json(w)[field as string]).toContain(value);
  }),
  step('the response nested field "{parent}.{child}" is "{value}"', (w, [parent, child, value]) => {
    const p = json(w)[parent as string] as Record<string, unknown>;
    expect(p[child as string]).toBe(value);
  }),
  step('the response header "{name}" is "{value}"', (w, [name, value]) => {
    expect(w.response?.headers.get(name as string)).toBe(value);
  }),
  step('the first item field "{field}" is "{value}"', (w, [field, value]) => {
    const items = (json(w).items ?? []) as Record<string, unknown>[];
    expect(items.length, "Response list 'items' is empty").toBeGreaterThan(0);
    expect(items[0]?.[field as string]).toBe(value);
  }),
  step('the first item field "{field}" is {value:d}', (w, [field, value]) => {
    const items = (json(w).items ?? []) as Record<string, unknown>[];
    expect(items.length, "Response list 'items' is empty").toBeGreaterThan(0);
    expect(items[0]?.[field as string]).toBe(Number(value));
  }),
  step('the response field "{field}" contains "{value}"', (w, [field, value]) => {
    const v = json(w)[field as string];
    expect(typeof v === 'string' ? v : JSON.stringify(v)).toContain(value);
  }),
];
