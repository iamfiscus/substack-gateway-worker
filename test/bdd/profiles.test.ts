import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps, ...mcpSteps];

await runFeature('test/features/api/profiles.feature', steps, { world: () => createWorld() });
await runFeature('test/features/mcp/profiles.feature', steps, { world: () => createWorld() });
