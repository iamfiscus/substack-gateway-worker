// MCP server factory and the shared tool wrapper. One fresh McpServer per
// request (upstream FastMCP runs `stateless_http=True`).

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { BearerCredentials } from '../auth/credentials';
import { checkFeature } from '../auth/features';
import { SubstackAPIError } from '../clients/errors';
import {
  anonymousCredentials,
  type GatewayContext,
  type GatewayExtension,
  scopeToSource,
} from '../context';
import { pyRepr } from '../converters/dialect/pyRepr';
import { APPLICATION_NAME, OSS_VERSION } from '../features';
import { registerCommentsTools } from './comments';
import { resolveMcpCredentials } from './credentials';
import { registerDraftsTools } from './drafts';
import { registerFollowingTools } from './following';
import {
  OBJECT_OUTPUT_SCHEMA,
  TEXT_OUTPUT_SCHEMA,
  toolInputSchema,
  toolOutputSchema,
} from './jsonSchema';
import { registerMeTools } from './me';
import { registerNotesTools } from './notes';
import { registerPostsTools } from './posts';
import { registerProfilesTools } from './profiles';
import { registerStatsTools } from './stats';

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolDef<S extends z.ZodObject> = {
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  /** Upstream feature string, gated for resolved (owner) credentials. */
  feature: string | null;
  /** Public tools: no `token` argument, anonymous clients (upstream profiles tools). */
  anonymous?: boolean;
  /** Upstream `meta` (category, substack_endpoint) plus folded `tags`. */
  meta?: Record<string, unknown>;
  /** The upstream tool returns `str`: FastMCP lists a wrapped `{result}` output schema. */
  textResult?: boolean;
};

/** Appended to every upstream tool description that takes `token`. */
export const TOKEN_NOTE =
  ' The `token` argument is optional: pass base64-encoded Substack credentials, or omit it if this deployment resolves credentials from the authenticated session.';

/** FastMCP `get_meta()`: the tool's `meta` plus `fastmcp.tags` (sorted). */
export function toolMeta(
  category: string,
  substackEndpoint: string,
  tags: readonly string[],
): Record<string, unknown> {
  return {
    category,
    substack_endpoint: substackEndpoint,
    fastmcp: { tags: [...tags].sort() },
  };
}

/** Annotations shared by every upstream read tool. */
export function readAnnotations(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

/** Annotations of an upstream write tool (never read-only, always open-world). */
export function writeAnnotations(
  title: string,
  o: { destructive?: boolean; idempotent: boolean },
): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: o.destructive ?? false,
    idempotentHint: o.idempotent,
    openWorldHint: true,
  };
}

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
  _meta?: Record<string, unknown>;
};

const serverContexts = new WeakMap<McpServer, GatewayContext>();

function contextOf(server: McpServer): GatewayContext {
  const ctx = serverContexts.get(server);
  if (!ctx) throw new Error('McpServer was not created by createMcpServer');
  return ctx;
}

/** FastMCP marks a result it wrapped as `{result}` (x-fastmcp-wrap-result). */
const WRAPPED_META = { fastmcp: { wrap_result: true } };

/**
 * FastMCP's result shape: an object result is `[text: compact JSON]` plus the
 * object as structuredContent; a string result is the text itself with
 * structuredContent `{result}` and the wrap marker in `_meta`. Successful
 * results carry `isError: false`.
 */
export function toToolResult(result: unknown): ToolResult {
  if (typeof result === 'string') {
    return {
      content: [{ type: 'text', text: result }],
      structuredContent: { result },
      isError: false,
      _meta: WRAPPED_META,
    };
  }
  if (result === null || result === undefined) return { content: [], isError: false };
  const text = JSON.stringify(result);
  if (typeof result === 'object' && !Array.isArray(result)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: result as Record<string, unknown>,
      isError: false,
    };
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: { result },
    isError: false,
    _meta: WRAPPED_META,
  };
}

