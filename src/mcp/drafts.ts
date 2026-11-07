// Tools of gateway_drafts_mcp (upstream bc2e875).

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { lenientBase64ToBytes } from '../auth/credentials';
import type { GatewayContext } from '../context';
import {
  aiDetectionResponse,
  createDraftResponse,
  type DraftUpdates,
  draftResponse,
  draftsListResponse,
  imageUploadResult,
  prepublishResponse,
  scheduleDraftResponse,
} from '../schemas/drafts';
import {
  aiDetection,
  createDraft,
  deleteDraft,
  getDraft,
  listDrafts,
  prepublishDraft,
  scheduleDraft,
  unscheduleDraft,
  updateDraft,
  uploadImage,
} from '../services/drafts';
import { dataUri } from '../services/images';
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta, writeAnnotations } from './server';

// Compact cheat sheet for the body dialect; the full reference is
// docs/drafts-markdown.md. Upstream's text, verbatim (it links upstream's copy).
const DIALECT_CHEAT_SHEET =
  'Body dialect (Markdown plus): `---` rule; ' +
  '`::button[Text]{href=subscribe|share|comment|URL}`; ' +
  '`![alt](src){size=normal|large|full}` with `{watermark=N%}` to watermark ' +
  '(external images are uploaded); ' +
  '`::defaults{align=left|center|right|justify|default}` ' +
  'as the first line; `:::align{left|center|right|justify|default}` ... `:::` ' +
  'and `:::callout` ... `:::` containers; `|>` pullquote; `$$` LaTeX. A ' +
  '```substack-node fence is a verbatim node: move or delete it, never edit ' +
  'its JSON. Malformed syntax is rejected with the line number; start a line ' +
  'with `\\` to write dialect-looking text literally. Full syntax: ' +
  'https://github.com/jakub-k-slys/substack-gateway-oss/blob/main/' +
  'docs/drafts-markdown.md.';
const CONCURRENCY_HINT =
  'Pass the `updated_at` from get_draft (or the previous update) as ' +
  '`expected_updated_at` to refuse the update if the draft was edited since ' +
  'you read it.';

const draftId = z.object({ draft_id: z.number().int() });
const optionalText = z.string().nullish();

