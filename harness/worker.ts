// The private `substack-gateway-harness` Worker: `POST /run` starts the
// harness container (harness/Dockerfile) in a Durable Object-managed
// Cloudflare container (the Sandbox model of @cloudflare/sandbox 1.x, which
// needs only the Container API for running commands) and returns the parity
// result `{ total, mismatches, allowed, happyFailures }` of harness/run.ts.
//
// Not deployed by default: deploying it is optional and requires your own Cloudflare account.
// Requests must carry `Authorization: Bearer <HARNESS_TOKEN>` (a Worker secret).

import { DurableObject } from 'cloudflare:workers';
import { bearerMatches } from './auth';

type Env = {
  HARNESS: DurableObjectNamespace<HarnessSandbox>;
  HARNESS_TOKEN?: string;
};

const decoder = new TextDecoder();

export class HarnessSandbox extends DurableObject<Env> {
  async run(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const container = this.ctx.container;
    if (!container) throw new Error('The container binding is not configured');
    // The image's own command runs the harness once and exits; under the
    // Durable Object the container idles and each /run execs the harness.
    // Everything the harness needs is in the image, and it only talks to 127.0.0.1.
    let lastError: unknown;
    // Right after a deploy the container application can still be
    // provisioning ("no container instance that can be provided"), and a failed
    // start leaves the container stopped, so (re)start it on every attempt.
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        if (!container.running) {
          container.start({ entrypoint: ['sleep', 'infinity'], enableInternet: false });
        }
        const proc = await container.exec(['harness/start.sh'], { cwd: '/app' });
        const out = await proc.output();
        return {
          exitCode: out.exitCode,
          stdout: decoder.decode(out.stdout),
          stderr: decoder.decode(out.stderr),
        };
      } catch (err) {
        // The container may still be booting.
        lastError = err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw lastError;
  }
}

function authorized(req: Request, env: Env): Promise<boolean> {
  return bearerMatches(req.headers.get('authorization'), env.HARNESS_TOKEN);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/run' || req.method !== 'POST') {
      return Response.json({ detail: 'Not Found' }, { status: 404 });
    }
    if (!(await authorized(req, env)))
      return Response.json({ detail: 'Unauthorized' }, { status: 401 });
    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await env.HARNESS.getByName('parity').run();
    } catch (err) {
      return Response.json(
        { detail: 'harness container did not run', error: String(err) },
        { status: 503 },
      );
    }
    const { exitCode, stdout, stderr } = result;
    try {
      // A non-zero exit only means mismatches: the body says which.
      return Response.json(JSON.parse(stdout));
    } catch {
      return Response.json(
        { detail: 'harness did not print JSON', exitCode, stderr },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
