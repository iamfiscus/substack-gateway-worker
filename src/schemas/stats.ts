// Port of gateway_stats/schemas.py (upstream bc2e875). Substack rows and
// payloads are mapped by the `*Response` functions, which validate their own
// output so a wrongly-typed Substack field is a 502, never a 500.

import { z } from '@hono/zod-openapi';
import { parseSubstack } from './parse';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** `data.get(key) or {}` for object-shaped values. */
const rec = (v: unknown): Rec => (isRec(v) ? v : {});
/** `data.get(key) or []`. */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** `x or 0`. */
const orZero = (v: unknown): unknown => (v ? v : 0);
const nn = (v: unknown): unknown => (v === undefined ? null : v);

const int = z.number().int().nullable();
const str = z.string().nullable();
const bool = z.boolean().nullable();
const recList = z.array(z.record(z.string(), z.unknown()));

// ---- parse_money ----

const MONEY_PLAIN = /^\d+(\.\d+)?$/;
const MONEY_GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
// [-] [symbol of 0-3 chars] [-] number, with optional whitespace between parts.
// The Unicode minus (U+2212) counts as "-" in both sign positions.
const MONEY_SHAPE = /^\s*([-−]?)\s*[^\d\s.,\-−]{0,3}\s*([-−]?)\s*([\d.,]+)\s*$/u;

/**
 * Parse a Substack money cell ("$1,262.40") into a number. Currency symbols
 * are discarded, never interpreted. Ambiguous or locale-formatted strings
 * ("€1.234,56", "1.5M", "12 USD") yield null rather than a guessed number.
 */
export function parseMoney(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const shape = MONEY_SHAPE.exec(value);
  if (shape === null) return null;
  const negative = Boolean(shape[1] || shape[2]);
  const digits = shape[3] as string;
  let number: number;
  if (MONEY_PLAIN.test(digits)) number = Number(digits);
  else if (MONEY_GROUPED.test(digits)) number = Number(digits.replaceAll(',', ''));
  else return null;
  return negative ? -number : number;
}

// ---- Timeseries ----

export const SubscriberPoint = z
  .object({
    date: z.string(),
    paid: int,
    comps: int,
    free_trials: int,
    total: int,
  })
  .openapi('SubscriberPoint');
export type SubscriberPoint = z.infer<typeof SubscriberPoint>;

export const SubscriberTimeseriesResponse = z
  .object({ items: z.array(SubscriberPoint) })
  .openapi('SubscriberTimeseriesResponse');
export type SubscriberTimeseriesResponse = z.infer<typeof SubscriberTimeseriesResponse>;

const cell = (row: unknown[], i: number): unknown => nn(row[i]);

export function subscriberTimeseriesResponse(rows: unknown[][]): SubscriberTimeseriesResponse {
  return parseSubstack(
    SubscriberTimeseriesResponse,
    {
      items: rows.map((r) => ({
        date: cell(r, 0),
        paid: cell(r, 1),
        comps: cell(r, 2),
        free_trials: cell(r, 3),
        total: cell(r, 4),
      })),
    },
    'subscriber timeseries',
  );
}

export const ArrPoint = z
  .object({ date: z.string(), arr: z.number().nullable(), arr_display: str })
  .openapi('ArrPoint');
export type ArrPoint = z.infer<typeof ArrPoint>;

