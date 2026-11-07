import { expect, it } from 'vitest';
import { createWorld, encodeCredentials, loadSample, send, type World } from '../bdd/steps/common';
import { mcpRequest } from '../bdd/steps/mcp';

const PUB = 'https://example.substack.com';

function world(): World {
  const w = createWorld();
  w.publicationUrl = PUB;
  w.headers = {
    'x-gateway-token': encodeCredentials({
      publication_url: PUB,
      substack_sid: 's',
      connect_sid: 'c',
    }),
  };
  return w;
}

it('rejects a calendar-invalid from date with 422', async () => {
  const w = world();
  await send(w, 'GET', '/api/v1/stats/subscribers?from=2025-02-31');
  expect(w.response?.status).toBe(422);
});

it('answers 502 when a stats body is not a JSON object', async () => {
  const w = world();
  w.routes['GET example.substack.com/api/v1/publish-dashboard/summary'] = ['nope'];
  await send(w, 'GET', '/api/v1/stats/dashboard');
  expect(w.response?.status).toBe(502);
});

it('rejects a non-positive post id with 422', async () => {
  const w = world();
  await send(w, 'GET', '/api/v1/posts/0/stats/engagement');
  expect(w.response?.status).toBe(422);
});

it('sends limit and offset to the recipients endpoint', async () => {
  const w = world();
  w.routes['GET example.substack.com/api/v1/post_management/detail/42/recipients'] =
    loadSample('post-stats/recipients');
  await send(w, 'GET', '/api/v1/posts/42/stats/recipients?limit=5&offset=10');
  expect(w.response?.status).toBe(200);
  const url = new URL(w.fake?.calls[0]?.url ?? '');
  expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '5', offset: '10' });
});

it('registers the thirteen stats tools with upstream names', async () => {
  const { payload } = await mcpRequest(world(), 'tools/list', {});
  const names = (payload.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  for (const n of [
    'get_subscriber_timeseries',
    'get_30d_views',
    'get_arr_timeseries',
    'get_email_timeseries',
    'get_dashboard_summary',
    'get_dashboard_period',
    'get_recommendation_stats',
    'get_post_counts',
    'get_post_engagement',
    'get_post_traffic',
    'get_post_recipients',
    'get_post_growth',
    'get_post_discussion',
  ]) {
    expect(names, n).toContain(n);
  }
});
