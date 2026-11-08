import { describe, expect, it } from 'vitest';
import {
  checkFeature,
  DEFAULT_OWNER_FEATURES,
  FeatureDisabledError,
  ownerFeatures,
} from '../../src/auth/features';

describe('owner feature gate', () => {
  it('blocks writes for resolved credentials only', () => {
    expect(() => checkFeature('api:notes:create', 'resolved', DEFAULT_OWNER_FEATURES)).toThrow(
      FeatureDisabledError,
    );
    expect(() => checkFeature('api:notes:create', 'resolved', DEFAULT_OWNER_FEATURES)).toThrow(
      'feature api:notes:create disabled for owner credentials',
    );
    expect(() => checkFeature('api:notes:create', 'token', DEFAULT_OWNER_FEATURES)).not.toThrow();
    expect(() => checkFeature(null, 'resolved', DEFAULT_OWNER_FEATURES)).not.toThrow();
  });

  it('default set has reads in both forms, images, and no note creation', () => {
    for (const f of ['notes:get', 'drafts:create', 'stats:dashboard']) {
      expect(DEFAULT_OWNER_FEATURES.has(`api:${f}`)).toBe(true);
      expect(DEFAULT_OWNER_FEATURES.has(`mcp:${f}`)).toBe(true);
    }
    expect(DEFAULT_OWNER_FEATURES.has('api:health:ready')).toBe(true);
    expect(DEFAULT_OWNER_FEATURES.has('mcp:health:ready')).toBe(false);
    expect(DEFAULT_OWNER_FEATURES.has('api:images:create')).toBe(true);
    expect(DEFAULT_OWNER_FEATURES.has('mcp:images:upload')).toBe(true);
    expect(DEFAULT_OWNER_FEATURES.has('api:notes:create')).toBe(false);
    expect(DEFAULT_OWNER_FEATURES.has('mcp:notes:create')).toBe(false);
    expect(DEFAULT_OWNER_FEATURES.has('api:drafts:schedule')).toBe(false);
    expect(DEFAULT_OWNER_FEATURES.has('api:posts:restack')).toBe(false);
  });

  it('allows every upstream read in both forms', () => {
    const reads = [
      'me:notes:list',
      'me:posts:list',
      'me:following:list',
      'profiles:posts:list',
      'profiles:notes:list',
      'notes:replies:list',
      'comments:replies:list',
      'posts:comments:list',
      'stats:dashboard:period',
      'stats:traffic:30d-views',
      'posts:stats:engagement',
      'posts:stats:discussion',
      'drafts:list',
      'comments:get',
      'me:get',
      'profiles:get',
    ];
    for (const f of reads) {
      expect(DEFAULT_OWNER_FEATURES.has(`api:${f}`), `api:${f}`).toBe(true);
      expect(DEFAULT_OWNER_FEATURES.has(`mcp:${f}`), `mcp:${f}`).toBe(true);
    }
  });

  it('keeps every other write excluded', () => {
    const writes = [
      'notes:create',
      'notes:reply',
      'notes:delete',
      'notes:like',
      'notes:unlike',
      'comments:create',
      'comments:reply',
      'comments:delete',
      'comments:like',
      'comments:unlike',
      'posts:like',
      'posts:unlike',
      'posts:restack',
      'drafts:delete',
      'drafts:schedule',
      'drafts:unschedule',
    ];
    for (const f of writes) {
      expect(DEFAULT_OWNER_FEATURES.has(`api:${f}`), `api:${f}`).toBe(false);
      expect(DEFAULT_OWNER_FEATURES.has(`mcp:${f}`), `mcp:${f}`).toBe(false);
    }
  });

  it('ownerFeatures parses the env list or falls back', () => {
    expect(ownerFeatures({})).toBe(DEFAULT_OWNER_FEATURES);
    expect(ownerFeatures({ OWNER_ALLOWED_FEATURES: '' })).toBe(DEFAULT_OWNER_FEATURES);
    const s = ownerFeatures({ OWNER_ALLOWED_FEATURES: ' api:notes:create , ,mcp:notes:create' });
    expect([...s].sort()).toEqual(['api:notes:create', 'mcp:notes:create']);
  });

  it('ownerFeatures adds `+` entries to the default set', () => {
    const s = ownerFeatures({ OWNER_ALLOWED_FEATURES: '+api:notes:create, +mcp:notes:create' });
    expect(s.size).toBe(DEFAULT_OWNER_FEATURES.size + 2);
    for (const f of DEFAULT_OWNER_FEATURES) expect(s.has(f), f).toBe(true);
    expect(s.has('api:notes:create')).toBe(true);
    expect(s.has('mcp:notes:create')).toBe(true);
    expect(DEFAULT_OWNER_FEATURES.has('api:notes:create')).toBe(false);
  });

  it('ownerFeatures rejects a list mixing `+` and plain entries, never echoing it', () => {
    const run = () =>
      ownerFeatures({ OWNER_ALLOWED_FEATURES: '+api:notes:create,api:secret-ish:get' });
    expect(run).toThrow('invalid OWNER_ALLOWED_FEATURES');
    try {
      run();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('secret-ish');
    }
    expect(() => ownerFeatures({ OWNER_ALLOWED_FEATURES: '+' })).toThrow(
      'invalid OWNER_ALLOWED_FEATURES',
    );
  });
});
