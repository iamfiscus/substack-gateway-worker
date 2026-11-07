// Port of the read-side of gateway_notes/schemas.py and the note models of
// gateway_core/models/substack.py (upstream bc2e875). Task 7 extends this file
// with the single-note, reply and write schemas.

import { z } from '@hono/zod-openapi';
import type { Logger } from '../log';
import { SubstackPreviewPost } from './posts';

// ---- Substack models (input) ----

const SubstackNoteUser = z.object({
  id: z.number().int(),
  name: z.string(),
  handle: z.string(),
  photo_url: z.string().nullish(),
});

const SubstackNoteComment = z.object({
  id: z.number().int(),
  body: z.string(),
  name: z.string().nullish(),
  handle: z.string().nullish(),
  photo_url: z.string().nullish(),
  reaction_count: z.number().int().nullish(),
});

export const SubstackNote = z.object({
  entity_key: z.string(),
  type: z.string().nullish(),
  context: z.object({ timestamp: z.string(), users: z.array(SubstackNoteUser) }),
  publication: z
    .object({
      author_name: z.string().nullish(),
      author_handle: z.string().nullish(),
      author_photo_url: z.string().nullish(),
    })
    .nullish(),
  post: SubstackPreviewPost.nullish(),
  comment: SubstackNoteComment.nullish(),
  parentComments: z.array(SubstackNoteComment).default([]),
});
export type SubstackNote = z.infer<typeof SubstackNote>;

export const SubstackNotesPage = z.object({
  items: z.array(SubstackNote).default([]),
  nextCursor: z.string().nullish(),
});
export type SubstackNotesPage = z.infer<typeof SubstackNotesPage>;

// ---- Gateway responses (output) ----

export const NoteAuthor = z
  .object({
    id: z.number().int(),
    name: z.string(),
    handle: z.string(),
    avatar_url: z.string(),
  })
  .openapi('NoteAuthor');

export const NoteResponse = z
  .object({
    id: z.number().int(),
    body: z.string(),
    likes_count: z.number().int(),
    author: NoteAuthor.nullable(),
    published_at: z.string(),
  })
  .openapi('NoteResponse');
export type NoteResponse = z.infer<typeof NoteResponse>;

export const NotesPageResponse = z
  .object({ items: z.array(NoteResponse), next: z.string().nullable() })
  .openapi('NotesPageResponse');
export type NotesPageResponse = z.infer<typeof NotesPageResponse>;

export function noteResponse(note: SubstackNote, log?: Logger): NoteResponse {
  const user = note.context.users[0];
  const comment = note.comment;
  if (!comment) {
    log?.warn('note has no comment body; returning empty defaults', {
      entity_key: note.entity_key,
    });
  }
  if (!user) {
    log?.warn('note has no author; returning empty defaults', { entity_key: note.entity_key });
  }
  return {
    id: comment ? comment.id : 0,
    body: comment ? comment.body : '',
    likes_count: comment?.reaction_count ?? 0,
    author: user
      ? {
          id: user.id,
          name: user.name,
          handle: user.handle,
          avatar_url: user.photo_url || '',
        }
      : null,
    published_at: note.context.timestamp,
  };
}

export function notesPageResponse(page: SubstackNotesPage, log?: Logger): NotesPageResponse {
  return {
    items: page.items.map((n) => noteResponse(n, log)),
    next: page.nextCursor ?? null,
  };
}
