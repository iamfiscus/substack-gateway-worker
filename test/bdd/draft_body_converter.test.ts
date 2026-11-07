import { afterAll, beforeAll } from 'vitest';
import { setSerializerWarn } from '../../src/converters/dialect/serialize';
import { runFeature } from './runner';
import { createDraftConverterWorld, draftBodyConverterSteps } from './steps/draftBodyConverter';

beforeAll(() => setSerializerWarn(() => {}));
afterAll(() => setSerializerWarn(null));

await runFeature('test/features/converters/draft_body_converter.feature', draftBodyConverterSteps, {
  world: createDraftConverterWorld,
});
