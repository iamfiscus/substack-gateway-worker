import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps];

await runFeature('test/features/api/profile_posts.feature', steps, { world: () => createWorld() });
