import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps, ...mcpSteps];
const WRITE = 'TODO(Task 10): comment write paths';

// Only the read scenarios of the engagement features run here.
await runFeature('test/features/api/comment_engagement.feature', steps, {
  world: () => createWorld(),
  skip: {
    'Create a top-level comment on a post': WRITE,
    'Reply to a comment': WRITE,
    'Reply to a comment with no resolvable post returns 404': WRITE,
    'Delete a comment': WRITE,
    'Like a comment': WRITE,
    'Unlike a comment': WRITE,
    'Missing x-gateway-token header returns 422': WRITE,
  },
});
await runFeature('test/features/mcp/comment_engagement.feature', steps, {
  world: () => createWorld(),
  skip: {
    'create_post_comment returns the created comment': WRITE,
    'reply_to_post_comment returns the created reply': WRITE,
    'delete_post_comment returns confirmation message': WRITE,
    'like_post_comment returns confirmation message': WRITE,
    'unlike_post_comment returns confirmation message': WRITE,
  },
});
