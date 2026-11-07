import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { rootSteps } from './steps/root';

await runFeature('test/features/api/root.feature', [...commonSteps, ...rootSteps], {
  world: () => createWorld(),
});
