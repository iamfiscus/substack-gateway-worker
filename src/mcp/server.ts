// MCP server factory and the shared tool wrapper. One fresh McpServer per
// request (upstream FastMCP runs `stateless_http=True`).

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { BearerCredentials } from '../auth/credentials';
import { checkFeature } from '../auth/features';
import { anonymousCredentials, type GatewayContext, type GatewayExtension } from '../context';
import { APPLICATION_NAME, OSS_VERSION } from '../features';
import { registerCommentsTools } from './comments';
import { resolveMcpCredentials } from './credentials';
import { registerFollowingTools } from './following';
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

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const serverContexts = new WeakMap<McpServer, GatewayContext>();

function contextOf(server: McpServer): GatewayContext {
  const ctx = serverContexts.get(server);
  if (!ctx) throw new Error('McpServer was not created by createMcpServer');
  return ctx;
}

/**
 * FastMCP's result shape: an object result is `[text: compact JSON]` plus the
 * object as structuredContent; a string result is the text itself with
 * structuredContent `{result}` (FastMCP's x-fastmcp-wrap-result).
 */
export function toToolResult(result: unknown): ToolResult {
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }], structuredContent: { result } };
  }
  if (result === null || result === undefined) return { content: [] };
  const text = JSON.stringify(result);
  if (typeof result === 'object' && !Array.isArray(result)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: result as Record<string, unknown>,
    };
  }
  return { content: [{ type: 'text', text }], structuredContent: { result } };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const tokenField = z.string().nullish();

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
  const inputSchema = def.anonymous
    ? def.inputSchema
    : def.inputSchema.extend({ token: tokenField });
  server.registerTool(
    name,
    {
      title: def.annotations.title,
      description: def.description,
      inputSchema,
      annotations: def.annotations,
      ...(def.meta ? { _meta: def.meta } : {}),
    },
    async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const { token, ...args } = rawArgs as { token?: string | null };
        let creds: BearerCredentials;
        if (def.anonymous) {
          creds = anonymousCredentials(ctx);
        } else {
          const resolved = await resolveMcpCredentials(token, ctx.authInfo, ctx);
          checkFeature(def.feature, resolved.source, ctx.ownerFeatures);
          creds = resolved.creds;
        }
        return toToolResult(await run(args as z.infer<S>, creds, ctx));
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error calling tool '${name}': ${errMessage(err)}` }],
          isError: true,
        };
      }
    },
  );
}

/** Domain tool registrars; each later task appends `register<Domain>Tools`. */
const DOMAIN_TOOLS: ((server: McpServer, ctx: GatewayContext) => void)[] = [
  registerProfilesTools,
  registerPostsTools,
  registerFollowingTools,
  registerMeTools,
  registerNotesTools,
  registerCommentsTools,
  registerStatsTools,
];

export function createMcpServer(
  ctx: GatewayContext,
  extensions: readonly GatewayExtension[] = [],
): McpServer {
  const server = new McpServer({ name: APPLICATION_NAME, version: OSS_VERSION });
  serverContexts.set(server, ctx);
  for (const register of DOMAIN_TOOLS) register(server, ctx);
  for (const ext of extensions) ext.registerMcp?.(server, ctx);
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
