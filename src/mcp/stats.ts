// Port of gateway_stats_mcp (upstream bc2e875): the 8 publication stats tools
// and the 5 post-stats tools. Tool names, argument names and descriptions are
// copied from upstream `__init__.py` / `tools.py`.

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { GatewayContext } from '../context';
import {
  arrTimeseriesResponse,
  dashboardPeriodResponse,
  dashboardSummaryResponse,
  emailTimeseriesResponse,
  postCountsResponse,
  postDiscussionResponse,
  postEngagementResponse,
  postRecipientsResponse,
  postTrafficResponse,
  recommendationStatsResponse,
  subscriberTimeseriesResponse,
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
import { mcpTool, readAnnotations, TOKEN_NOTE, toolMeta } from './server';

const noArgs = z.object({});
const fromDate = z.object({ from_date: z.string().nullish() });
const postId = z.object({ post_id: z.number().int() });

const CACHE_NOTE =
  'Without a cache extension installed, every call reaches the Substack API directly.';
const TIMESERIES_NOTE =
  'Optionally pass `from_date` (ISO) to bound the window. If a cache extension is installed, repeat calls fetch only the days newer than what is already stored; without one, every call fetches the full window from Substack.';

export function registerStatsTools(server: McpServer, _ctx: GatewayContext): void {
  const stats = (tags: string[]) => (endpoint: string) => toolMeta('stats', endpoint, tags);
  const statsMeta = stats(['stats', 'read']);
  const postMeta = (endpoint: string) => toolMeta('post-stats', endpoint, ['post-stats', 'read']);

  mcpTool(
    server,
    'get_subscriber_timeseries',
    {
      description: `Fetch the publication's daily subscriber timeseries (paid, comps, free trials, total) for the trailing 7 days by default. ${TIMESERIES_NOTE}${TOKEN_NOTE}`,
      inputSchema: fromDate,
      annotations: readAnnotations('Get Subscriber Timeseries'),
      feature: 'mcp:stats:subscribers',
      meta: statsMeta('GET /publication/stats/subscribers/timeseries'),
    },
    async (args, creds, ctx) =>
      subscriberTimeseriesResponse(
        await getSubscriberTimeseries(ctx, creds, { from: args.from_date }),
      ),
  );
  mcpTool(
    server,
    'get_30d_views',
    {
      description: `Fetch the publication's trailing-30-day view count and its delta versus the prior period. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: noArgs,
      annotations: readAnnotations('Get 30-Day Views'),
      feature: 'mcp:stats:traffic:30d-views',
      meta: statsMeta('GET /publication/stats/publication_traffic/30d_views'),
    },
    async (_args, creds, ctx) => thirtyDayViewsResponse(await getThirtyDayViews(ctx, creds)),
  );
  mcpTool(
    server,
    'get_arr_timeseries',
    {
      description: `Fetch the publication's daily annualized recurring revenue (ARR) timeseries for the trailing 7 days by default; each point keeps the raw money string next to the parsed number. ${TIMESERIES_NOTE}${TOKEN_NOTE}`,
      inputSchema: fromDate,
      annotations: readAnnotations('Get ARR Timeseries'),
      feature: 'mcp:stats:arr',
      meta: statsMeta('GET /publication/stats/arr/timeseries'),
    },
    async (args, creds, ctx) =>
      arrTimeseriesResponse(await getArrTimeseries(ctx, creds, { from: args.from_date })),
  );
  mcpTool(
    server,
    'get_email_timeseries',
    {
      description: `Fetch the publication's daily email subscriber count timeseries for the trailing 7 days by default. ${TIMESERIES_NOTE}${TOKEN_NOTE}`,
      inputSchema: fromDate,
      annotations: readAnnotations('Get Email Timeseries'),
      feature: 'mcp:stats:emails',
      meta: statsMeta('GET /publication/stats/emails/timeseries'),
    },
    async (args, creds, ctx) =>
      emailTimeseriesResponse(await getEmailTimeseries(ctx, creds, { from: args.from_date })),
  );
  mcpTool(
    server,
    'get_dashboard_summary',
    {
      description: `Fetch the publish dashboard's headline numbers for the publication (views, subscribers and related totals). ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: noArgs,
      annotations: readAnnotations('Get Dashboard Summary'),
      feature: 'mcp:stats:dashboard',
      meta: statsMeta('GET /publish-dashboard/summary'),
    },
    async (_args, creds, ctx) => dashboardSummaryResponse(await dashboardSummary(ctx, creds)),
  );
  mcpTool(
    server,
    'get_dashboard_period',
    {
      description: `Fetch the publish dashboard summary over a trailing window: pass \`range_days\` (1-3650, default 365) to choose the number of days. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: z.object({ range_days: z.number().int().min(1).max(3650).default(365) }),
      annotations: readAnnotations('Get Dashboard Period'),
      feature: 'mcp:stats:dashboard:period',
      meta: statsMeta('GET /publish-dashboard/summary-v2'),
    },
    async (args, creds, ctx) =>
      dashboardPeriodResponse(
        await dashboardPeriod(ctx, creds, { rangeDays: args.range_days }),
        args.range_days,
      ),
  );
  mcpTool(
    server,
    'get_recommendation_stats',
    {
      description: `Fetch recommendation stats for the publication: pass \`direction\` \`outgoing\` (publications this one recommends) or \`incoming\` (publications recommending this one), paginated via \`offset\` (default 0) and \`limit\` (1-100, default 20). ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: z.object({
        direction: z.enum(['outgoing', 'incoming']),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: readAnnotations('Get Recommendation Stats'),
      feature: 'mcp:stats:recommendations',
      meta: statsMeta('GET /recommendations/stats/{from|to}'),
    },
    async (args, creds, ctx) =>
      recommendationStatsResponse(
        await recommendations(ctx, creds, args),
        args.direction,
        args.offset,
        args.limit,
      ),
  );
  mcpTool(
    server,
    'get_post_counts',
    {
      description: `Fetch the publication's post counts by state (published, drafts, scheduled and so on). ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: noArgs,
      annotations: readAnnotations('Get Post Counts'),
      feature: 'mcp:stats:post-counts',
      meta: statsMeta('GET /post_management/counts'),
    },
    async (_args, creds, ctx) => postCountsResponse(await postCounts(ctx, creds)),
  );

  mcpTool(
    server,
    'get_post_engagement',
    {
      description: `Fetch engagement for a published post: like count and likers, comment count and summary, and commenter count. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: postId,
      annotations: readAnnotations('Get Post Engagement'),
      feature: 'mcp:posts:stats:engagement',
      meta: postMeta('GET /post_management/detail/{id}/engagement'),
    },
    async (args, creds, ctx) =>
      postEngagementResponse(await getPostEngagement(ctx, creds, { postId: args.post_id })),
  );
  mcpTool(
    server,
    'get_post_traffic',
    {
      description: `Fetch traffic for a published post: view counts broken down by referrer source, device type, and category. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: postId,
      annotations: readAnnotations('Get Post Traffic'),
      feature: 'mcp:posts:stats:traffic',
      meta: postMeta('GET /post_management/detail/{id}/traffic'),
    },
    async (args, creds, ctx) =>
      postTrafficResponse(await getPostTraffic(ctx, creds, { postId: args.post_id })),
  );
  mcpTool(
    server,
    'get_post_recipients',
    {
      description: `Fetch per-recipient email stats for a published post (delivery, opens, clicks), paginated via limit/offset. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: postId.extend({
        limit: z.number().int().default(20),
        offset: z.number().int().default(0),
      }),
      annotations: readAnnotations('Get Post Recipients'),
      feature: 'mcp:posts:stats:recipients',
      meta: postMeta('GET /post_management/detail/{id}/recipients'),
    },
    async (args, creds, ctx) =>
      postRecipientsResponse(
        await getPostRecipients(ctx, creds, {
          postId: args.post_id,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  );
  mcpTool(
    server,
    'get_post_growth',
    {
      description: `Fetch subscriber growth attributed to a published post. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: postId,
      annotations: readAnnotations('Get Post Growth'),
      feature: 'mcp:posts:stats:growth',
      meta: postMeta('GET /post_management/detail/{id}/growth'),
    },
    (args, creds, ctx) => getPostGrowth(ctx, creds, { postId: args.post_id }),
  );
  mcpTool(
    server,
    'get_post_discussion',
    {
      description: `Fetch the discussion (comment thread) for a published post, cursor-paginated. ${CACHE_NOTE}${TOKEN_NOTE}`,
      inputSchema: postId.extend({ cursor: z.string().nullish() }),
      annotations: readAnnotations('Get Post Discussion'),
      feature: 'mcp:posts:stats:discussion',
      meta: postMeta('GET /post_management/detail/{id}/discussion'),
    },
    async (args, creds, ctx) =>
      postDiscussionResponse(
        await getPostDiscussion(ctx, creds, { postId: args.post_id, cursor: args.cursor }),
      ),
  );
}
