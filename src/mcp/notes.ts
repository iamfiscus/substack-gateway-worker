// Tools of gateway_notes_mcp (upstream bc2e875).

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import {
  createNote,
  deleteNote,
  getNote,
  likeNote,
  listNoteReplies,
  replyToNote,
  unlikeNote,
} from '../services/notes';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta, writeAnnotations } from './server';

export function registerNotesTools(server: McpServer, _ctx: GatewayContext): void {
  mcpTool(
    server,
    'create_note',
    {
      description: `Publish a new note to Substack from Markdown content, with an optional link attachment.${TOKEN_NOTE}`,
      inputSchema: z.object({ content: z.string(), attachment: z.string().nullish() }),
      annotations: writeAnnotations('Create Note', { idempotent: false }),
      feature: 'mcp:notes:create',
      meta: toolMeta('notes', 'POST /comment/feed/', ['notes', 'write']),
    },
    (args, creds, ctx) =>
      createNote(ctx, creds, { content: args.content, attachment: args.attachment }),
  );
  mcpTool(
    server,
    'delete_note',
    {
      description: `Permanently delete a Substack note by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ note_id: z.number().int() }),
      annotations: writeAnnotations('Delete Note', { destructive: true, idempotent: true }),
      feature: 'mcp:notes:delete',
      textResult: true,
      meta: toolMeta('notes', 'DELETE /comment/{note_id}', ['notes', 'write', 'delete']),
    },
    async (args, creds, ctx) => {
      await deleteNote(ctx, creds, { noteId: args.note_id });
      return `Note ${args.note_id} deleted successfully.`;
    },
  );
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
    'like_note',
    {
      description: `Add a like to a Substack note by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ note_id: z.number().int() }),
      annotations: writeAnnotations('Like Note', { idempotent: true }),
      feature: 'mcp:notes:like',
      textResult: true,
      meta: toolMeta('notes', 'POST /comment/{note_id}/reaction', ['notes', 'write']),
    },
    async (args, creds, ctx) => {
      await likeNote(ctx, creds, { noteId: args.note_id });
      return `Note ${args.note_id} liked successfully.`;
    },
  );
  mcpTool(
    server,
    'unlike_note',
    {
      description: `Remove a like from a Substack note by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: z.object({ note_id: z.number().int() }),
      annotations: writeAnnotations('Unlike Note', { idempotent: true }),
      feature: 'mcp:notes:unlike',
      textResult: true,
      meta: toolMeta('notes', 'DELETE /comment/{note_id}/reaction', ['notes', 'write']),
    },
    async (args, creds, ctx) => {
      await unlikeNote(ctx, creds, { noteId: args.note_id });
      return `Note ${args.note_id} unliked successfully.`;
    },
  );
  mcpTool(
    server,
    'reply_to_note',
    {
      description: `Reply to a Substack note or to any comment within its thread, from Markdown content.${TOKEN_NOTE}`,
      inputSchema: z.object({ note_id: z.number().int(), body: z.string() }),
      annotations: writeAnnotations('Reply To Note', { idempotent: false }),
      feature: 'mcp:notes:reply',
      meta: toolMeta('notes', 'POST /comment/feed/', ['notes', 'write']),
    },
    (args, creds, ctx) => replyToNote(ctx, creds, { parentId: args.note_id, body: args.body }),
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
