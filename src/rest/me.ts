// Port of gateway_me_rest/router.py (upstream bc2e875).

import { createRoute } from '@hono/zod-openapi';
import { NotesPageResponse } from '../schemas/notes';
import { CursorLimitPageQuery, CursorPageQuery } from '../schemas/pagination';
import { PostsPageResponse } from '../schemas/posts';
import { ProfileResponse } from '../schemas/profiles';
import { getMe, getMyNotes, getMyPosts } from '../services/me';
import { restRoute } from './credentials';
import { createRouter } from './errors';
import { ok, tokenHeader } from './openapi';

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['me'],
  summary: 'Get Me',
  description: "Return the authenticated user's own Substack profile.",
  request: { headers: tokenHeader },
  responses: { 200: ok(ProfileResponse) },
});

const notesRoute = createRoute({
  method: 'get',
  path: '/me/notes',
  tags: ['me'],
  summary: 'Get Me Notes',
  description: "Return a page of the authenticated user's own notes.",
  request: { headers: tokenHeader, query: CursorPageQuery },
  responses: { 200: ok(NotesPageResponse) },
});

const postsRoute = createRoute({
  method: 'get',
  path: '/me/posts',
  tags: ['me'],
  summary: 'Get Me Posts',
  description: "Return a page of the authenticated user's own posts.",
  request: { headers: tokenHeader, query: CursorLimitPageQuery },
  responses: { 200: ok(PostsPageResponse) },
});

export const meRouter = createRouter()
  .openapi(
    meRoute,
    restRoute<typeof meRoute>('api:me:get', async (c, { creds, ctx }) =>
      c.json(await getMe(ctx, creds), 200),
    ),
  )
  .openapi(
    notesRoute,
    restRoute<typeof notesRoute>('api:me:notes:list', async (c, { creds, ctx }) =>
      c.json(await getMyNotes(ctx, creds, c.req.valid('query')), 200),
    ),
  )
  .openapi(
    postsRoute,
    restRoute<typeof postsRoute>('api:me:posts:list', async (c, { creds, ctx }) =>
      c.json(await getMyPosts(ctx, creds, c.req.valid('query')), 200),
    ),
  );
