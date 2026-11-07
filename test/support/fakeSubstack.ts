import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Fetcher } from '../../src/clients/base';

/** A handler `(req) => Response | json`, or a plain JSON value served as 200. */
export type FakeRoute = unknown;

/** Load a JSON sample from test/fixtures/samples/<path>. */
export function sample(path: string): unknown {
  const file = fileURLToPath(new URL(`../fixtures/samples/${path}`, import.meta.url).href);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Route keys look like "GET substack.com/api/v1/user-settings" (method, host+path,
 * no query). A handler may return a Response or any JSON-serialisable value.
 */
export function createFakeSubstack(
  routes: Record<string, FakeRoute>,
): Fetcher & { calls: Request[] } {
  const calls: Request[] = [];
  const fetcher = async (req: Request): Promise<Response> => {
    calls.push(req.clone());
    const u = new URL(req.url);
    const handler = routes[`${req.method} ${u.host}${u.pathname}`];
    if (!handler) {
      return Response.json({ error: 'no fake route' }, { status: 404 });
    }
    const out = typeof handler === 'function' ? await handler(req) : handler;
    return out instanceof Response ? out : Response.json(out);
  };
  return Object.assign(fetcher, { calls });
}
