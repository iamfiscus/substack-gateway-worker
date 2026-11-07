// Port of the read-side of NotesService in gateway_notes/service.py (upstream
// bc2e875). Task 7 extends this file with the writes.

import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients } from '../context';
import {
  type NoteGetResponse,
  type NoteRepliesResponse,
  type NotesPageResponse,
  noteGetResponse,
  noteRepliesResponse,
  notesPageResponse,
  SubstackCommentBranchesResponse,
  SubstackItemResponse,
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
