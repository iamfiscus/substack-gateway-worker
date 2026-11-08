// Port of gateway_oss/api/v1/health.py (upstream bc2e875).

import { createRoute, z } from '@hono/zod-openapi';
import { makeClients } from '../context';
import { restRoute } from './credentials';
import { createRouter, HttpError } from './errors';
import { tokenHeader } from './openapi';

const LivenessResponse = z.object({ status: z.string() }).openapi('LivenessResponse');

const TokensInfo = z
  .object({ publication_url: z.string(), substack_sid: z.string(), connect_sid: z.string() })
  .openapi('TokensInfo');

const HealthResponse = z
  .object({ connected: z.boolean(), tokens: TokensInfo.optional() })
  .openapi('HealthResponse');

/** Pydantic's lenient bool parsing for query params. */
const QueryBool = z.stringbool({
  truthy: ['true', '1', 'yes', 'on', 'y', 't'],
  falsy: ['false', '0', 'no', 'off', 'n', 'f'],
});

const liveRoute = createRoute({
  method: 'get',
  path: '/health/live',
  tags: ['health'],
  summary: 'Health Live',
  description: 'Public liveness probe — no auth required.',
  responses: {
    200: {
      description: 'Successful Response',
      content: { 'application/json': { schema: LivenessResponse } },
    },
  },
});

const readyRoute = createRoute({
  method: 'get',
  path: '/health/ready',
  tags: ['health'],
  summary: 'Health Ready',
  description: 'Authenticated readiness probe — verifies Substack connectivity.',
  request: { headers: tokenHeader, query: z.object({ show: QueryBool.optional() }) },
  responses: {
    200: {
      description: 'Successful Response',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

export const SHOW_DISABLED = 'show is disabled for resolved credentials';

export const healthRouter = createRouter()
  .openapi(liveRoute, (c) => c.json({ status: 'ok' }, 200))
  .openapi(
    readyRoute,
    restRoute<typeof readyRoute>('api:health:ready', async (c, { creds, source, ctx }) => {
      const show = c.req.valid('query').show ?? false;
      // Resolved (owner) credentials are never echoed: the caller never supplied them.
      if (show && source === 'resolved') throw new HttpError(403, SHOW_DISABLED);
      const connected = await makeClients(ctx, creds).substack.checkConnectivity();
      return c.json(show ? { connected, tokens: { ...creds } } : { connected }, 200);
    }),
  );
