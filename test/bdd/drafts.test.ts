import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { draftSteps } from './steps/drafts';
import { mcpSteps } from './steps/mcp';

const steps = [...commonSteps, ...draftSteps, ...mcpSteps];
const options = { world: () => createWorld() };

await runFeature('test/features/api/drafts.feature', steps, options);
await runFeature('test/features/mcp/drafts.feature', steps, options);
