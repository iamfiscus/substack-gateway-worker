import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { statsSteps } from './steps/stats';

const steps = [...commonSteps, ...statsSteps, ...mcpSteps];

await runFeature('test/features/api/post_stats.feature', steps, { world: () => createWorld() });
await runFeature('test/features/mcp/post_stats.feature', steps, { world: () => createWorld() });
