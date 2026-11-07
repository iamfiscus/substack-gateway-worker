// The parity matrix (harness/matrix.ts) must cover every REST operation and
// every MCP tool, each with all five variants.

import { describe, expect, it } from 'vitest';
import { ALLOWED_DIFFS, MATRIX, MCP_TOOLS, REST_OPERATIONS } from '../../harness/matrix';
import { jsonDiff } from '../../harness/run';
import { createApi } from '../../src/app';
import { createWorld } from '../bdd/steps/common';
import { mcpRequest } from '../bdd/steps/mcp';

const VARIANTS = ['happy', 'missing-token', 'invalid-token', 'substack-404', 'substack-500'];

function openApiOperations(): string[] {
  const doc = createApi().getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'matrix', version: '0' },
  });
  return Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    ['get', 'put', 'post', 'delete', 'patch']
      .filter((m) => (item as Record<string, unknown>)[m] !== undefined)
      .map((m) => `${m.toUpperCase()} /api${path}`),
  );
}

describe('parity matrix', () => {
  it('covers all 51 REST operations', () => {
    expect([...REST_OPERATIONS].sort()).toEqual(openApiOperations().sort());
    expect(REST_OPERATIONS).toHaveLength(51);
  });

  it('covers all 49 MCP tools', async () => {
    const { payload } = await mcpRequest(createWorld(), 'tools/list', {});
    const names = (payload.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect([...MCP_TOOLS].sort()).toEqual([...names].sort());
    expect(MCP_TOOLS).toHaveLength(49);
  });

  it.each([...REST_OPERATIONS.map((op) => `REST ${op}`), ...MCP_TOOLS.map((t) => `MCP ${t}`)])(
    '%s has all five variants',
    (prefix) => {
      for (const v of VARIANTS) {
        expect(MATRIX.filter((c) => c.name === `${prefix} [${v}]`)).toHaveLength(1);
      }
    },
  );

  it('case names are unique', () => {
    expect(new Set(MATRIX.map((c) => c.name)).size).toBe(MATRIX.length);
  });
});

describe('diffing', () => {
  it('reports differing paths, absent keys and array lengths', () => {
    expect(jsonDiff({ a: 1, b: [1, 2], c: { d: 'x' } }, { a: 1, b: [1], c: {}, e: 2 })).toEqual([
      { path: '$.b.length', upstream: 2, worker: 1 },
      { path: '$.c.d', upstream: 'x', worker: '<absent>' },
      { path: '$.e', upstream: '<absent>', worker: 2 },
    ]);
  });

  const allowed = (name: string, field: string, upstream: unknown, worker: unknown) =>
    ALLOWED_DIFFS.some(
      (a) =>
        a.match.test(name) &&
        (field === a.field || field.startsWith(`${a.field} `)) &&
        (!a.applies || a.applies({ field, upstream, worker })),
    );

  it('allows only the listed differences', () => {
    expect(allowed('REST x', 'body $.detail.0.msg', 'a', 'b')).toBe(true);
    expect(allowed('REST x', 'body $.detail', 'Not Found', 'Gone')).toBe(false);
    expect(allowed('MCP initialize', 'body $.result.serverInfo.version', '4.1.6', '6.1.1')).toBe(
      true,
    );
    expect(allowed('REST x', 'status', 200, 500)).toBe(false);
    expect(allowed('REST x', 'body $.markdown', 'a\n\nb', 'a\nb')).toBe(true);
    expect(allowed('REST x', 'body $.markdown', 'a b', 'a c')).toBe(false);
    expect(allowed('MCP t', 'body $.result.content.0.text', 'Substack API error 404: x', 'x')).toBe(
      false,
    );
  });
});
