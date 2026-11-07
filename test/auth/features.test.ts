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
    for (const f of ['notes:get', 'drafts:create', 'stats:dashboard', 'health:ready']) {
      expect(DEFAULT_OWNER_FEATURES.has(`api:${f}`)).toBe(true);
      expect(DEFAULT_OWNER_FEATURES.has(`mcp:${f}`)).toBe(true);
    }
    expect(DEFAULT_OWNER_FEATURES.has('api:images:create')).toBe(true);
    expect(DEFAULT_OWNER_FEATURES.has('mcp:images:upload')).toBe(true);
    expect(DEFAULT_OWNER_FEATURES.has('api:notes:create')).toBe(false);
    expect(DEFAULT_OWNER_FEATURES.has('mcp:notes:create')).toBe(false);
    expect(DEFAULT_OWNER_FEATURES.has('api:drafts:schedule')).toBe(false);
  });

  it('ownerFeatures parses the env list or falls back', () => {
    expect(ownerFeatures({})).toBe(DEFAULT_OWNER_FEATURES);
    expect(ownerFeatures({ OWNER_ALLOWED_FEATURES: '' })).toBe(DEFAULT_OWNER_FEATURES);
    const s = ownerFeatures({ OWNER_ALLOWED_FEATURES: ' api:notes:create , ,mcp:notes:create' });
    expect([...s].sort()).toEqual(['api:notes:create', 'mcp:notes:create']);
  });
});
