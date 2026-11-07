// Port of gateway_core/client/publication.py (upstream bc2e875).

import { SubstackHTTPBase, type SubstackHTTPBaseOptions } from './base';

export type PublicationClientOptions = Omit<SubstackHTTPBaseOptions, 'base'> & {
  publicationUrl: string;
};

/** HTTP client scoped to one publication: `{publication_url}/api/v1/*`. */
export class PublicationClient extends SubstackHTTPBase {
  constructor({ publicationUrl, ...o }: PublicationClientOptions) {
    super({ ...o, base: `${publicationUrl.replace(/\/+$/, '')}/api/v1` });
  }
}
