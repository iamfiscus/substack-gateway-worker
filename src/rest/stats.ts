// Port of gateway_stats_rest/router.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import {
  ArrTimeseriesResponse,
  arrTimeseriesResponse,
  DashboardPeriodResponse,
  DashboardSummaryResponse,
  dashboardPeriodResponse,
  dashboardSummaryResponse,
  EmailTimeseriesResponse,
  emailTimeseriesResponse,
  PostCountsResponse,
  PostDiscussionResponse,
  PostEngagementResponse,
  PostGrowthResponse,
  PostRecipientsResponse,
  PostTrafficResponse,
  postCountsResponse,
  postDiscussionResponse,
  postEngagementResponse,
  postRecipientsResponse,
  postTrafficResponse,
  RecommendationStatsResponse,
  recommendationStatsResponse,
  SubscriberTimeseriesResponse,
  subscriberTimeseriesResponse,
  ThirtyDayViewsResponse,
  thirtyDayViewsResponse,
} from '../schemas/stats';
import {
  getPostDiscussion,
  getPostEngagement,
  getPostGrowth,
  getPostRecipients,
  getPostTraffic,
} from '../services/postStats';
import {
  dashboardPeriod,
  dashboardSummary,
  getArrTimeseries,
  getEmailTimeseries,
  getSubscriberTimeseries,
  getThirtyDayViews,
  postCounts,
  recommendations,
} from '../services/stats';
import { restRoute } from './credentials';
import { createRouter } from './errors';
import { ok, tokenHeader } from './openapi';

// ISO lower bound; Python `re.match` anchors the start only. A calendar-invalid
// date (2025-02-31) is a 422 here rather than upstream's unhandled ValueError.
const fromParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .refine((s) => {
    const day = s.slice(0, 10);
    const d = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
  }, 'Invalid calendar date')
  .optional()
  .openapi({
    description:
      'ISO lower bound for the returned window (e.g. 2025-07-09T00:00:00Z). Defaults to the last 7 days.',
  });
const fromQuery = z.object({ from: fromParam });

const postIdParam = z.object({
  post_id: z.coerce.number().int().gt(0).openapi({ description: 'Published post id.' }),
});

function statsRoute(path: string, summary: string, schema: z.ZodType, description?: string) {
  return createRoute({
    method: 'get',
    path,
    tags: ['stats'],
    summary,
    ...(description ? { description } : {}),
    request: { headers: tokenHeader },
    responses: { 200: ok(schema) },
  });
}

const cacheNote =
  'If a cache extension is installed, only the tail beyond the last stored day is fetched from Substack on subsequent calls; without one, every call fetches the full window.';

const subscribersRoute = createRoute({
  method: 'get',
  path: '/stats/subscribers',
  tags: ['stats'],
  summary: 'Subscriber Timeseries',
  description: `Daily subscriber counts (paid / comps / free trials / total).\n\n${cacheNote}`,
  request: { headers: tokenHeader, query: fromQuery },
  responses: { 200: ok(SubscriberTimeseriesResponse) },
});

const viewsRoute = statsRoute(
  '/stats/30d-views',
  'Thirty Day Views',
  ThirtyDayViewsResponse,
  'Trailing-30-day publication views and their delta.',
);

const arrRoute = createRoute({
  method: 'get',
  path: '/stats/arr',
  tags: ['stats'],
  summary: 'Arr Timeseries',
  description: `Daily annualized recurring revenue (ARR) as a timeseries.\n\n${cacheNote}`,
  request: { headers: tokenHeader, query: fromQuery },
  responses: { 200: ok(ArrTimeseriesResponse) },
});

const emailsRoute = createRoute({
  method: 'get',
  path: '/stats/emails',
  tags: ['stats'],
  summary: 'Email Timeseries',
  description: `Daily email subscriber counts as a timeseries.\n\n${cacheNote}`,
  request: { headers: tokenHeader, query: fromQuery },
  responses: { 200: ok(EmailTimeseriesResponse) },
});

const dashboardRoute = statsRoute(
  '/stats/dashboard',
  'Dashboard Summary',
  DashboardSummaryResponse,
  'Headline dashboard numbers: subscribers, ARR, views, open rate, pledges.',
);

const periodRoute = createRoute({
  method: 'get',
  path: '/stats/dashboard/period',
  tags: ['stats'],
  summary: 'Dashboard Period',
  description: 'Start and end values of the key dashboard metrics over a trailing window.',
  request: {
    headers: tokenHeader,
    query: z.object({
      range_days: z.coerce
        .number()
        .int()
        .min(1)
        .max(3650)
        .default(365)
        .openapi({ description: 'Trailing window length in days.' }),
    }),
  },
  responses: { 200: ok(DashboardPeriodResponse) },
});

