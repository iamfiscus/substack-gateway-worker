// Routes of gateway_notes_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import { NoteMarkdownError } from '../converters/noteMarkdown';
import {
  CreateNoteRequest,
  CreateNoteResponse,
  NoteGetResponse,
  NoteRepliesResponse,
  NoteReplyCreatedResponse,
  NoteReplyRequest,
} from '../schemas/notes';
import {
  createNote,
  deleteNote,
  getNote,
  likeNote,
  listNoteReplies,
  replyToNote,
  unlikeNote,
} from '../services/notes';
import { restRoute } from './credentials';
import { createRouter, HttpError } from './errors';
import { jsonBody, noContent, ok, tokenHeader } from './openapi';

const noteIdParam = z.object({ note_id: z.coerce.number().int().gt(0) });

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

const deleteRoute = createRoute({
  method: 'delete',
  path: '/notes/{note_id}',
  tags: ['notes'],
  summary: 'Delete Note',
  description: 'Delete a Substack note by its ID.',
  request: { headers: tokenHeader, params: noteIdParam },
  responses: noContent,
});

const createRoute_ = createRoute({
  method: 'post',
  path: '/notes',
  tags: ['notes'],
  summary: 'Create Note',
  description: 'Convert markdown content to a Substack note and publish it.',
  request: { headers: tokenHeader, body: jsonBody(CreateNoteRequest) },
  responses: { 201: { ...ok(CreateNoteResponse), description: 'Successful Response' } },
});

const likeRoute = createRoute({
  method: 'put',
  path: '/notes/{note_id}/like',
  tags: ['notes'],
  summary: 'Like Note',
  description: 'Add a like to a Substack note.',
  request: { headers: tokenHeader, params: noteIdParam },
  responses: noContent,
});

const unlikeRoute = createRoute({
  method: 'delete',
  path: '/notes/{note_id}/like',
  tags: ['notes'],
  summary: 'Unlike Note',
  description: 'Remove a like from a Substack note.',
  request: { headers: tokenHeader, params: noteIdParam },
  responses: noContent,
});

const replyRoute = createRoute({
  method: 'post',
  path: '/notes/{note_id}/comments',
  tags: ['notes'],
  summary: 'Reply To Note',
  description: 'Reply to a note or to any comment in a note thread.',
  request: { headers: tokenHeader, params: noteIdParam, body: jsonBody(NoteReplyRequest) },
  responses: { 201: ok(NoteReplyCreatedResponse) },
});

export const notesRouter = createRouter()
  .openapi(
    getRoute,
    restRoute<typeof getRoute>('api:notes:get', async (c, { creds, ctx }) =>
      c.json(await getNote(ctx, creds, { noteId: c.req.valid('param').note_id }), 200),
    ),
  )
  .openapi(
    deleteRoute,
    restRoute<typeof deleteRoute>('api:notes:delete', async (c, { creds, ctx }) => {
      await deleteNote(ctx, creds, { noteId: c.req.valid('param').note_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    createRoute_,
    restRoute<typeof createRoute_>('api:notes:create', async (c, { creds, ctx }) => {
      try {
        return c.json(await createNote(ctx, creds, c.req.valid('json')), 201);
      } catch (err) {
        if (err instanceof NoteMarkdownError) throw new HttpError(400, err.message);
        throw err;
      }
    }),
  )
  .openapi(
    likeRoute,
    restRoute<typeof likeRoute>('api:notes:like', async (c, { creds, ctx }) => {
      await likeNote(ctx, creds, { noteId: c.req.valid('param').note_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    unlikeRoute,
    restRoute<typeof unlikeRoute>('api:notes:unlike', async (c, { creds, ctx }) => {
      await unlikeNote(ctx, creds, { noteId: c.req.valid('param').note_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    replyRoute,
    restRoute<typeof replyRoute>('api:notes:reply', async (c, { creds, ctx }) => {
      try {
        const reply = await replyToNote(ctx, creds, {
          parentId: c.req.valid('param').note_id,
          body: c.req.valid('json').body,
        });
        return c.json(reply, 201);
      } catch (err) {
        if (err instanceof NoteMarkdownError) throw new HttpError(400, err.message);
        throw err;
      }
    }),
  )
  .openapi(
    repliesRoute,
    restRoute<typeof repliesRoute>('api:notes:replies:list', async (c, { creds, ctx }) =>
      c.json(await listNoteReplies(ctx, creds, { noteId: c.req.valid('param').note_id }), 200),
    ),
  );
