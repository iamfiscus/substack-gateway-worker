// Port of gateway_core/client/exceptions.py (upstream bc2e875).

/** Raised when Substack returns 401 or 403. */
export class SubstackAuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403 = 401, message = 'Invalid or expired Substack session token') {
    super(message);
    this.name = 'SubstackAuthError';
    this.status = status;
  }
}

/** Raised for other Substack API errors (network failures, 5xx, non-JSON, etc.). */
export class SubstackAPIError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SubstackAPIError';
    this.status = status;
  }
}
