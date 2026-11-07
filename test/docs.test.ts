// Docs stay true to the code: every MCP tool in docs/mcp.md and every REST route in
// docs/api-reference.md exists in the live inventory, and the README carries the
// credit, disclaimer and Deploy button.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApi } from '../src/app';
import { createWorld } from './bdd/steps/common';
import { mcpRequest } from './bdd/steps/mcp';

const read = (path: string) => readFileSync(path, 'utf8');
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

function restOperations(): string[] {
  const openapi = createApi().getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'docs', version: '0' },
  });
  return Object.entries(openapi.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((m) => (item as Record<string, unknown>)[m] !== undefined).map(
      (m) => `${m.toUpperCase()} /api${path}`,
    ),
  );
}

describe('docs', () => {
  it('docs/mcp.md names exactly the live MCP tools', async () => {
    const documented = [...read('docs/mcp.md').matchAll(/^- `(\w+)\(/gm)].map((m) => m[1]);
    const { payload } = await mcpRequest(createWorld(), 'tools/list', {});
    const live = (payload.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(documented).toHaveLength(49);
    expect([...documented].sort()).toEqual([...live].sort());
  });

  it('docs/api-reference.md lists exactly the live REST routes', () => {
    const documented = [
      ...read('docs/api-reference.md').matchAll(
        /^### `(GET|POST|PUT|DELETE|PATCH) (\/api\/\S+)`$/gm,
      ),
    ].map((m) => `${m[1]} ${m[2]}`);
    expect(documented).toHaveLength(51);
    expect(documented.sort()).toEqual(restOperations().sort());
  });

  it('README carries the credit, disclaimer and Deploy button', () => {
    const readme = read('README.md');
    for (const s of [
      'Jakub Slys',
      'bc2e875',
      'Not affiliated with Substack',
      'deploy.workers.cloudflare.com',
      'https://deploy.workers.cloudflare.com/?url=https://github.com/iamfiscus/substack-gateway-worker',
      'wrangler secret put',
    ]) {
      expect(readme).toContain(s);
    }
  });

  it('README sections appear in the required order', () => {
    const readme = read('README.md');
    const marks = [
      'Jakub Slys',
      'Unofficial. Not affiliated with Substack.',
      'deploy.workers.cloudflare.com',
      '## Credential modes',
      '## Getting your cookies',
      '## Terms of Service risk',
      '## Trust model',
      '## Limits',
      '## Rotating cookies',
      '## Differences from upstream',
    ];
    const at = marks.map((m) => readme.indexOf(m));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the guides exist', () => {
    for (const f of ['authentication', 'api-reference', 'mcp', 'extensions', 'deploy']) {
      expect(existsSync(`docs/${f}.md`)).toBe(true);
    }
  });
});
