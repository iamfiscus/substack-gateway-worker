// Hono app shell: request id, gateway-key auth, `/`, `/api`, `/mcp`.
// Port of substack_gateway/app_factory.py + api_app.py (upstream bc2e875).

import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import pkg from '../package.json';
import { ownerFeatures } from './auth/features';
import { type AuthInfo, authenticateGatewayKey, parseGatewayKeys } from './auth/gatewayKey';
import { type CredentialResolver, SecretCredentialResolver } from './auth/resolver';
import type { Fetcher } from './clients/base';
import { type GatewayEnv, loadConfig } from './config';
import { type AppEnv, type GatewayContext, type GatewayExtension, NullValueCache } from './context';
import { assertOwnerModeFor, composeExtensions, resolveProvider } from './extensions/compose';
import type { ComposedProviders } from './extensions/types';
import { createLogger } from './log';
import { handleMcpRequest } from './mcp/server';
import { commentsRouter } from './rest/comments';
import { draftsRouter } from './rest/drafts';
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

async function checkGatewayKey(
  req: Request,
  env: GatewayEnv,
  authenticate: ComposedProviders['authenticate'],
): Promise<KeyCheck> {
  if (authenticate) {
    // An extension's authenticate replaces the built-in gateway-key check.
    try {
      const auth = await authenticate(req, env);
      return auth ? { kind: 'ok', auth } : { kind: 'denied' };
    } catch {
      return { kind: 'misconfigured' };
    }
  }
  const raw = env.GATEWAY_API_KEYS;
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

/** The `/api` sub-app: every REST router under `/v1`, with their OpenAPI routes. */
export function createApi(extensions: readonly GatewayExtension[] = []): OpenAPIHono<AppEnv> {
  const api = new OpenAPIHono<AppEnv>();
  // FastAPI's `Response(status_code=204)` still carries its default media type.
  api.use('*', async (c, next) => {
    await next();
    if (c.res.status === 204 && !c.res.headers.has('content-type')) {
      c.res.headers.set('content-type', 'application/json');
    }
  });
  api.route('/v1', healthRouter);
  api.route('/v1', meRouter);
  api.route('/v1', followingRouter);
  api.route('/v1', notesRouter);
  api.route('/v1', commentsRouter);
  api.route('/v1', postsRouter);
  api.route('/v1', profilesRouter);
  api.route('/v1', statsRouter);
  api.route('/v1', draftsRouter);
  const registration = { extensionNames: extensions.map((e) => e.name) };
  for (const ext of extensions) ext.registerApi?.(api, registration);
  return api;
}

export function createApp(opts: CreateAppOptions = {}): Hono<AppEnv> {
  const extensions = opts.extensions ?? [];
  // Throws on a duplicate single provider: a startup error, as upstream.
  const providers = composeExtensions(extensions);
  const fetcher = opts.fetcher ?? providers.fetcher ?? defaultFetcher;
  const app = new OpenAPIHono<AppEnv>();

  // First, so browser preflights (which carry no Authorization) are answered.
  app.use('*', cors());
  app.use('*', async (c, next) => {
    const env: GatewayEnv = c.env ?? {};
    assertOwnerModeFor(providers, env);
    const config = loadConfig(env);
    const log = createLogger(config.logLevel);
    const requestId = c.req.header('x-request-id') || crypto.randomUUID();
    const path = c.req.path;
    let allowed: ReadonlySet<string>;
    let featuresMalformed = false;
    try {
      allowed = ownerFeatures(env);
    } catch {
      // Fail closed: no owner feature is allowed, and non-public paths answer 500.
      allowed = new Set();
      featuresMalformed = true;
    }
    const gw: GatewayContext = {
      env,
      config,
      fetcher,
      valueCache: providers.valueCache
        ? resolveProvider(providers.valueCache, env)
        : new NullValueCache(),
      statsCache: providers.statsCache ? resolveProvider(providers.statsCache, env) : null,
      resolver: providers.credentialResolver ?? ownerResolver(env),
      requestId,
      authInfo: null,
      ownerFeatures: allowed,
      log,
    };
    c.set('gw', gw);

    const key = await checkGatewayKey(c.req.raw, env, providers.authenticate);
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
      if (featuresMalformed) {
        log.error('OWNER_ALLOWED_FEATURES is malformed', { request_id: requestId });
        return finish(c.json({ detail: GATEWAY_MISCONFIGURED }, 500));
      }
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

  app.route('/api', createApi(extensions));
  // Not in PUBLIC_PATHS: open without GATEWAY_API_KEYS, key-gated with it.
  // Swagger UI loads its JS/CSS from the jsDelivr CDN (as FastAPI's /docs does).
  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Substack Gateway', version: pkg.version },
  });
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

  const registration = { extensionNames: extensions.map((e) => e.name) };
  for (const ext of extensions) ext.registerApp?.(app, registration);

  const mcp = (c: { req: { raw: Request }; var: { gw: GatewayContext } }) =>
    handleMcpRequest(c.req.raw, c.var.gw, extensions);
  app.post('/mcp', (c) => mcp(c));
  app.post('/mcp/', (c) => mcp(c));
  // Stateless streamable HTTP, as upstream's FastMCP (`stateless_http=True`) answers them.
  app.on('GET', ['/mcp', '/mcp/'], (c) =>
    c.body('Method Not Allowed', 405, {
      allow: 'POST, DELETE',
      'content-type': 'text/plain; charset=utf-8',
    }),
  );
  app.on('DELETE', ['/mcp', '/mcp/'], (c) =>
    c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Method Not Allowed: Session termination not supported' },
      },
      405,
    ),
  );

  app.notFound((c) => c.json({ detail: 'Not Found' }, 404));
  app.onError((err, c) => {
    c.var.gw?.log.error('unhandled error', { request_id: c.var.gw.requestId });
    return errorResponse(c, err);
  });
  return app;
}