/** Python `str(cell)` for the JSON scalar types. */
function display(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

export function arrPointFromRow(row: unknown[]): ArrPoint {
  const c = cell(row, 1);
  return parseSubstack(
    ArrPoint,
    { date: cell(row, 0), arr: parseMoney(c), arr_display: display(c) },
    'ARR timeseries',
  );
}

export const ArrTimeseriesResponse = z
  .object({ items: z.array(ArrPoint) })
  .openapi('ArrTimeseriesResponse');
export type ArrTimeseriesResponse = z.infer<typeof ArrTimeseriesResponse>;

export function arrTimeseriesResponse(rows: unknown[][]): ArrTimeseriesResponse {
  return { items: rows.map(arrPointFromRow) };
}

export const EmailPoint = z.object({ date: z.string(), emails: int }).openapi('EmailPoint');
export type EmailPoint = z.infer<typeof EmailPoint>;

export function emailPointFromRow(row: unknown[]): EmailPoint {
  return parseSubstack(
    EmailPoint,
    { date: cell(row, 0), emails: cell(row, 1) },
    'email timeseries',
  );
}

export const EmailTimeseriesResponse = z
  .object({ items: z.array(EmailPoint) })
  .openapi('EmailTimeseriesResponse');
export type EmailTimeseriesResponse = z.infer<typeof EmailTimeseriesResponse>;

export function emailTimeseriesResponse(rows: unknown[][]): EmailTimeseriesResponse {
  return { items: rows.map(emailPointFromRow) };
}

export const ThirtyDayViewsResponse = z
  .object({ views_30d: z.number().int().default(0), views_delta_30d: z.number().int().default(0) })
  .openapi('ThirtyDayViewsResponse');
export type ThirtyDayViewsResponse = z.infer<typeof ThirtyDayViewsResponse>;

export function thirtyDayViewsResponse(data: Rec): ThirtyDayViewsResponse {
  return parseSubstack(
    ThirtyDayViewsResponse,
    { views_30d: orZero(data.views30d), views_delta_30d: orZero(data.viewsDelta30d) },
    '30d views',
  );
}

// ---- Per-post stats ----
//
// Large nested Substack objects: the meaningful top-level structure is
// pinned, deeply-nested rows pass through untyped.

export const PostEngagementResponse = z
  .object({
    likes_count: z.number().int().default(0),
    comment_count: z.number().int().default(0),
    commenter_count: z.number().int().default(0),
    likes: recList,
    comments: recList,
    commenters: recList,
  })
  .openapi('PostEngagementResponse');
export type PostEngagementResponse = z.infer<typeof PostEngagementResponse>;

export function postEngagementResponse(data: Rec): PostEngagementResponse {
  const likes = rec(data.likes);
  const summary = rec(data.commentSummary);
  const commenters = rec(data.commenters);
  return parseSubstack(
    PostEngagementResponse,
    {
      likes_count: orZero(likes.count),
      comment_count: orZero(summary.total),
      commenter_count: orZero(commenters.count),
      likes: list(likes.users),
      comments: list(summary.comments),
      commenters: list(commenters.users),
    },
    'post engagement',
  );
}

export const PostTrafficResponse = z
  .object({ referrers: recList, devices: recList, categories: recList })
  .openapi('PostTrafficResponse');
export type PostTrafficResponse = z.infer<typeof PostTrafficResponse>;

export function postTrafficResponse(data: Rec): PostTrafficResponse {
  return parseSubstack(
    PostTrafficResponse,
    {
      referrers: list(data.referrers),
      devices: list(data.devices),
      categories: list(data.categories),
    },
    'post traffic',
  );
}

export const PostRecipientsResponse = z
  .object({ rows: recList, total: z.number().int().default(0) })
  .openapi('PostRecipientsResponse');
export type PostRecipientsResponse = z.infer<typeof PostRecipientsResponse>;

export function postRecipientsResponse(data: Rec): PostRecipientsResponse {
  return parseSubstack(
    PostRecipientsResponse,
    { rows: list(data.rows), total: orZero(data.total) },
    'post recipients',
  );
}

export const PostDiscussionResponse = z
  .object({ items: recList, next_cursor: str, tabs: recList, tab_id: str })
  .openapi('PostDiscussionResponse');
export type PostDiscussionResponse = z.infer<typeof PostDiscussionResponse>;

export function postDiscussionResponse(data: Rec): PostDiscussionResponse {
  return parseSubstack(
    PostDiscussionResponse,
    {
      items: list(data.items),
      next_cursor: nn(data.nextCursor),
      tabs: list(data.tabs),
      tab_id: nn(data.tabId),
    },
    'post discussion',
  );
}

/** Growth attribution: passed through verbatim (shape not pinned). */
export const PostGrowthResponse = z.record(z.string(), z.unknown()).openapi('PostGrowthResponse');
export type PostGrowthResponse = z.infer<typeof PostGrowthResponse>;

// ---- Dashboard ----

export const DashboardSummaryResponse = z
  .object({
    app_subscribers: int,
    app_subscribers_last_30_days: int,
    subscribers: int,
    subscribers_last_30_days: int,
    total_email: int,
    total_email_last_30_days: int,
    arr: z.number().nullable(),
    arr_delta: z.number().nullable(),
    views: int,
    views_delta: int,
    open_rate: z.number().nullable(),
    open_rate_diff: z.number().nullable(),
    pledges_amount: z.number().nullable(),
    num_pledges: int,
    pledge_currency: str,
    is_bestseller: bool,
  })
  .openapi('DashboardSummaryResponse');
export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponse>;

export function dashboardSummaryResponse(data: Rec): DashboardSummaryResponse {
  return parseSubstack(
    DashboardSummaryResponse,
    {
      app_subscribers: nn(data.appSubscribers),
      app_subscribers_last_30_days: nn(data.appSubscribersLast30Days),
      subscribers: nn(data.subscribers),
      subscribers_last_30_days: nn(data.subscribersLast30Days),
      total_email: nn(data.totalEmail),
      total_email_last_30_days: nn(data.totalEmailLast30Days),
      arr: parseMoney(data.arr),
      arr_delta: parseMoney(data.arrDelta),
      views: nn(data.views),
      views_delta: nn(data.viewsDelta),
      open_rate: nn(data.openRate),
      open_rate_diff: nn(data.openRateDiff),
      pledges_amount: parseMoney(data.pledgesAmount),
      num_pledges: nn(data.numPledges),
      pledge_currency: nn(data.pledgeCurrency),
      is_bestseller: nn(data.isBestseller),
    },
    'dashboard summary',
  );
}

/** A metric at the start and end of a period. */
export const PeriodValue = z
  .object({ start: z.number().nullable(), end: z.number().nullable() })
  .openapi('PeriodValue');

export const DashboardPeriodResponse = z
  .object({
    range_days: z.number().int(),
    total_subscribers: PeriodValue,
    paid_subscribers: PeriodValue,
    arr: PeriodValue,
    total_views: PeriodValue,
    pledged_arr: PeriodValue,
  })
  .openapi('DashboardPeriodResponse');
export type DashboardPeriodResponse = z.infer<typeof DashboardPeriodResponse>;

export function dashboardPeriodResponse(data: Rec, rangeDays: number): DashboardPeriodResponse {
  const count = (key: string) => ({ start: nn(data[`${key}Start`]), end: nn(data[`${key}End`]) });
  const money = (key: string) => ({
    start: parseMoney(data[`${key}Start`]),
    end: parseMoney(data[`${key}End`]),
  });
  return parseSubstack(
    DashboardPeriodResponse,
    {
      range_days: rangeDays,
      total_subscribers: count('totalSubscribers'),
      paid_subscribers: count('paidSubscribers'),
      arr: money('arr'),
      total_views: count('totalViews'),
      pledged_arr: money('pledgedArr'),
    },
    'dashboard period',
  );
}

export const RecommendedPublication = z
  .object({ id: int, name: str, subdomain: str, custom_domain: str, logo_url: str })
  .openapi('RecommendedPublication');

export const RecommendationStat = z
  .object({
    publication: RecommendedPublication,
    signups: int,
    signups_last_30_days: int,
    paid_subs: int,
    is_mutual: bool,
    is_active: bool,
    created_at: str,
    first_activity_at: str,
    data_updated_at: str,
  })
  .openapi('RecommendationStat');
export type RecommendationStat = z.infer<typeof RecommendationStat>;

export type RecommendationDirection = 'outgoing' | 'incoming';

/**
 * One recommendation relationship. Accepts both the slimmed row (publication
 * under `pub`) and the raw Substack row (`target_pub` outgoing, `source_pub`
 * incoming).
 */
export function recommendationStat(row: Rec, direction: string): RecommendationStat {
  // Counterpart first: target_pub when outgoing, source_pub when incoming.
  const counterpart =
    direction === 'incoming' ? ['source_pub', 'target_pub'] : ['target_pub', 'source_pub'];
  let pub: Rec = {};
  for (const key of ['pub', ...counterpart]) {
    if (isRec(row[key])) {
      pub = row[key] as Rec;
      break;
    }
  }
  let pubId = pub.id;
  if (pubId === null || pubId === undefined) {
    pubId = row[direction === 'outgoing' ? 'target_publication_id' : 'publication_id'];
  }
  return parseSubstack(
    RecommendationStat,
    {
      publication: {
        id: nn(pubId),
        name: nn(pub.name),
        subdomain: nn(pub.subdomain),
        custom_domain: nn(pub.custom_domain),
        logo_url: nn(pub.logo_url),
      },
      signups: nn(row.xp_signups),
      signups_last_30_days: nn(row.xp_signups_last_30_days),
      paid_subs: nn(row.xp_paid_subs),
      is_mutual: nn(row.is_mutual),
      is_active: nn(row.is_active),
      created_at: nn(row.created_at),
      first_activity_at: nn(row.first_activity_at),
      data_updated_at: nn(row.data_updated_at),
    },
    'recommendation stats',
  );
}

export const RecommendationStatsResponse = z
  .object({
    direction: z.enum(['outgoing', 'incoming']),
    items: z.array(RecommendationStat),
    next_offset: z.number().int().nullable(),
  })
  .openapi('RecommendationStatsResponse');
export type RecommendationStatsResponse = z.infer<typeof RecommendationStatsResponse>;

export function recommendationStatsResponse(
  data: Rec,
  direction: RecommendationDirection,
  offset: number,
  limit: number,
): RecommendationStatsResponse {
  const rows = list(data.rows);
  const items = rows.map((row) => recommendationStat(rec(row), direction));
  return {
    direction,
    items,
    next_offset: items.length === limit ? offset + limit : null,
  };
}

export const PostCountsResponse = z
  .object({
    published: int,
    published_is_capped: bool,
    drafts: int,
    drafts_is_capped: bool,
    scheduled: int,
    scheduled_is_capped: bool,
  })
  .openapi('PostCountsResponse');
export type PostCountsResponse = z.infer<typeof PostCountsResponse>;

export function postCountsResponse(data: Rec): PostCountsResponse {
  return parseSubstack(
    PostCountsResponse,
    {
      published: nn(data.published),
      published_is_capped: nn(data.publishedIsCapped),
      drafts: nn(data.drafts),
      drafts_is_capped: nn(data.draftsIsCapped),
      scheduled: nn(data.scheduled),
      scheduled_is_capped: nn(data.scheduledIsCapped),
    },
    'post counts',
  );
}
