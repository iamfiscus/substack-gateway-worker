import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { writeDomainSteps } from './steps/writeDomains';

const steps = [...commonSteps, ...writeDomainSteps, ...mcpSteps];
const options = { world: () => createWorld() };

await runFeature('test/features/api/post_likes.feature', steps, options);
await runFeature('test/features/mcp/post_likes.feature', steps, options);
await runFeature('test/features/api/post_restacks.feature', steps, options);
await runFeature('test/features/mcp/post_restacks.feature', steps, options);
