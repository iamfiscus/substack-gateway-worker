// Port of DraftsService in gateway_drafts/service.py (upstream bc2e875).

import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients } from '../context';
import { pyJsonDumps } from '../converters/dialect/pyJson';
import { pyRepr } from '../converters/dialect/pyRepr';
import { markdownToDraftDoc } from '../converters/draftMarkdown';
import { resolveDraftBody } from '../converters/resolveDraftBody';
import { decodeOffset, encodeOffset } from '../drafts/cursor';
import {
  type DraftUpdates,
  SubstackAiDetection,
  SubstackDraft,
  SubstackDraftCreated,
  type SubstackDraftSummary,
  SubstackDraftsPage,
  SubstackPrepublish,
  type SubstackScheduledRelease,
} from '../schemas/drafts';
import { parseSubstack } from '../schemas/parse';
import { ImagesService, type UploadedImage } from './images';
import { WatermarkService } from './watermark';

/** The draft changed upstream since the caller last read it. */
export class DraftConflictError extends Error {
  readonly draftId: number;
  readonly current: string | null;

  constructor(draftId: number, current: string | null) {
    super(
      `Draft ${draftId} changed since it was read (now ${current === null ? 'None' : current}); ` +
        'fetch it again before updating.',
    );
    this.name = 'DraftConflictError';
    this.draftId = draftId;
    this.current = current;
  }
}

// Python `datetime.fromisoformat` (3.11+) after upstream's `Z` -> `+00:00`:
// extended or basic date, any one-character separator, optional time with
// fraction, optional `±HH[:MM[:SS[.f]]]` offset.
const ISO_DATE = /^(\d{4})-?(\d{2})-?(\d{2})/;
const ISO_TIME = /^(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,]\d+)?)?)?/;
const ISO_OFFSET = /^([+-])(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,]\d+)?)?)?$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Epoch milliseconds of an ISO-8601 string, or null when Python would reject it. */
function parseIsoformat(text: string): number | null {
  const d = ISO_DATE.exec(text);
  if (!d) return null;
  // Python rejects a mixed form such as `2026-0916`.
  const dateLen = d[0].length;
  if (dateLen !== 8 && dateLen !== 10) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  let rest = text.slice(dateLen);
  let [hour, minute, second, offsetMs] = [0, 0, 0, 0];
  if (rest !== '') {
    rest = rest.slice(1); // the separator
    const t = ISO_TIME.exec(rest);
    if (!t) return null;
    [hour, minute, second] = [Number(t[1]), Number(t[2] ?? 0), Number(t[3] ?? 0)];
    if (hour > 23 || minute > 59 || second > 59) return null;
    rest = rest.slice(t[0].length);
    if (rest !== '') {
      const o = ISO_OFFSET.exec(rest);
      if (!o) return null;
      const [oh, om, os] = [Number(o[2]), Number(o[3] ?? 0), Number(o[4] ?? 0)];
      if (oh > 23 || om > 59 || os > 59) return null;
      offsetMs = (o[1] === '-' ? -1 : 1) * ((oh * 60 + om) * 60 + os) * 1000;
    }
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
}

function formatTriggerAt(epochMs: number): string {
  // `%Y-%m-%dT%H:%M:%S.000Z`: whole seconds, the fraction always zero.
  return `${new Date(Math.floor(epochMs / 1000) * 1000).toISOString().slice(0, 19)}.000Z`;
}

/**
 * Normalize a Date or ISO-8601 string to Substack's UTC trigger format. A
 * string without an offset is UTC. Throws `Invalid isoformat string: '...'`.
 */
export function toTriggerAt(value: string | Date): string {
  if (value instanceof Date) return formatTriggerAt(value.getTime());
  const text = value.replaceAll('Z', '+00:00');
  const epoch = parseIsoformat(text);
  if (epoch === null) throw new Error(`Invalid isoformat string: ${pyRepr(text)}`);
  return formatTriggerAt(epoch);
}

/** True when `toTriggerAt` accepts `value`. */
export function isTriggerAt(value: string): boolean {
  return parseIsoformat(value.replaceAll('Z', '+00:00')) !== null;
}

const UPDATE_FIELD_MAP = {
  title: 'draft_title',
  subtitle: 'draft_subtitle',
  body: 'draft_body',
} as const;

/** Markdown -> doc -> media placeholders resolved -> `json.dumps(ensure_ascii=False)`. */
export async function buildDraftBody(
  ctx: GatewayContext,
  creds: BearerCredentials,
  markdown: string,
): Promise<string> {
  const doc = markdownToDraftDoc(markdown);
  const { publication } = makeClients(ctx, creds);
  const resolved = await resolveDraftBody(doc, {
    images: new ImagesService(publication),
    watermark: new WatermarkService(publication),
    pub: publication,
  });
  return pyJsonDumps(resolved);
}

/** GET /post_management/drafts: cursor-paginated drafts, newest first. */
export async function listDrafts(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { cursor?: string | null; limit?: number },
): Promise<{ drafts: SubstackDraftSummary[]; nextCursor: string | null }> {
  const limit = args.limit ?? 10;
  const offset = args.cursor ? decodeOffset(args.cursor) : 0;
  const body = await makeClients(ctx, creds).publication.get('post_management/drafts', {
    query: { offset, limit, order_by: 'draft_updated_at', order_direction: 'desc' },
  });
  const page = parseSubstack(SubstackDraftsPage, body, 'drafts');
  const drafts = Array.isArray(page) ? page : page.posts;
  const total = Array.isArray(page) ? null : (page.total ?? null);
  const consumed = offset + drafts.length;
  const hasMore = drafts.length === limit && (total === null || consumed < total);
  return { drafts, nextCursor: hasMore ? encodeOffset(consumed) : null };
}

/** GET /drafts/{id}. */
export async function getDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { draftId: number },
): Promise<SubstackDraft> {
  const body = await makeClients(ctx, creds).publication.get(`drafts/${args.draftId}`);
  return parseSubstack(SubstackDraft, body, 'draft');
}

