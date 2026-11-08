// The owner feature gate, checked against the live inventory: every registered
// REST route and MCP tool declares an upstream feature string (from
// test/fixtures/upstream-features.json, extracted from upstream bc2e875), and the
// default owner set holds only reads plus the safe draft and image writes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/app';
import { DEFAULT_OWNER_FEATURES } from '../../src/auth/features';
import { declaredToolFeatures } from '../../src/mcp/server';
import { declaredRouteFeature } from '../../src/rest/credentials';
import { createWorld } from '../bdd/steps/common';
import { mcpRequest } from '../bdd/steps/mcp';

const UPSTREAM: ReadonlySet<string> = new Set(
  (
    JSON.parse(readFileSync('test/fixtures/upstream-features.json', 'utf8')) as {
      features: string[];
    }
  ).features,
);

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
/** Public and ungated, as upstream: the liveness probe declares no feature. */
const UNGATED = new Set(['GET /v1/health/live']);

function restFeatures(): Map<string, string | null | undefined> {
  const api = createApi();
  const doc = api.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 'g', version: '0' } });
  const out = new Map<string, string | null | undefined>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) {
      if ((item as Record<string, unknown>)[m] === undefined) continue;
      const honoPath = path.replace(/\{(\w+)\}/g, ':$1');
      const handlers = api.routes.filter(
        (r) => r.method === m.toUpperCase() && r.path === honoPath,
      );
      const declared = handlers
        .map((r) => declaredRouteFeature(r.handler))
        .filter((f) => f !== undefined);
      expect(declared.length, `${m} ${path}`).toBeLessThanOrEqual(1);
      out.set(`${m.toUpperCase()} ${path}`, declared[0]);
    }
  }
  return out;
}

async function mcpFeatures(): Promise<Map<string, string | null>> {
  const { payload } = await mcpRequest(createWorld(), 'tools/list', {});
  const names = (payload.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  const declared = declaredToolFeatures();
  return new Map(names.map((n) => [n, declared.get(n) ?? null]));
}

describe('feature gate inventory', () => {
  it('upstream lists 100 features: 51 api:, 49 mcp:', () => {
    expect(UPSTREAM.size).toBe(100);
    expect([...UPSTREAM].filter((f) => f.startsWith('api:'))).toHaveLength(51);
    expect([...UPSTREAM].filter((f) => f.startsWith('mcp:'))).toHaveLength(49);
  });

  it('every REST route declares an upstream api: feature, each used once', () => {
    const features = restFeatures();
    expect(features.size).toBe(51);
    const used: string[] = [];
    for (const [op, f] of features) {
      if (UNGATED.has(op)) {
        expect(f, op).toBeUndefined();
        continue;
      }
      expect(typeof f, op).toBe('string');
      expect(UPSTREAM.has(f as string), `${op} -> ${f}`).toBe(true);
      expect((f as string).startsWith('api:'), op).toBe(true);
      used.push(f as string);
    }
    expect(new Set(used).size).toBe(used.length);
  });

  it('every MCP tool declares an upstream mcp: feature, each used once', async () => {
    const features = await mcpFeatures();
    expect(features.size).toBe(49);
    for (const [tool, f] of features) {
      expect(typeof f, tool).toBe('string');
      expect(UPSTREAM.has(f as string), `${tool} -> ${f}`).toBe(true);
      expect((f as string).startsWith('mcp:'), tool).toBe(true);
    }
    expect(new Set(features.values()).size).toBe(49);
  });
});

describe('DEFAULT_OWNER_FEATURES', () => {
  const SAFE_WRITES = new Set([
    'drafts:create',
    'drafts:update',
    'drafts:prepublish',
    'drafts:ai-detection',
  ]);
  const IMAGES = new Set(['api:images:create', 'mcp:images:upload']);
  const isRead = (name: string) =>
    /:(get|list)$/.test(name) || name.startsWith('stats:') || name.startsWith('posts:stats:');

  it('holds only upstream features', () => {
    for (const f of DEFAULT_OWNER_FEATURES) expect(UPSTREAM.has(f), f).toBe(true);
  });

  it('holds only reads, the safe draft writes, health:ready and the two image features', () => {
    for (const f of DEFAULT_OWNER_FEATURES) {
      if (IMAGES.has(f) || f === 'api:health:ready') continue;
      const name = f.replace(/^(api|mcp):/, '');
      expect(isRead(name) || SAFE_WRITES.has(name), f).toBe(true);
    }
  });

  it('holds every upstream read and safe draft write, in both forms where upstream has them', () => {
    for (const f of UPSTREAM) {
      const name = f.replace(/^(api|mcp):/, '');
      if (name.startsWith('health:live')) continue;
      if (isRead(name) || SAFE_WRITES.has(name) || IMAGES.has(f) || f === 'api:health:ready') {
        expect(DEFAULT_OWNER_FEATURES.has(f), f).toBe(true);
      }
    }
  });

  it('holds no notes, comments or posts writes and no draft delete/schedule/unschedule', () => {
    const forbidden = [...UPSTREAM].filter((f) => {
      const name = f.replace(/^(api|mcp):/, '');
      if (/^(notes|comments|posts):/.test(name) && !isRead(name)) return true;
      return ['drafts:delete', 'drafts:schedule', 'drafts:unschedule'].includes(name);
    });
    expect(forbidden.length).toBeGreaterThan(20);
    for (const f of forbidden) expect(DEFAULT_OWNER_FEATURES.has(f), f).toBe(false);
  });
});
