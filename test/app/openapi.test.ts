// GET /api/openapi.json and GET /api/docs: the document matches upstream
// docs/api-reference.md (bc2e875, copied to test/fixtures/upstream-docs/).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { createApp } from '../../src/app';
import { TEST_ENV } from '../bdd/steps/common';

const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const app = createApp();
const get = (path: string, env = TEST_ENV, headers: Record<string, string> = {}) =>
  app.request(path, { headers }, env);

type Doc = { info: { title: string; version: string }; paths: Record<string, object> };

describe('GET /api/openapi.json', () => {
  it('has 51 operations covering every path in upstream api-reference.md', async () => {
    const res = await get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const doc = (await res.json()) as Doc;
    expect(doc.info.title).toBe('Substack Gateway');
    expect(doc.info.version).toBe(pkg.version);
    const ops = Object.entries(doc.paths).flatMap(([p, item]) =>
      METHODS.filter((m) => m in item).map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(ops).toHaveLength(51);
    const text = readFileSync('test/fixtures/upstream-docs/api-reference.md', 'utf8');
    const documented = [...text.matchAll(/^### `(GET|POST|PUT|DELETE) (\S+)`/gm)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(documented.length).toBeGreaterThan(0);
    for (const op of documented) expect(ops).toContain(op);
  });
});

describe('GET /api/docs', () => {
  it('serves Swagger UI HTML pointing at the document', async () => {
    const res = await get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('/api/openapi.json');
  });
});

describe('docs endpoint access', () => {
  const keyed = { ...TEST_ENV, GATEWAY_API_KEYS: 'ci:abc' };
  it('is public when GATEWAY_API_KEYS is unset', async () => {
    expect((await get('/api/docs')).status).toBe(200);
    expect((await get('/api/openapi.json')).status).toBe(200);
  });
  it('requires a gateway key when GATEWAY_API_KEYS is set', async () => {
    for (const path of ['/api/docs', '/api/openapi.json']) {
      expect((await get(path, keyed)).status).toBe(401);
      expect((await get(path, keyed, { authorization: 'Bearer abc' })).status).toBe(200);
    }
  });
});
