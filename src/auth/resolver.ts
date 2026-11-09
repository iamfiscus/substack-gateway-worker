// Owner-mode credential resolver: credentials come from Worker secrets.

import { type BearerCredentials, validateResolvedCredentials } from './credentials';
import type { AuthInfo } from './gatewayKey';

export interface CredentialResolver {
  resolve(auth: AuthInfo | null): Promise<BearerCredentials | null>;
}

export type OwnerEnv = {
  OWNER_PUBLICATION_URL?: string;
  OWNER_SUBSTACK_SID?: string;
  OWNER_CONNECT_SID?: string;
};

export class SecretCredentialResolver implements CredentialResolver {
  private readonly partial: Partial<BearerCredentials>;

  constructor(env: OwnerEnv) {
    this.partial = {
      publication_url: env.OWNER_PUBLICATION_URL,
      substack_sid: env.OWNER_SUBSTACK_SID?.trim(),
      // Optional: absent or blank means "send substack.sid alone".
      connect_sid: env.OWNER_CONNECT_SID?.trim() ?? '',
    };
  }

  async resolve(auth: AuthInfo | null): Promise<BearerCredentials | null> {
    if (auth === null) return null;
    const c = { ...this.partial };
    validateResolvedCredentials(c);
    return c;
  }
}
