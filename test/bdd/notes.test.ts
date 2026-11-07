import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';
import { writeDomainSteps } from './steps/writeDomains';

const steps = [...commonSteps, ...readDomainSteps, ...writeDomainSteps, ...mcpSteps];
const options = { world: () => createWorld() };

await runFeature('test/features/mcp/notes.feature', steps, options);
await runFeature('test/features/api/notes_create.feature', steps, options);
await runFeature('test/features/api/note_engagement.feature', steps, options);
await runFeature('test/features/mcp/note_engagement.feature', steps, options);
