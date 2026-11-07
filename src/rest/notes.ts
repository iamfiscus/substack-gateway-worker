// Read routes of gateway_notes_rest/router.py (upstream bc2e875).
// create/delete/like/unlike/reply arrive in Task 9/10.

import { createRoute, z } from '@hono/zod-openapi';
import { NoteGetResponse, NoteRepliesResponse } from '../schemas/notes';
import { getNote, listNoteReplies } from '../services/notes';
import { restRoute } from './credentials';
import { createRouter } from './errors';

const tokenHeader = z.object({ 'x-gateway-token': z.string().optional() });
const noteIdParam = z.object({ note_id: z.coerce.number().int().gt(0) });
const ok = (schema: z.ZodType) => ({
  description: 'Successful Response',
  content: { 'application/json': { schema } },
});

const getRoute = createRoute({
  method: 'get',
  path: '/notes/{note_id}',
  tags: ['notes'],
  summary: 'Get Note',
  description: 'Return a single Substack note by its ID.',
  request: { headers: tokenHeader, params: noteIdParam },
  responses: { 200: ok(NoteGetResponse) },
});

const repliesRoute = createRoute({
  method: 'get',
  path: '/notes/{note_id}/comments',
  tags: ['notes'],
  summary: 'List Note Replies',
  description: 'List direct replies to a note (or any node in its thread).',
  request: { headers: tokenHeader, params: noteIdParam },
  responses: { 200: ok(NoteRepliesResponse) },
});

export const notesRouter = createRouter()
  .openapi(
    getRoute,
    restRoute<typeof getRoute>('api:notes:get', async (c, { creds, ctx }) =>
      c.json(await getNote(ctx, creds, { noteId: c.req.valid('param').note_id }), 200),
    ),
  )
  .openapi(
    repliesRoute,
    restRoute<typeof repliesRoute>('api:notes:replies:list', async (c, { creds, ctx }) =>
      c.json(await listNoteReplies(ctx, creds, { noteId: c.req.valid('param').note_id }), 200),
    ),
  );
