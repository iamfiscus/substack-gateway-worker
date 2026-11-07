// Ports of upstream packages/gateway_stats/tests/*.py (bc2e875), one test per
// upstream test, names in camelCase. `FakeStatsCache` is the _fakes.py double.
// The registry tests of test_stats_cache.py have no counterpart: the Worker
// carries the cache on the context (null = no caching), not in a global.

import { describe, expect, it } from 'vitest';
import { ownerFeatures } from '../../src/auth/features';
import { loadConfig } from '../../src/config';
import type { GatewayContext, StatsCache, StatsRow } from '../../src/context';
import { createLogger } from '../../src/log';
import {
  arrPointFromRow,
  arrTimeseriesResponse,
  dashboardPeriodResponse,
  dashboardSummaryResponse,
  emailPointFromRow,
  emailTimeseriesResponse,
  parseMoney,
  postCountsResponse,
  recommendationStat,
  recommendationStatsResponse,
  thirtyDayViewsResponse,
} from '../../src/schemas/stats';
import {
  getPostDiscussion,
  getPostEngagement,
  getPostGrowth,
  getPostRecipients,
  getPostTraffic,
} from '../../src/services/postStats';
import {
  cachedSnapshot,
  DEFAULT_LOOKBACK_DAYS,
  dashboardPeriod,
  dashboardSummary,
  getArrTimeseries,
  getEmailTimeseries,
  getSubscriberTimeseries,
  getThirtyDayViews,
  postCounts,
  recommendations,
  rowsByDate,
} from '../../src/services/stats';
import { createFakeSubstack } from '../support/fakeSubstack';

const PUB = 'https://example.substack.com';
const creds = { publication_url: PUB, substack_sid: 's', connect_sid: 'c' };
const HEADER = ['Date', 'Paid', 'Comps', 'Free trials', 'Total subscribers'];

class FakeStatsCache implements StatsCache {
  timeseries = new Map<string, Record<string, StatsRow>>();
  snapshots = new Map<string, Record<string, unknown>>();
  async readTimeseries(pub: string, series: string) {
    return { ...(this.timeseries.get(`${pub}|${series}`) ?? {}) };
  }
  async writeTimeseries(pub: string, series: string, rows: Record<string, StatsRow>) {
    this.timeseries.set(`${pub}|${series}`, {
      ...(this.timeseries.get(`${pub}|${series}`) ?? {}),
      ...rows,
    });
  }
  async getSnapshot(pub: string, key: string) {
    return this.snapshots.get(`${pub}|${key}`) ?? null;
  }
  async setSnapshot(pub: string, key: string, value: Record<string, unknown>) {
    this.snapshots.set(`${pub}|${key}`, value);
  }
}

/** A fake publication API: each path serves its queued payloads in order (the last repeats). */
function harness(
  payloads: Record<string, unknown[]> | unknown,
  opts: { cache?: StatsCache | null; lag?: number } = {},
) {
  const queues: Record<string, unknown[]> = Array.isArray(payloads)
    ? { '*': payloads }
    : (payloads as Record<string, unknown[]>);
  const calls: { path: string; params: Record<string, string> }[] = [];
  const fetcher = createFakeSubstack({});
  const wrapped = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const path = u.pathname.replace('/api/v1/', '');
    calls.push({ path, params: Object.fromEntries(u.searchParams) });
    const queue = queues[path] ?? queues['*'] ?? [];
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return Response.json(body);
  };
  const env = {
    SUBSTACK_BASE_URL: 'https://substack.com',
    ...(opts.lag !== undefined ? { STATS_TIMESERIES_WATERMARK_LAG_DAYS: String(opts.lag) } : {}),
  };
  const ctx: GatewayContext = {
    env,
    config: loadConfig(env),
    fetcher: wrapped,
    valueCache: { getOrCall: (_k, f) => f() },
    statsCache: opts.cache === undefined ? new FakeStatsCache() : opts.cache,
    resolver: null,
    requestId: 'r',
    authInfo: null,
    ownerFeatures: ownerFeatures({}),
    log: createLogger('error'),
  };
  void fetcher;
  return { ctx, calls };
}

const one = (path: string, payload: unknown, opts?: Parameters<typeof harness>[1]) =>
  harness({ [path]: [payload] }, opts);