/** Python `str(exc)`: upstream SubstackAPIError prefixes its status. */
function errMessage(err: unknown): string {
  if (err instanceof SubstackAPIError) return `Substack API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

const tokenField = z.string().nullish();

/** Tool name → declared feature, filled as tools are registered (the same every request). */
const TOOL_FEATURES = new Map<string, string | null>();

/** The features declared by every tool registered so far, keyed by tool name. */
export function declaredToolFeatures(): ReadonlyMap<string, string | null> {
  return TOOL_FEATURES;
}

/**
 * Register a tool that takes an optional `token` (unless anonymous), resolves
 * credentials, checks the owner feature gate, and returns FastMCP-shaped output.
 * Failures come back as `isError` results, worded like FastMCP's
 * `Error calling tool '<name>': <message>`.
 */
export function mcpTool<S extends z.ZodObject>(
  server: McpServer,
  name: string,
  def: McpToolDef<S>,
  run: (args: z.infer<S>, creds: BearerCredentials, ctx: GatewayContext) => Promise<unknown>,
): void {
  const ctx = contextOf(server);
  TOOL_FEATURES.set(name, def.feature);
  const inputSchema = def.anonymous
    ? def.inputSchema
    : def.inputSchema.extend({ token: tokenField });
  server.registerTool(
    name,
    {
      title: def.annotations.title,
      description: def.description,
      inputSchema: toolInputSchema(inputSchema),
      outputSchema: toolOutputSchema(def.textResult ? TEXT_OUTPUT_SCHEMA : OBJECT_OUTPUT_SCHEMA),
      annotations: def.annotations,
      ...(def.meta ? { _meta: def.meta } : {}),
    },
    async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { token, ...args } = rawArgs as { token?: string | null };
        let creds: BearerCredentials;
        let scoped = ctx;
        if (def.anonymous) {
          creds = anonymousCredentials(ctx);
        } else {
          const resolved = await resolveMcpCredentials(token, ctx.authInfo, ctx);
          checkFeature(def.feature, resolved.source, ctx.ownerFeatures);
          creds = resolved.creds;
          scoped = scopeToSource(ctx, resolved.source);
        }
        return toToolResult(await run(args as z.infer<S>, creds, scoped));
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error calling tool '${name}': ${errMessage(err)}` }],
          isError: true,
        };
      }
    },
  );
}

/** Domain tool registrars, in upstream's registration (and so `tools/list`) order. */
const DOMAIN_TOOLS: ((server: McpServer, ctx: GatewayContext) => void)[] = [
  registerFollowingTools,
  registerDraftsTools,
  registerMeTools,
  registerNotesTools,
  registerProfilesTools,
  registerStatsTools,
  registerCommentsTools,
  registerPostsTools,
];

/** The capabilities FastMCP advertises on `initialize`. */
const CAPABILITIES = {
  logging: {},
  prompts: { listChanged: true },
  resources: { subscribe: false, listChanged: true },
};

type RequestHandler = (request: unknown, ctx: unknown) => Promise<unknown>;
type HandlerRegistry = { _getRequestHandler(method: string): RequestHandler | undefined };

/**
 * FastMCP answers a call to an unknown tool with an error result, where the SDK
 * raises a JSON-RPC error: wrap the SDK's `tools/call` handler to match.
 */
function answerUnknownToolsLikeFastMcp(server: McpServer, known: ReadonlySet<string>): void {
  const low = server.server;
  const sdkCall = (low as unknown as HandlerRegistry)._getRequestHandler('tools/call');
  if (!sdkCall) return;
  low.removeRequestHandler('tools/call');
  low.setRequestHandler('tools/call', async (request, ctx) => {
    const name = request.params.name;
    if (!known.has(name)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${pyRepr(name)}` }], isError: true };
    }
    return (await sdkCall(request, ctx)) as never;
  });
}

export function createMcpServer(
  ctx: GatewayContext,
  extensions: readonly GatewayExtension[] = [],
): McpServer {
  const server = new McpServer(
    { name: APPLICATION_NAME, version: OSS_VERSION },
    { capabilities: CAPABILITIES },
  );
  serverContexts.set(server, ctx);
  const known = new Set<string>();
  const registerTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, ...rest: unknown[]) => {
    known.add(name);
    return (registerTool as (...a: unknown[]) => unknown)(name, ...rest);
  }) as typeof server.registerTool;
  for (const register of DOMAIN_TOOLS) register(server, ctx);
  for (const ext of extensions) ext.registerMcp?.(server, ctx);
  answerUnknownToolsLikeFastMcp(server, known);
  return server;
}

/** Serve one MCP HTTP request; `ctx.authInfo` is passed through as the SDK's authInfo. */
export function handleMcpRequest(
  req: Request,
  ctx: GatewayContext,
  extensions: readonly GatewayExtension[],
): Promise<Response> {
  const handler = createMcpHandler(({ authInfo }) =>
    createMcpServer({ ...ctx, authInfo: authInfo ?? null }, extensions),
  );
  return handler.fetch(req, ctx.authInfo ? { authInfo: ctx.authInfo } : {});
}
