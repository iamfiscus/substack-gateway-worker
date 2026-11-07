import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { MAX_NOTE_CONTENT_CHARS } from '../../src/schemas/notes';
import { createWorld, encodeCredentials, TEST_ENV, type World } from '../bdd/steps/common';
import { callTool, mcpRequest } from '../bdd/steps/mcp';
import { createFakeSubstack, sample } from '../support/fakeSubstack';

const TOKEN = encodeCredentials({
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
});
const PUB = 'example.substack.com/api/v1';
const GLOBAL = 'substack.com/api/v1';
const MAX = MAX_NOTE_CONTENT_CHARS;

async function call(routes: Record<string, unknown>, method: string, path: string, body?: unknown) {
  const fake = createFakeSubstack(routes);
  const app = createApp({ fetcher: fake });
  const headers: Record<string, string> = { 'x-gateway-token': TOKEN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(
    path,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    TEST_ENV,
  );
  const text = await res.text();
  const sent = await Promise.all(
    fake.calls.map(async (r) => {
      const raw = await r.text();
      const u = new URL(r.url);
      return {
        method: r.method,
        url: u.host + u.pathname,
        body: raw ? (JSON.parse(raw) as unknown) : null,
      };
    }),
  );
  return { status: res.status, body: text ? JSON.parse(text) : null, sent };
}

function mcpWorld(routes: Record<string, unknown>): World {
  const w = createWorld();
  w.publicationUrl = 'https://example.substack.com';
  w.mcpToken = TOKEN;
  w.routes = routes;
  return w;
}

const FEED = `POST ${GLOBAL}/comment/feed/`;
const CREATED = sample('comment/response');

describe('create note', () => {
  it('posts the converted payload, with the attachment id after registering the link', async () => {
    const r = await call(
      {
        [`POST ${GLOBAL}/comment/attachment/`]: sample('comment/attachment-response'),
        [FEED]: CREATED,
      },
      'POST',
      '/api/v1/notes',
      { content: 'Hello **world**.', attachment: 'https://substack.com' },
    );
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: 131648796 });
    expect(r.sent.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST substack.com/api/v1/comment/attachment/',
      'POST substack.com/api/v1/comment/feed/',
    ]);
    expect(r.sent[0]?.body).toEqual({ url: 'https://substack.com', type: 'link' });
    expect(r.sent[1]?.body).toMatchObject({
      attachmentIds: ['550e8400-e29b-41d4-a716-446655440000'],
      tabId: 'for-you',
      surface: 'feed',
    });
  });

  it('sends no attachmentIds without an attachment', async () => {
    const r = await call({ [FEED]: CREATED }, 'POST', '/api/v1/notes', { content: 'hi' });
    expect(r.sent[0]?.body).not.toHaveProperty('attachmentIds');
  });

  it('does not register an attachment when the content is empty', async () => {
    const r = await call({}, 'POST', '/api/v1/notes', {
      content: '  ',
      attachment: 'https://substack.com',
    });
    expect(r.status).toBe(400);
    expect(r.sent).toHaveLength(0);
  });

  it('reads a Substack body without an id as a 502, not a crash', async () => {
    const r = await call({ [FEED]: { status: 'x' } }, 'POST', '/api/v1/notes', { content: 'hi' });
    expect(r.status).toBe(502);
  });

  it('accepts exactly the cap and rejects one character more with a 422 detail', async () => {
    const ok = await call({ [FEED]: CREATED }, 'POST', '/api/v1/notes', {
      content: 'a'.repeat(MAX),
    });
    expect(ok.status).toBe(201);
    const tooLong = await call({ [FEED]: CREATED }, 'POST', '/api/v1/notes', {
      content: 'a'.repeat(MAX + 1),
    });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body).toEqual({
      detail: [
        {
          loc: ['json', 'content'],
          msg: `String should have at most ${MAX} characters`,
          type: 'too_big',
        },
      ],
    });
    expect(tooLong.sent).toHaveLength(0);
  });

  it('counts code points, not UTF-16 units, against the cap', async () => {
    const r = await call({ [FEED]: CREATED }, 'POST', '/api/v1/notes', {
      content: '😀'.repeat(MAX),
    });
    expect(r.status).toBe(201);
  });

  it('rejects a missing content field with 422', async () => {
    const r = await call({}, 'POST', '/api/v1/notes', {});
    expect(r.status).toBe(422);
  });
});

