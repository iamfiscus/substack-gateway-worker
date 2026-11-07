// Port of the read side of CommentsService in gateway_comments/service.py
// (upstream bc2e875). The writes arrive in Task 10.

import type { BearerCredentials } from '../auth/credentials';
import { SubstackAPIError } from '../clients/errors';
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
import { SubstackCommentBranchesResponse, SubstackItemResponse } from '../schemas/notes';
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
