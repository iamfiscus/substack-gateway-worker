// Port of gateway_core/models/pagination.py (upstream bc2e875): the shared
// query-parameter models for cursor and cursor+limit endpoints.

import { z } from '@hono/zod-openapi';

export const CursorPageQuery = z.object({ cursor: z.string().optional() });

export const CursorLimitPageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().gt(0).lte(100).default(25),
});
