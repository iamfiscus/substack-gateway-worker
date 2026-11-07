// Port of the read-side of gateway_notes/schemas.py and the note models of
// gateway_core/models/substack.py (upstream bc2e875). Task 7 extends this file
// with the write schemas; Task 7 added the single-note and reply reads.

import { z } from '@hono/zod-openapi';
import type { Logger } from '../log';
import { excludeNone } from './parse';
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

/** GET /reader/comment/{id}: `{item}` wrapper (SubstackItemResponse). */
export const SubstackItemResponse = z.object({ item: SubstackNote });

/** Rich comment shape for note threads and replies (SubstackPostComment). */
export const SubstackPostComment = z.object({
  id: z.number().int(),
  body: z.string(),
  post_id: z.number().int().nullish(),
  user_id: z.number().int().nullish(),
  publication_id: z.number().int().nullish(),
  date: z.string().nullish(),
  deleted: z.boolean().default(false),
  name: z.string().nullish(),
  photo_url: z.string().nullish(),
  ancestor_path: z.string().nullish(),
  type: z.string().nullish(),
  status: z.string().nullish(),
  reaction_count: z.number().int().nullish(),
});
export type SubstackPostComment = z.infer<typeof SubstackPostComment>;

/** GET /reader/comment/{id}/replies (alias `commentBranches`). */
export const SubstackCommentBranchesResponse = z.object({
  commentBranches: z.array(z.object({ comment: SubstackPostComment })).default([]),
});

/** `SubstackPostComment.parent_id`: the last dotted segment of ancestor_path. */
export function parentIdOf(c: SubstackPostComment): number | null {
  const path = c.ancestor_path ?? '';
  if (!path) return null;
  const last = path.split('.').at(-1) ?? '';
  return /^\s*[+-]?\d+\s*$/.test(last) ? Number(last) : null;
}

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

/** Single-note response: upstream serves it with `response_model_exclude_none`. */
export const NoteGetResponse = z
  .object({
    id: z.number().int(),
    body: z.string(),
    likes_count: z.number().int(),
    author: NoteAuthor.optional(),
    published_at: z.string(),
  })
  .openapi('NoteGetResponse');
export type NoteGetResponse = z.infer<typeof NoteGetResponse>;

export const NoteReplyItem = z
  .object({
    id: z.number().int(),
    body: z.string(),
    parent_id: z.number().int().optional(),
    user_id: z.number().int().optional(),
    date: z.string().optional(),
    deleted: z.boolean(),
    author_name: z.string().optional(),
    reaction_count: z.number().int().optional(),
  })
  .openapi('NoteReplyItem');

export const NoteRepliesResponse = z
  .object({ items: z.array(NoteReplyItem) })
  .openapi('NoteRepliesResponse');
export type NoteRepliesResponse = z.infer<typeof NoteRepliesResponse>;

export function noteGetResponse(note: SubstackNote, log?: Logger): NoteGetResponse {
  return excludeNone(noteResponse(note, log)) as NoteGetResponse;
}

export function noteRepliesResponse(replies: SubstackPostComment[]): NoteRepliesResponse {
  return {
    items: replies.map(
      (c) =>
        excludeNone({
          id: c.id,
          body: c.body,
          parent_id: parentIdOf(c),
          user_id: c.user_id,
          date: c.date,
          deleted: c.deleted,
          author_name: c.name,
          reaction_count: c.reaction_count,
        }) as NoteRepliesResponse['items'][number],
    ),
  };
}
