import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fetcher } from '../../src/clients/base';

/** A handler `(req) => Response | json`, or a plain JSON value served as 200. */
export type FakeRoute = unknown;

/** Load a JSON sample from test/fixtures/samples/<path>. */
export function sample(path: string): unknown {
  // Joined as a plain path: some sample names carry a "?" (feed/profile/<id>?types=note).
  const root = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/samples');
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
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
