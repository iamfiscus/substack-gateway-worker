// Port of gateway_profiles_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import { NotesPageResponse } from '../schemas/notes';
import { CursorLimitPageQuery, CursorPageQuery } from '../schemas/pagination';
import { PostsPageResponse } from '../schemas/posts';
import { ProfileResponse } from '../schemas/profiles';
import { getProfile, getProfileNotes, getProfilePosts } from '../services/profiles';
import { restRoute } from './credentials';
import { createRouter } from './errors';

const tokenHeader = z.object({ 'x-gateway-token': z.string().optional() });
const slugParam = z.object({ slug: z.string() });
const ok = (schema: z.ZodType) => ({
  description: 'Successful Response',
  content: { 'application/json': { schema } },
});

const getRoute = createRoute({
  method: 'get',
  path: '/profiles/{slug}',
  tags: ['profiles'],
  summary: 'Get Profile',
  description: "Return a Substack user's public profile by their handle slug.",
  request: { headers: tokenHeader, params: slugParam },
  responses: { 200: ok(ProfileResponse) },
});

const postsRoute = createRoute({
  method: 'get',
  path: '/profiles/{slug}/posts',
  tags: ['profiles'],
  summary: 'Get Profile Posts',
  description: 'Return a page of posts for the given profile slug.',
  request: { headers: tokenHeader, params: slugParam, query: CursorLimitPageQuery },
  responses: { 200: ok(PostsPageResponse) },
});

const notesRoute = createRoute({
  method: 'get',
  path: '/profiles/{slug}/notes',
  tags: ['profiles'],
  summary: 'Get Profile Notes',
  description: 'Return a page of notes for the given profile slug.',
  request: { headers: tokenHeader, params: slugParam, query: CursorPageQuery },
  responses: { 200: ok(NotesPageResponse) },
});

export const profilesRouter = createRouter()
  .openapi(
    getRoute,
    restRoute<typeof getRoute>('api:profiles:get', async (c, { creds, ctx }) =>
      c.json(await getProfile(ctx, creds, c.req.valid('param')), 200),
    ),
  )
  .openapi(
    postsRoute,
    restRoute<typeof postsRoute>('api:profiles:posts:list', async (c, { creds, ctx }) => {
      const { slug } = c.req.valid('param');
      const { limit, cursor } = c.req.valid('query');
      return c.json(await getProfilePosts(ctx, creds, { slug, limit, cursor }), 200);
    }),
  )
  .openapi(
    notesRoute,
    restRoute<typeof notesRoute>('api:profiles:notes:list', async (c, { creds, ctx }) => {
      const { slug } = c.req.valid('param');
      const { cursor } = c.req.valid('query');
      return c.json(await getProfileNotes(ctx, creds, { slug, cursor }), 200);
    }),
  );
