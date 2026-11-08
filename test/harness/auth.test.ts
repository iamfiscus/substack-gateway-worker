import { describe, expect, it } from 'vitest';
import { bearerMatches } from '../../harness/auth';

describe('harness bearer check', () => {
  it('accepts exactly `Bearer <token>`', async () => {
    expect(await bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
  });

  it('refuses a wrong, partial, longer, missing or unconfigured token', async () => {
    expect(await bearerMatches('Bearer s3cres', 's3cret')).toBe(false);
    expect(await bearerMatches('Bearer s3cre', 's3cret')).toBe(false);
    expect(await bearerMatches('Bearer s3crett', 's3cret')).toBe(false);
    expect(await bearerMatches('s3cret', 's3cret')).toBe(false);
    expect(await bearerMatches(null, 's3cret')).toBe(false);
    expect(await bearerMatches('Bearer ', '')).toBe(false);
    expect(await bearerMatches('Bearer x', undefined)).toBe(false);
  });
});