export function registerDraftsTools(server: McpServer, _ctx: GatewayContext): void {
  const warnTo = (ctx: GatewayContext) => (message: string) =>
    ctx.log.warn(message, { request_id: ctx.requestId });

  mcpTool(
    server,
    'list_drafts',
    {
      description: `List Substack post drafts for the publication, newest first, in pages of 10 with cursor-based pagination. Pass \`next\` from a previous response to fetch the following page. Each item contains id, uuid, title, and last-updated timestamp.${TOKEN_NOTE}`,
      inputSchema: z.object({ next: optionalText }),
      annotations: readAnnotations('List Drafts'),
      feature: 'mcp:drafts:list',
      meta: toolMeta('drafts', 'GET /post_management/drafts', ['drafts', 'read']),
    },
    async (args, creds, ctx) => {
      const page = await listDrafts(ctx, creds, { cursor: args.next });
      return draftsListResponse(page.drafts, page.nextCursor);
    },
  );
  mcpTool(
    server,
    'get_draft',
    {
      description:
        'Fetch a Substack post draft by ID. The body is returned as Markdown in the draft dialect, ' +
        'together with `updated_at`. ' +
        DIALECT_CHEAT_SHEET +
        ' Pass `updated_at` back as `expected_updated_at` on update_draft to detect concurrent edits.' +
        TOKEN_NOTE,
      inputSchema: draftId,
      annotations: readAnnotations('Get Draft'),
      feature: 'mcp:drafts:get',
      meta: toolMeta('drafts', 'GET /drafts/{draft_id}', ['drafts', 'read']),
    },
    async (args, creds, ctx) =>
      draftResponse(await getDraft(ctx, creds, { draftId: args.draft_id }), warnTo(ctx)),
  );
  mcpTool(
    server,
    'create_draft',
    {
      description:
        'Create a new Substack post draft with optional title, subtitle, and body. ' +
        'The body accepts Markdown in the draft dialect. ' +
        DIALECT_CHEAT_SHEET +
        TOKEN_NOTE,
      inputSchema: z.object({ title: optionalText, subtitle: optionalText, body: optionalText }),
      annotations: writeAnnotations('Create Draft', { idempotent: false }),
      feature: 'mcp:drafts:create',
      meta: toolMeta('drafts', 'POST /drafts', ['drafts', 'write']),
    },
    async (args, creds, ctx) => createDraftResponse(await createDraft(ctx, creds, args)),
  );
  mcpTool(
    server,
    'upload_image',
    {
      description: `Upload an image to Substack and get back its hosted URL and pixel dimensions. Pass the image as base64 in \`image_base64\` with its \`content_type\` (e.g. image/png). Reference the returned URL in a draft body as ![alt](url).${TOKEN_NOTE}`,
      inputSchema: z.object({
        image_base64: z.string(),
        content_type: z.string().default('image/png'),
      }),
      annotations: writeAnnotations('Upload Image', { idempotent: false }),
      feature: 'mcp:images:upload',
      meta: toolMeta('drafts', 'POST /api/v1/image', ['drafts', 'images', 'write']),
    },
    async (args, creds, ctx) => {
      const image = dataUri(args.content_type, lenientBase64ToBytes(args.image_base64));
      return imageUploadResult(await uploadImage(ctx, creds, { image }));
    },
  );
  mcpTool(
    server,
    'update_draft',
    {
      description:
        'Update specific fields of a Substack post draft. Only provided fields are changed; ' +
        'omitted fields remain unchanged. The body accepts Markdown in the draft dialect. ' +
        DIALECT_CHEAT_SHEET +
        ' ' +
        CONCURRENCY_HINT +
        TOKEN_NOTE,
      inputSchema: draftId.extend({
        title: optionalText,
        subtitle: optionalText,
        body: optionalText,
        expected_updated_at: optionalText,
      }),
      annotations: writeAnnotations('Update Draft', { idempotent: true }),
      feature: 'mcp:drafts:update',
      meta: toolMeta('drafts', 'PUT /drafts/{draft_id}', ['drafts', 'write']),
    },
    async (args, creds, ctx) => {
      // Unlike REST, a null argument means "not passed".
      const updates: DraftUpdates = {};
      if (args.title != null) updates.title = args.title;
      if (args.subtitle != null) updates.subtitle = args.subtitle;
      if (args.body != null) updates.body = args.body;
      const draft = await updateDraft(ctx, creds, {
        draftId: args.draft_id,
        updates,
        expectedUpdatedAt: args.expected_updated_at,
      });
      return draftResponse(draft, warnTo(ctx));
    },
  );
  mcpTool(
    server,
    'delete_draft',
    {
      description: `Permanently delete a Substack post draft by its numeric ID.${TOKEN_NOTE}`,
      inputSchema: draftId,
      annotations: writeAnnotations('Delete Draft', { destructive: true, idempotent: true }),
      feature: 'mcp:drafts:delete',
      meta: toolMeta('drafts', 'DELETE /drafts/{draft_id}', ['drafts', 'write', 'delete']),
    },
    async (args, creds, ctx) => {
      await deleteDraft(ctx, creds, { draftId: args.draft_id });
      return `Draft ${args.draft_id} deleted successfully.`;
    },
  );
  mcpTool(
    server,
    'get_ai_detection',
    {
      description: `Run Substack's Pangram AI-writing detection on a draft. Returns fraction_ai / fraction_ai_assisted / fraction_human plus a human-readable header and details.${TOKEN_NOTE}`,
      inputSchema: draftId,
      annotations: readAnnotations('Get AI Detection'),
      feature: 'mcp:drafts:ai-detection',
      meta: toolMeta('drafts', 'GET /drafts/{draft_id}/pangram_detection', ['drafts', 'read']),
    },
    async (args, creds, ctx) =>
      aiDetectionResponse(await aiDetection(ctx, creds, { draftId: args.draft_id })),
  );
  mcpTool(
    server,
    'check_draft',
    {
      description: `Run Substack's pre-publish validation on a draft, returning any blocking errors and non-blocking suggestions. Call before scheduling.${TOKEN_NOTE}`,
      inputSchema: draftId,
      annotations: readAnnotations('Check Draft'),
      feature: 'mcp:drafts:prepublish',
      meta: toolMeta('drafts', 'GET /drafts/{draft_id}/prepublish', ['drafts', 'read']),
    },
    async (args, creds, ctx) =>
      prepublishResponse(await prepublishDraft(ctx, creds, { draftId: args.draft_id })),
  );
  mcpTool(
    server,
    'schedule_draft',
    {
      description: `Schedule a Substack draft for timed release. \`scheduled_at\` is an ISO-8601 timestamp (UTC recommended, e.g. 2026-09-16T18:24:00Z). \`post_audience\` and \`email_audience\` default to only_paid.${TOKEN_NOTE}`,
      inputSchema: draftId.extend({
        scheduled_at: z.string(),
        post_audience: z.string().default('only_paid'),
        email_audience: z.string().default('only_paid'),
      }),
      annotations: writeAnnotations('Schedule Draft', { idempotent: true }),
      feature: 'mcp:drafts:schedule',
      meta: toolMeta('drafts', 'POST /drafts/{draft_id}/scheduled_release', ['drafts', 'write']),
    },
    async (args, creds, ctx) => {
      const release = await scheduleDraft(ctx, creds, {
        draftId: args.draft_id,
        scheduledAt: args.scheduled_at,
        postAudience: args.post_audience,
        emailAudience: args.email_audience,
      });
      return scheduleDraftResponse(release);
    },
  );
  mcpTool(
    server,
    'unschedule_draft',
    {
      description: `Cancel a Substack draft's scheduled release, returning it to an unscheduled draft.${TOKEN_NOTE}`,
      inputSchema: draftId,
      annotations: writeAnnotations('Unschedule Draft', { destructive: true, idempotent: true }),
      feature: 'mcp:drafts:unschedule',
      meta: toolMeta('drafts', 'DELETE /drafts/{draft_id}/scheduled_release', [
        'drafts',
        'write',
        'delete',
      ]),
    },
    async (args, creds, ctx) => {
      await unscheduleDraft(ctx, creds, { draftId: args.draft_id });
      return `Draft ${args.draft_id} unscheduled successfully.`;
    },
  );
}
