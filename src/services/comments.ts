// Port of CommentsService in gateway_comments/service.py (upstream bc2e875).

import type { BearerCredentials } from '../auth/credentials';
import { NotFoundError, SubstackAPIError } from '../clients/errors';
import { type GatewayContext, makeClients } from '../context';
import {
  type CommentsResponse,
  commentsResponse,
  noteToPostComment,
  type PostCommentRepliesResponse,
  type PostCommentResponse,
  postCommentRepliesResponse,
  postCommentResponse,
  SubstackCommentsResponse,
} from '../schemas/comments';
import {
  SubstackCommentBranchesResponse,
  SubstackItemResponse,
  SubstackPostComment,
} from '../schemas/notes';
import { parseSubstack } from '../schemas/parse';

/** GET /post/{id}/comments (publication host): all comments for a post. */
export async function getPostComments(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number },
): Promise<CommentsResponse> {
  const { publication } = makeClients(ctx, creds);
  const body = await publication.get(`post/${args.postId}/comments`);
  return commentsResponse(parseSubstack(SubstackCommentsResponse, body, 'comments').comments);
}

/** GET /reader/comment/{id} (publication host) as the rich comment shape. */
export async function getPostComment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { commentId: number },
): Promise<PostCommentResponse> {
  const { publication } = makeClients(ctx, creds);
  const body = await publication.get(`reader/comment/${args.commentId}`);
  const note = parseSubstack(SubstackItemResponse, body, 'comment').item;
  const comment = noteToPostComment(note);
  // Upstream raises CommentNotFoundError (an unhandled 500); a reader response
  // without `comment` is a malformed Substack body, so it is a 502 here.
  if (!comment) {
    throw new SubstackAPIError(502, "Substack comment response invalid: missing 'comment'");
  }
  return postCommentResponse(comment);
}

/** GET /reader/comment/{id}/replies (publication host): direct replies to a comment. */
export async function listPostCommentReplies(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { commentId: number },
): Promise<PostCommentRepliesResponse> {
  const { publication } = makeClients(ctx, creds);
  const body = await publication.get(`reader/comment/${args.commentId}/replies`);
  const page = parseSubstack(SubstackCommentBranchesResponse, body, 'comment replies');
  return postCommentRepliesResponse(page.commentBranches.map((b) => b.comment));
}

const LIKE_REACTION = '❤';

/** POST /post/{id}/comment (publication host): top-level comment under a post. */
export async function createPostComment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { postId: number; body: string },
): Promise<PostCommentResponse> {
  const { publication } = makeClients(ctx, creds);
  const body = await publication.post(`post/${args.postId}/comment`, {
    json: { body: args.body },
  });
  return postCommentResponse(parseSubstack(SubstackPostComment, body, 'created comment'));
}

/** POST /post/{post_id}/comment with parent_id: reply to a comment. */
export async function replyToPostComment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { commentId: number; body: string },
): Promise<PostCommentResponse> {
  const { publication } = makeClients(ctx, creds);
  const reader = await publication.get(`reader/comment/${args.commentId}`);
  const note = parseSubstack(SubstackItemResponse, reader, 'comment').item;
  const postId = note.post?.id;
  if (postId === null || postId === undefined) {
    throw new NotFoundError(`comment ${args.commentId} has no associated post`);
  }
  const body = await publication.post(`post/${postId}/comment`, {
    json: { body: args.body, parent_id: args.commentId },
  });
  return postCommentResponse(parseSubstack(SubstackPostComment, body, 'comment reply'));
}

/** DELETE /comment/{id} (publication host): delete a comment under a post. */
export async function deletePostComment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { commentId: number },
): Promise<void> {
  await makeClients(ctx, creds).publication.delete(`comment/${args.commentId}`);
}

/** POST /comment/{id}/reaction (publication host): heart a comment. */
export async function likePostComment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { commentId: number },
): Promise<void> {
  await makeClients(ctx, creds).publication.post(`comment/${args.commentId}/reaction`, {
    json: { publication_id: null, reaction: LIKE_REACTION },
  });
}

/** DELETE /comment/{id}/reaction (publication host): remove the heart. */
export async function unlikePostComment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { commentId: number },
): Promise<void> {
  await makeClients(ctx, creds).publication.delete(`comment/${args.commentId}/reaction`, {
    json: { publication_id: null, reaction: LIKE_REACTION },
  });
}
