// Routes of gateway_drafts_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import { DraftMarkdownError } from '../converters/dialect/errors';
import { InvalidCursorError } from '../drafts/cursor';
import {
  AiDetectionResponse,
  aiDetectionResponse,
  CreateDraftRequest,
  CreateDraftResponse,
  createDraftResponse,
  DraftResponse,
  DraftsListResponse,
  draftResponse,
  draftsListResponse,
  ImageUploadResult,
  imageUploadResult,
  PrepublishResponse,
  prepublishResponse,
  providedUpdates,
  ScheduleDraftRequest,
  ScheduleDraftResponse,
  scheduleDraftResponse,
  UpdateDraftRequest,
  warnTo,
} from '../schemas/drafts';
import {
  aiDetection,
  createDraft,
  DraftConflictError,
  deleteDraft,
  getDraft,
  isTriggerAt,
  listDrafts,
  prepublishDraft,
  scheduleDraft,
  unscheduleDraft,
  updateDraft,
  uploadImage,
} from '../services/drafts';
import { dataUri } from '../services/images';
import { restRoute } from './credentials';
import { createRouter, HttpError } from './errors';

const tokenHeader = z.object({ 'x-gateway-token': z.string().optional() });
const draftIdParam = z.object({ draft_id: z.coerce.number().int().gt(0) });
const ok = (schema: z.ZodType) => ({
  description: 'Successful Response',
  content: { 'application/json': { schema } },
});
const noContent = { 204: { description: 'Successful Response' } } as const;
const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});

/** Upstream's 400 (malformed dialect) and 409 (stale `expected_updated_at`). */
function mapDraftErrors(err: unknown): never {
  if (err instanceof DraftConflictError) throw new HttpError(409, err.message);
  if (err instanceof DraftMarkdownError) throw new HttpError(400, err.message);
  throw err;
}

const listRoute = createRoute({
  method: 'get',
  path: '/drafts',
  tags: ['drafts'],
  summary: 'List Drafts',
  description: 'List post drafts, newest first, in pages of 10 with cursor-based pagination.',
  request: {
    headers: tokenHeader,
    query: z.object({
      next: z
        .string()
        .optional()
        .openapi({ description: 'Opaque cursor from a previous response.' }),
    }),
  },
  responses: { 200: ok(DraftsListResponse) },
});

const getRoute = createRoute({
  method: 'get',
  path: '/drafts/{draft_id}',
  tags: ['drafts'],
  summary: 'Get Draft',
  description: 'Fetch a post draft from Substack by ID.',
  request: { headers: tokenHeader, params: draftIdParam },
  responses: { 200: ok(DraftResponse) },
});

const updateRoute = createRoute({
  method: 'put',
  path: '/drafts/{draft_id}',
  tags: ['drafts'],
  summary: 'Update Draft',
  description:
    'Update specific fields of a Substack post draft.\n\n' +
    'Pass `expected_updated_at` (the `updated_at` from a prior read) to refuse the\n' +
    'update with 409 when the draft changed in the meantime. Malformed draft\n' +
    'Markdown is rejected with 400.',
  request: { headers: tokenHeader, params: draftIdParam, body: jsonBody(UpdateDraftRequest) },
  responses: { 200: ok(DraftResponse) },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/drafts/{draft_id}',
  tags: ['drafts'],
  summary: 'Delete Draft',
  description: 'Delete a post draft on Substack.',
  request: { headers: tokenHeader, params: draftIdParam },
  responses: noContent,
});

const createRoute_ = createRoute({
  method: 'post',
  path: '/drafts',
  tags: ['drafts'],
  summary: 'Create Draft',
  description: 'Create a new post draft on Substack.',
  request: { headers: tokenHeader, body: jsonBody(CreateDraftRequest) },
  responses: { 201: ok(CreateDraftResponse) },
});

const aiDetectionRoute = createRoute({
  method: 'get',
  path: '/drafts/{draft_id}/ai-detection',
  tags: ['drafts'],
  summary: 'Ai Detection',
  description: "Run Substack's Pangram AI-writing detection on a draft.",
  request: { headers: tokenHeader, params: draftIdParam },
  responses: { 200: ok(AiDetectionResponse) },
});

const prepublishRoute = createRoute({
  method: 'get',
  path: '/drafts/{draft_id}/prepublish',
  tags: ['drafts'],
  summary: 'Prepublish Draft',
  description: "Run Substack's pre-publish validation on a draft.",
  request: { headers: tokenHeader, params: draftIdParam },
  responses: { 200: ok(PrepublishResponse) },
});

const scheduleRoute = createRoute({
  method: 'post',
  path: '/drafts/{draft_id}/schedule',
  tags: ['drafts'],
  summary: 'Schedule Draft',
  description: 'Schedule a draft for timed release.',
  request: { headers: tokenHeader, params: draftIdParam, body: jsonBody(ScheduleDraftRequest) },
  responses: { 200: ok(ScheduleDraftResponse) },
});

const unscheduleRoute = createRoute({
  method: 'delete',
  path: '/drafts/{draft_id}/schedule',
  tags: ['drafts'],
  summary: 'Unschedule Draft',
  description: "Cancel a draft's scheduled release.",
  request: { headers: tokenHeader, params: draftIdParam },
  responses: noContent,
});

