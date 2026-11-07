// Port of gateway_core/client/substack.py (upstream bc2e875).

import { SubstackHTTPBase, type SubstackHTTPBaseOptions } from './base';
import { SubstackAPIError, SubstackAuthError } from './errors';

export type SubstackClientOptions = Omit<SubstackHTTPBaseOptions, 'base'> & {
  /** Value of SUBSTACK_BASE_URL, e.g. https://substack.com */
  baseUrl: string;
};

/** HTTP client for the global platform API: `${SUBSTACK_BASE_URL}/api/v1/*`. */
export class SubstackClient extends SubstackHTTPBase {
  constructor({ baseUrl, ...o }: SubstackClientOptions) {
    super({ ...o, base: `${baseUrl.replace(/\/+$/, '')}/api/v1` });
  }

  /** GET feed/following. Returns false only on a network/API failure. */
  async checkConnectivity(): Promise<boolean> {
    try {
      await this.get('feed/following');
      return true;
    } catch (err) {
      if (err instanceof SubstackAuthError) return true; // reachable, token invalid
      if (err instanceof SubstackAPIError) return false;
      throw err;
    }
  }

  /** GET handle/options: the caller's own handle slug. */
  async getOwnSlug(): Promise<string> {
    const r = await this.get('handle/options');
    const handles = (r as { potentialHandles?: { handle?: unknown }[] } | null)?.potentialHandles;
    if (!Array.isArray(handles)) {
      throw new SubstackAPIError(502, 'Substack returned an unexpected handle/options response');
    }
    const handle = handles[0]?.handle;
    if (handles.length === 0) {
      throw new SubstackAPIError(502, 'Substack returned no potential handles for this account');
    }
    if (typeof handle !== 'string') {
      throw new SubstackAPIError(502, 'Substack returned an unexpected handle/options response');
    }
    return handle;
  }

  /** GET user-settings: the caller's own numeric user id. */
  async getOwnUserId(): Promise<number> {
    const r = await this.get('user-settings');
    const settings = (r as { userSettings?: { userId?: unknown }[] } | null)?.userSettings;
    if (!Array.isArray(settings)) {
      throw new SubstackAPIError(502, 'Substack returned an unexpected user-settings response');
    }
    if (settings.length === 0) {
      throw new SubstackAPIError(502, 'Substack returned no user settings');
    }
    const id = settings[0]?.userId;
    if (typeof id !== 'number') {
      throw new SubstackAPIError(502, 'Substack returned an unexpected user-settings response');
    }
    return id;
  }
}
