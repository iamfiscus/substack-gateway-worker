// Port of gateway_drafts/schemas.py and gateway_drafts/models/substack.py
// (upstream bc2e875).

import { z } from '@hono/zod-openapi';
import type { GatewayContext } from '../context';
import { draftBodyToMarkdown } from '../converters/draftMarkdown';
import type { UploadedImage } from '../services/images';

// ---- Substack models (input) ----

export const SubstackDraftCreated = z.object({ id: z.number().int(), uuid: z.string() });
export type SubstackDraftCreated = z.infer<typeof SubstackDraftCreated>;

export const SubstackDraftSummary = z.object({
  id: z.number().int(),
  uuid: z.string(),
  draft_title: z.string().nullish(),
  draft_updated_at: z.string().nullish(),
});
export type SubstackDraftSummary = z.infer<typeof SubstackDraftSummary>;

/** `GET post_management/drafts`: `{posts, total, ...}`, or a bare list. */
export const SubstackDraftsPage = z.union([
  z.object({
    posts: z.array(SubstackDraftSummary).default([]),
    total: z.number().nullish(),
  }),
  z.array(SubstackDraftSummary),
]);

export const SubstackDraft = z.object({
  draft_title: z.string().nullish(),
  draft_subtitle: z.string().nullish(),
  draft_body: z.string().nullish(),
  draft_updated_at: z.string().nullish(),
});
export type SubstackDraft = z.infer<typeof SubstackDraft>;

export type SubstackScheduledRelease = {
  trigger_at: string;
  post_audience: string;
  email_audience: string;
};

export const SubstackPrepublish = z.object({
  errors: z.array(z.unknown()).default([]),
  suggestions: z.array(z.unknown()).default([]),
});
export type SubstackPrepublish = z.infer<typeof SubstackPrepublish>;

export const SubstackAiDetection = z.object({
  type: z.string().nullish(),
  header: z.string().nullish(),
  details: z.string().nullish(),
  fraction_ai: z.number().nullish(),
  fraction_ai_assisted: z.number().nullish(),
  fraction_human: z.number().nullish(),
  can_disable: z.boolean().nullish(),
  can_modify_disclosure: z.boolean().nullish(),
});
export type SubstackAiDetection = z.infer<typeof SubstackAiDetection>;

// ---- Gateway requests ----

const optionalText = z.string().nullable().optional();

export const CreateDraftRequest = z
  .object({ title: optionalText, subtitle: optionalText, body: optionalText })
  .openapi('CreateDraftRequest');
export type CreateDraftRequest = z.infer<typeof CreateDraftRequest>;

export const UpdateDraftRequest = z
  .object({
    title: optionalText,
    subtitle: optionalText,
    body: optionalText,
    expected_updated_at: z.string().nullable().optional().openapi({
      description:
        'The `updated_at` value returned when the draft was last read. When set, the update is rejected with 409 if the draft has changed since.',
    }),
  })
  .openapi('UpdateDraftRequest');
export type UpdateDraftRequest = z.infer<typeof UpdateDraftRequest>;

export type DraftUpdates = {
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
};

/** `provided_updates()`: the subset of {title, subtitle, body} the caller actually set. */
export function providedUpdates(req: UpdateDraftRequest): DraftUpdates {
  const out: DraftUpdates = {};
  for (const name of ['title', 'subtitle', 'body'] as const) {
    if (Object.hasOwn(req, name)) out[name] = req[name] ?? null;
  }
  return out;
}

const ISO_DATETIME_HINT = { type: 'string', format: 'date-time' } as const;

export const ScheduleDraftRequest = z
  .object({
    // pydantic `datetime`: an ISO-8601 string or a unix timestamp; checked by the route.
    scheduled_at: z.union([z.string(), z.number()]).openapi(ISO_DATETIME_HINT),
    post_audience: optionalText,
    email_audience: optionalText,
  })
  .openapi('ScheduleDraftRequest');
export type ScheduleDraftRequest = z.infer<typeof ScheduleDraftRequest>;

// ---- Gateway responses ----

export const DraftSummaryResponse = z
  .object({
    id: z.number().int(),
    uuid: z.string(),
    title: z.string().nullable(),
    updated: z.string().nullable(),
  })
  .openapi('DraftSummaryResponse');
export type DraftSummaryResponse = z.infer<typeof DraftSummaryResponse>;

