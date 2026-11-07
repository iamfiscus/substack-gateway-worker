import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps, ...mcpSteps];

// The comments scenarios of these two upstream files belong to the comments
// domain, ported with it in Task 7.
const COMMENTS = 'TODO(Task 7): comments read paths';

await runFeature('test/features/api/posts.feature', steps, {
  world: () => createWorld(),
  skip: {
    'Successfully fetch comments for a post': COMMENTS,
    'Authentication failure on comments fetch returns 401': COMMENTS,
    'Missing x-gateway-token header on comments fetch returns 422': COMMENTS,
    'Malformed x-gateway-token header on comments fetch returns 401': COMMENTS,
  },
});

// Despite its name, upstream mcp/me.feature covers get_post and get_post_comments.
await runFeature('test/features/mcp/me.feature', steps, {
  world: () => createWorld(),
  skip: {
    'get_post_comments returns comments': COMMENTS,
    'get_post_comments propagates Substack auth failures': COMMENTS,
  },
});
