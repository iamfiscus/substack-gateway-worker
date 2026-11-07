import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps, ...mcpSteps];

await runFeature('test/features/api/posts.feature', steps, {
  world: () => createWorld(),
});

// Despite its name, upstream mcp/me.feature covers get_post and get_post_comments.
await runFeature('test/features/mcp/me.feature', steps, {
  world: () => createWorld(),
});
