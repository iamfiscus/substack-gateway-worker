// Per-request gateway context shared by REST routes and MCP tools.

import type { McpServer } from '@modelcontextprotocol/server';
import type { BearerCredentials } from './auth/credentials';
import type { AuthInfo } from './auth/gatewayKey';
import type { CredentialResolver } from './auth/resolver';
import type { Fetcher } from './clients/base';
import { PublicationClient } from './clients/publication';
import { SubstackClient } from './clients/substack';
import type { GatewayConfig, GatewayEnv } from './config';
import type { ModuleInfo } from './features';
import type { Logger } from './log';

/** Port of gateway_core/caching.py `ValueCache`: implementations coalesce in-flight calls. */
export interface ValueCache {
  getOrCall<T>(key: string, factory: () => Promise<T>): Promise<T>;
}

/** The default: no caching, every call reaches Substack. */
export class NullValueCache implements ValueCache {
  getOrCall<T>(_key: string, factory: () => Promise<T>): Promise<T> {
    return factory();
  }
}

/** One timeseries row as Substack returns it: `[dateBucket, ...values]`. */
export type StatsRow = unknown[];

/** Port of gateway_stats/cache.py `StatsCache`. Implementations arrive in Task 17. */
export interface StatsCache {
  readTimeseries(publicationUrl: string, series: string): Promise<Record<string, StatsRow>>;
  writeTimeseries(
    publicationUrl: string,
    series: string,
    rows: Record<string, StatsRow>,
  ): Promise<void>;
  getSnapshot(publicationUrl: string, key: string): Promise<Record<string, unknown> | null>;
  setSnapshot(publicationUrl: string, key: string, value: Record<string, unknown>): Promise<void>;
}

export type GatewayContext = {
  env: GatewayEnv;
  config: GatewayConfig;
  fetcher: Fetcher;
  valueCache: ValueCache;
  statsCache: StatsCache | null;
  resolver: CredentialResolver | null;
  requestId: string;
  authInfo: AuthInfo | null;
  ownerFeatures: ReadonlySet<string>;
  log: Logger;
};

/**
 * Extension point. Stub: Task 17 adds the remaining hooks (caches, resolver,
 * fetcher, auth, registerApi/registerApp).
 */
export type GatewayExtension = {
  name: string;
  moduleInfo?: ModuleInfo;
  registerMcp?: (server: McpServer, ctx: GatewayContext) => void;
};

/** Hono environment for the app and every router. */
export type AppEnv = {
  Bindings: GatewayEnv;
  Variables: { gw: GatewayContext };
};

export type SubstackClients = { substack: SubstackClient; publication: PublicationClient };

/** Build the per-request Substack clients for one credential set. */
export function makeClients(ctx: GatewayContext, creds: BearerCredentials): SubstackClients {
  const common = {
    substackSid: creds.substack_sid,
    connectSid: creds.connect_sid,
    fetcher: ctx.fetcher,
    timeoutMs: ctx.config.timeoutMs,
    requestId: ctx.requestId,
    log: ctx.log.log,
  };
  return {
    substack: new SubstackClient({ ...common, baseUrl: ctx.config.substackBaseUrl }),
    publication: new PublicationClient({ ...common, publicationUrl: creds.publication_url }),
  };
}

/** Port of gateway_mcp_common `_anonymous_credentials`: empty cookies, the base URL. */
export function anonymousCredentials(ctx: GatewayContext): BearerCredentials {
  return { publication_url: ctx.config.substackBaseUrl, substack_sid: '', connect_sid: '' };
}
