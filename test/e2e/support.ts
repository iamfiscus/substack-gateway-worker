// Live end-to-end support, ported from upstream packages/gateway_oss/e2e (MIT,
// Jakub Slys). Gated on E2E_BASE_URL and E2E_GATEWAY_KEY; never runs in `npm test`.
//
// Point it only at an instance wired to a throwaway publication (or, read-only,
// at the main instance, where only reads ever run).
//
// Optional fixtures (scenarios that need one skip when it is unset):
//   E2E_PROFILE_SLUG, E2E_POST_ID, E2E_NOTE_ID
//   (E2E_POST_ID must be a post on the credentials' own publication: post comments
//   are read from the publication host, so another publication's post answers 404.)
// Optional switches:
//   E2E_ALLOW_WRITES=<host> opt in to scenarios that write to Substack (default: reads
//                         only). Must equal the exact host of E2E_BASE_URL, e.g.
//                         substack-gateway-throwaway.<sub>.workers.dev; "1" does nothing.
//                         Refused regardless when E2E_BASE_URL contains "nerding".
//   E2E_ENABLE_COMMENTS=1 run the post-comment lifecycle (needs the comment write
//                         features listed in OWNER_ALLOWED_FEATURES)
//   E2E_REQUEST_INTERVAL_SEC (default 1), E2E_429_RETRIES (4), E2E_429_BACKOFF_SEC (5)

import { type DeleteOutcome, hostOf, writesAllowedFor } from './guard';

export const BASE_URL = (process.env.E2E_BASE_URL ?? '').trim().replace(/\/+$/, '');
export const GATEWAY_KEY = (process.env.E2E_GATEWAY_KEY ?? '').trim();
export const enabled = BASE_URL !== '' && GATEWAY_KEY !== '';
export const isMainInstance = BASE_URL.toLowerCase().includes('nerding');
export const writesRequested = (process.env.E2E_ALLOW_WRITES ?? '').trim() !== '';
export const writesAllowed = writesAllowedFor(BASE_URL, process.env.E2E_ALLOW_WRITES);
if (enabled && writesRequested && !writesAllowed) {
  const why = isMainInstance
    ? 'main instance'
    : `E2E_ALLOW_WRITES must equal the E2E_BASE_URL host ${hostOf(BASE_URL)}`;
  console.warn(`e2e: refusing write scenarios against ${BASE_URL} (${why}); reads only`);
}
export const commentsEnabled = process.env.E2E_ENABLE_COMMENTS === '1';
export const PROFILE_SLUG = (process.env.E2E_PROFILE_SLUG ?? '').trim();
export const POST_ID = (process.env.E2E_POST_ID ?? '').trim();
export const NOTE_ID = (process.env.E2E_NOTE_ID ?? '').trim();

const intervalMs = Number(process.env.E2E_REQUEST_INTERVAL_SEC ?? '1') * 1000;
const retries = Number(process.env.E2E_429_RETRIES ?? '4');
const backoffMs = Number(process.env.E2E_429_BACKOFF_SEC ?? '5') * 1000;

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// biome-ignore lint/suspicious/noExplicitAny: live responses are untyped JSON
export type Json = any;
export type Reply = { status: number; headers: Headers; text: string; json: () => Json };

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${GATEWAY_KEY}`, ...extra };
}

/** Space requests out and retry idempotent ones that Substack throttled (429). */
export async function call(
  method: string,
  path: string,
  opts: { json?: unknown; form?: FormData; headers?: Record<string, string>; auth?: boolean } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(opts.auth === false ? {} : authHeaders()) };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  Object.assign(headers, opts.headers);
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const res = await fetch(`${BASE_URL}${path}`, { method, headers, body });
    const text = await res.text();
    const retryable = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (res.status === 429 && retryable && attempt < retries) {
      const ra = res.headers.get('retry-after') ?? '';
      await sleep(/^\d+$/.test(ra) ? Number(ra) * 1000 : backoffMs * 2 ** attempt);
      continue;
    }
    return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
  }
}

export const get = (path: string, auth = true) => call('GET', path, { auth });
export const post = (path: string, json?: unknown) => call('POST', path, { json });
export const put = (path: string, json?: unknown) => call('PUT', path, { json });
export const del = (path: string) => call('DELETE', path);

export function expectStatus(r: Reply, status: number): void {
  if (r.status !== status) throw new Error(`Expected ${status}, got ${r.status}: ${r.text}`);
}

/** Delete used for cleanup: 403 (feature disabled) and 404 (already gone) are reported, not thrown. */
export async function deleteDraft(id: string): Promise<DeleteOutcome> {
  const r = await del(`/api/v1/drafts/${id}`);
  if (r.status === 204) return 'deleted';
  if (r.status === 404) return 'missing';
  if (r.status === 403) return 'forbidden';
  throw new Error(`Expected 204, got ${r.status}: ${r.text}`);
}

// --- MCP (streamable HTTP, JSON or SSE replies) ---

function parseMcp(r: Reply): Json {
  if ((r.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
    for (const line of r.text.split(/\r?\n/)) {
      if (line.startsWith('data:') && line.trim() !== 'data:') {
        return JSON.parse(line.slice(5).trim());
      }
    }
    throw new Error(`No JSON-RPC message found in SSE response: ${r.text}`);
  }
  return r.json();
}

export async function mcp(
  method: string,
  id: number,
  params?: unknown,
  sessionId?: string | null,
): Promise<{ reply: Reply; payload: Json }> {
  const headers: Record<string, string> = { accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const reply = await call('POST', '/mcp/', {
    json: { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) },
    headers,
  });
  return { reply, payload: parseMcp(reply) };
}

export async function mcpInitialize(): Promise<string | null> {
  const { reply, payload } = await mcp('initialize', 1, {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'gateway-worker-e2e', version: '1.0.0' },
  });
  expectStatus(reply, 200);
  if (!payload.result || !('capabilities' in payload.result)) {
    throw new Error(`No capabilities in MCP init response: ${JSON.stringify(payload)}`);
  }
  const sid = reply.headers.get('mcp-session-id');
  const headers: Record<string, string> = { accept: 'application/json, text/event-stream' };
  if (sid) headers['mcp-session-id'] = sid;
  await call('POST', '/mcp/', {
    json: { jsonrpc: '2.0', method: 'notifications/initialized' },
    headers,
  });
  return sid;
}

// --- Fixtures ---

const crc32 = (buf: Uint8Array): number => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

/** Solid-colour RGB PNG built with node:zlib only. */
export async function solidPng(w: number, h: number, rgb: [number, number, number]) {
  const { deflateSync } = await import('node:zlib');
  const chunk = (kind: string, data: Uint8Array): Buffer => {
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const richDialectBody = (imageUrl: string) => `\
::defaults{align=justify}

# E2E rich draft

A justified paragraph that follows the default alignment of the whole draft.

:::align{center}
A centered paragraph.
:::

:::align{left}
A left-aligned paragraph.
:::

![E2E image](${imageUrl}){size=large watermark}

::button[Subscribe now]{href=subscribe}

::button[Share this post]{href=share}

::button[Leave a comment]{href=comment}

---

:::callout
A callout with **bold** text.
:::
`;
