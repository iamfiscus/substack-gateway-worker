// Unit tests for the live e2e write guard and draft cleanup (test/e2e/guard.ts).
import { describe, expect, it, vi } from 'vitest';
import { cleanupDrafts, writesAllowedFor } from '../e2e/guard';

const THROWAWAY = 'https://substack-gateway-throwaway.example.workers.dev';

describe('writesAllowedFor', () => {
  it('allows writes only when E2E_ALLOW_WRITES is the exact base URL host', () => {
    expect(writesAllowedFor(THROWAWAY, 'substack-gateway-throwaway.example.workers.dev')).toBe(
      true,
    );
    expect(
      writesAllowedFor(`${THROWAWAY}/`, 'Substack-Gateway-Throwaway.example.workers.dev'),
    ).toBe(true);
  });

  it('"1" no longer enables writes', () => {
    expect(writesAllowedFor(THROWAWAY, '1')).toBe(false);
  });

  it('refuses unset, a different host, a suffix or a partial host', () => {
    expect(writesAllowedFor(THROWAWAY, undefined)).toBe(false);
    expect(writesAllowedFor(THROWAWAY, '')).toBe(false);
    expect(writesAllowedFor(THROWAWAY, 'other.example.workers.dev')).toBe(false);
    expect(writesAllowedFor(THROWAWAY, 'example.workers.dev')).toBe(false);
    expect(writesAllowedFor(THROWAWAY, THROWAWAY)).toBe(false);
    expect(writesAllowedFor('', 'substack-gateway-throwaway.example.workers.dev')).toBe(false);
    expect(writesAllowedFor('not a url', 'not a url')).toBe(false);
  });

  it('still refuses any host containing "nerding", even when it matches', () => {
    const main = 'https://substack-gateway-nerding.example.workers.dev';
    expect(writesAllowedFor(main, 'substack-gateway-nerding.example.workers.dev')).toBe(false);
  });
});

describe('cleanupDrafts', () => {
  it('attempts every draft, warns on 403/404 and throws one aggregated error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    const outcomes: Record<string, () => Promise<'deleted' | 'forbidden' | 'missing'>> = {
      a: async () => 'deleted',
      b: async () => {
        throw new Error('Expected 204, got 500: boom');
      },
      c: async () => 'forbidden',
      d: async () => 'missing',
      e: async () => {
        throw new Error('Expected 204, got 502: bad gateway');
      },
    };
    const run = cleanupDrafts(['a', 'b', 'c', 'd', 'e'], (id) => {
      seen.push(id);
      return (outcomes[id] as () => Promise<'deleted' | 'forbidden' | 'missing'>)();
    });
    await expect(run).rejects.toThrow(/2 draft cleanup failures/);
    await run.catch((err: Error) => {
      expect(err.message).toContain('b: Expected 204, got 500: boom');
      expect(err.message).toContain('e: Expected 204, got 502: bad gateway');
    });
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      'e2e: draft c left behind (drafts:delete disabled)',
      'e2e: draft d was already gone (404)',
    ]);
    warn.mockRestore();
  });

  it('resolves when every draft is deleted', async () => {
    await expect(cleanupDrafts(['x', 'y'], async () => 'deleted')).resolves.toBeUndefined();
  });
});