/**
 * PUT /drafts/{id}: update only the provided fields. With `expectedUpdatedAt`
 * the draft is read first and the update refused with DraftConflictError (no
 * PUT sent) unless its `draft_updated_at` matches exactly. As upstream says,
 * the read and the write are two requests: the check is not atomic.
 */
export async function updateDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { draftId: number; updates: DraftUpdates; expectedUpdatedAt?: string | null },
): Promise<SubstackDraft> {
  const { draftId, updates } = args;
  if (args.expectedUpdatedAt != null) {
    const current = (await getDraft(ctx, creds, { draftId })).draft_updated_at ?? null;
    if (current !== args.expectedUpdatedAt) throw new DraftConflictError(draftId, current);
  }
  const payload: Record<string, string | null> = {};
  // Field order, as `model_dump(exclude_unset=True)` writes it.
  for (const name of ['title', 'subtitle', 'body'] as const) {
    if (!Object.hasOwn(updates, name)) continue;
    let value = updates[name] ?? null;
    if (name === 'body' && value !== null) value = await buildDraftBody(ctx, creds, value);
    payload[UPDATE_FIELD_MAP[name]] = value;
  }
  const body = await makeClients(ctx, creds).publication.put(`drafts/${draftId}`, {
    json: payload,
  });
  return parseSubstack(SubstackDraft, body, 'draft');
}

/** DELETE /drafts/{id}. */
export async function deleteDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { draftId: number },
): Promise<void> {
  await makeClients(ctx, creds).publication.delete(`drafts/${args.draftId}`);
}

/** POST /drafts: the byline is the caller's own user id from G `user-settings`. */
export async function createDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { title?: string | null; subtitle?: string | null; body?: string | null },
): Promise<SubstackDraftCreated> {
  const { substack, publication } = makeClients(ctx, creds);
  const userId = await substack.getOwnUserId();
  const payload = {
    draft_title: args.title || '',
    draft_subtitle: args.subtitle || '',
    draft_podcast_url: null,
    draft_podcast_duration: null,
    draft_body: args.body ? await buildDraftBody(ctx, creds, args.body) : '',
    section_chosen: false,
    draft_section_id: null,
    draft_bylines: [{ id: userId, is_guest: false }],
    audience: 'only_paid',
    type: 'newsletter',
  };
  const body = await publication.post('drafts', { json: payload });
  return parseSubstack(SubstackDraftCreated, body, 'created draft');
}

/** GET /drafts/{id}/pangram_detection: Pangram AI-writing scan. */
export async function aiDetection(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { draftId: number },
): Promise<SubstackAiDetection> {
  const body = await makeClients(ctx, creds).publication.get(
    `drafts/${args.draftId}/pangram_detection`,
  );
  return parseSubstack(SubstackAiDetection, body, 'AI detection');
}

/** GET /drafts/{id}/prepublish: editor pre-publish validation. */
export async function prepublishDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { draftId: number },
): Promise<SubstackPrepublish> {
  const body = await makeClients(ctx, creds).publication.get(`drafts/${args.draftId}/prepublish`);
  return parseSubstack(SubstackPrepublish, body, 'prepublish');
}

/** POST /drafts/{id}/scheduled_release: schedule a timed release. */
export async function scheduleDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: {
    draftId: number;
    scheduledAt: string | Date;
    postAudience?: string;
    emailAudience?: string;
  },
): Promise<SubstackScheduledRelease> {
  const release: SubstackScheduledRelease = {
    trigger_at: toTriggerAt(args.scheduledAt),
    post_audience: args.postAudience ?? 'only_paid',
    email_audience: args.emailAudience ?? 'only_paid',
  };
  await makeClients(ctx, creds).publication.post(`drafts/${args.draftId}/scheduled_release`, {
    json: release,
  });
  return release;
}

/** DELETE /drafts/{id}/scheduled_release: cancel a scheduled release. */
export async function unscheduleDraft(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { draftId: number },
): Promise<void> {
  await makeClients(ctx, creds).publication.delete(`drafts/${args.draftId}/scheduled_release`);
}

/** POST /image: re-host a data URI or URL on Substack. */
export function uploadImage(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { image: string },
): Promise<UploadedImage> {
  return new ImagesService(makeClients(ctx, creds).publication).upload(args.image);
}
