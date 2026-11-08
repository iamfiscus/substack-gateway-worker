// REST credential resolution. Port of gateway_rest_common/deps.py (upstream
// bc2e875) plus owner mode: no header + valid gateway key → the resolver.

import type { RouteConfig, RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  type BearerCredentials,
  decodeBearerCredentials,
  validateBearerCredentials,
} from '../auth/credentials';
import { type CredentialSource, checkFeature } from '../auth/features';
import { type AppEnv, type GatewayContext, scopeToSource } from '../context';
import {
  errorResponse,
  GATEWAY_MISCONFIGURED,
  HttpError,
  INVALID_CREDENTIALS,
  MISSING_TOKEN_DETAIL,
} from './errors';

export type ResolvedCredentials = { creds: BearerCredentials; source: CredentialSource };

export type RestAuth = ResolvedCredentials & { ctx: GatewayContext };

export async function resolveRestCredentials(
  c: Context<AppEnv, string, object>,
): Promise<ResolvedCredentials> {
  const gw = c.var.gw;
  const header = c.req.header('x-gateway-token');
  if (header !== undefined) {
    const raw = header.trim();
    if (!raw) {
      gw.log.warn('rejected: empty x-gateway-token header', { request_id: gw.requestId });
      throw new HttpError(401, INVALID_CREDENTIALS);
    }
    try {
      return { creds: decodeBearerCredentials(raw), source: 'token' };
    } catch {
      gw.log.warn('rejected: x-gateway-token is not valid base64-encoded JSON', {
        request_id: gw.requestId,
      });
      throw new HttpError(401, INVALID_CREDENTIALS);
    }
  }
  if (gw.authInfo && gw.resolver) {
    let creds: BearerCredentials | null;
    try {
      creds = await gw.resolver.resolve(gw.authInfo);
      if (creds) validateBearerCredentials(creds, 'Resolved credentials');
    } catch {
      gw.log.error('credential resolver failed', { request_id: gw.requestId });
      throw new HttpError(500, GATEWAY_MISCONFIGURED);
    }
    if (creds) return { creds, source: 'resolved' };
  }
  throw new HttpError(422, MISSING_TOKEN_DETAIL);
}

/**
 * Wrap a REST handler: resolve credentials, apply the owner feature gate, and
 * map every error through `toHttpError`. `feature` is the upstream feature
 * string (e.g. `api:notes:create`), or null where upstream has none.
 */
export type RouteContext<R extends RouteConfig> = Parameters<RouteHandler<R, AppEnv>>[0];

export function restRoute<R extends RouteConfig = RouteConfig>(
  feature: string | null,
  handler: (c: RouteContext<R>, auth: RestAuth) => Promise<Response>,
): RouteHandler<R, AppEnv> {
  const wrapped = async (c: RouteContext<R>): Promise<Response> => {
    try {
      const resolved = await resolveRestCredentials(c);
      const ctx = scopeToSource(c.var.gw, resolved.source);
      checkFeature(feature, resolved.source, ctx.ownerFeatures);
      return await handler(c, { ...resolved, ctx });
    } catch (err) {
      return errorResponse(c, err);
    }
  };
  ROUTE_FEATURES.set(wrapped, feature);
  // Error responses are outside the route's declared response types by design.
  return wrapped as unknown as RouteHandler<R, AppEnv>;
}

const ROUTE_FEATURES = new WeakMap<object, string | null>();

/** The feature a `restRoute` handler declared; undefined for any other handler. */
export function declaredRouteFeature(handler: unknown): string | null | undefined {
  return typeof handler === 'function' ? ROUTE_FEATURES.get(handler) : undefined;
}
