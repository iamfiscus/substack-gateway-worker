import { type CreateAppOptions, createApp } from './app';
import type { GatewayEnv } from './config';
import { assertOwnerModeFor, composeExtensions } from './extensions/compose';

export type { CreateAppOptions } from './app';
export { createApp } from './app';
export type { GatewayContext, GatewayExtension } from './context';
export { composeExtensions } from './extensions/compose';
export { kvStatsCache } from './extensions/kvStatsCache';
export { kvValueCache } from './extensions/kvValueCache';
export { type PacedFetcherOptions, pacedFetcher } from './extensions/pacedFetcher';

export type Gateway = {
  fetch: (req: Request, env?: GatewayEnv, ctx?: ExecutionContext) => Response | Promise<Response>;
};

/**
 * Build a Worker entry from statically listed extensions. Two extensions
 * supplying the same single provider throws here. An owner-only stats cache
 * needs the env to judge owner mode: pass `env` to fail now, otherwise the
 * check runs on every request (a Worker's env only exists per request).
 */
export function createGateway(opts: CreateAppOptions & { env?: GatewayEnv } = {}): Gateway {
  const { env, ...appOpts } = opts;
  const providers = composeExtensions(appOpts.extensions ?? []);
  if (env) assertOwnerModeFor(providers, env);
  const app = createApp(appOpts);
  return {
    fetch: async (req, e, ctx) => {
      assertOwnerModeFor(providers, e ?? {});
      return app.fetch(req, e, ctx);
    },
  };
}

export default createGateway({ extensions: [] });