describe('stats service', () => {
  it('subscriberTimeseriesDeltaFetchesOnlyTheTail', async () => {
    const { ctx, calls } = harness(
      [
        [HEADER, ['2025/07/10', 1, 0, 0, 10], ['2025/07/11', 1, 0, 0, 11]],
        [HEADER, ['2025/07/11', 1, 0, 0, 12], ['2025/07/12', 2, 0, 0, 13]],
      ],
      { lag: 2 },
    );
    const first = await getSubscriberTimeseries(ctx, creds, { from: '2025-07-01T00:00:00Z' });
    expect(first.map((r) => r[0])).toEqual(['2025/07/10', '2025/07/11']);
    expect(calls[0]?.params).toEqual({ from: '2025-07-01T00:00:00Z' });

    const second = await getSubscriberTimeseries(ctx, creds, {});
    // watermark 2025/07/11 minus 2-day lag -> 2025-07-09
    expect(calls[1]?.params).toEqual({ from: '2025-07-09T00:00:00Z' });
    expect(second.map((r) => r[0])).toEqual(['2025/07/10', '2025/07/11', '2025/07/12']);
    expect(second[1]).toEqual(['2025/07/11', 1, 0, 0, 12]);
  });

  it('subscriberTimeseriesFiltersByFromBound', async () => {
    const { ctx } = harness([[HEADER, ['2025/07/10', 1, 0, 0, 10], ['2025/07/11', 1, 0, 0, 11]]]);
    const rows = await getSubscriberTimeseries(ctx, creds, { from: '2025-07-11T00:00:00Z' });
    expect(rows.map((r) => r[0])).toEqual(['2025/07/11']);
  });

  it('subscriberTimeseriesHandlesEmptyPayload', async () => {
    const { ctx } = harness([[HEADER]]);
    expect(await getSubscriberTimeseries(ctx, creds, { from: '2025-07-01T00:00:00Z' })).toEqual([]);
  });

  it('thirtyDayViewsIsCachedAfterFirstFetch', async () => {
    const { ctx, calls } = harness([{ views30d: 100, viewsDelta30d: 5 }]);
    const first = await getThirtyDayViews(ctx, creds);
    const second = await getThirtyDayViews(ctx, creds);
    expect(first).toEqual({ views30d: 100, viewsDelta30d: 5 });
    expect(second).toEqual(first);
    // Only one upstream call: the second is served from the snapshot cache.
    expect(calls).toHaveLength(1);
  });

  it('defaultWindowIsSevenDays', () => {
    expect(DEFAULT_LOOKBACK_DAYS).toBe(7);
  });

  it('defaultWindowStartsAtMidnightUtcSevenDaysBeforeTheInjectedClock', async () => {
    const { ctx, calls } = harness([[HEADER]], { cache: null });
    await getSubscriberTimeseries(ctx, creds, { now: () => new Date('2025-07-20T15:30:00Z') });
    expect(calls[0]?.params).toEqual({ from: '2025-07-13T00:00:00Z' });
  });

  it('aWarmCacheWidensWhenAskedForOlderData', async () => {
    const cache = new FakeStatsCache();
    await cache.writeTimeseries(PUB, 'subscribers', {
      '2025/07/10': ['2025/07/10', 1, 0, 0, 10],
    });
    const { ctx, calls } = harness([[HEADER, ['2025/01/01', 1, 0, 0, 5]]], { cache, lag: 2 });
    await getSubscriberTimeseries(ctx, creds, { from: '2025-01-01T00:00:00Z' });
    // a from older than the oldest cached row must widen the fetch, not be
    // reduced to a filter over rows already held
    expect(calls[0]?.params).toEqual({ from: '2025-01-01T00:00:00Z' });
  });

  it('withoutACacheFromIsHonouredEveryCall', async () => {
    const { ctx, calls } = harness(
      [
        [HEADER, ['2025/01/01', 1, 0, 0, 5]],
        [HEADER, ['2025/01/01', 1, 0, 0, 5]],
      ],
      { cache: null },
    );
    const first = await getSubscriberTimeseries(ctx, creds, { from: '2025-01-01T00:00:00Z' });
    await getSubscriberTimeseries(ctx, creds, { from: '2025-01-01T00:00:00Z' });
    // an uncached deployment must still return the rows it fetched
    expect(first).toEqual([['2025/01/01', 1, 0, 0, 5]]);
    // with nothing retained, every call fetches the window the caller asked for
    expect(calls.map((c) => c.params)).toEqual([
      { from: '2025-01-01T00:00:00Z' },
      { from: '2025-01-01T00:00:00Z' },
    ]);
  });

  it('aWarmCacheStillDeltaFetchesWhenFromIsInsideIt', async () => {
    const cache = new FakeStatsCache();
    await cache.writeTimeseries(PUB, 'subscribers', {
      '2025/07/10': ['2025/07/10', 1, 0, 0, 10],
      '2025/07/11': ['2025/07/11', 1, 0, 0, 11],
    });
    const { ctx, calls } = harness([[HEADER, ['2025/07/12', 1, 0, 0, 12]]], { cache, lag: 2 });
    await getSubscriberTimeseries(ctx, creds, { from: '2025-07-11T00:00:00Z' });
    // a from inside the cached range must leave the watermark path alone
    expect(calls[0]?.params).toEqual({ from: '2025-07-09T00:00:00Z' });
  });

  it('wideningNeverFetchesLessThanTheWatermarkPathWould', async () => {
    // Cache span 2025/07/01 - 2025/07/20 with lag 30: the watermark date
    // (2025-06-20) is earlier than from (2025-06-25), which is itself older
    // than the oldest cached row. Widening must land on the EARLIER date.
    const cache = new FakeStatsCache();
    await cache.writeTimeseries(PUB, 'subscribers', {
      '2025/07/01': ['2025/07/01', 1, 0, 0, 1],
      '2025/07/20': ['2025/07/20', 1, 0, 0, 20],
    });
    const { ctx, calls } = harness([[HEADER, ['2025/06/20', 1, 0, 0, 0]]], { cache, lag: 30 });
    await getSubscriberTimeseries(ctx, creds, { from: '2025-06-25T00:00:00Z' });
    expect(calls[0]?.params).toEqual({ from: '2025-06-20T00:00:00Z' });
  });

  it('arrTimeseriesKeepsFirstRowWithoutHeader', async () => {
    const { ctx, calls } = harness([
      [
        ['2025/10/18', '$258.19'],
        ['2025/10/19', '$260.00'],
      ],
    ]);
    const rows = await getArrTimeseries(ctx, creds, { from: '2025-10-01T00:00:00Z' });
    expect(rows.map((r) => r[0])).toEqual(['2025/10/18', '2025/10/19']);
    expect(calls).toEqual([
      { path: 'publication/stats/arr/timeseries', params: { from: '2025-10-01T00:00:00Z' } },
    ]);
  });

  it('emailTimeseriesDeltaFetchUsesWatermarkLag', async () => {
    const { ctx, calls } = harness(
      [
        [
          ['2025/10/19', 411],
          ['2025/10/20', 415],
        ],
        [
          ['2025/10/20', 416],
          ['2025/10/21', 420],
        ],
      ],
      { lag: 2 },
    );
    await getEmailTimeseries(ctx, creds, { from: '2025-10-01T00:00:00Z' });
    const rows = await getEmailTimeseries(ctx, creds, {});
    // watermark 2025/10/20 minus 2-day lag -> 2025-10-18
    expect(calls[1]).toEqual({
      path: 'publication/stats/emails/timeseries',
      params: { from: '2025-10-18T00:00:00Z' },
    });
    expect(rows).toEqual([
      ['2025/10/19', 411],
      ['2025/10/20', 416],
      ['2025/10/21', 420],
    ]);
  });

  it.each([[[]], [[['Date', 'ARR']]], [{ rows: [] }], [null]])(
    'arrTimeseriesEmptyOrHeaderOnlyPayload %j',
    async (payload) => {
      const { ctx } = harness([payload]);
      expect(await getArrTimeseries(ctx, creds, {})).toEqual([]);
    },
  );

  it('rowsByDateSkipsNonDateRows', () => {
    const payload = [
      ['Date', 'Paid'],
      ['2025/07/10', 1],
      [],
      ['total', 3],
      'junk',
      ['2025-07-11', 2],
    ];
    expect(rowsByDate(payload)).toEqual({ '2025/07/10': ['2025/07/10', 1] });
  });

  it('aMalformedSnapshotBodyIsA502NotACrash', async () => {
    const { ctx } = harness([['not', 'an', 'object']]);
    await expect(getThirtyDayViews(ctx, creds)).rejects.toMatchObject({ status: 502 });
  });
});

