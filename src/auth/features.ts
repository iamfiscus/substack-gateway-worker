// Feature gate for owner (resolved) credentials. Feature strings come from the
// upstream capability modules; an explicit token bypasses the gate entirely.

export type CredentialSource = 'token' | 'resolved';

export class FeatureDisabledError extends Error {
  constructor(feature: string) {
    super(`feature ${feature} disabled for owner credentials`);
    this.name = 'FeatureDisabledError';
  }
}

/** Every upstream read (last segment `get`/`list`, all stats) plus the safe draft writes. */
const BASE_FEATURES = [
  'notes:get',
  'notes:replies:list',
  'comments:get',
  'comments:replies:list',
  'posts:get',
  'posts:comments:list',
  'profiles:get',
  'profiles:posts:list',
  'profiles:notes:list',
  'me:get',
  'me:notes:list',
  'me:posts:list',
  'me:following:list',
  'drafts:get',
  'drafts:list',
  'drafts:create',
  'drafts:update',
  'drafts:prepublish',
  'drafts:ai-detection',
  'stats:subscribers',
  'stats:traffic:30d-views',
  'stats:arr',
  'stats:emails',
  'stats:dashboard',
  'stats:dashboard:period',
  'stats:recommendations',
  'stats:post-counts',
  'posts:stats:engagement',
  'posts:stats:traffic',
  'posts:stats:recipients',
  'posts:stats:growth',
  'posts:stats:discussion',
];

export const DEFAULT_OWNER_FEATURES: ReadonlySet<string> = new Set([
  ...BASE_FEATURES.flatMap((f) => [`api:${f}`, `mcp:${f}`]),
  'api:health:ready', // upstream defines no mcp:health:ready
  'api:images:create',
  'mcp:images:upload',
]);

export function ownerFeatures(env: { OWNER_ALLOWED_FEATURES?: string }): ReadonlySet<string> {
  const raw = env.OWNER_ALLOWED_FEATURES;
  if (raw === undefined) return DEFAULT_OWNER_FEATURES;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : DEFAULT_OWNER_FEATURES;
}

export function checkFeature(
  feature: string | null,
  source: CredentialSource,
  allowed: ReadonlySet<string>,
): void {
  if (source === 'resolved' && feature !== null && !allowed.has(feature)) {
    throw new FeatureDisabledError(feature);
  }
}
