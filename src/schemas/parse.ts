// Validate a Substack response body against a zod schema. Upstream validates
// with pydantic and (for profiles) re-raises as `SubstackAPIError(502, …)`; a
// malformed body is an upstream fault, never a 500 here.

import type { z } from 'zod';
import { SubstackAPIError } from '../clients/errors';

export function parseSubstack<S extends z.ZodType>(
  schema: S,
  data: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  throw new SubstackAPIError(502, `Substack ${what} response invalid: ${issues}`);
}

/**
 * FastAPI `response_model_exclude_none` / pydantic `model_dump(exclude_none=True)`:
 * drop top-level null and undefined fields.
 */
export function excludeNone<T extends object>(value: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}
