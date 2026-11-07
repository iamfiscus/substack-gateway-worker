// The fake Substack for the differential parity harness: a `createFakeSubstack`
// route table (test/support/fakeSubstack.ts) served over real HTTP, so the
// upstream Python gateway and this Worker (under `wrangler dev`) can both call it.
//
// Both gateways run with SUBSTACK_BASE_URL=http://127.0.0.1:7000 and every
// request carries the publication URL http://127.0.0.1:7000/pub, so global API
// calls land on /api/v1/* and publication calls on /pub/api/v1/*.
//
// Control endpoints (never called by a gateway):
//   POST /__control/mode   {"status": 200|404|500}  answer every route with this status
//   POST /__control/reset  → {"calls": [...]}       the calls recorded since the last reset

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createFakeSubstack, sample } from '../test/support/fakeSubstack.ts';

export const FAKE_PORT = 7000;
export const FAKE_HOST = `127.0.0.1:${FAKE_PORT}`;
export const FAKE_BASE_URL = `http://${FAKE_HOST}`;
export const PUBLICATION_URL = `${FAKE_BASE_URL}/pub`;

// IDs the matrix uses; each one has a canned response below.
export const IDS = {
  userId: 254824415,
  slug: 'jakubslys',
  noteId: 131648795,
  commentId: 131648795,
  postId: 987654,
  draftId: 189535264,
} as const;

export type RecordedCall = { method: string; path: string; query: string; body: unknown };

const S = (method: string, path: string) => `${method} ${FAKE_HOST}/api/v1/${path}`;
const P = (method: string, path: string) => `${method} ${FAKE_HOST}/pub/api/v1/${path}`;

const empty = () => new Response(null, { status: 200 });

function replies(): unknown {
  const page = sample('post/987654/comments') as { comments?: unknown[] };
  return { commentBranches: (page.comments ?? []).slice(0, 2).map((comment) => ({ comment })) };
}