describe('dashboard service', () => {
  it('summaryCallsUpstreamAndCaches', async () => {
    const cache = new FakeStatsCache();
    const { ctx, calls } = one('publish-dashboard/summary', { subscribers: 10 }, { cache });
    expect(await dashboardSummary(ctx, creds)).toEqual({ subscribers: 10 });
    expect(calls).toEqual([{ path: 'publish-dashboard/summary', params: {} }]);
    expect(cache.snapshots.get(`${PUB}|dashboard_summary`)).toEqual({ subscribers: 10 });
    await dashboardSummary(ctx, creds);
    expect(calls).toHaveLength(1);
  });

  it('periodPassesRangeAndKeysByIt', async () => {
    const cache = new FakeStatsCache();
    const { ctx, calls } = one('publish-dashboard/summary-v2', { views: 5 }, { cache });
    expect(await dashboardPeriod(ctx, creds, { rangeDays: 90 })).toEqual({ views: 5 });
    expect(calls).toEqual([{ path: 'publish-dashboard/summary-v2', params: { range: '90' } }]);
    expect(cache.snapshots.has(`${PUB}|dashboard_period:90`)).toBe(true);
  });

  it('postCountsPathAndKey', async () => {
    const cache = new FakeStatsCache();
    const { ctx, calls } = one('post_management/counts', { published: 3 }, { cache });
    expect(await postCounts(ctx, creds)).toEqual({ published: 3 });
    expect(calls).toEqual([{ path: 'post_management/counts', params: {} }]);
    expect(cache.snapshots.has(`${PUB}|post_counts`)).toBe(true);
  });

  const TARGET_PUB = {
    id: 1001,
    name: 'Example Weekly',
    subdomain: 'exampleweekly',
    custom_domain: null,
    logo_url: 'https://example.com/logo.png',
    hero_text: 'Long hero text',
    theme: { colors: ['#fff'] },
    author_bio: 'Bio',
  };

  it('recommendationsOutgoingSlimsTargetPub', async () => {
    const cache = new FakeStatsCache();
    const { ctx, calls } = one(
      'recommendations/stats/from',
      {
        rows: [
          {
            publication_id: 1,
            target_publication_id: 1001,
            xp_signups: 7,
            is_mutual: true,
            irrelevant_blob: { a: 1 },
            target_pub: TARGET_PUB,
          },
        ],
      },
      { cache },
    );
    const data = await recommendations(ctx, creds, { direction: 'outgoing' });
    const row = (data.rows as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(row.pub).toEqual({
      id: 1001,
      name: 'Example Weekly',
      subdomain: 'exampleweekly',
      custom_domain: null,
      logo_url: 'https://example.com/logo.png',
    });
    expect(row).not.toHaveProperty('target_pub');
    expect(row).not.toHaveProperty('irrelevant_blob');
    expect(row.xp_signups).toBe(7);
    expect(row).not.toHaveProperty('xp_paid_subs');
    expect(calls).toEqual([
      { path: 'recommendations/stats/from', params: { offset: '0', limit: '20' } },
    ]);
    expect(cache.snapshots.get(`${PUB}|recommendations:outgoing:20:0`)).toEqual(data);
  });

  it('recommendationsIncomingUsesSourcePubAndToPath', async () => {
    const { ctx, calls } = one('recommendations/stats/to', {
      rows: [{ publication_id: 2, source_pub: TARGET_PUB }],
    });
    const data = await recommendations(ctx, creds, { direction: 'incoming', offset: 5, limit: 10 });
    expect((data.rows as { pub: { id: number } }[])[0]?.pub.id).toBe(1001);
    expect(calls).toEqual([
      { path: 'recommendations/stats/to', params: { offset: '5', limit: '10' } },
    ]);
  });

  it('recommendationsNullPub', async () => {
    const { ctx } = one('recommendations/stats/from', {
      rows: [{ xp_signups: 4, target_pub: null }],
    });
    const data = await recommendations(ctx, creds, { direction: 'outgoing' });
    const row = (data.rows as Record<string, unknown>[])[0];
    expect(row?.pub).toBeNull();
    expect(row?.xp_signups).toBe(4);
  });

  it.each([[{ rows: null }], [{}]])('recommendationsRowsNullOrMissing %j', async (payload) => {
    const { ctx } = one('recommendations/stats/from', payload);
    expect(await recommendations(ctx, creds, { direction: 'outgoing' })).toEqual({ rows: [] });
  });

  it('recommendationsRejectsUnknownDirection', async () => {
    const { ctx } = one('recommendations/stats/from', {});
    await expect(
      recommendations(ctx, creds, { direction: 'sideways' as 'outgoing' }),
    ).rejects.toThrow();
  });

  const OWN_PUB = { id: 1, name: 'Own Digest', subdomain: 'owndigest' };
  const OTHER_PUB = { id: 2002, name: 'Other Letter', subdomain: 'otherletter' };

  it.each([
    ['outgoing', 'recommendations/stats/from', { target_pub: OTHER_PUB, source_pub: OWN_PUB }],
    ['incoming', 'recommendations/stats/to', { target_pub: OWN_PUB, source_pub: OTHER_PUB }],
  ] as const)('recommendationsRowWithBothPubsPicksCounterpart %s', async (direction, path, row) => {
    const { ctx } = one(path, { rows: [row] });
    const data = await recommendations(ctx, creds, { direction });
    expect((data.rows as { pub: { id: number } }[])[0]?.pub.id).toBe(2002);
  });

  it('recommendationsFallsBackToOtherPubKey', async () => {
    const out = harness({
      'recommendations/stats/from': [{ rows: [{ target_pub: null, source_pub: OTHER_PUB }] }],
    });
    const inc = harness({
      'recommendations/stats/to': [{ rows: [{ source_pub: null, target_pub: OTHER_PUB }] }],
    });
    const outgoing = await recommendations(out.ctx, creds, { direction: 'outgoing' });
    const incoming = await recommendations(inc.ctx, creds, { direction: 'incoming' });
    expect((outgoing.rows as { pub: { id: number } }[])[0]?.pub.id).toBe(2002);
    expect((incoming.rows as { pub: { id: number } }[])[0]?.pub.id).toBe(2002);
  });

  it('recommendationsNonDictPayload', async () => {
    const { ctx } = one('recommendations/stats/from', [{ rows: [1] }]);
    expect(await recommendations(ctx, creds, { direction: 'outgoing' })).toEqual({ rows: [] });
  });
});

describe('post stats service', () => {
  it('engagementHitsTheRightEndpoint', async () => {
    const { ctx, calls } = one('post_management/detail/42/engagement', { likes: { count: 3 } });
    expect(await getPostEngagement(ctx, creds, { postId: 42 })).toEqual({ likes: { count: 3 } });
    expect(calls[0]?.path).toBe('post_management/detail/42/engagement');
  });

  it('recipientsPassesPaginationParams', async () => {
    const { ctx, calls } = one('post_management/detail/42/recipients', { rows: [], total: 0 });
    await getPostRecipients(ctx, creds, { postId: 42, limit: 50, offset: 10 });
    expect(calls[0]).toEqual({
      path: 'post_management/detail/42/recipients',
      params: { limit: '50', offset: '10' },
    });
  });

  it('discussionOmitsCursorWhenAbsentAndSendsWhenPresent', async () => {
    const a = one('post_management/detail/42/discussion', { items: [] });
    await getPostDiscussion(a.ctx, creds, { postId: 42 });
    expect(a.calls[0]?.params).toEqual({});
    const b = one('post_management/detail/42/discussion', { items: [] });
    await getPostDiscussion(b.ctx, creds, { postId: 42, cursor: 'abc' });
    expect(b.calls[0]?.params).toEqual({ cursor: 'abc' });
  });

  it('snapshotCacheAvoidsSecondUpstreamCall', async () => {
    const { ctx, calls } = one('post_management/detail/7/traffic', {
      referrers: [],
      devices: [],
      categories: [],
    });
    const first = await getPostTraffic(ctx, creds, { postId: 7 });
    const second = await getPostTraffic(ctx, creds, { postId: 7 });
    expect(first).toEqual(second);
    expect(calls).toHaveLength(1);
  });

  it('recipientsPaginationIsCachedPerPage', async () => {
    const { ctx, calls } = one('post_management/detail/7/recipients', { rows: [], total: 0 });
    await getPostRecipients(ctx, creds, { postId: 7, limit: 20, offset: 0 });
    await getPostRecipients(ctx, creds, { postId: 7, limit: 20, offset: 20 }); // new page, new fetch
    expect(calls).toHaveLength(2);
  });

  it('growthPassesTheBodyThroughVerbatim', async () => {
    const { ctx } = one('post_management/detail/7/growth', { totalFreeSignups: 12, extra: [1] });
    expect(await getPostGrowth(ctx, creds, { postId: 7 })).toEqual({
      totalFreeSignups: 12,
      extra: [1],
    });
  });

  it('withoutACacheEveryCallReachesSubstack', async () => {
    const { ctx, calls } = one(
      'post_management/detail/7/engagement',
      { likes: { count: 1 } },
      { cache: null },
    );
    await getPostEngagement(ctx, creds, { postId: 7 });
    await getPostEngagement(ctx, creds, { postId: 7 });
    expect(calls).toHaveLength(2);
  });
});

describe('snapshot cache', () => {
  it('cachedSnapshotHitSkipsFetch', async () => {
    const cache = new FakeStatsCache();
    cache.snapshots.set(`${PUB}|k`, { a: 1 });
    const fetch = async () => {
      throw new Error('fetch must not run on a cache hit');
    };
    expect(await cachedSnapshot(cache, PUB, 'k', fetch)).toEqual({ a: 1 });
  });

  it('cachedSnapshotMissFetchesAndStores', async () => {
    const cache = new FakeStatsCache();
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { b: 2 };
    };
    expect(await cachedSnapshot(cache, PUB, 'k', fetch)).toEqual({ b: 2 });
    expect(calls).toBe(1);
    expect(cache.snapshots.get(`${PUB}|k`)).toEqual({ b: 2 });
  });

  it('aNullCacheNeverRetainsSnapshots', async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { c: 3 };
    };
    await cachedSnapshot(null, PUB, 'k', fetch);
    await cachedSnapshot(null, PUB, 'k', fetch);
    expect(calls).toBe(2);
  });

  it('aNullCacheNeverRetainsTimeseries', async () => {
    const { ctx, calls } = harness([[['2025/07/10', 1]], [['2025/07/10', 1]]], { cache: null });
    await getEmailTimeseries(ctx, creds, { from: '2025-07-01T00:00:00Z' });
    await getEmailTimeseries(ctx, creds, { from: '2025-07-01T00:00:00Z' });
    expect(calls.map((c) => c.params.from)).toEqual([
      '2025-07-01T00:00:00Z',
      '2025-07-01T00:00:00Z',
    ]);
  });
});

