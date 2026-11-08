// Port of gateway_stats service.py, dashboard.py and snapshot.py (upstream
// bc2e875). Services return Substack-shaped data (rows, snapshots); the
// REST routes and MCP tools map it with src/schemas/stats.ts, as upstream does.
//
// `ctx.statsCache` is null unless an extension installs one (`kvStatsCache`,
// owner mode only, and only for resolved credentials): with no cache nothing is
// retained and every call reaches Substack.

import { z } from 'zod';
import type { BearerCredentials } from '../auth/credentials';
import { type GatewayContext, makeClients, type StatsCache, type StatsRow } from '../context';
import { parseSubstack } from '../schemas/parse';
import type { RecommendationDirection } from '../schemas/stats';

type Snapshot = Record<string, unknown>;
const SnapshotBody = z.record(z.string(), z.unknown());

// ---- snapshot.py ----

/** Serve `key` from the snapshot cache, or fetch, store and return it. */
export async function cachedSnapshot(
  cache: StatsCache | null,
  publicationUrl: string,
  key: string,
  fetch: () => Promise<Snapshot>,
): Promise<Snapshot> {
  const cached = cache ? await cache.getSnapshot(publicationUrl, key) : null;
  if (cached !== null) return cached;
  const data = await fetch();
  await cache?.setSnapshot(publicationUrl, key, data);
  return data;
}

/** GET `path` on the publication host and require a JSON object (else 502). */
async function getSnapshotBody(
  ctx: GatewayContext,
  creds: BearerCredentials,
  path: string,
  what: string,
  query?: Record<string, string | number | undefined>,
): Promise<Snapshot> {
  const body = await makeClients(ctx, creds).publication.get(path, query ? { query } : undefined);
  return parseSubstack(SnapshotBody, body, what);
}

// ---- service.py: timeseries ----

type Series = 'subscribers' | 'arr' | 'emails';

// Substack timeseries endpoints, keyed by the series name we cache under.
const TIMESERIES_ENDPOINTS: Record<Series, string> = {
  subscribers: 'publication/stats/subscribers/timeseries',
  arr: 'publication/stats/arr/timeseries',
  emails: 'publication/stats/emails/timeseries',
};

// Substack date buckets look like "2025/07/10".
const DATE_BUCKET = /^\d{4}\/\d{2}\/\d{2}$/;

// Kept deliberately short: without a cache this window is refetched on every
// call, and `from` is available per call for anything wider.
export const DEFAULT_LOOKBACK_DAYS = 7;
const SNAPSHOT_30D_VIEWS = 'traffic_30d_views';
const DAY_MS = 86_400_000;

/** Day number (UTC midnight, ms) of a "YYYY/MM/DD" bucket. */
function bucketToDay(bucket: string): number {
  const [y, m, d] = bucket.split('/').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Accept "2025-07-10T10:52:11.615Z" or "2025-07-10"; only the day matters. */
function isoToDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
  const day = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
  // Date.UTC rolls 2025-02-31 over; fromisoformat would reject it.
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== iso.slice(0, 10)) {
    throw new Error(`Invalid isoformat string: '${iso}'`);
  }
  return day;
}

const dayToIso = (day: number): string => `${new Date(day).toISOString().slice(0, 10)}T00:00:00Z`;

/**
 * ISO `from` cursor: the watermark date minus a lag so maturing days are
 * re-fetched and overwritten rather than frozen at stale values.
 */
function watermarkFrom(watermark: string, lagDays: number): string {
  return dayToIso(bucketToDay(watermark) - lagDays * DAY_MS);
}

/**
 * Turn a Substack timeseries payload into date -> row. No header row is
 * assumed: the whole payload is scanned and only rows whose first cell is a
 * `YYYY/MM/DD` bucket are kept.
 */
export function rowsByDate(payload: unknown): Record<string, StatsRow> {
  if (!Array.isArray(payload)) return {};
  const result: Record<string, StatsRow> = {};
  for (const row of payload) {
    if (
      Array.isArray(row) &&
      row.length > 0 &&
      typeof row[0] === 'string' &&
      DATE_BUCKET.test(row[0])
    ) {
      result[row[0]] = row;
    }
  }
  return result;
}

export type TimeseriesArgs = {
  /** ISO lower bound for the returned window. */
  from?: string | null;
  /** Injectable clock for the default window; tests pass a fixed one. */
  now?: () => Date;
};

async function timeseries(
  ctx: GatewayContext,
  creds: BearerCredentials,
  series: Series,
  args: TimeseriesArgs,
): Promise<StatsRow[]> {
  const from = args.from || null;
  const cache = ctx.statsCache;
  const pubUrl = creds.publication_url;
  const cached = cache ? await cache.readTimeseries(pubUrl, series) : {};
  const cachedBuckets = Object.keys(cached).sort();

  let fetchFrom: string;
  if (cachedBuckets.length > 0) {
    const watermark = cachedBuckets[cachedBuckets.length - 1] as string;
    fetchFrom = watermarkFrom(watermark, ctx.config.watermarkLagDays);
    // A warm cache must still be able to widen. When the caller asks for a
    // window starting before the oldest row held, fetch from there instead:
    // the endpoint takes only `from` and returns through to now, so one
    // request covers both the missing prefix and the tail.
    if (from && isoToDay(from) < bucketToDay(cachedBuckets[0] as string)) {
      // Take the EARLIER of the two, never a straight overwrite: with a large
      // lag the watermark date can already be earlier than `from`.
      fetchFrom = from < fetchFrom ? from : fetchFrom;
    }
  } else {
    const now = (args.now ?? (() => new Date()))();
    fetchFrom = from ?? dayToIso(now.getTime() - DEFAULT_LOOKBACK_DAYS * DAY_MS);
  }

  ctx.log.debug(
    `Fetching ${series} timeseries from=${fetchFrom} (cached_rows=${cachedBuckets.length})`,
    {
      request_id: ctx.requestId,
    },
  );
  const body = await makeClients(ctx, creds).publication.get(TIMESERIES_ENDPOINTS[series], {
    query: { from: fetchFrom },
  });
  const fresh = rowsByDate(body);
  if (Object.keys(fresh).length > 0) await cache?.writeTimeseries(pubUrl, series, fresh);

  const merged = { ...cached, ...fresh };
  let rows = Object.keys(merged)
    .sort()
    .map((bucket) => merged[bucket] as StatsRow);
  if (from) {
    const floor = isoToDay(from);
    rows = rows.filter((row) => bucketToDay(row[0] as string) >= floor);
  }
  return rows;
}