const ImageUploadForm = z.object({
  file: z
    .custom<File>((v) => v instanceof File, { message: 'Field required' })
    .openapi({ type: 'string', format: 'binary' }),
});

const imagesRoute = createRoute({
  method: 'post',
  path: '/images',
  tags: ['drafts', 'images'],
  summary: 'Upload Image',
  description: 'Upload an image file to Substack and return its hosted URL and dimensions.',
  request: {
    headers: tokenHeader,
    body: { required: true, content: { 'multipart/form-data': { schema: ImageUploadForm } } },
  },
  responses: { 201: ok(ImageUploadResult) },
});

/**
 * pydantic `datetime`: a unix timestamp (seconds, or milliseconds past 2e10)
 * or an ISO-8601 string; anything else is a 422 like FastAPI's.
 */
function scheduledAt(value: string | number): string | Date {
  if (typeof value === 'number') {
    return new Date(Math.abs(value) > 2e10 ? value : value * 1000);
  }
  if (isTriggerAt(value)) return value;
  throw new HttpError(422, [
    {
      loc: ['body', 'scheduled_at'],
      msg: 'Input should be a valid datetime',
      type: 'datetime_parsing',
    },
  ]);
}

export const draftsRouter = createRouter()
  .openapi(
    listRoute,
    restRoute<typeof listRoute>('api:drafts:list', async (c, { creds, ctx }) => {
      let page: Awaited<ReturnType<typeof listDrafts>>;
      try {
        page = await listDrafts(ctx, creds, { cursor: c.req.valid('query').next });
      } catch (err) {
        if (err instanceof InvalidCursorError) throw new HttpError(400, 'Invalid cursor');
        throw err;
      }
      return c.json(draftsListResponse(page.drafts, page.nextCursor), 200);
    }),
  )
  .openapi(
    getRoute,
    restRoute<typeof getRoute>('api:drafts:get', async (c, { creds, ctx }) => {
      const draft = await getDraft(ctx, creds, { draftId: c.req.valid('param').draft_id });
      return c.json(draftResponse(draft, warnTo(ctx)), 200);
    }),
  )
  .openapi(
    updateRoute,
    restRoute<typeof updateRoute>('api:drafts:update', async (c, { creds, ctx }) => {
      const req = c.req.valid('json');
      const draft = await updateDraft(ctx, creds, {
        draftId: c.req.valid('param').draft_id,
        updates: providedUpdates(req),
        expectedUpdatedAt: req.expected_updated_at,
      }).catch(mapDraftErrors);
      return c.json(draftResponse(draft, warnTo(ctx)), 200);
    }),
  )
  .openapi(
    deleteRoute,
    restRoute<typeof deleteRoute>('api:drafts:delete', async (c, { creds, ctx }) => {
      await deleteDraft(ctx, creds, { draftId: c.req.valid('param').draft_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    createRoute_,
    restRoute<typeof createRoute_>('api:drafts:create', async (c, { creds, ctx }) => {
      const draft = await createDraft(ctx, creds, c.req.valid('json')).catch(mapDraftErrors);
      return c.json(createDraftResponse(draft), 201);
    }),
  )
  .openapi(
    aiDetectionRoute,
    restRoute<typeof aiDetectionRoute>('api:drafts:ai-detection', async (c, { creds, ctx }) => {
      const result = await aiDetection(ctx, creds, { draftId: c.req.valid('param').draft_id });
      return c.json(aiDetectionResponse(result), 200);
    }),
  )
  .openapi(
    prepublishRoute,
    restRoute<typeof prepublishRoute>('api:drafts:prepublish', async (c, { creds, ctx }) => {
      const result = await prepublishDraft(ctx, creds, { draftId: c.req.valid('param').draft_id });
      return c.json(prepublishResponse(result), 200);
    }),
  )
  .openapi(
    scheduleRoute,
    restRoute<typeof scheduleRoute>('api:drafts:schedule', async (c, { creds, ctx }) => {
      const req = c.req.valid('json');
      const release = await scheduleDraft(ctx, creds, {
        draftId: c.req.valid('param').draft_id,
        scheduledAt: scheduledAt(req.scheduled_at),
        // Python `or`: an empty audience falls back too.
        postAudience: req.post_audience || 'only_paid',
        emailAudience: req.email_audience || 'only_paid',
      });
      return c.json(scheduleDraftResponse(release), 200);
    }),
  )
  .openapi(
    unscheduleRoute,
    restRoute<typeof unscheduleRoute>('api:drafts:unschedule', async (c, { creds, ctx }) => {
      await unscheduleDraft(ctx, creds, { draftId: c.req.valid('param').draft_id });
      return c.body(null, 204);
    }),
  )
  .openapi(
    imagesRoute,
    restRoute<typeof imagesRoute>('api:images:create', async (c, { creds, ctx }) => {
      const { file } = c.req.valid('form');
      const raw = new Uint8Array(await file.arrayBuffer());
      const contentType = file.type || 'application/octet-stream';
      const image = await uploadImage(ctx, creds, { image: dataUri(contentType, raw) });
      return c.json(imageUploadResult(image), 201);
    }),
  );
