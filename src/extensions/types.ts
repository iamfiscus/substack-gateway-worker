// Extension contract. Port of gateway_oss/extensions/base.py `GatewayExtension`
// (upstream bc2e875) with static composition: no entry points, no lifespan hooks.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import type { AuthInfo } from '../auth/gatewayKey';
import type { CredentialResolver } from '../auth/resolver';
import type { Fetcher } from '../clients/base';
import type { GatewayEnv } from '../config';
import type { AppEnv, GatewayContext, StatsCache, ValueCache } from '../context';
import type { ModuleInfo } from '../features';

/**
 * Passed to `registerApi` / `registerApp`, which run once when the app is built,
 * before any request exists. Handlers read the per-request context from
 * `c.var.gw`.
 */
export type ExtensionRegistration = { readonly extensionNames: readonly string[] };

/** A provider is either ready-made or built from the request's env (KV bindings). */
export type Provider<T> = T | ((env: GatewayEnv) => T);

export interface GatewayExtension {
  name: string;
  moduleInfo?: ModuleInfo;
  registerApi?(api: OpenAPIHono<AppEnv>, ctx: ExtensionRegistration): void;
  registerApp?(app: Hono<AppEnv>, ctx: ExtensionRegistration): void;
  registerMcp?(server: McpServer, ctx: GatewayContext): void;
  /** Replaces the built-in gateway-key check. Null means "not authenticated". */
  authenticate?(req: Request, env: GatewayEnv): Promise<AuthInfo | null>;
  credentialResolver?: CredentialResolver;
  /** Must pass the original Request through unchanged (client sets `redirect: 'manual'`). */
  fetcher?: Fetcher;
  valueCache?: Provider<ValueCache>;
  statsCache?: Provider<StatsCache>;
  /** Marks a statsCache that only works in owner mode (checked per request). */
  requiresOwnerMode?: boolean;
}

export type ComposedProviders = {
  authenticate: GatewayExtension['authenticate'] | null;
  credentialResolver: CredentialResolver | null;
  fetcher: Fetcher | null;
  valueCache: Provider<ValueCache> | null;
  statsCache: Provider<StatsCache> | null;
  requiresOwnerMode: boolean;
};
