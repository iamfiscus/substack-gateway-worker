// REST error mapping. Port of the substack_gateway/api_app.py exception handlers
// and the status table in upstream docs/api-reference.md (400/401/404/409/422/429/502).

import { OpenAPIHono, type z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { InvalidTokenError, MissingCredentialsError } from '../auth/credentials';
import { FeatureDisabledError } from '../auth/features';
import { NotFoundError, SubstackAPIError, SubstackAuthError } from '../clients/errors';
import type { AppEnv } from '../context';

export type ErrorDetail = string | Record<string, unknown>[];

/** Raise from a handler to answer `{"detail": detail}` with `status` (FastAPI HTTPException). */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly detail: ErrorDetail;

  constructor(status: ContentfulStatusCode, detail: ErrorDetail) {
    super(typeof detail === 'string' ? detail : 'validation error');
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export const INVALID_CREDENTIALS = 'Invalid credentials';
export const GATEWAY_MISCONFIGURED = 'gateway misconfigured';

export const MISSING_TOKEN_DETAIL = [
  { loc: ['header', 'x-gateway-token'], msg: 'Field required', type: 'missing' },
];

/** Upstream passes these Substack statuses through; everything else becomes 502. */
const PASSTHROUGH_CODES = new Set([404, 429]);

export type HttpErrorBody = { status: ContentfulStatusCode; body: { detail: ErrorDetail } };

export function toHttpError(err: unknown): HttpErrorBody {
  const out = (status: ContentfulStatusCode, detail: ErrorDetail): HttpErrorBody => ({
    status,
    body: { detail },
  });
  if (err instanceof HttpError) return out(err.status, err.detail);
  if (err instanceof InvalidTokenError) return out(401, INVALID_CREDENTIALS);
  if (err instanceof MissingCredentialsError) return out(422, MISSING_TOKEN_DETAIL);
  if (err instanceof NotFoundError) return out(404, err.message);
  if (err instanceof FeatureDisabledError) return out(403, err.message);
  if (err instanceof SubstackAuthError) return out(err.status, err.message);
  if (err instanceof SubstackAPIError) {
    const status = PASSTHROUGH_CODES.has(err.status) ? (err.status as 404 | 429) : 502;
    return out(status, err.message);
  }
  // Unknown errors never echo their message: it may carry env or request data.
  return out(500, 'Internal Server Error');
}

export function errorResponse(c: Context, err: unknown): Response {
  const { status, body } = toHttpError(err);
  return c.json(body, status);
}

type ZodIssue = z.core.$ZodIssue;

/** FastAPI-style 422 body for a failed request validation. */
export function validationDetail(target: string, issues: readonly ZodIssue[]) {
  const loc = target === 'param' ? 'path' : target;
  return issues.map((i) => ({
    loc: [loc, ...i.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
    msg: i.message,
    type: i.code,
  }));
}

/** An OpenAPIHono router whose validation failures answer 422 `{"detail":[...]}`. */
export function createRouter(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ detail: validationDetail(result.target, result.error.issues) }, 422);
      }
    },
  });
}

const MALFORMED_JSON = 'Malformed JSON in request body';
const UNSUPPORTED_MEDIA_TYPE = 'Unsupported Media Type';
const NOT_A_DICT = 'Input should be a valid dictionary or object to extract fields from';

/** Methods whose raw body is buffered so a body error can be reported like upstream. */
export const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** The buffered raw request body, or null when it was never buffered. */
async function bufferedText(c: Context): Promise<string | null> {
  const cached = c.req.bodyCache.text;
  if (cached === undefined) return null;
  try {
    return await cached;
  } catch {
    return null;
  }
}

/**
 * Map the JSON body validator's HTTPExceptions to upstream's FastAPI 422 bodies
 * (observed against bc2e875): empty body -> missing, unparsable JSON ->
 * json_invalid with the error position, a non-JSON media type -> the
 * model_attributes_type error echoing the input. Null when `err` is not one of them.
 */
export async function bodyErrorResponse(c: Context, err: unknown): Promise<Response | null> {
  if (!(err instanceof HTTPException)) return null;
  const malformed = err.status === 400 && err.message === MALFORMED_JSON;
  const mediaType = err.status === 415 && err.message === UNSUPPORTED_MEDIA_TYPE;
  if (!malformed && !mediaType) return null;
  const raw = await bufferedText(c);
  if (raw === null) return null;
  if (raw === '') {
    return c.json(
      { detail: [{ type: 'missing', loc: ['body'], msg: 'Field required', input: null }] },
      422,
    );
  }
  if (mediaType) {
    return c.json(
      { detail: [{ type: 'model_attributes_type', loc: ['body'], msg: NOT_A_DICT, input: raw }] },
      422,
    );
  }
  let message = 'JSON decode error';
  try {
    JSON.parse(raw);
  } catch (e) {
    if (e instanceof Error) message = e.message;
  }
  const pos = /position (\d+)/.exec(message);
  return c.json(
    {
      detail: [
        {
          type: 'json_invalid',
          loc: ['body', pos ? Number(pos[1]) : 0],
          msg: 'JSON decode error',
          input: {},
          ctx: { error: message },
        },
      ],
    },
    422,
  );
}
