// Read tools of gateway_notes_mcp (upstream bc2e875).
// create_note, delete_note, like_note, unlike_note and reply_to_note arrive in Task 9/10.

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import { getNote, listNoteReplies } from '../services/notes';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta } from './server';

export function registerNotesTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'get_note',
    {
      description: `Retrieve a single Substack note by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ note_id: z.number().int() }),
      annotations: readAnnotations('Get Note'),
      feature: 'mcp:notes:get',
      meta: toolMeta('notes', 'GET /reader/comment/{note_id}', ['notes', 'read']),
    },
    (args, creds, ctx) => getNote(ctx, creds, { noteId: args.note_id }),
  );
  mcpTool(
    server,
    'list_note_replies',
    {
      description: `List the direct replies to a Substack note by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ note_id: z.number().int() }),
      annotations: readAnnotations('List Note Replies'),
      feature: 'mcp:notes:replies:list',
      meta: toolMeta('notes', 'GET /reader/comment/{note_id}/replies', ['notes', 'read']),
    },
    (args, creds, ctx) => listNoteReplies(ctx, creds, { noteId: args.note_id }),
  );
}
