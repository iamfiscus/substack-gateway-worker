// Port of the read-side of NotesService in gateway_notes/service.py (upstream
// bc2e875). Task 7 extends this file with getNote, replies and the writes.

import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients } from '../context';
import { type NotesPageResponse, notesPageResponse, SubstackNotesPage } from '../schemas/notes';
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
