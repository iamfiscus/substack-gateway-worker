// Shared OpenAPI route fragments for the REST routers.

import { z } from '@hono/zod-openapi';

/** The optional per-request credentials header every authenticated route documents. */
export const tokenHeader = z.object({ 'x-gateway-token': z.string().optional() });

/** A JSON success response with `schema`. */
export const ok = (schema: z.ZodType) => ({
  description: 'Successful Response',
  content: { 'application/json': { schema } },
});

/** A bodyless 204 response. */
export const noContent = { 204: { description: 'Successful Response' } } as const;

/** A required JSON request body. */
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
