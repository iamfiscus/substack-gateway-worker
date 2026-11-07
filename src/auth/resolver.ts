// Owner-mode credential resolver: credentials come from Worker secrets.

import { type BearerCredentials, validateBearerCredentials } from './credentials';
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
      substack_sid: env.OWNER_SUBSTACK_SID,
      connect_sid: env.OWNER_CONNECT_SID,
    };
  }

  async resolve(auth: AuthInfo | null): Promise<BearerCredentials | null> {
    if (auth === null) return null;
    const c = { ...this.partial };
    validateBearerCredentials(c, 'Resolved credentials');
    return c;
  }
}
