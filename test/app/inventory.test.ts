// The full REST and MCP inventory against upstream docs/api-reference.md and
// docs/mcp.md (bc2e875, copied to test/fixtures/upstream-docs/).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/app';
import { createWorld } from '../bdd/steps/common';
import { mcpRequest } from '../bdd/steps/mcp';

const doc = (name: string) => readFileSync(`test/fixtures/upstream-docs/${name}`, 'utf8');

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

function restOperations(): string[] {
  const openapi = createApi().getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'inventory', version: '0' },
  });
  return Object.entries(openapi.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((m) => (item as Record<string, unknown>)[m] !== undefined).map(
      (m) => `${m.toUpperCase()} /api${path}`,
    ),
  );
}

describe('REST inventory', () => {
  it('the OpenAPI document lists 51 operations', () => {
    expect(restOperations()).toHaveLength(51);
  });

  it('lists exactly the routes of upstream docs/api-reference.md', () => {
    const documented = [
      ...doc('api-reference.md').matchAll(/^### `(GET|POST|PUT|DELETE|PATCH) (\/api\/\S+)`$/gm),
    ].map((m) => `${m[1]} ${m[2]}`);
    expect(documented).toHaveLength(51);
    expect(restOperations().sort()).toEqual(documented.sort());
  });
});

describe('MCP inventory', () => {
  it('tools/list returns the 49 tools named in upstream docs/mcp.md', async () => {
    const documented = [...doc('mcp.md').matchAll(/^- `(\w+)\(/gm)].map((m) => m[1]);
    expect(documented).toHaveLength(49);
    const { payload } = await mcpRequest(createWorld(), 'tools/list', {});
    const names = (payload.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toHaveLength(49);
    expect([...names].sort()).toEqual([...documented].sort());
  });
});