// Only `limit` and `offset` are read from the query; the path takes the direction.
const recommendationsRoute = createRoute({
  method: 'get',
  path: '/stats/recommendations/{direction}',
  tags: ['stats'],
  summary: 'Recommendation Stats',
  description:
    'Recommendation signup stats (paginated). `outgoing` lists publications this one recommends; `incoming` lists publications recommending this one.',
  request: {
    headers: tokenHeader,
    params: z.object({ direction: z.enum(['outgoing', 'incoming']) }),
    query: z.object({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: { 200: ok(RecommendationStatsResponse) },
});

const countsRoute = statsRoute(
  '/stats/posts/counts',
  'Post Counts',
  PostCountsResponse,
  'Post counts by state (published, drafts, scheduled).',
);

function postStatsRoute(tab: string, summary: string, schema: z.ZodType) {
  return createRoute({
    method: 'get',
    path: `/posts/{post_id}/stats/${tab}`,
    tags: ['post-stats'],
    summary,
    request: { headers: tokenHeader, params: postIdParam },
    responses: { 200: ok(schema) },
  });
}

const engagementRoute = postStatsRoute('engagement', 'Post Engagement', PostEngagementResponse);
const trafficRoute = postStatsRoute('traffic', 'Post Traffic', PostTrafficResponse);
const growthRoute = postStatsRoute('growth', 'Post Growth', PostGrowthResponse);
const recipientsRoute = createRoute({
  method: 'get',
  path: '/posts/{post_id}/stats/recipients',
  tags: ['post-stats'],
  summary: 'Post Recipients',
  request: {
    headers: tokenHeader,
    params: postIdParam,
    query: z.object({
      limit: z.coerce.number().int().gt(0).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: { 200: ok(PostRecipientsResponse) },
});
const discussionRoute = createRoute({
  method: 'get',
  path: '/posts/{post_id}/stats/discussion',
  tags: ['post-stats'],
  summary: 'Post Discussion',
  request: {
    headers: tokenHeader,
    params: postIdParam,
    query: z.object({
      cursor: z.string().optional().openapi({ description: 'Opaque discussion cursor.' }),
    }),
  },
  responses: { 200: ok(PostDiscussionResponse) },
});

export const statsRouter = createRouter()
  .openapi(
    subscribersRoute,
    restRoute<typeof subscribersRoute>('api:stats:subscribers', async (c, { creds, ctx }) =>
      c.json(
        subscriberTimeseriesResponse(
          await getSubscriberTimeseries(ctx, creds, { from: c.req.valid('query').from }),
        ),
        200,
      ),
    ),
  )
  .openapi(
    viewsRoute,
    restRoute<typeof viewsRoute>('api:stats:traffic:30d-views', async (c, { creds, ctx }) =>
      c.json(thirtyDayViewsResponse(await getThirtyDayViews(ctx, creds)), 200),
    ),
  )
  .openapi(
    arrRoute,
    restRoute<typeof arrRoute>('api:stats:arr', async (c, { creds, ctx }) =>
      c.json(
        arrTimeseriesResponse(
          await getArrTimeseries(ctx, creds, { from: c.req.valid('query').from }),
        ),
        200,
      ),
    ),
  )
  .openapi(
    emailsRoute,
    restRoute<typeof emailsRoute>('api:stats:emails', async (c, { creds, ctx }) =>
      c.json(
        emailTimeseriesResponse(
          await getEmailTimeseries(ctx, creds, { from: c.req.valid('query').from }),
        ),
        200,
      ),
    ),
  )
  .openapi(
    dashboardRoute,
    restRoute<typeof dashboardRoute>('api:stats:dashboard', async (c, { creds, ctx }) =>
      c.json(dashboardSummaryResponse(await dashboardSummary(ctx, creds)), 200),
    ),
  )
  .openapi(
    periodRoute,
    restRoute<typeof periodRoute>('api:stats:dashboard:period', async (c, { creds, ctx }) => {
      const { range_days } = c.req.valid('query');
      return c.json(
        dashboardPeriodResponse(
          await dashboardPeriod(ctx, creds, { rangeDays: range_days }),
          range_days,
        ),
        200,
      );
    }),
  )
  .openapi(
    recommendationsRoute,
    restRoute<typeof recommendationsRoute>(
      'api:stats:recommendations',
      async (c, { creds, ctx }) => {
        const { direction } = c.req.valid('param');
        const { offset, limit } = c.req.valid('query');
        return c.json(
          recommendationStatsResponse(
            await recommendations(ctx, creds, { direction, offset, limit }),
            direction,
            offset,
            limit,
          ),
          200,
        );
      },
    ),
  )
  .openapi(
    countsRoute,
    restRoute<typeof countsRoute>('api:stats:post-counts', async (c, { creds, ctx }) =>
      c.json(postCountsResponse(await postCounts(ctx, creds)), 200),
    ),
  )
  .openapi(
    engagementRoute,
    restRoute<typeof engagementRoute>('api:posts:stats:engagement', async (c, { creds, ctx }) =>
      c.json(
        postEngagementResponse(
          await getPostEngagement(ctx, creds, { postId: c.req.valid('param').post_id }),
        ),
        200,
      ),
    ),
  )
  .openapi(
    trafficRoute,
    restRoute<typeof trafficRoute>('api:posts:stats:traffic', async (c, { creds, ctx }) =>
      c.json(
        postTrafficResponse(
          await getPostTraffic(ctx, creds, { postId: c.req.valid('param').post_id }),
        ),
        200,
      ),
    ),
  )
  .openapi(
    recipientsRoute,
    restRoute<typeof recipientsRoute>('api:posts:stats:recipients', async (c, { creds, ctx }) => {
      const { limit, offset } = c.req.valid('query');
      return c.json(
        postRecipientsResponse(
          await getPostRecipients(ctx, creds, {
            postId: c.req.valid('param').post_id,
            limit,
            offset,
          }),
        ),
        200,
      );
    }),
  )
  .openapi(
    growthRoute,
    restRoute<typeof growthRoute>('api:posts:stats:growth', async (c, { creds, ctx }) =>
      c.json(await getPostGrowth(ctx, creds, { postId: c.req.valid('param').post_id }), 200),
    ),
  )
  .openapi(
    discussionRoute,
    restRoute<typeof discussionRoute>('api:posts:stats:discussion', async (c, { creds, ctx }) =>
      c.json(
        postDiscussionResponse(
          await getPostDiscussion(ctx, creds, {
            postId: c.req.valid('param').post_id,
            cursor: c.req.valid('query').cursor,
          }),
        ),
        200,
      ),
    ),
  );
