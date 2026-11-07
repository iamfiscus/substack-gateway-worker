import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { healthSteps } from './steps/health';

await runFeature('test/features/api/health.feature', [...commonSteps, ...healthSteps], {
  world: () => createWorld(),
});
