import { describe, expect, it } from 'vitest';
import { createWorld, encodeCredentials, loadSample, type World } from '../bdd/steps/common';
import { callTool, mcpRequest } from '../bdd/steps/mcp';

const TOKEN = encodeCredentials({
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
});

function world(): World {
  const w = createWorld();
  w.publicationUrl = 'https://example.substack.com';
  w.mcpToken = TOKEN;
  w.routes['GET substack.com/api/v1/handle/options'] = loadSample('handle/options');
  w.routes['GET substack.com/api/v1/user/jakubslys/public_profile'] = loadSample(
    'user/jakubslys/public_profile',
  );
  w.routes['GET substack.com/api/v1/user-settings'] = {
    userSettings: [{ user_id: 254824415, type: 'x' }],
  };
  w.routes['GET example.substack.com/api/v1/user/254824415/subscriber-lists'] = loadSample(
    'user/254824415/subscriber-lists',
  );
  w.routes['GET example.substack.com/api/v1/notes'] = loadSample('notes');
  w.routes['GET substack.com/api/v1/profile/posts'] = loadSample('profile/posts');
  return w;
}

describe('read tools over /mcp', () => {
  it('registers the eight read tools with upstream annotations and meta', async () => {
    const { payload } = await mcpRequest(world(), 'tools/list', {});
    const tools = (payload.result as { tools: Record<string, unknown>[] }).tools;
    const byName = new Map(tools.map((t) => [t.name as string, t]));
    for (const name of [
      'get_profile',
      'get_profile_posts',
      'get_profile_notes',
      'get_post',
      'get_me',
      'get_my_notes',
      'get_my_posts',
      'get_my_following',
    ]) {
      const t = byName.get(name) as Record<string, unknown>;
      expect(t, name).toBeDefined();
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
    const profile = byName.get('get_profile') as {
      inputSchema: { properties: object };
      _meta: object;
    };
    expect(Object.keys(profile.inputSchema.properties)).toEqual(['slug']); // anonymous: no token
    expect(profile._meta).toEqual({
      category: 'profiles',
      substack_endpoint: 'GET /user/{slug}/public_profile',
      fastmcp: { tags: ['profiles', 'read'] },
    });
    const me = byName.get('get_my_posts') as {
      inputSchema: { properties: Record<string, unknown> };
    };
    expect(Object.keys(me.inputSchema.properties).sort()).toEqual(['cursor', 'limit', 'token']);
  });

  it('get_me, get_my_notes, get_my_posts and get_my_following return their pages', async () => {
    const w = world();
    expect((await callTool(w, 'get_me', {})).result).toMatchObject({ handle: 'jakubslys' });
    expect((await callTool(w, 'get_my_notes', {})).result?.items).toHaveLength(20);
    expect((await callTool(w, 'get_my_posts', {})).result?.items).toHaveLength(1);
    expect((await callTool(w, 'get_my_following', {})).result?.items).toEqual([
      { id: 111111, handle: 'anotheruser' },
      { id: 222222, handle: 'bob' },
    ]);
  });

  it('get_my_posts sends the cursor to Substack as next_cursor', async () => {
    const w = world();
    await callTool(w, 'get_my_posts', { limit: 5, cursor: 'abc' });
    const call = w.fake?.calls.find((r) => new URL(r.url).pathname.endsWith('/profile/posts'));
    const q = new URL(call?.url ?? '').searchParams;
    expect(q.get('next_cursor')).toBe('abc');
    expect(q.get('cursor')).toBeNull();
    expect(q.get('limit')).toBe('5');
    expect(q.get('profile_user_id')).toBe('254824415');
  });

  it('get_my_following surfaces a Substack failure as a tool error', async () => {
    const w = world();
    w.routes['GET substack.com/api/v1/user-settings'] = () => new Response(null, { status: 503 });
    const out = await callTool(w, 'get_my_following', {});
    expect(out.isError).toBe(true);
    expect(out.text).toContain("Error calling tool 'get_my_following'");
  });

  it('profile tools send no cookies', async () => {
    const w = world();
    await callTool(w, 'get_profile', { slug: 'jakubslys' }, { withToken: false });
    const cookie = w.fake?.calls[0]?.headers.get('cookie');
    expect(cookie).toBe('substack.sid=; connect.sid=');
  });
});

describe('profile route inputs', () => {
  it('encodes the slug as one path segment', async () => {
    const w = world();
    await callTool(w, 'get_profile', { slug: 'a/b?x=1' }, { withToken: false });
    expect(w.fake?.calls[0]?.url).toBe(
      'https://substack.com/api/v1/user/a%2Fb%3Fx%3D1/public_profile',
    );
  });
});