/** Every Substack endpoint the 51 REST operations and 49 MCP tools reach. */
export function harnessRoutes(): Record<string, unknown> {
  const { userId, slug, noteId, commentId, postId, draftId } = IDS;
  const both = (method: string, path: string, value: unknown) => ({
    [S(method, path)]: value,
    [P(method, path)]: value,
  });
  return {
    // identity
    ...both('GET', 'handle/options', sample('handle/options')),
    ...both('GET', 'user-settings', {
      userSettings: [{ user_id: userId, type: 'default_byline', value_bool: true }],
    }),
    ...both('GET', 'feed/following', { items: [] }),
    ...both('GET', `user/${slug}/public_profile`, sample(`user/${slug}/public_profile`)),
    ...both('GET', `user/${userId}/subscriber-lists`, sample(`user/${userId}/subscriber-lists`)),
    // posts / profiles
    ...both('GET', 'profile/posts', sample('profile/posts')),
    ...both('GET', `posts/by-id/${postId}`, sample(`posts/by-id/${postId}`)),
    ...both('POST', `post/${postId}/reaction`, empty),
    ...both('DELETE', `post/${postId}/reaction`, empty),
    ...both('POST', 'restack/feed', { id: 1 }),
    // notes
    ...both('GET', 'notes', sample('notes')),
    ...both('GET', `reader/feed/profile/${userId}`, sample(`feed/profile/${userId}?types=note`)),
    ...both('GET', `reader/comment/${noteId}`, sample(`reader/comment/${noteId}`)),
    ...both('GET', `reader/comment/${noteId}/replies`, replies()),
    ...both('DELETE', `comment/${noteId}`, empty),
    ...both('POST', 'comment/attachment/', sample('comment/attachment-response')),
    ...both('POST', 'comment/feed/', sample('comment/response')),
    ...both('POST', `comment/${noteId}/reaction`, empty),
    ...both('DELETE', `comment/${noteId}/reaction`, empty),
    // comments
    ...both('GET', `post/${postId}/comments`, sample(`post/${postId}/comments`)),
    ...both('POST', `post/${postId}/comment`, {
      id: 131648796,
      body: 'Great post',
      post_id: postId,
      user_id: userId,
      date: '2024-01-15T11:00:00.000Z',
      name: 'Jakub',
      ancestor_path: '',
      type: 'comment',
      status: 'published',
      reaction_count: 0,
    }),
    ...both('DELETE', `comment/${commentId}`, empty),
    // drafts
    ...both('GET', 'post_management/drafts', sample('drafts/list-response')),
    ...both('GET', `drafts/${draftId}`, sample('draft/get-response')),
    ...both('PUT', `drafts/${draftId}`, sample('draft/get-response')),
    ...both('DELETE', `drafts/${draftId}`, empty),
    ...both('POST', 'drafts', sample('draft/response')),
    ...both('GET', `drafts/${draftId}/pangram_detection`, {
      type: 'ai',
      header: 'Fully AI-assisted text',
      details: 'details',
      fraction_ai: 1,
      fraction_ai_assisted: 0,
      fraction_human: 0,
      can_disable: true,
      can_modify_disclosure: false,
    }),
    ...both('GET', `drafts/${draftId}/prepublish`, { errors: [], suggestions: ['add a subtitle'] }),
    ...both('POST', `drafts/${draftId}/scheduled_release`, empty),
    ...both('DELETE', `drafts/${draftId}/scheduled_release`, empty),
    ...both('POST', 'image', {
      id: 303467639,
      url: 'https://substack-post-media.s3.amazonaws.com/public/images/e175.png',
      contentType: 'image/png',
      bytes: 72180,
      imageWidth: 2387,
      imageHeight: 203,
    }),
    // stats
    ...both(
      'GET',
      'publication/stats/subscribers/timeseries',
      sample('stats/subscribers-timeseries'),
    ),
    ...both('GET', 'publication/stats/arr/timeseries', sample('stats/arr-timeseries')),
    ...both('GET', 'publication/stats/emails/timeseries', sample('stats/emails-timeseries')),
    ...both('GET', 'publication/stats/publication_traffic/30d_views', sample('stats/30d-views')),
    ...both('GET', 'publish-dashboard/summary', sample('stats/dashboard-summary')),
    ...both('GET', 'publish-dashboard/summary-v2', sample('stats/dashboard-summary-v2')),
    ...both('GET', 'recommendations/stats/from', sample('stats/recommendations-from')),
    ...both('GET', 'recommendations/stats/to', sample('stats/recommendations-to')),
    ...both('GET', 'post_management/counts', sample('stats/post-counts')),
    ...Object.assign(
      {},
      ...['engagement', 'traffic', 'recipients', 'growth', 'discussion'].map((tab) =>
        both('GET', `post_management/detail/${postId}/${tab}`, sample(`post-stats/${tab}`)),
      ),
    ),
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function parseBody(raw: Buffer): unknown {
  if (raw.length === 0) return null;
  const text = raw.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function startFakeSubstackServer(port = FAKE_PORT): Server {
  const fake = createFakeSubstack(harnessRoutes());
  let mode = 200;
  let calls: RecordedCall[] = [];

  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? '/', FAKE_BASE_URL);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/__control/mode') {
      mode = Number((parseBody(raw) as { status?: number } | null)?.status ?? 200);
      return send(200, { mode });
    }
    if (url.pathname === '/__control/reset') {
      const out = calls;
      calls = [];
      return send(200, { calls: out });
    }

    calls.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      query: [...url.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).join('&'),
      body: parseBody(raw),
    });
    if (mode !== 200) {
      const error = mode === 404 ? 'Not found' : 'Internal error';
      return send(mode, { error });
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    const hasBody = raw.length > 0 && req.method !== 'GET' && req.method !== 'HEAD';
    const out = await fake(
      new Request(`http://${FAKE_HOST}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body: hasBody ? raw : undefined,
      }),
    );
    const text = await out.text();
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(text);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startFakeSubstackServer();
  console.log(`fake Substack listening on ${FAKE_BASE_URL}`);
}
