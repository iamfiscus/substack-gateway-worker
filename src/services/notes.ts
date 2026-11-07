// Port of NotesService in gateway_notes/service.py (upstream bc2e875).

import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients } from '../context';
import { markdownToDoc, markdownToNotePayload } from '../converters/noteMarkdown';
import {
  assertNoteContentLength,
  type CreateNoteResponse,
  createNoteResponse,
  type NoteGetResponse,
  type NoteRepliesResponse,
  type NoteReplyCreatedResponse,
  type NotesPageResponse,
  noteGetResponse,
  noteRepliesResponse,
  noteReplyCreatedResponse,
  notesPageResponse,
  SubstackAttachmentCreated,
  SubstackCommentBranchesResponse,
  SubstackItemResponse,
  SubstackNoteCreated,
  SubstackNotesPage,
} from '../schemas/notes';
import { parseSubstack } from '../schemas/parse';

/** GET /notes (publication host): the caller's own notes. */
export async function getOwnNotes(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { cursor?: string | null },
): Promise<NotesPageResponse> {
  const { publication } = makeClients(ctx, creds);
  const body = await publication.get('notes', {
    query: args.cursor ? { cursor: args.cursor } : {},
  });
  return notesPageResponse(parseSubstack(SubstackNotesPage, body, 'notes'), ctx.log);
}

/** GET /reader/feed/profile/{id}?types=note (publication host): notes for a profile id. */
export async function getNotesForProfile(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { profileId: number; cursor?: string | null },
): Promise<NotesPageResponse> {
  const { publication } = makeClients(ctx, creds);
  const query: Record<string, string> = { types: 'note' };
  if (args.cursor) query.cursor = args.cursor;
  const body = await publication.get(`reader/feed/profile/${args.profileId}`, { query });
  return notesPageResponse(parseSubstack(SubstackNotesPage, body, 'notes'), ctx.log);
}

/** GET /reader/comment/{id} (publication host): a note by id. */
export async function getNote(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { noteId: number },
): Promise<NoteGetResponse> {
  const { publication } = makeClients(ctx, creds);
  const body = await publication.get(`reader/comment/${args.noteId}`);
  return noteGetResponse(parseSubstack(SubstackItemResponse, body, 'note').item, ctx.log);
}

/** GET /reader/comment/{id}/replies (global host, as upstream): direct replies in a note thread. */
export async function listNoteReplies(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { noteId: number },
): Promise<NoteRepliesResponse> {
  const { substack } = makeClients(ctx, creds);
  const body = await substack.get(`reader/comment/${args.noteId}/replies`);
  const page = parseSubstack(SubstackCommentBranchesResponse, body, 'note replies');
  return noteRepliesResponse(page.commentBranches.map((b) => b.comment));
}

const LIKE_REACTION = '❤';
const FOR_YOU_TAB_ID = 'for-you';

/** DELETE /comment/{id} (publication host): delete a note. */
export async function deleteNote(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { noteId: number },
): Promise<void> {
  await makeClients(ctx, creds).publication.delete(`comment/${args.noteId}`);
}

/** POST /comment/attachment/: register a link attachment, returns its UUID. */
async function createAttachment(
  ctx: GatewayContext,
  creds: BearerCredentials,
  url: string,
): Promise<string> {
  const body = await makeClients(ctx, creds).substack.post('comment/attachment/', {
    json: { url, type: 'link' },
  });
  return parseSubstack(SubstackAttachmentCreated, body, 'attachment').id;
}

/**
 * Convert markdown to a note payload and POST /comment/feed/. Throws
 * NoteMarkdownError (upstream ValueError) for empty content.
 */
export async function createNote(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { content: string; attachment?: string | null },
): Promise<CreateNoteResponse> {
  assertNoteContentLength('content', args.content);
  // Validate before the attachment call so bad content never leaves an orphan attachment.
  markdownToDoc(args.content);
  const attachmentIds = args.attachment
    ? [await createAttachment(ctx, creds, args.attachment)]
    : undefined;
  const payload = markdownToNotePayload(args.content, attachmentIds);
  const body = await makeClients(ctx, creds).substack.post('comment/feed/', { json: payload });
  return createNoteResponse(parseSubstack(SubstackNoteCreated, body, 'created note'));
}

/** POST /comment/{id}/reaction: add a heart reaction to a note. */
export async function likeNote(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { noteId: number },
): Promise<void> {
  await makeClients(ctx, creds).substack.post(`comment/${args.noteId}/reaction`, {
    json: { publication_id: null, reaction: LIKE_REACTION },
  });
}

/** DELETE /comment/{id}/reaction: remove the heart reaction from a note. */
export async function unlikeNote(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { noteId: number },
): Promise<void> {
  await makeClients(ctx, creds).substack.delete(`comment/${args.noteId}/reaction`, {
    json: { publication_id: null, reaction: LIKE_REACTION, tabId: FOR_YOU_TAB_ID },
  });
}

/** POST /comment/feed/ with parent_id: reply to a note or note comment. */
export async function replyToNote(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { parentId: number; body: string },
): Promise<NoteReplyCreatedResponse> {
  assertNoteContentLength('body', args.body);
  const payload = { ...markdownToNotePayload(args.body), parent_id: args.parentId };
  const body = await makeClients(ctx, creds).substack.post('comment/feed/', { json: payload });
  return noteReplyCreatedResponse(parseSubstack(SubstackNoteCreated, body, 'note reply'));
}