/** Daily subscriber counts (paid / comps / free trials / total), header stripped, sorted. */
export const getSubscriberTimeseries = (
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: TimeseriesArgs,
) => timeseries(ctx, creds, 'subscribers', args);

/** Daily annualized recurring revenue (raw money strings, e.g. "$258.19"). */
export const getArrTimeseries = (
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: TimeseriesArgs,
) => timeseries(ctx, creds, 'arr', args);

/** Daily email subscriber counts. */
export const getEmailTimeseries = (
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: TimeseriesArgs,
) => timeseries(ctx, creds, 'emails', args);

/** Trailing-30-day view count and its delta (snapshot). */
export function getThirtyDayViews(ctx: GatewayContext, creds: BearerCredentials) {
  return cachedSnapshot(ctx.statsCache, creds.publication_url, SNAPSHOT_30D_VIEWS, () =>
    getSnapshotBody(ctx, creds, 'publication/stats/publication_traffic/30d_views', '30d views'),
  );
}

// ---- dashboard.py ----

const SUMMARY = 'publish-dashboard/summary';
const SUMMARY_V2 = 'publish-dashboard/summary-v2';
const POST_COUNTS = 'post_management/counts';

const ROW_KEYS = [
  'publication_id',
  'target_publication_id',
  'xp_signups',
  'xp_signups_last_30_days',
  'xp_paid_subs',
  'is_mutual',
  'is_active',
  'created_at',
  'first_activity_at',
  'data_updated_at',
];
const PUB_KEYS = ['id', 'name', 'subdomain', 'custom_domain', 'logo_url'];

const RECOMMENDATION_PATHS: Record<RecommendationDirection, string> = {
  outgoing: 'recommendations/stats/from',
  incoming: 'recommendations/stats/to',
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = (src: Rec, keys: string[]): Rec =>
  Object.fromEntries(keys.filter((k) => k in src).map((k) => [k, src[k]]));

function slimPub(row: Rec, direction: RecommendationDirection): Rec | null {
  // The counterpart is the target publication for outgoing rows and the
  // source publication for incoming rows; the other key is this publication.
  const keys =
    direction === 'incoming' ? ['source_pub', 'target_pub'] : ['target_pub', 'source_pub'];
  for (const key of keys) {
    const pub = row[key];
    if (isRec(pub)) return pick(pub, PUB_KEYS);
  }
  return null;
}

function slimRow(row: Rec, direction: RecommendationDirection): Rec {
  return { ...pick(row, ROW_KEYS), pub: slimPub(row, direction) };
}

/** Headline dashboard numbers for the publication. */
export function dashboardSummary(ctx: GatewayContext, creds: BearerCredentials) {
  return cachedSnapshot(ctx.statsCache, creds.publication_url, 'dashboard_summary', () =>
    getSnapshotBody(ctx, creds, SUMMARY, 'dashboard summary'),
  );
}

/** Dashboard summary over the trailing `rangeDays` days. */
export function dashboardPeriod(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { rangeDays?: number },
) {
  const rangeDays = args.rangeDays ?? 365;
  return cachedSnapshot(
    ctx.statsCache,
    creds.publication_url,
    `dashboard_period:${rangeDays}`,
    () => getSnapshotBody(ctx, creds, SUMMARY_V2, 'dashboard period', { range: rangeDays }),
  );
}

/** Recommendation stats, outgoing or incoming (paginated, slimmed rows). */
export async function recommendations(
  ctx: GatewayContext,
  creds: BearerCredentials,
  args: { direction: RecommendationDirection; offset?: number; limit?: number },
) {
  const { direction } = args;
  const path = RECOMMENDATION_PATHS[direction];
  if (!path) throw new Error(`'${direction}' is not a valid RecommendationDirection`);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 20;
  return cachedSnapshot(
    ctx.statsCache,
    creds.publication_url,
    `recommendations:${direction}:${limit}:${offset}`,
    async () => {
      const body = await makeClients(ctx, creds).publication.get(path, {
        query: { offset, limit },
      });
      const rows = isRec(body) ? (body.rows ?? []) : [];
      const parsed = parseSubstack(
        z.array(z.record(z.string(), z.unknown())),
        rows,
        'recommendations',
      );
      return { rows: parsed.map((row) => slimRow(row, direction)) };
    },
  );
}

/** Post counts by state (published, drafts, scheduled, ...). */
export function postCounts(ctx: GatewayContext, creds: BearerCredentials) {
  return cachedSnapshot(ctx.statsCache, creds.publication_url, 'post_counts', () =>
    getSnapshotBody(ctx, creds, POST_COUNTS, 'post counts'),
  );
}
