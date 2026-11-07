// Port of read-side gateway_comments/schemas.py (upstream bc2e875).

import { z } from '@hono/zod-openapi';
import { parentIdOf, type SubstackNote, type SubstackPostComment } from './notes';
import { excludeNone } from './parse';

// ---- Substack models (input) ----

export const SubstackComment = z.object({
  id: z.number().int(),
  body: z.string(),
  author_is_admin: z.boolean().nullish(),
  name: z.string().nullish(),
  handle: z.string().nullish(),
  user_id: z.number().int().nullish(),
});
export type SubstackComment = z.infer<typeof SubstackComment>;

/** GET /post/{id}/comments. */
export const SubstackCommentsResponse = z.object({
  comments: z.array(SubstackComment).default([]),
});

// ---- Gateway responses (output) ----

export const CommentResponse = z
  .object({
    id: z.number().int(),
    body: z.string(),
    is_admin: z.boolean(),
    author_name: z.string().nullable(),
    author_handle: z.string().nullable(),
    user_id: z.number().int().nullable(),
  })
  .openapi('CommentResponse');

export const CommentsResponse = z
  .object({ items: z.array(CommentResponse) })
  .openapi('CommentsResponse');
export type CommentsResponse = z.infer<typeof CommentsResponse>;

export function commentsResponse(comments: SubstackComment[]): CommentsResponse {
  return {
    items: comments.map((c) => ({
      id: c.id,
      body: c.body,
      is_admin: c.author_is_admin ?? false,
      author_name: c.name ?? null,
      author_handle: c.handle ?? null,
      user_id: c.user_id ?? null,
    })),
  };
}

/** Served with exclude_none, so every nullable field is optional. */
export const PostCommentResponse = z
  .object({
    id: z.number().int(),
    body: z.string(),
    parent_id: z.number().int().optional(),
    post_id: z.number().int().optional(),
    user_id: z.number().int().optional(),
    date: z.string().optional(),
    deleted: z.boolean(),
    author_name: z.string().optional(),
    reaction_count: z.number().int().optional(),
  })
  .openapi('PostCommentResponse');
export type PostCommentResponse = z.infer<typeof PostCommentResponse>;

export const PostCommentRepliesResponse = z
  .object({ items: z.array(PostCommentResponse) })
  .openapi('PostCommentRepliesResponse');
export type PostCommentRepliesResponse = z.infer<typeof PostCommentRepliesResponse>;

export function postCommentResponse(c: SubstackPostComment): PostCommentResponse {
  return excludeNone({
    id: c.id,
    body: c.body,
    parent_id: parentIdOf(c),
    post_id: c.post_id,
    user_id: c.user_id,
    date: c.date,
    deleted: c.deleted,
    author_name: c.name,
    reaction_count: c.reaction_count,
  }) as PostCommentResponse;
}

export function postCommentRepliesResponse(
  replies: SubstackPostComment[],
): PostCommentRepliesResponse {
  return { items: replies.map(postCommentResponse) };
}

/**
 * CommentsService._note_to_post_comment: a reader-format note as the rich
 * comment shape. Returns null when the note carries no `comment`.
 */
export function noteToPostComment(note: SubstackNote): SubstackPostComment | null {
  const c = note.comment;
  if (!c) return null;
  return {
    id: c.id,
    body: c.body,
    post_id: note.post ? note.post.id : null,
    name: c.name,
    photo_url: c.photo_url,
    reaction_count: c.reaction_count,
    deleted: false,
  };
}
