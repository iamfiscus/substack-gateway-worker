// Port of gateway_mcp_common/clients.py `resolve_credentials` (upstream bc2e875).

import {
  decodeBearerCredentials,
  MissingCredentialsError,
  validateBearerCredentials,
} from '../auth/credentials';
import type { AuthInfo } from '../auth/gatewayKey';
import type { GatewayContext } from '../context';
import type { ResolvedCredentials } from '../rest/credentials';

/**
 * An explicit `token` always wins. Otherwise the installed resolver is asked
 * about the authenticated caller; no resolver or no result raises
 * `MissingCredentialsError` with the upstream message.
 */
export async function resolveMcpCredentials(
  token: string | null | undefined,
  authInfo: AuthInfo | null,
  ctx: Pick<GatewayContext, 'resolver'>,
): Promise<ResolvedCredentials> {
  if (token) return { creds: decodeBearerCredentials(token), source: 'token' };
  if (ctx.resolver === null) throw new MissingCredentialsError();
  const creds = await ctx.resolver.resolve(authInfo);
  if (creds === null) throw new MissingCredentialsError();
  validateBearerCredentials(creds, 'Resolved credentials');
  return { creds, source: 'resolved' };
}