export const DraftsListResponse = z
  .object({ items: z.array(DraftSummaryResponse), next: z.string().nullable() })
  .openapi('DraftsListResponse');
export type DraftsListResponse = z.infer<typeof DraftsListResponse>;

export const CreateDraftResponse = z
  .object({ id: z.number().int(), uuid: z.string() })
  .openapi('CreateDraftResponse');
export type CreateDraftResponse = z.infer<typeof CreateDraftResponse>;

export const DraftResponse = z
  .object({
    title: z.string().nullable(),
    subtitle: z.string().nullable(),
    body: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .openapi('DraftResponse');
export type DraftResponse = z.infer<typeof DraftResponse>;

export const ScheduleDraftResponse = z
  .object({ scheduled_at: z.string(), post_audience: z.string(), email_audience: z.string() })
  .openapi('ScheduleDraftResponse');
export type ScheduleDraftResponse = z.infer<typeof ScheduleDraftResponse>;

export const PrepublishResponse = z
  .object({ errors: z.array(z.unknown()), suggestions: z.array(z.unknown()) })
  .openapi('PrepublishResponse');
export type PrepublishResponse = z.infer<typeof PrepublishResponse>;

export const AiDetectionResponse = z
  .object({
    type: z.string().nullable(),
    header: z.string().nullable(),
    details: z.string().nullable(),
    fraction_ai: z.number().nullable(),
    fraction_ai_assisted: z.number().nullable(),
    fraction_human: z.number().nullable(),
    can_disable: z.boolean().nullable(),
    can_modify_disclosure: z.boolean().nullable(),
  })
  .openapi('AiDetectionResponse');
export type AiDetectionResponse = z.infer<typeof AiDetectionResponse>;

export const ImageUploadResult = z
  .object({
    id: z.number().int(),
    url: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    bytes: z.number().int(),
    content_type: z.string(),
  })
  .openapi('ImageUploadResult');
export type ImageUploadResult = z.infer<typeof ImageUploadResult>;

// ---- Mapping (upstream `from_substack`) ----

export function draftsListResponse(
  drafts: readonly SubstackDraftSummary[],
  nextCursor: string | null,
): DraftsListResponse {
  return {
    items: drafts.map((d) => ({
      id: d.id,
      uuid: d.uuid,
      title: d.draft_title ?? null,
      updated: d.draft_updated_at ?? null,
    })),
    next: nextCursor,
  };
}

export function createDraftResponse(draft: SubstackDraftCreated): CreateDraftResponse {
  return { id: draft.id, uuid: draft.uuid };
}

/** Serializer warnings go to the request's logger, tagged with its request id. */
export const warnTo =
  (ctx: GatewayContext) =>
  (message: string): void =>
    ctx.log.warn(message, { request_id: ctx.requestId });

/**
 * The stored body comes back as dialect Markdown. `warn` receives serializer
 * warnings: pass the request's logger, never a module-level sink.
 */
export function draftResponse(
  draft: SubstackDraft,
  warn: (message: string) => void,
): DraftResponse {
  return {
    title: draft.draft_title ?? null,
    subtitle: draft.draft_subtitle ?? null,
    // Python truthiness: an empty stored body is None.
    body: draft.draft_body ? draftBodyToMarkdown(draft.draft_body, warn) : null,
    updated_at: draft.draft_updated_at ?? null,
  };
}

export function scheduleDraftResponse(release: SubstackScheduledRelease): ScheduleDraftResponse {
  return {
    scheduled_at: release.trigger_at,
    post_audience: release.post_audience,
    email_audience: release.email_audience,
  };
}

export function prepublishResponse(data: SubstackPrepublish): PrepublishResponse {
  return { errors: data.errors, suggestions: data.suggestions };
}

export function aiDetectionResponse(d: SubstackAiDetection): AiDetectionResponse {
  return {
    type: d.type ?? null,
    header: d.header ?? null,
    details: d.details ?? null,
    fraction_ai: d.fraction_ai ?? null,
    fraction_ai_assisted: d.fraction_ai_assisted ?? null,
    fraction_human: d.fraction_human ?? null,
    can_disable: d.can_disable ?? null,
    can_modify_disclosure: d.can_modify_disclosure ?? null,
  };
}

export function imageUploadResult(image: UploadedImage): ImageUploadResult {
  return {
    id: image.id,
    url: image.url,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    content_type: image.contentType,
  };
}
