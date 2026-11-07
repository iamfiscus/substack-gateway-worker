// Port of upstream packages/gateway_oss/features/steps/mcp_tools.py (bc2e875).
// Upstream calls the tool coroutines directly; here every call goes through
// the real `/mcp` endpoint as a JSON-RPC `tools/call`. Domain `When` steps are
// added by the task that ports each domain.

import { expect } from 'vitest';
import { createApp } from '../../../src/app';
import { MissingCredentialsError } from '../../../src/auth/credentials';
import { SubstackAuthError } from '../../../src/clients/errors';
import { createFakeSubstack } from '../../support/fakeSubstack';
import { type StepRegistry, step } from '../runner';
import { encodeCredentials, type McpOutcome, type World, walkPath } from './common';

export const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

/** Parse a JSON-RPC response that is either a JSON body or an SSE stream. */
export async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    const last = data[data.length - 1];
    if (last === undefined) throw new Error(`Empty SSE MCP response: ${text}`);
    return JSON.parse(last) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

let rpcId = 0;

export async function mcpRequest(
  w: World,
  method: string,
  params: Record<string, unknown>,
  path = '/mcp',
): Promise<{ res: Response; payload: Record<string, unknown> }> {
  w.fake = createFakeSubstack(w.routes);
  const app = createApp({ fetcher: w.fake, extensions: w.extensions });
  rpcId += 1;
  const res = await app.request(
    path,
    {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...w.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
    },
    w.env,
  );
  return { res, payload: await readJsonRpc(res) };
}

/** Call a tool; the world's MCP token is added as `token` unless `withToken` is false. */
export async function callTool(
  w: World,
  name: string,
  args: Record<string, unknown>,
  { withToken = true } = {},
): Promise<McpOutcome> {
  const full = withToken && w.mcpToken !== null ? { ...args, token: w.mcpToken } : args;
  const { res, payload } = await mcpRequest(w, 'tools/call', { name, arguments: full });
  expect(res.status, JSON.stringify(payload)).toBe(200);
  if (payload.error) throw new Error(`JSON-RPC error: ${JSON.stringify(payload.error)}`);
  const result = payload.result as {
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  const text = result.content?.find((c) => c.type === 'text')?.text ?? null;
  w.mcp = {
    isError: result.isError === true,
    text,
    result: result.structuredContent ?? null,
  };
  return w.mcp;
}

function ok(w: World): Record<string, unknown> {
  expect(w.mcp, 'no MCP call was made').not.toBeNull();
  expect(w.mcp?.isError, `MCP tool raised: ${w.mcp?.text}`).toBe(false);
  return w.mcp?.result ?? {};
}

export const mcpSteps: StepRegistry<World> = [
  step('a valid MCP token and publication URL "{pub_url_}"', (w, [url]) => {
    w.publicationUrl = url as string;
    w.mcpToken = encodeCredentials({
      publication_url: url as string,
      substack_sid: 'test-token',
      connect_sid: 'test-token',
    });
  }),
  step('an invalid MCP token and publication URL "{pub_url_}"', (w, [url]) => {
    w.publicationUrl = url as string;
    w.mcpToken = 'not-valid-base64!!!';
  }),

  step('I call the MCP tool get_note without credentials', (w) =>
    callTool(w, 'get_note', { note_id: 1 }, { withToken: false }),
  ),

  // me / posts / profiles (upstream mcp_tools.py)
  step('I call the MCP tool get_me', (w) => callTool(w, 'get_me', {})),
  step('I call the MCP tool get_my_notes', (w) => callTool(w, 'get_my_notes', {})),
  step('I call the MCP tool get_my_posts', (w) => callTool(w, 'get_my_posts', {})),
  step('I call the MCP tool get_my_following', (w) => callTool(w, 'get_my_following', {})),
  step('I call the MCP tool get_post with post_id {post_id:d}', (w, [id]) =>
    callTool(w, 'get_post', { post_id: Number(id) }),
  ),
  step('I call the MCP tool get_note with note_id {id:d}', (w, [id]) =>
    callTool(w, 'get_note', { note_id: Number(id) }),
  ),
  step('I call the MCP tool list_note_replies with note_id {id:d}', (w, [id]) =>
    callTool(w, 'list_note_replies', { note_id: Number(id) }),
  ),
  step('I call the MCP tool get_post_comments with post_id {id:d}', (w, [id]) =>
    callTool(w, 'get_post_comments', { post_id: Number(id) }),
  ),
  step('I call the MCP tool get_post_comment with comment_id {id:d}', (w, [id]) =>
    callTool(w, 'get_post_comment', { comment_id: Number(id) }),
  ),
  step('I call the MCP tool list_post_comment_replies with comment_id {id:d}', (w, [id]) =>
    callTool(w, 'list_post_comment_replies', { comment_id: Number(id) }),
  ),
  step('I call the MCP tool get_profile with slug "{slug}"', (w, [slug]) =>
    callTool(w, 'get_profile', { slug }, { withToken: false }),
  ),
  step('I call the MCP tool get_profile_posts with slug "{slug}"', (w, [slug]) =>
    callTool(w, 'get_profile_posts', { slug }, { withToken: false }),
  ),
  step('I call the MCP tool get_profile_notes with slug "{slug}"', (w, [slug]) =>
    callTool(w, 'get_profile_notes', { slug }, { withToken: false }),
  ),

  step('the MCP result field "{field}" is not null', (w, [field]) => {
    const v = ok(w)[field as string];
    expect(v).not.toBeNull();
    expect(v).not.toBeUndefined();
  }),
  step('the MCP result field "{field}" is "{value}"', (w, [field, value]) => {
    expect(String(ok(w)[field as string])).toBe(value);
  }),
  step('the MCP result path "{path}" equals JSON {value}', (w, [path, value]) => {
    expect(walkPath(ok(w), path as string)).toEqual(JSON.parse(value as string));
  }),
  step('the MCP result is "{value}"', (w, [value]) => {
    ok(w);
    expect(w.mcp?.text).toBe(value);
  }),
  step('the MCP call fails with a tool error containing "{text}"', (w, [text]) => {
    expect(w.mcp?.isError, `expected a tool error, got ${w.mcp?.text}`).toBe(true);
    expect(w.mcp?.text).toContain(text);
  }),
  step('the MCP tool raises a SubstackAuthError', (w) => {
    expect(w.mcp?.isError, `expected a tool error, got ${w.mcp?.text}`).toBe(true);
    expect(w.mcp?.text).toContain(new SubstackAuthError().message);
  }),
  step('the MCP call fails asking for credentials', (w) => {
    expect(w.mcp?.isError, `expected a tool error, got ${w.mcp?.text}`).toBe(true);
    expect(w.mcp?.text).toContain(new MissingCredentialsError().message);
    expect(w.mcp?.text).toContain('token');
  }),
  step('the MCP result list "{field}" has {count:d} items', (w, [field, count]) => {
    const v = ok(w)[field as string];
    expect(Array.isArray(v), `"${field}" is not a list`).toBe(true);
    expect(v).toHaveLength(Number(count));
  }),
  step(
    'the first MCP item in "{field}" has "{key}" equal to {value:d}',
    (w, [field, key, value]) => {
      const items = ok(w)[field as string] as Record<string, unknown>[];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.[key as string]).toBe(Number(value));
    },
  ),
];
