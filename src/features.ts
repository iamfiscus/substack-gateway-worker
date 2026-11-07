// Root module metadata. Port of gateway_oss/application_features.py plus the
// capability `_FEATURES` tuples that substack_gateway/app_factory.py merges into
// the "gateway-oss" module (upstream bc2e875). The full upstream list is
// advertised here so `/` matches upstream exactly; each domain's routes and
// tools land in later tasks.

export const APPLICATION_NAME = 'substack-gateway';
export const OSS_MODULE_NAME = 'gateway-oss';
/** upstream packages/gateway_oss/pyproject.toml `version` at bc2e875. */
export const OSS_VERSION = '6.1.1';

export type ModuleInfo = { name: string; version: string; features: string[] };

const OSS_FEATURES = ['api:health:live', 'api:health:ready'];

/** `_FEATURES` of every upstream `_rest` / `_mcp` capability package. */
const CAPABILITY_FEATURES: Record<string, readonly string[]> = {
  comments_mcp: [
    'mcp:posts:comments:list',
    'mcp:comments:create',
    'mcp:comments:reply',
    'mcp:comments:get',
    'mcp:comments:delete',
    'mcp:comments:replies:list',
    'mcp:comments:like',
    'mcp:comments:unlike',
  ],
  comments_rest: [
    'api:comments:get',
    'api:comments:create',
    'api:comments:delete',
    'api:comments:like',
    'api:comments:unlike',
    'api:comments:reply',
    'api:comments:replies:list',
    'api:posts:comments:list',
  ],
  drafts_mcp: [
    'mcp:drafts:list',
    'mcp:drafts:get',
    'mcp:drafts:create',
    'mcp:drafts:update',
    'mcp:drafts:delete',
    'mcp:drafts:schedule',
    'mcp:drafts:unschedule',
    'mcp:drafts:prepublish',
    'mcp:drafts:ai-detection',
    'mcp:images:upload',
  ],
  drafts_rest: [
    'api:drafts:list',
    'api:drafts:get',
    'api:drafts:create',
    'api:drafts:update',
    'api:drafts:delete',
    'api:drafts:schedule',
    'api:drafts:unschedule',
    'api:drafts:prepublish',
    'api:drafts:ai-detection',
    'api:images:create',
  ],
  following_mcp: ['mcp:me:following:list'],
  following_rest: ['api:me:following:list'],
  me_mcp: ['mcp:me:get', 'mcp:me:notes:list', 'mcp:me:posts:list'],
  me_rest: ['api:me:get', 'api:me:notes:list', 'api:me:posts:list'],
  notes_mcp: [
    'mcp:notes:get',
    'mcp:notes:create',
    'mcp:notes:delete',
    'mcp:notes:like',
    'mcp:notes:unlike',
    'mcp:notes:reply',
    'mcp:notes:replies:list',
  ],
  notes_rest: [
    'api:notes:get',
    'api:notes:create',
    'api:notes:delete',
    'api:notes:like',
    'api:notes:unlike',
    'api:notes:reply',
    'api:notes:replies:list',
  ],
  posts_mcp: ['mcp:posts:get', 'mcp:posts:like', 'mcp:posts:unlike', 'mcp:posts:restack'],
  posts_rest: ['api:posts:get', 'api:posts:like', 'api:posts:unlike', 'api:posts:restack'],
  profiles_mcp: ['mcp:profiles:get', 'mcp:profiles:posts:list', 'mcp:profiles:notes:list'],
  profiles_rest: ['api:profiles:get', 'api:profiles:posts:list', 'api:profiles:notes:list'],
  stats_mcp: [
    'mcp:stats:subscribers',
    'mcp:stats:traffic:30d-views',
    'mcp:stats:arr',
    'mcp:stats:emails',
    'mcp:stats:dashboard',
    'mcp:stats:dashboard:period',
    'mcp:stats:recommendations',
    'mcp:stats:post-counts',
    'mcp:posts:stats:engagement',
    'mcp:posts:stats:traffic',
    'mcp:posts:stats:recipients',
    'mcp:posts:stats:growth',
    'mcp:posts:stats:discussion',
  ],
  stats_rest: [
    'api:stats:subscribers',
    'api:stats:traffic:30d-views',
    'api:stats:arr',
    'api:stats:emails',
    'api:stats:dashboard',
    'api:stats:dashboard:period',
    'api:stats:recommendations',
    'api:stats:post-counts',
    'api:posts:stats:engagement',
    'api:posts:stats:traffic',
    'api:posts:stats:recipients',
    'api:posts:stats:growth',
    'api:posts:stats:discussion',
  ],
};

/** Sorted, de-duplicated like Python `tuple(sorted({...}))` (ASCII, code-point order). */
function sortedUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort();
}

export function buildFeatureList(): ModuleInfo {
  return {
    name: OSS_MODULE_NAME,
    version: OSS_VERSION,
    features: sortedUnique([...OSS_FEATURES, ...Object.values(CAPABILITY_FEATURES).flat()]),
  };
}

export function normalizeModule(m: ModuleInfo): ModuleInfo {
  return { name: m.name, version: m.version, features: sortedUnique(m.features) };
}
