// Port of gateway_mcp_common/clients.py `resolve_credentials` (upstream bc2e875).

import {
  type BearerCredentials,
  decodeBearerCredentials,
  MissingCredentialsError,
  validateBearerCredentials,
} from '../auth/credentials';
import type { AuthInfo } from '../auth/gatewayKey';
import type { GatewayContext } from '../context';
import type { ResolvedCredentials } from '../rest/credentials';
import { GATEWAY_MISCONFIGURED } from '../rest/errors';

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
  // Defence in depth: never ask a resolver about an unauthenticated caller,
  // whatever its resolve(null) does (extension resolvers may not return null).
  if (authInfo === null || ctx.resolver === null) throw new MissingCredentialsError();
  let creds: BearerCredentials | null;
  try {
    creds = await ctx.resolver.resolve(authInfo);
    if (creds !== null) validateBearerCredentials(creds, 'Resolved credentials');
  } catch {
    // Same generic text REST uses: resolver errors may carry secrets or env detail.
    throw new Error(GATEWAY_MISCONFIGURED);
  }
  if (creds === null) throw new MissingCredentialsError();
  return { creds, source: 'resolved' };
}
