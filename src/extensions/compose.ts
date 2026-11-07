// Port of substack_gateway/runtime.py `_single_provider` (upstream bc2e875):
// two extensions offering the same single provider is a startup error.

import type { GatewayEnv } from '../config';
import type { ComposedProviders, GatewayExtension } from './types';

type SingleKind = 'authenticate' | 'credentialResolver' | 'fetcher' | 'valueCache' | 'statsCache';
const KINDS: SingleKind[] = [
  'authenticate',
  'credentialResolver',
  'fetcher',
  'valueCache',
  'statsCache',
];

export function composeExtensions(exts: readonly GatewayExtension[]): ComposedProviders {
  const out: ComposedProviders = {
    authenticate: null,
    credentialResolver: null,
    fetcher: null,
    valueCache: null,
    statsCache: null,
    requiresOwnerMode: false,
  };
  const owner = new Map<SingleKind, string>();
  for (const ext of exts) {
    for (const kind of KINDS) {
      const provider = ext[kind];
      if (provider === undefined) continue;
      const first = owner.get(kind);
      if (first !== undefined) {
        throw new Error(`duplicate provider ${kind} from ${first} and ${ext.name}`);
      }
      owner.set(kind, ext.name);
      (out as Record<SingleKind, unknown>)[kind] = provider;
    }
    if (ext.statsCache !== undefined && ext.requiresOwnerMode) out.requiresOwnerMode = true;
  }
  return out;
}

/** Owner mode: a gateway key gate plus complete OWNER_* credentials. */
export function isOwnerMode(env: GatewayEnv): boolean {
  return (
    (env.GATEWAY_API_KEYS ?? '').trim() !== '' &&
    Boolean(env.OWNER_PUBLICATION_URL && env.OWNER_SUBSTACK_SID && env.OWNER_CONNECT_SID)
  );
}

export const OWNER_MODE_REQUIRED =
  'kvStatsCache requires owner mode (GATEWAY_API_KEYS and OWNER_*)';

/** Spec §10.4: an owner-only stats cache refuses to run without owner mode. */
export function assertOwnerModeFor(providers: ComposedProviders, env: GatewayEnv): void {
  if (providers.requiresOwnerMode && !isOwnerMode(env)) throw new Error(OWNER_MODE_REQUIRED);
}

/** Resolve a ready-made or env-built provider. */
export function resolveProvider<T>(p: T | ((env: GatewayEnv) => T), env: GatewayEnv): T {
  return typeof p === 'function' ? (p as (env: GatewayEnv) => T)(env) : p;
}
