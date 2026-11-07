// Regression tests for the FastMCP parity gaps the Task 20 differential
// harness (harness/) found between upstream bc2e875 and this Worker.

import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createWorld, encodeCredentials, TEST_ENV, type World } from '../bdd/steps/common';
import { MCP_HEADERS, mcpRequest } from '../bdd/steps/mcp';

const TOKEN = encodeCredentials({
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
});

function world(routes: Record<string, unknown> = {}): World {
  const w = createWorld();
  w.publicationUrl = 'https://example.substack.com';
  w.routes = routes;
  return w;
}

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

async function call(w: World, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { payload } = await mcpRequest(w, 'tools/call', { name, arguments: args });
  expect(payload.error, JSON.stringify(payload)).toBeUndefined();
  return payload.result as ToolResult;
}

type ListedTool = {
  name: string;
  inputSchema: Record<string, unknown> & { properties: Record<string, unknown> };
  outputSchema?: unknown;
};

async function listTools(): Promise<ListedTool[]> {
  const { payload } = await mcpRequest(world(), 'tools/list', {});
  return (payload.result as { tools: ListedTool[] }).tools;
}

describe('tool results (FastMCP shape)', () => {
  it('a string result carries isError false and the wrap_result marker', async () => {
    const w = world({ 'DELETE example.substack.com/api/v1/comment/42': {} });
    const result = await call(w, 'delete_note', { note_id: 42, token: TOKEN });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Note 42 deleted successfully.' }],
      structuredContent: { result: 'Note 42 deleted successfully.' },
      isError: false,
      _meta: { fastmcp: { wrap_result: true } },
    });
  });

  it('an object result carries isError false and no _meta', async () => {
    const w = world({
      'GET example.substack.com/api/v1/drafts/7/prepublish': { errors: [], suggestions: [] },
    });
    const result = await call(w, 'check_draft', { draft_id: 7, token: TOKEN });
    expect(result.isError).toBe(false);
    expect(result._meta).toBeUndefined();
    expect(result.structuredContent).toEqual({ errors: [], suggestions: [] });
  });

  it('a SubstackAPIError reads like Python str(exc): "Substack API error <status>: …"', async () => {
    const w = world({
      'GET example.substack.com/api/v1/reader/comment/42': () =>
        Response.json({ error: 'Not found' }, { status: 404 }),
    });
    const result = await call(w, 'get_note', { note_id: 42, token: TOKEN });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Error calling tool 'get_note': Substack API error 404: Substack returned 404: Not found",
    );
  });

  it('an unknown tool is an error result, not a JSON-RPC error', async () => {
    const result = await call(world(), 'no_such_tool', {});
    expect(result).toEqual({
      content: [{ type: 'text', text: "Unknown tool: 'no_such_tool'" }],
      isError: true,
    });
  });

  it('rejects an argument the tool does not take (pydantic forbids extras)', async () => {
    const w = world({ 'GET substack.com/api/v1/user/jakubslys/public_profile': {} });
    const result = await call(w, 'get_profile', { slug: 'jakubslys', token: TOKEN });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(w.fake?.calls ?? []).toHaveLength(0);
  });
});

describe('tools/list (pydantic JSON Schema dialect)', () => {
  it('lists tools in upstream registration order', async () => {
    const names = (await listTools()).map((t) => t.name);
    expect(names.slice(0, 4)).toEqual([
      'get_my_following',
      'list_drafts',
      'get_draft',
      'create_draft',
    ]);
    expect(names.slice(-4)).toEqual(['get_post', 'like_post', 'unlike_post', 'restack_post']);
    expect(names.indexOf('create_note')).toBeLessThan(names.indexOf('get_note'));
  });

  it('writes nullable arguments as anyOf + default null, forbids extras, drops $schema', async () => {
    const tool = (await listTools()).find((t) => t.name === 'get_profile_posts');
    expect(tool?.inputSchema).toEqual({
      type: 'object',
      properties: {
        slug: { type: 'string' },
        limit: { default: 25, type: 'integer' },
        cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      },
      required: ['slug'],
      additionalProperties: false,
    });
  });

  it('keeps real integer bounds and drops the safe-integer ones', async () => {
    const tool = (await listTools()).find((t) => t.name === 'get_recommendation_stats');
    expect(tool?.inputSchema.properties).toMatchObject({
      offset: { default: 0, minimum: 0, type: 'integer' },
      limit: { default: 20, minimum: 1, maximum: 100, type: 'integer' },
      token: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
    });
    expect(tool?.inputSchema.properties.offset).not.toHaveProperty('maximum');
  });

  it('lists FastMCP output schemas: a wrapped {result} for text tools, open object otherwise', async () => {
    const tools = await listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('like_post')?.outputSchema).toEqual({
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      'x-fastmcp-wrap-result': true,
    });
    expect(byName.get('get_post')?.outputSchema).toEqual({
      type: 'object',
      additionalProperties: true,
    });
    const wrapped = tools.filter((t) => JSON.stringify(t.outputSchema).includes('wrap-result'));
    expect(wrapped).toHaveLength(11);
  });
});

describe('MCP transport', () => {
  it('advertises the FastMCP capabilities on initialize', async () => {
    const { payload } = await mcpRequest(world(), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    expect((payload.result as { capabilities: unknown }).capabilities).toEqual({
      logging: {},
      prompts: { listChanged: true },
      resources: { subscribe: false, listChanged: true },
      tools: { listChanged: true },
    });
  });

  it.each(['prompts/list', 'resources/list'])('%s answers an empty list', async (method) => {
    const { payload } = await mcpRequest(world(), method, {});
    expect(payload.error).toBeUndefined();
    expect(Object.values(payload.result as object)).toEqual([[]]);
  });

  it.each(['/mcp', '/mcp/'])('GET %s answers 405 text/plain like Starlette', async (path) => {
    const res = await createApp().request(path, { headers: MCP_HEADERS }, TEST_ENV);
    expect(res.status).toBe(405);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('allow')).toBe('POST, DELETE');
    expect(await res.text()).toBe('Method Not Allowed');
  });

  it.each(['/mcp', '/mcp/'])('DELETE %s answers the stateless 405 JSON-RPC error', async (path) => {
    const res = await createApp().request(path, { method: 'DELETE' }, TEST_ENV);
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Method Not Allowed: Session termination not supported' },
    });
  });
});
