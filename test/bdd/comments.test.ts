import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';
import { writeDomainSteps } from './steps/writeDomains';

const steps = [...commonSteps, ...readDomainSteps, ...writeDomainSteps, ...mcpSteps];
const options = { world: () => createWorld() };

await runFeature('test/features/api/comment_engagement.feature', steps, options);
await runFeature('test/features/mcp/comment_engagement.feature', steps, options);