describe('stats schemas', () => {
  it.each([
    ['$258.19', 258.19],
    ['$1,262.40', 1262.4],
    ['-$5.00', -5.0],
    ['€12', 12.0],
    [' $ 7 ', 7.0],
    [12, 12.0],
    [12.5, 12.5],
    [null, null],
    [true, null],
    ['', null],
    ['n/a', null],
    ['€1.234,56', null],
    ['1,5', null],
    ['$1,23', null],
    ['$1.2K', null],
    ['1.5M', null],
    ['1e5', null],
    ['Q3 2025', null],
    ['5-3', null],
    ['2025-10', null],
    ['12 USD', null],
    ['US$12', 12.0],
    ['-$1,262.40', -1262.4],
    ['$-5', -5.0],
    ['−5', -5.0],
    ['−$5.00', -5.0],
    ['$−5', -5.0],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
  ])('parseMoney %j', (raw, expected) => {
    expect(parseMoney(raw)).toBe(expected);
  });

  it('arrTimeseriesFromSubstack', () => {
    const resp = arrTimeseriesResponse([
      ['2025/10/18', '$258.19'],
      ['2025/10/19', null],
    ]);
    expect(resp.items[0]).toEqual({ date: '2025/10/18', arr: 258.19, arr_display: '$258.19' });
    expect(resp.items[1]).toEqual({ date: '2025/10/19', arr: null, arr_display: null });
  });

  it('arrPointNumericCellKeepsDisplayAsString', () => {
    expect(arrPointFromRow(['2025/10/18', 258.19]).arr_display).toBe('258.19');
  });

  it('arrPointShortRow', () => {
    const point = arrPointFromRow(['2025/10/18']);
    expect(point.arr).toBeNull();
    expect(point.arr_display).toBeNull();
  });

  it('emailTimeseriesFromSubstackShortRow', () => {
    expect(emailTimeseriesResponse([['2025/10/19', 411], ['2025/10/20']]).items).toEqual([
      { date: '2025/10/19', emails: 411 },
      { date: '2025/10/20', emails: null },
    ]);
    expect(emailPointFromRow(['2025/10/19', 411]).emails).toBe(411);
  });

  it('emptyTimeseriesResponses', () => {
    expect(arrTimeseriesResponse([]).items).toEqual([]);
    expect(emailTimeseriesResponse([]).items).toEqual([]);
  });

  it('thirtyDayViewsDefaultsMissingAndFalsyToZero', () => {
    expect(thirtyDayViewsResponse({})).toEqual({ views_30d: 0, views_delta_30d: 0 });
    expect(thirtyDayViewsResponse({ views30d: null, viewsDelta30d: 9 })).toEqual({
      views_30d: 0,
      views_delta_30d: 9,
    });
  });

  it('dashboardSummaryMapsAllFields', () => {
    const resp = dashboardSummaryResponse({
      appSubscribers: 12,
      appSubscribersLast30Days: 3,
      subscribers: 420,
      subscribersLast30Days: 25,
      totalEmail: 410,
      totalEmailLast30Days: 22,
      arr: '$1,262.40',
      arrDelta: 54.1,
      views: 9000,
      viewsDelta: -120,
      openRate: 0.48,
      openRateDiff: -0.02,
      pledgesAmount: '$30.00',
      numPledges: 4,
      pledgeCurrency: 'usd',
      isBestseller: false,
    });
    expect(resp).toEqual({
      app_subscribers: 12,
      app_subscribers_last_30_days: 3,
      subscribers: 420,
      subscribers_last_30_days: 25,
      total_email: 410,
      total_email_last_30_days: 22,
      arr: 1262.4,
      arr_delta: 54.1,
      views: 9000,
      views_delta: -120,
      open_rate: 0.48,
      open_rate_diff: -0.02,
      pledges_amount: 30.0,
      num_pledges: 4,
      pledge_currency: 'usd',
      is_bestseller: false,
    });
  });

  it('dashboardSummaryAllNull', () => {
    const keys = [
      'appSubscribers',
      'appSubscribersLast30Days',
      'subscribers',
      'subscribersLast30Days',
      'totalEmail',
      'totalEmailLast30Days',
      'arr',
      'arrDelta',
      'views',
      'viewsDelta',
      'openRate',
      'openRateDiff',
      'pledgesAmount',
      'numPledges',
      'pledgeCurrency',
      'isBestseller',
    ];
    const nulls = Object.fromEntries(keys.map((k) => [k, null]));
    for (const payload of [{}, nulls]) {
      const dumped = dashboardSummaryResponse(payload);
      expect(Object.keys(dumped)).toHaveLength(keys.length);
      expect(Object.values(dumped).every((v) => v === null)).toBe(true);
    }
  });

  it('dashboardPeriodGroupsStartEnd', () => {
    const resp = dashboardPeriodResponse(
      {
        totalSubscribersStart: 300,
        totalSubscribersEnd: 420,
        paidSubscribersStart: 20,
        paidSubscribersEnd: 31,
        arrStart: '$900.00',
        arrEnd: '$1,262.40',
        totalViewsStart: 5000,
        totalViewsEnd: 9000,
        pledgedArrStart: null,
        pledgedArrEnd: '$360.00',
      },
      365,
    );
    expect(resp.range_days).toBe(365);
    expect(resp.total_subscribers).toEqual({ start: 300, end: 420 });
    expect(resp.paid_subscribers).toEqual({ start: 20, end: 31 });
    expect(resp.arr).toEqual({ start: 900.0, end: 1262.4 });
    expect(resp.total_views).toEqual({ start: 5000, end: 9000 });
    expect(resp.pledged_arr).toEqual({ start: null, end: 360.0 });
  });

  it('dashboardPeriodPartialPayload', () => {
    const resp = dashboardPeriodResponse({}, 30);
    expect(resp.range_days).toBe(30);
    expect(resp.arr).toEqual({ start: null, end: null });
    expect(resp.total_subscribers).toEqual({ start: null, end: null });
  });

  it('recommendationStatFromSlimRow', () => {
    const stat = recommendationStat(
      {
        publication_id: 11,
        target_publication_id: 22,
        xp_signups: 40,
        xp_signups_last_30_days: 5,
        xp_paid_subs: 2,
        is_mutual: true,
        is_active: false,
        created_at: '2025-01-02T03:04:05Z',
        first_activity_at: '2025-01-03T00:00:00Z',
        data_updated_at: '2025-10-18T00:00:00Z',
        pub: {
          id: 22,
          name: 'Fictional Weekly',
          subdomain: 'fictional',
          custom_domain: null,
          logo_url: 'https://example.test/logo.png',
        },
      },
      'outgoing',
    );
    expect(stat).toEqual({
      publication: {
        id: 22,
        name: 'Fictional Weekly',
        subdomain: 'fictional',
        custom_domain: null,
        logo_url: 'https://example.test/logo.png',
      },
      signups: 40,
      signups_last_30_days: 5,
      paid_subs: 2,
      is_mutual: true,
      is_active: false,
      created_at: '2025-01-02T03:04:05Z',
      first_activity_at: '2025-01-03T00:00:00Z',
      data_updated_at: '2025-10-18T00:00:00Z',
    });
  });

  it('recommendationStatFromRawSourcePub', () => {
    const stat = recommendationStat(
      {
        publication_id: 33,
        xp_signups: 7,
        source_pub: { id: 33, name: 'Invented Digest', subdomain: 'invented' },
        extra_field: 'ignored',
      },
      'incoming',
    );
    expect(stat.publication.id).toBe(33);
    expect(stat.publication.name).toBe('Invented Digest');
    expect(stat.publication.subdomain).toBe('invented');
    expect(stat.publication.logo_url).toBeNull();
    expect(stat.signups).toBe(7);
    expect(stat.signups_last_30_days).toBeNull();
    expect(stat.is_mutual).toBeNull();
  });

  it('recommendationStatRawTargetPub', () => {
    const stat = recommendationStat({ target_pub: { id: 5, name: 'Made Up Notes' } }, 'outgoing');
    expect(stat.publication.id).toBe(5);
    expect(stat.publication.name).toBe('Made Up Notes');
  });

  it.each([
    ['outgoing', { target_pub: { id: 2002 }, source_pub: { id: 1 } }],
    ['incoming', { target_pub: { id: 1 }, source_pub: { id: 2002 } }],
  ])('recommendationStatRawRowWithBothPubsPicksCounterpart %s', (direction, row) => {
    expect(recommendationStat(row, direction as 'outgoing').publication.id).toBe(2002);
  });

  it('recommendationStatPubKeyWinsOverRawKeys', () => {
    const stat = recommendationStat(
      { pub: { id: 7 }, target_pub: { id: 1 }, source_pub: { id: 2 } },
      'incoming',
    );
    expect(stat.publication.id).toBe(7);
  });

  it('recommendationStatNullPubFallsBackToRowId', () => {
    const row = { publication_id: 11, target_publication_id: 22, pub: null };
    const outgoing = recommendationStat(row, 'outgoing');
    const incoming = recommendationStat(row, 'incoming');
    expect(outgoing.publication.id).toBe(22);
    expect(outgoing.publication.name).toBeNull();
    expect(incoming.publication.id).toBe(11);
  });

  it('recommendationStatPubWithoutIdFallsBackToRowId', () => {
    const stat = recommendationStat(
      { target_publication_id: 22, pub: { name: 'Fictional Weekly' } },
      'outgoing',
    );
    expect(stat.publication.id).toBe(22);
    expect(stat.publication.name).toBe('Fictional Weekly');
  });

  it('recommendationStatsNextOffset', () => {
    const rows = [{ target_publication_id: 1 }, { target_publication_id: 2 }];
    const full = recommendationStatsResponse({ rows }, 'outgoing', 0, 2);
    expect(full.direction).toBe('outgoing');
    expect(full.items.map((i) => i.publication.id)).toEqual([1, 2]);
    expect(full.next_offset).toBe(2);

    expect(recommendationStatsResponse({ rows }, 'incoming', 40, 2).next_offset).toBe(42);
    expect(
      recommendationStatsResponse({ rows: rows.slice(0, 1) }, 'outgoing', 0, 2).next_offset,
    ).toBeNull();

    const empty = recommendationStatsResponse({ rows: null }, 'outgoing', 0, 2);
    expect(empty.items).toEqual([]);
    expect(empty.next_offset).toBeNull();
    expect(recommendationStatsResponse({}, 'incoming', 0, 2).items).toEqual([]);
  });

  it('postCountsMapsFlags', () => {
    expect(
      postCountsResponse({
        published: 120,
        publishedIsCapped: false,
        drafts: 7,
        draftsIsCapped: true,
        scheduled: 2,
        scheduledIsCapped: false,
      }),
    ).toEqual({
      published: 120,
      published_is_capped: false,
      drafts: 7,
      drafts_is_capped: true,
      scheduled: 2,
      scheduled_is_capped: false,
    });
  });

  it('postCountsPartialPayload', () => {
    expect(Object.values(postCountsResponse({})).every((v) => v === null)).toBe(true);
  });
});
