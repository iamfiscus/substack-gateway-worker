// Pure helpers for the live e2e suite: the write guard and draft cleanup.
// No env reads here, so they are unit-tested in test/support/e2eGuard.test.ts.

/** The host (with port, if any) of a base URL, lowercased; '' when it does not parse. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Writes run only when `allowWrites` is exactly the host of `baseUrl` (so the
 * opt-in names the instance it is for), and never against a host containing
 * "nerding" (the main instance), whatever `allowWrites` says.
 */
export function writesAllowedFor(baseUrl: string, allowWrites: string | undefined): boolean {
  const host = hostOf(baseUrl);
  const wanted = (allowWrites ?? '').trim().toLowerCase();
  if (host === '' || wanted === '' || wanted !== host) return false;
  return !baseUrl.toLowerCase().includes('nerding');
}

export type DeleteOutcome = 'deleted' | 'forbidden' | 'missing';

/**
 * Try to delete every draft. A 403 (drafts:delete disabled) or a 404 (already
 * gone) is a warning; every other failure is collected and reported together
 * in one error once all drafts have been attempted.
 */
export async function cleanupDrafts(
  ids: readonly string[],
  deleteDraft: (id: string) => Promise<DeleteOutcome>,
): Promise<void> {
  const failures: string[] = [];
  for (const id of ids) {
    try {
      const outcome = await deleteDraft(id);
      if (outcome === 'forbidden') {
        console.warn(`e2e: draft ${id} left behind (drafts:delete disabled)`);
      } else if (outcome === 'missing') {
        console.warn(`e2e: draft ${id} was already gone (404)`);
      }
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} draft cleanup failures:\n${failures.join('\n')}`);
  }
}
