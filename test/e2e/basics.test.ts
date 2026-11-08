// Ported from upstream e2e: root.feature, health.feature, me.feature, profiles.feature,
// posts.feature, notes.feature (read parts), mcp.feature.
import { describe, expect, it } from 'vitest';
import {
  enabled,
  expectStatus,
  get,
  mcp,
  mcpInitialize,
  NOTE_ID,
  POST_ID,
  PROFILE_SLUG,
} from './support';

describe.skipIf(!enabled)('e2e: read endpoints', () => {
  it('root metadata returns application info', async () => {
    const r = await get('/', false);
    expectStatus(r, 200);
    expect(r.json().application).toBe('substack-gateway');
    expect(Array.isArray(r.json().modules)).toBe(true);
  });

  it('liveness probe returns 200', async () => {
    const r = await get('/api/v1/health/live', false);
    expectStatus(r, 200);
    expect(r.json()).toHaveProperty('status');
  });

  it('readiness probe with valid credentials returns 200', async () => {
    const r = await get('/api/v1/health/ready');
    expectStatus(r, 200);
    expect(r.json()).toHaveProperty('connected');
  });

  it('gets own profile', async () => {
    const r = await get('/api/v1/me');
    expectStatus(r, 200);
    expect(r.json()).toHaveProperty('id');
    expect(r.json()).toHaveProperty('name');
  });

  it.each(['notes', 'posts', 'following'])('lists own %s', async (what) => {
    const r = await get(`/api/v1/me/${what}`);
    expectStatus(r, 200);
    expect(Array.isArray(r.json().items)).toBe(true);
  });

  describe.skipIf(!PROFILE_SLUG)('profiles (E2E_PROFILE_SLUG)', () => {
    it('gets profile by slug', async () => {
      const r = await get(`/api/v1/profiles/${PROFILE_SLUG}`);
      expectStatus(r, 200);
      for (const f of ['id', 'name', 'audience']) expect(r.json()).toHaveProperty(f);
    });
    it.each(['posts', 'notes'])('gets profile %s', async (what) => {
      const r = await get(`/api/v1/profiles/${PROFILE_SLUG}/${what}`);
      expectStatus(r, 200);
      expect(Array.isArray(r.json().items)).toBe(true);
    });
  });

  describe.skipIf(!POST_ID)('posts (E2E_POST_ID)', () => {
    it('gets post by ID', async () => {
      const r = await get(`/api/v1/posts/${POST_ID}`);
      expectStatus(r, 200);
      for (const f of ['id', 'title', 'html_body', 'markdown']) expect(r.json()).toHaveProperty(f);
    });
    it('gets post comments', async () => {
      const r = await get(`/api/v1/posts/${POST_ID}/comments`);
      expectStatus(r, 200);
      expect(Array.isArray(r.json().items)).toBe(true);
    });
  });

  describe.skipIf(!NOTE_ID)('notes (E2E_NOTE_ID)', () => {
    it('gets note by ID', async () => {
      const r = await get(`/api/v1/notes/${NOTE_ID}`);
      expectStatus(r, 200);
      expect(r.json()).toHaveProperty('id');
    });
  });

  describe('MCP public tools', () => {
    it('initializes and lists public tools', async () => {
      const sid = await mcpInitialize();
      const { reply, payload } = await mcp('tools/list', 2, {}, sid);
      expectStatus(reply, 200);
      const names = payload.result.tools.map((t: { name: string }) => t.name);
      for (const n of [
        'get_note',
        'get_post',
        'get_post_comments',
        'get_profile',
        'get_profile_posts',
        'get_profile_notes',
      ]) {
        expect(names).toContain(n);
      }
    });

    it.skipIf(!PROFILE_SLUG || !POST_ID || !NOTE_ID)(
      'calls public MCP tools over HTTP',
      async () => {
        const sid = await mcpInitialize();
        const calls: [string, Record<string, unknown>][] = [
          ['get_profile', { slug: PROFILE_SLUG }],
          ['get_post', { post_id: Number(POST_ID) }],
          ['get_note', { note_id: Number(NOTE_ID) }],
          ['get_post_comments', { post_id: Number(POST_ID) }],
        ];
        let id = 3;
        for (const [name, args] of calls) {
          const { reply, payload } = await mcp('tools/call', id++, { name, arguments: args }, sid);
          expectStatus(reply, 200);
          expect(payload.error).toBeUndefined();
          const r = payload.result;
          expect(r.structuredContent != null || (r.content ?? []).length > 0).toBe(true);
        }
      },
    );
  });
});
