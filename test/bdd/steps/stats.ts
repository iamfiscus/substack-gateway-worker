// Port of upstream features/steps/{stats,post_stats}.py (bc2e875) plus the
// stats When steps from mcp_tools.py. The publication API lives on the
// credential's publication host.

import { type StepRegistry, step } from '../runner';
import { loadSample, pubHost, type World } from './common';
import { callTool } from './mcp';

const status = (code: number) => () => new Response(null, { status: code });

// name -> [path under /api/v1/, sample file under samples/stats/]
const STATS_ENDPOINTS: Record<string, [string, string]> = {
  'ARR-timeseries': ['publication/stats/arr/timeseries', 'arr-timeseries'],
  'email-timeseries': ['publication/stats/emails/timeseries', 'emails-timeseries'],
  'dashboard-summary': ['publish-dashboard/summary', 'dashboard-summary'],
  'dashboard-period': ['publish-dashboard/summary-v2', 'dashboard-summary-v2'],
  'recommendations-from': ['recommendations/stats/from', 'recommendations-from'],
  'recommendations-to': ['recommendations/stats/to', 'recommendations-to'],
  'post-counts': ['post_management/counts', 'post-counts'],
};

function statsEndpoint(w: World, name: string): { key: string; sample: string } {
  const entry = STATS_ENDPOINTS[name];
  if (!entry) {
    throw new Error(
      `Unknown stats endpoint "${name}"; expected one of ${Object.keys(STATS_ENDPOINTS).sort()}`,
    );
  }
  return { key: `GET ${pubHost(w)}/api/v1/${entry[0]}`, sample: `stats/${entry[1]}` };
}

const subscribersKey = (w: World) =>
  `GET ${pubHost(w)}/api/v1/publication/stats/subscribers/timeseries`;
const viewsKey = (w: World) =>
  `GET ${pubHost(w)}/api/v1/publication/stats/publication_traffic/30d_views`;
const detailKey = (w: World, id: number | string, tab: string) =>
  `GET ${pubHost(w)}/api/v1/post_management/detail/${id}/${tab}`;

export const statsSteps: StepRegistry<World> = [
  step('the Substack subscriber-timeseries endpoint returns the sample response', (w) => {
    w.routes[subscribersKey(w)] = loadSample('stats/subscribers-timeseries');
  }),
  step('the Substack subscriber-timeseries endpoint returns status {status:d}', (w, [code]) => {
    w.routes[subscribersKey(w)] = status(Number(code));
  }),
  step('the Substack 30d-views endpoint returns the sample response', (w) => {
    w.routes[viewsKey(w)] = loadSample('stats/30d-views');
  }),
  step('the Substack 30d-views endpoint returns status {status:d}', (w, [code]) => {
    w.routes[viewsKey(w)] = status(Number(code));
  }),
  step('the Substack stats "{name}" endpoint returns the sample response', (w, [name]) => {
    const { key, sample } = statsEndpoint(w, name as string);
    w.routes[key] = loadSample(sample);
  }),
  step('the Substack stats "{name}" endpoint returns status {status:d}', (w, [name, code]) => {
    w.routes[statsEndpoint(w, name as string).key] = status(Number(code));
  }),

  // post stats
  step(
    'the Substack post {tab} endpoint returns the sample response for post {post_id:d}',
    (w, [tab, id]) => {
      w.routes[detailKey(w, Number(id), String(tab))] = loadSample(`post-stats/${tab}`);
    },
  ),
  step(
    'the Substack post {tab} endpoint returns status {status:d} for post {post_id:d}',
    (w, [tab, code, id]) => {
      w.routes[detailKey(w, Number(id), String(tab))] = status(Number(code));
    },
  ),

  // MCP When steps
  step('I call the MCP tool get_subscriber_timeseries', (w) =>
    callTool(w, 'get_subscriber_timeseries', {}),
  ),
  step('I call the MCP tool get_30d_views', (w) => callTool(w, 'get_30d_views', {})),
  step('I call the MCP tool get_arr_timeseries', (w) => callTool(w, 'get_arr_timeseries', {})),
  step('I call the MCP tool get_email_timeseries', (w) => callTool(w, 'get_email_timeseries', {})),
  step('I call the MCP tool get_dashboard_summary', (w) =>
    callTool(w, 'get_dashboard_summary', {}),
  ),
  step('I call the MCP tool get_dashboard_period with range_days {n:d}', (w, [n]) =>
    callTool(w, 'get_dashboard_period', { range_days: Number(n) }),
  ),
  step('I call the MCP tool get_recommendation_stats with direction "{direction}"', (w, [d]) =>
    callTool(w, 'get_recommendation_stats', { direction: d }),
  ),
  step('I call the MCP tool get_post_counts', (w) => callTool(w, 'get_post_counts', {})),
  ...(['engagement', 'traffic', 'recipients', 'growth', 'discussion'] as const).map((tab) =>
    step<World>(`I call the MCP tool get_post_${tab} with post_id {id:d}`, (w, [id]) =>
      callTool(w, `get_post_${tab}`, { post_id: Number(id) }),
    ),
  ),
];
