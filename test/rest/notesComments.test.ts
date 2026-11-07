import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { encodeCredentials, TEST_ENV } from '../bdd/steps/common';
import { createFakeSubstack, sample } from '../support/fakeSubstack';

const TOKEN = encodeCredentials({
  publication_url: 'https://example.substack.com',
  substack_sid: 's',
  connect_sid: 'c',
});

async function get(routes: Record<string, unknown>, path: string) {
  const app = createApp({ fetcher: createFakeSubstack(routes) });
  const res = await app.request(path, { headers: { 'x-gateway-token': TOKEN } }, TEST_ENV);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const READER = 'GET example.substack.com/api/v1/reader/comment';

describe('notes and comments read edges', () => {
  it('serves a note with exclude_none: no author key when the note has no users', async () => {
    const item = (sample('reader/comment/131648795') as { item: { context: object } }).item;
    const noUsers = { item: { ...item, context: { timestamp: 't', users: [] } } };
    const { status, body } = await get({ [`${READER}/5`]: noUsers }, '/api/v1/notes/5');
    expect(status).toBe(200);
    expect(body).toEqual({
      id: 131648795,
      body: 'This is a sample note body.',
      likes_count: 5,
      published_at: 't',
    });
  });

  it('derives parent_id from the last ancestor_path segment and omits nulls', async () => {
    const replies = {
      commentBranches: [{ comment: { id: 9, body: 'r', ancestor_path: '3.7', name: 'Ann' } }],
    };
    const note = await get({ [`${READER}/7/replies`]: replies }, '/api/v1/comments/7/comments');
    expect(note.body).toEqual({
      items: [{ id: 9, body: 'r', parent_id: 7, deleted: false, author_name: 'Ann' }],
    });
  });

  it('lists note replies from the global host', async () => {
    const replies = { commentBranches: [{ comment: { id: 1, body: 'a' } }] };
    const { status, body } = await get(
      { 'GET substack.com/api/v1/reader/comment/7/replies': replies },
      '/api/v1/notes/7/comments',
    );
    expect(status).toBe(200);
    expect(body).toEqual({ items: [{ id: 1, body: 'a', deleted: false }] });
  });

  it('keeps nulls for post comments and defaults is_admin to false', async () => {
    const { body } = await get(
      { 'GET example.substack.com/api/v1/post/4/comments': { comments: [{ id: 1, body: 'x' }] } },
      '/api/v1/posts/4/comments',
    );
    expect(body).toEqual({
      items: [
        {
          id: 1,
          body: 'x',
          is_admin: false,
          author_name: null,
          author_handle: null,
          user_id: null,
        },
      ],
    });
  });

  it.each([
    ['/api/v1/notes/5', `${READER}/5`, { unexpected: true }],
    ['/api/v1/comments/5', `${READER}/5`, { unexpected: true }],
    ['/api/v1/comments/5/comments', `${READER}/5/replies`, { commentBranches: [{ id: 1 }] }],
    [
      '/api/v1/posts/5/comments',
      'GET example.substack.com/api/v1/post/5/comments',
      { comments: [{ id: 1 }] },
    ],
  ])('%s maps a malformed Substack body to 502', async (path, route, bad) => {
    const { status } = await get({ [route]: bad }, path);
    expect(status).toBe(502);
  });

  it('maps a reader response without a comment to 502 for the comment route', async () => {
    const item = (sample('reader/comment/131648795') as { item: object }).item;
    const { status } = await get(
      { [`${READER}/5`]: { item: { ...item, comment: null } } },
      '/api/v1/comments/5',
    );
    expect(status).toBe(502);
  });

  it('rejects a non-positive id with 422', async () => {
    expect((await get({}, '/api/v1/notes/0')).status).toBe(422);
    expect((await get({}, '/api/v1/comments/abc')).status).toBe(422);
  });
});
