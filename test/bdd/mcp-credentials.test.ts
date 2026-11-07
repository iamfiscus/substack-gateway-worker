import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';

await runFeature('test/features/mcp/credentials.feature', [...commonSteps, ...mcpSteps], {
  world: () => createWorld(),
});
