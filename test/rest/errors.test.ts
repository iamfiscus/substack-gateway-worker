import { describe, expect, it } from 'vitest';
import { SubstackAPIError, SubstackAuthError } from '../../src/clients/errors';
import { toHttpError } from '../../src/rest/errors';

describe('toHttpError status table', () => {
  it.each([
    [new SubstackAPIError(404, 'Substack returned 404: HTTP 404'), 404],
    [new SubstackAPIError(429, 'Substack returned 429: HTTP 429'), 429],
    [new SubstackAPIError(400, 'Substack returned 400: HTTP 400'), 502],
    [new SubstackAPIError(500, 'Substack returned 500: HTTP 500'), 502],
    [new SubstackAuthError(401, 'Invalid or expired Substack session token'), 401],
    [new SubstackAuthError(403, 'Forbidden: insufficient permissions for this resource'), 403],
  ])('%s -> %i', (err, status) => {
    const out = toHttpError(err);
    expect(out.status).toBe(status);
    expect(out.body.detail).toBe(err.message);
  });
});
