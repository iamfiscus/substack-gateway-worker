// The reader/comment-backed GET endpoints: a note and a comment by ID.
import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps];

await runFeature('test/features/api/notes.feature', steps, { world: () => createWorld() });
await runFeature('test/features/api/comments.feature', steps, { world: () => createWorld() });
