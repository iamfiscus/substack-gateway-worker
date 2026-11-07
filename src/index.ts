import { type CreateAppOptions, createApp } from './app';
import type { GatewayEnv } from './config';

export type { CreateAppOptions } from './app';
export { createApp } from './app';
export type { GatewayContext, GatewayExtension } from './context';

export type Gateway = {
  fetch: (req: Request, env?: GatewayEnv, ctx?: ExecutionContext) => Response | Promise<Response>;
};

/** Build a Worker entry. Task 17 adds extension provider resolution. */
export function createGateway(opts: CreateAppOptions = {}): Gateway {
  const app = createApp(opts);
  return { fetch: (req, env, ctx) => app.fetch(req, env, ctx) };
}

export default {
  fetch: (req: Request, env?: GatewayEnv, ctx?: ExecutionContext) =>
    createApp({}).fetch(req, env, ctx),
};
