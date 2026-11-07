// Hono app shell: request id, gateway-key auth, `/`, `/api`, `/mcp`.
// Port of substack_gateway/app_factory.py + api_app.py (upstream bc2e875).

import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ownerFeatures } from './auth/features';
import { type AuthInfo, authenticateGatewayKey, parseGatewayKeys } from './auth/gatewayKey';
import { type CredentialResolver, SecretCredentialResolver } from './auth/resolver';
import type { Fetcher } from './clients/base';
import { type GatewayEnv, loadConfig } from './config';
import { type AppEnv, type GatewayContext, type GatewayExtension, NullValueCache } from './context';
import { createLogger } from './log';
import { handleMcpRequest } from './mcp/server';
import { commentsRouter } from './rest/comments';
import { errorResponse, GATEWAY_MISCONFIGURED } from './rest/errors';
import { followingRouter } from './rest/following';
import { healthRouter } from './rest/health';
import { meRouter } from './rest/me';
import { notesRouter } from './rest/notes';
import { postsRouter } from './rest/posts';
import { profilesRouter } from './rest/profiles';
import { rootHandler } from './rest/root';
import { statsRouter } from './rest/stats';

export type CreateAppOptions = { fetcher?: Fetcher; extensions?: GatewayExtension[] };

/** Production fetcher: the Request goes through unchanged so `redirect: 'manual'` holds. */
const defaultFetcher: Fetcher = (req) => fetch(req);

/** [C6] Reachable without a gateway key even when GATEWAY_API_KEYS is set. */
const PUBLIC_PATHS = new Set(['/', '/api/v1/health/live']);
/** Upstream's log filter drops lines for these paths. */
const SILENT_PATHS = new Set(['/api/v1/health/live', '/api/v1/health/ready']);

const INVALID_GATEWAY_KEY = 'Invalid gateway key';

function ownerResolver(env: GatewayEnv): CredentialResolver | null {
  const any = env.OWNER_PUBLICATION_URL || env.OWNER_SUBSTACK_SID || env.OWNER_CONNECT_SID;
  return any ? new SecretCredentialResolver(env) : null;
}

type KeyCheck =
  | { kind: 'off' }
  | { kind: 'ok'; auth: AuthInfo }
  | { kind: 'denied' | 'misconfigured' };

async function checkGatewayKey(req: Request, raw: string | undefined): Promise<KeyCheck> {
  if (raw === undefined || raw.trim() === '') return { kind: 'off' };
  let keys: ReturnType<typeof parseGatewayKeys>;
  try {
    keys = parseGatewayKeys(raw);
  } catch {
    return { kind: 'misconfigured' };
  }
  if (keys.length === 0) return { kind: 'misconfigured' };
  const auth = await authenticateGatewayKey(req, keys);
  return auth ? { kind: 'ok', auth } : { kind: 'denied' };
}

export function createApp(opts: CreateAppOptions = {}): Hono<AppEnv> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const extensions = opts.extensions ?? [];
  const app = new Hono<AppEnv>();

  // First, so browser preflights (which carry no Authorization) are answered.
  app.use('*', cors());
  app.use('*', async (c, next) => {
    const env: GatewayEnv = c.env ?? {};
    const config = loadConfig(env);
    const log = createLogger(config.logLevel);
    const requestId = c.req.header('x-request-id') || crypto.randomUUID();
    const path = c.req.path;
    const gw: GatewayContext = {
      env,
      config,
      fetcher,
      valueCache: new NullValueCache(),
      statsCache: null,
      resolver: ownerResolver(env),
      requestId,
      authInfo: null,
      ownerFeatures: ownerFeatures(env),
      log,
    };
    c.set('gw', gw);

    const key = await checkGatewayKey(c.req.raw, env.GATEWAY_API_KEYS);
    if (key.kind === 'ok') gw.authInfo = key.auth;
    const finish = (res: Response): Response => {
      res.headers.set('X-Request-ID', requestId);
      if (!SILENT_PATHS.has(path)) {
        // Never raw headers: method, path, status, request id and key label only.
        log.info('request', {
          request_id: requestId,
          method: c.req.method,
          path,
          status: res.status,
          key: gw.authInfo?.clientId ?? null,
        });
      }
      return res;
    };

    if (!PUBLIC_PATHS.has(path)) {
      if (key.kind === 'misconfigured') {
        log.error('GATEWAY_API_KEYS is malformed', { request_id: requestId });
        return finish(c.json({ detail: GATEWAY_MISCONFIGURED }, 500));
      }
      if (key.kind === 'denied') return finish(c.json({ detail: INVALID_GATEWAY_KEY }, 401));
    }
    await next();
    c.res = finish(c.res);
  });

  app.get('/', rootHandler(extensions));

  const api = new OpenAPIHono<AppEnv>();
  api.route('/v1', healthRouter);
  api.route('/v1', meRouter);
  api.route('/v1', followingRouter);
  api.route('/v1', notesRouter);
  api.route('/v1', commentsRouter);
  api.route('/v1', postsRouter);
  api.route('/v1', profilesRouter);
  api.route('/v1', statsRouter);
  app.route('/api', api);

  const mcp = (c: { req: { raw: Request }; var: { gw: GatewayContext } }) =>
    handleMcpRequest(c.req.raw, c.var.gw, extensions);
  app.on(['GET', 'POST', 'DELETE'], ['/mcp', '/mcp/'], (c) => mcp(c));

  app.notFound((c) => c.json({ detail: 'Not Found' }, 404));
  app.onError((err, c) => {
    c.var.gw?.log.error('unhandled error', { request_id: c.var.gw.requestId });
    return errorResponse(c, err);
  });
  return app;
}
