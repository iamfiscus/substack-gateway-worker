// Port of gateway_core/client/base.py (upstream bc2e875), fetch-based.

import { SubstackAPIError, SubstackAuthError } from './errors';

export type Fetcher = (req: Request) => Promise<Response>;

export type LogFn = (level: 'info' | 'debug', msg: string) => void;

export type Query = Record<string, string | number | undefined>;

export type SubstackHTTPBaseOptions = {
  base: string;
  substackSid: string;
  connectSid: string;
  fetcher: Fetcher;
  timeoutMs: number;
  requestId?: string;
  log?: LogFn;
};

type RequestOptions = { json?: unknown; query?: Query };

export class SubstackHTTPBase {
  protected readonly base: string;
  private readonly cookie: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly requestId: string | undefined;
  private readonly log: LogFn;

  constructor(o: SubstackHTTPBaseOptions) {
    this.base = o.base.replace(/\/+$/, '');
    // Owner mode may run on substack.sid alone: connect.sid is then omitted.
    // Anonymous calls (both empty) keep upstream's exact empty-cookie header.
    this.cookie =
      o.connectSid || !o.substackSid
        ? `substack.sid=${o.substackSid}; connect.sid=${o.connectSid}`
        : `substack.sid=${o.substackSid}`;
    this.fetcher = o.fetcher;
    this.timeoutMs = o.timeoutMs;
    this.requestId = o.requestId;
    this.log = o.log ?? (() => {});
  }

  get(path: string, o?: { query?: Query }): Promise<unknown> {
    return this.request('GET', path, o);
  }

  post(path: string, o?: RequestOptions): Promise<unknown> {
    return this.request('POST', path, o);
  }

  put(path: string, o?: RequestOptions): Promise<unknown> {
    return this.request('PUT', path, o);
  }

  delete(path: string, o?: { json?: unknown }): Promise<unknown> {
    return this.request('DELETE', path, o);
  }

  private url(path: string, query?: Query): string {
    const u = new URL(`${this.base}/${path.replace(/^\/+/, '')}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async request(method: string, path: string, o: RequestOptions = {}): Promise<unknown> {
    let headers: Headers;
    try {
      headers = new Headers({ cookie: this.cookie, accept: 'application/json' });
    } catch {
      throw new SubstackAPIError(400, 'Invalid credentials: cookie contains invalid characters');
    }
    if (this.requestId) headers.set('x-request-id', this.requestId);
    let body: string | undefined;
    if (o.json !== undefined) {
      body = JSON.stringify(o.json);
      headers.set('content-type', 'application/json');
    }
    const signal = AbortSignal.timeout(this.timeoutMs);
    // Never follow redirects: they could carry the session cookies to another host.
    const req = new Request(this.url(path, o.query), {
      method,
      headers,
      body,
      signal,
      redirect: 'manual',
    });

    let status: number;
    let text: string;
    let location: string | null;
    try {
      // A fetcher may ignore the signal, so race it against the abort.
      const res = await abortable(signal, this.fetcher(req));
      this.logSetCookie(res);
      status = res.status;
      location = res.headers.get('location');
      text = await abortable(signal, res.text());
    } catch (err) {
      throw new SubstackAPIError(502, `Network error: ${errMessage(err)}`);
    }

    if (status === 401) {
      throw new SubstackAuthError(401, 'Invalid or expired Substack session token');
    }
    if (status === 403) {
      throw new SubstackAuthError(403, 'Forbidden: insufficient permissions for this resource');
    }
    if (status >= 300 && status < 400) {
      throw new SubstackAPIError(
        status,
        `Substack returned ${status}: ${redirectDetail(location)}`,
      );
    }
    if (status < 200 || status > 299) {
      throw new SubstackAPIError(
        status,
        `Substack returned ${status}: ${errorDetail(status, text)}`,
      );
    }
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new SubstackAPIError(502, 'Substack returned non-JSON response');
    }
  }

  // Names only, never values: tracks cookie rotation without leaking secrets.
  private logSetCookie(res: Response): void {
    const cookies = res.headers.getSetCookie();
    if (cookies.length === 0) return;
    const names = cookies.map((c) => c.split('=', 1)[0]?.trim() ?? '');
    this.log('info', `substack set-cookie names=${names.join(',')}`);
  }
}

function errorDetail(status: number, text: string): string {
  const fallback = `HTTP ${status}`;
  try {
    const body: unknown = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return fallback;
    const b = body as Record<string, unknown>;
    const detail = b.error || b.message;
    return detail ? String(detail) : fallback;
  } catch {
    return fallback;
  }
}

function redirectDetail(location: string | null): string {
  if (!location) return 'redirect';
  try {
    const host = new URL(location).host;
    return host ? `redirect to ${host}` : 'redirect';
  } catch {
    return 'redirect';
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function abortable<T>(signal: AbortSignal, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    if (signal.aborted) {
      p.catch(() => {});
      return onAbort();
    }
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