describe('note engagement bodies', () => {
  it('likes with a null publication id and the heart', async () => {
    const r = await call(
      { [`POST ${GLOBAL}/comment/9/reaction`]: {} },
      'PUT',
      '/api/v1/notes/9/like',
    );
    expect(r.status).toBe(204);
    expect(r.sent[0]?.body).toEqual({ publication_id: null, reaction: '❤' });
  });

  it('unlikes with a JSON body that carries tabId for-you', async () => {
    const r = await call(
      { [`DELETE ${GLOBAL}/comment/9/reaction`]: {} },
      'DELETE',
      '/api/v1/notes/9/like',
    );
    expect(r.status).toBe(204);
    expect(r.sent[0]?.method).toBe('DELETE');
    expect(r.sent[0]?.body).toEqual({ publication_id: null, reaction: '❤', tabId: 'for-you' });
  });

  it('replies with parent_id added to the converted payload', async () => {
    const r = await call({ [FEED]: CREATED }, 'POST', '/api/v1/notes/9/comments', { body: 'nice' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({
      id: 131648796,
      date: '2024-01-15T11:00:00.000Z',
      status: 'published',
    });
    expect(r.sent[0]?.body).toMatchObject({ parent_id: 9, tabId: 'for-you' });
  });

  it('answers 422 for an empty reply body, 400 for a whitespace-only one', async () => {
    expect((await call({}, 'POST', '/api/v1/notes/9/comments', { body: '' })).status).toBe(422);
    expect((await call({}, 'POST', '/api/v1/notes/9/comments', { body: '  ' })).status).toBe(400);
  });

  it('caps reply bodies', async () => {
    const r = await call({}, 'POST', '/api/v1/notes/9/comments', { body: 'a'.repeat(MAX + 1) });
    expect(r.status).toBe(422);
    expect(r.body.detail[0]).toMatchObject({ loc: ['json', 'body'], type: 'too_big' });
  });
});

describe('comment writes', () => {
  it('creates and replies with the upstream bodies', async () => {
    const reader = {
      item: {
        entity_key: 'k',
        context: { timestamp: 't', users: [] },
        post: { id: 77, title: 'p', post_date: 't' },
        comment: { id: 42, body: 'parent' },
      },
    };
    const routes = {
      [`GET ${PUB}/reader/comment/42`]: reader,
      [`POST ${PUB}/post/77/comment`]: { id: 901, body: 're', ancestor_path: '42' },
    };
    const r = await call(routes, 'POST', '/api/v1/comments/42/comments', { body: 're' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: 901, body: 're', parent_id: 42, deleted: false });
    expect(r.sent[1]?.body).toEqual({ body: 're', parent_id: 42 });
  });

  it('answers 404 when the parent comment has no post, apart from the 502 for a missing comment', async () => {
    const noPost = {
      item: {
        entity_key: 'k',
        context: { timestamp: 't', users: [] },
        comment: { id: 42, body: 'x' },
      },
    };
    const missingPost = await call(
      { [`GET ${PUB}/reader/comment/42`]: noPost },
      'POST',
      '/api/v1/comments/42/comments',
      { body: 're' },
    );
    expect(missingPost.status).toBe(404);
    expect(missingPost.body).toEqual({ detail: 'comment 42 has no associated post' });

    const noComment = {
      item: { entity_key: 'k', context: { timestamp: 't', users: [] } },
    };
    const read = await call(
      { [`GET ${PUB}/reader/comment/42`]: noComment },
      'GET',
      '/api/v1/comments/42',
    );
    expect(read.status).toBe(502);
  });

  it('likes and unlikes with the same reaction body and no tabId', async () => {
    const routes = {
      [`POST ${PUB}/comment/42/reaction`]: { ok: true },
      [`DELETE ${PUB}/comment/42/reaction`]: { ok: true },
    };
    const like = await call(routes, 'POST', '/api/v1/comments/42/reaction');
    const unlike = await call(routes, 'DELETE', '/api/v1/comments/42/reaction');
    expect(like.sent[0]?.body).toEqual({ publication_id: null, reaction: '❤' });
    expect(unlike.sent[0]?.body).toEqual({ publication_id: null, reaction: '❤' });
  });

  it('rejects an empty comment body with 422', async () => {
    const r = await call({}, 'POST', '/api/v1/posts/55/comments', { body: '' });
    expect(r.status).toBe(422);
  });
});

describe('post writes', () => {
  it('sends the reader-surface like, an empty-object unlike and the restack body', async () => {
    const routes = {
      [`POST ${GLOBAL}/post/5/reaction`]: {},
      [`DELETE ${GLOBAL}/post/5/reaction`]: {},
      [`POST ${GLOBAL}/restack/feed`]: {},
    };
    const like = await call(routes, 'PUT', '/api/v1/posts/5/like');
    const unlike = await call(routes, 'DELETE', '/api/v1/posts/5/like');
    const restack = await call(routes, 'POST', '/api/v1/posts/5/restack');
    expect(like.sent[0]?.body).toEqual({ reaction: '❤', surface: 'reader' });
    expect(unlike.sent[0]?.body).toEqual({});
    expect(restack.sent[0]?.body).toEqual({ postId: 5, commentId: null });
  });
});

describe('write tools over /mcp', () => {
  it('registers the write tools with upstream annotations', async () => {
    const { payload } = await mcpRequest(mcpWorld({}), 'tools/list', {});
    const tools = (payload.result as { tools: Record<string, unknown>[] }).tools;
    const byName = new Map(tools.map((t) => [t.name as string, t]));
    const expected: Record<string, [boolean, boolean]> = {
      create_note: [false, false],
      delete_note: [true, true],
      like_note: [false, true],
      unlike_note: [false, true],
      reply_to_note: [false, false],
      create_post_comment: [false, false],
      reply_to_post_comment: [false, false],
      delete_post_comment: [true, true],
      like_post_comment: [false, true],
      unlike_post_comment: [true, true],
      like_post: [false, true],
      unlike_post: [true, true],
      restack_post: [false, false],
    };
    for (const [name, [destructive, idempotent]] of Object.entries(expected)) {
      const t = byName.get(name) as { annotations: object; inputSchema: { properties: object } };
      expect(t, name).toBeDefined();
      expect(t.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: destructive,
        idempotentHint: idempotent,
        openWorldHint: true,
      });
      expect(t.inputSchema.properties, name).toHaveProperty('token');
    }
  });

  it('create_note returns {id} and delete_note a confirmation', async () => {
    const w = mcpWorld({ [FEED]: CREATED, [`DELETE ${PUB}/comment/7`]: {} });
    expect((await callTool(w, 'create_note', { content: 'hi' })).result).toEqual({
      id: 131648796,
    });
    expect((await callTool(w, 'delete_note', { note_id: 7 })).text).toBe(
      'Note 7 deleted successfully.',
    );
  });

  it('create_note reports empty content and over-cap content as tool errors', async () => {
    const w = mcpWorld({ [FEED]: CREATED });
    const empty = await callTool(w, 'create_note', { content: '' });
    expect(empty.isError).toBe(true);
    expect(empty.text).toContain('Note body cannot be empty');
    const big = await callTool(w, 'create_note', { content: 'a'.repeat(MAX + 1) });
    expect(big.isError).toBe(true);
    expect(big.text).toContain(`at most ${MAX} characters`);
    expect(w.fake?.calls).toHaveLength(0);
  });

  it('reply_to_note applies the same cap', async () => {
    const out = await callTool(mcpWorld({ [FEED]: CREATED }), 'reply_to_note', {
      note_id: 1,
      body: 'a'.repeat(MAX + 1),
    });
    expect(out.isError).toBe(true);
    expect(out.text).toContain(`at most ${MAX} characters`);
  });

  it('reply_to_post_comment surfaces the not-found message as a tool error', async () => {
    const noPost = {
      item: {
        entity_key: 'k',
        context: { timestamp: 't', users: [] },
        comment: { id: 42, body: 'x' },
      },
    };
    const out = await callTool(
      mcpWorld({ [`GET ${PUB}/reader/comment/42`]: noPost }),
      'reply_to_post_comment',
      { comment_id: 42, body: 're' },
    );
    expect(out.isError).toBe(true);
    expect(out.text).toContain('comment 42 has no associated post');
  });
});

describe('204 responses', () => {
  // Parity (Task 20 harness): FastAPI's Response(status_code=204) keeps its
  // default `application/json` media type.
  it.each([
    ['DELETE', '/api/v1/notes/42', `DELETE ${PUB}/comment/42`],
    ['PUT', '/api/v1/notes/42/like', `POST ${GLOBAL}/comment/42/reaction`],
    ['DELETE', '/api/v1/drafts/7/schedule', `DELETE ${PUB}/drafts/7/scheduled_release`],
  ])('%s %s answers 204 with content-type application/json', async (method, path, route) => {
    const app = createApp({ fetcher: createFakeSubstack({ [route]: {} }) });
    const res = await app.request(
      path,
      { method, headers: { 'x-gateway-token': TOKEN } },
      TEST_ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('');
  });
});
