import { runFeature } from './runner';
import { createConverterWorld, markdownConverterSteps } from './steps/markdownConverter';

await runFeature('test/features/converters/markdown_converter.feature', markdownConverterSteps, {
  world: createConverterWorld,
});
