// Replays MATRIX against upstream and this Worker and diffs the results.
//
//   node harness/run.ts [--upstream http://127.0.0.1:5001] [--worker http://127.0.0.1:8787]
//                       [--only <case-name regex>] [--show]
//
// Expects the fake Substack (harness/fakeSubstackServer.ts) on :7000 and both
// gateways already running (harness/start.sh does all three). Prints
// `{ total, mismatches, allowed, happyFailures }` as JSON; exits 1 on any mismatch.

import { FAKE_BASE_URL, type RecordedCall } from './fakeSubstackServer.ts';
import { ALLOWED_DIFFS, MATRIX, type MatrixCase } from './matrix.ts';

export type Mismatch = { name: string; field: string; upstream: unknown; worker: unknown };
export type AllowedHit = Mismatch & { reason: string };
export type RunResult = {
  total: number;
  mismatches: Mismatch[];
  allowed: AllowedHit[];
  /** Happy-path cases where either side failed: they exercise nothing. */
  happyFailures: { name: string; upstream: Observation; worker: Observation }[];
};

type Observation = {
  status: number;
  contentType: string;
  body: unknown;
  calls: RecordedCall[];
};

let rpcId = 0;

async function control(path: string, body: unknown = {}): Promise<unknown> {
  const res = await fetch(`${FAKE_BASE_URL}/__control/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

function buildRequest(c: MatrixCase, id: number): RequestInit {
  const headers: Record<string, string> = { ...c.headers };
  const init: RequestInit = { method: c.method, headers };
  if (c.mcp || c.rpc) {
    headers['content-type'] = 'application/json';
    headers.accept = 'application/json, text/event-stream';
    const call = c.mcp
      ? { method: 'tools/call', params: { name: c.mcp.tool, arguments: c.mcp.args } }
      : c.rpc;
    init.body = JSON.stringify({ jsonrpc: '2.0', id, ...call });
  } else if (c.form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(c.form)) {
      if (typeof v === 'string') fd.append(k, v);
      else fd.append(k, new Blob([Buffer.from(v.content, 'latin1')], { type: v.type }), v.filename);
    }
    init.body = fd;
  } else if (c.rawBody) {
    headers['content-type'] = c.rawBody.contentType;
    init.body = c.rawBody.content;
  } else if (c.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(c.body);
  }
  return init;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The JSON-RPC message of a JSON or SSE response (last `data:` line). */
function parseBody(contentType: string, text: string): unknown {
  if (contentType.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    const last = data[data.length - 1];
    return last === undefined ? text : parseMaybeJson(last);
  }
  return text === '' ? null : parseMaybeJson(text);
}

/** Tool result text is compact JSON from both sides: compare it parsed. */
function normalizeMcp(body: unknown): unknown {
  const result = (body as { result?: { content?: { type: string; text?: string }[] } } | null)
    ?.result;
  if (!result || !Array.isArray(result.content)) return body;
  return {
    ...(body as object),
    result: {
      ...result,
      content: result.content.map((c) =>
        c.type === 'text' && typeof c.text === 'string'
          ? { ...c, text: parseMaybeJson(c.text) }
          : c,
      ),
    },
  };
}

/**
 * tools/list compared by tool name. Upstream registers its plugin packages in
 * `importlib.metadata.entry_points()` order, which follows the filesystem's
 * directory listing order (sorted on macOS APFS, hash order on Linux, as in
 * the Sandbox container), so its tool order is not stable across hosts.
 */
function sortToolsList(body: unknown): unknown {
  const result = (body as { result?: { tools?: { name?: string }[] } } | null)?.result;
  if (!result || !Array.isArray(result.tools)) return body;
  const tools = [...result.tools].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { ...(body as object), result: { ...result, tools } };
}

async function observe(base: string, c: MatrixCase, id: number): Promise<Observation> {
  await control('reset');
  await control('mode', { status: c.substackStatus ?? 200 });
  const res = await fetch(`${base}${c.path}`, { ...buildRequest(c, id), redirect: 'manual' });
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const text = await res.text();
  const { calls } = (await control('reset')) as { calls: RecordedCall[] };
  await control('mode', { status: 200 });
  let body = parseBody(contentType, text);
  if (c.mcp || c.rpc) body = normalizeMcp(body);
  if (c.rpc?.method === 'tools/list') body = sortToolsList(body);
  return { status: res.status, contentType, body, calls };
}

function isSuccess(c: MatrixCase, o: Observation): boolean {
  if (o.status < 200 || o.status > 299) return false;
  if (!c.mcp) return true;
  const b = o.body as { error?: unknown; result?: { isError?: boolean } } | null;
  return !b?.error && b?.result?.isError !== true;
}

/** Paths (a.b.0.c) where two JSON values differ, with both sides. */
export function jsonDiff(
  a: unknown,
  b: unknown,
  path = '$',
): { path: string; upstream: unknown; worker: unknown }[] {
  if (Object.is(a, b)) return [];
  const bothObjects = typeof a === 'object' && a !== null && typeof b === 'object' && b !== null;
  if (!bothObjects || Array.isArray(a) !== Array.isArray(b)) {
    return [{ path, upstream: a, worker: b }];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return [{ path: `${path}.length`, upstream: a.length, worker: b.length }];
    }
    return a.flatMap((x, i) => jsonDiff(x, b[i], `${path}.${i}`));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  return keys.flatMap((k) => {
    if (!(k in ao)) return [{ path: `${path}.${k}`, upstream: '<absent>', worker: bo[k] }];
    if (!(k in bo)) return [{ path: `${path}.${k}`, upstream: ao[k], worker: '<absent>' }];
    return jsonDiff(ao[k], bo[k], `${path}.${k}`);
  });
}

function compare(c: MatrixCase, up: Observation, wk: Observation): Mismatch[] {
  const out: Mismatch[] = [];
  if (up.status !== wk.status) {
    out.push({ name: c.name, field: 'status', upstream: up.status, worker: wk.status });
  }
  if (up.contentType !== wk.contentType) {
    out.push({
      name: c.name,
      field: 'content-type',
      upstream: up.contentType,
      worker: wk.contentType,
    });
  }
  for (const d of jsonDiff(up.body, wk.body)) {
    out.push({ name: c.name, field: `body ${d.path}`, upstream: d.upstream, worker: d.worker });
  }
  for (const d of jsonDiff(up.calls, wk.calls)) {
    out.push({
      name: c.name,
      field: `substack-calls ${d.path}`,
      upstream: d.upstream,
      worker: d.worker,
    });
  }
  return out;
}

export async function runMatrix(
  upstream: string,
  worker: string,
  only?: RegExp,
): Promise<RunResult> {
  const cases = only ? MATRIX.filter((c) => only.test(c.name)) : MATRIX;
  const result: RunResult = { total: cases.length, mismatches: [], allowed: [], happyFailures: [] };
  for (const c of cases) {
    rpcId += 1;
    const up = await observe(upstream, c, rpcId);
    const wk = await observe(worker, c, rpcId);
    if (c.expectSuccess && !(isSuccess(c, up) && isSuccess(c, wk))) {
      result.happyFailures.push({ name: c.name, upstream: up, worker: wk });
    }
    for (const m of compare(c, up, wk)) {
      const allow = ALLOWED_DIFFS.find(
        (a) =>
          a.match.test(m.name) &&
          (m.field === a.field || m.field.startsWith(`${a.field} `)) &&
          (!a.applies || a.applies(m)),
      );
      if (allow) {
        result.allowed.push({ ...m, reason: allow.reason });
      } else {
        result.mismatches.push(m);
      }
    }
  }
  return result;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const upstream = arg('--upstream', 'http://127.0.0.1:5001');
  const worker = arg('--worker', 'http://127.0.0.1:8787');
  const only = process.argv.includes('--only') ? new RegExp(arg('--only', '')) : undefined;
  if (process.argv.includes('--show')) {
    // Print both raw observations of the selected cases instead of diffing.
    for (const c of MATRIX.filter((m) => !only || only.test(m.name))) {
      rpcId += 1;
      const up = await observe(upstream, c, rpcId);
      const wk = await observe(worker, c, rpcId);
      console.log(JSON.stringify({ name: c.name, upstream: up, worker: wk }, null, 2));
    }
    process.exit(0);
  }
  const result = await runMatrix(upstream, worker, only);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.mismatches.length === 0 && result.happyFailures.length === 0 ? 0 : 1;
}
