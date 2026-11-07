// Tool schemas shaped like FastMCP's (pydantic) JSON Schema, so `tools/list`
// matches upstream (bc2e875) and unknown arguments are rejected as pydantic's
// `validate_call` rejects them.
//
// Zod's JSON Schema differs from pydantic's in four ways this module undoes:
// a `$schema` key; nullable fields as `type: [T, "null"]` (pydantic writes
// `anyOf: [{type: T}, {type: "null"}]` plus `default: null` for `= None`);
// safe-integer `minimum`/`maximum` on every `.int()`; and no
// `additionalProperties: false` unless the object is strict.

import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';

type Json = Record<string, unknown>;

function pydanticProperty(prop: Json, required: boolean): Json {
  const out: Json = { ...prop };
  if (out.type === 'integer') {
    if (out.minimum === Number.MIN_SAFE_INTEGER) delete out.minimum;
    if (out.maximum === Number.MAX_SAFE_INTEGER) delete out.maximum;
  }
  if (Array.isArray(out.type) && out.type.includes('null')) {
    const { type, default: dflt, ...rest } = out;
    const others = (type as string[]).filter((t) => t !== 'null');
    const branches = others.map((t) => pydanticProperty({ ...rest, type: t }, true));
    const nullable: Json = { anyOf: [...branches, { type: 'null' }] };
    if (dflt !== undefined) nullable.default = dflt;
    else if (!required) nullable.default = null;
    return nullable;
  }
  return out;
}

/** Zod's JSON Schema for a tool's arguments, rewritten in pydantic's dialect. */
export function pydanticInputSchema(schema: z.ZodObject): Json {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Json;
  const required = new Set((json.required as string[] | undefined) ?? []);
  const props = (json.properties as Record<string, Json> | undefined) ?? {};
  json.properties = Object.fromEntries(
    Object.entries(props).map(([k, p]) => [k, pydanticProperty(p, required.has(k))]),
  );
  json.additionalProperties = false;
  return json;
}

/**
 * A tool `inputSchema`: validates with the strict form of `schema` (unknown
 * arguments fail) and lists as pydantic's JSON Schema.
 */
export function toolInputSchema<S extends z.ZodObject>(
  schema: S,
): StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  const strict = schema.strict();
  const json = pydanticInputSchema(strict);
  return {
    '~standard': {
      version: 1,
      vendor: 'substack-gateway',
      validate: (value) => strict['~standard'].validate(value),
      jsonSchema: { input: () => json, output: () => json },
    },
  } as StandardSchemaWithJSON<z.input<S>, z.output<S>>;
}

/** FastMCP's output schema for a tool returning an object (a pydantic dict). */
export const OBJECT_OUTPUT_SCHEMA: Json = { type: 'object', additionalProperties: true };

/** FastMCP's output schema for a tool returning `str`: wrapped as `{result}`. */
export const TEXT_OUTPUT_SCHEMA: Json = {
  type: 'object',
  properties: { result: { type: 'string' } },
  required: ['result'],
  'x-fastmcp-wrap-result': true,
};

/** An output schema that lists as `json` and accepts any structured content. */
export function toolOutputSchema(json: Json): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'substack-gateway',
      validate: (value) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  } as StandardSchemaWithJSON;
}
