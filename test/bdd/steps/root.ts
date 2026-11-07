// Port of upstream packages/gateway_oss/features/steps/root.py (bc2e875).

import { expect } from 'vitest';
import { type StepRegistry, step } from '../runner';
import { json, type World } from './common';

/** `gateway_oss.__version__` at bc2e875 (packages/gateway_oss/pyproject.toml). */
const UPSTREAM_OSS_VERSION = '6.1.1';

type Module = { name: string; version: string; features: string[] };

function moduleNamed(w: World, name: string): Module {
  const modules = json(w).modules as Module[];
  const found = modules.find((m) => m.name === name);
  if (!found) throw new Error(`No module named "${name}" in ${JSON.stringify(modules)}`);
  return found;
}

export const rootSteps: StepRegistry<World> = [
  step('the response contains a module named "{name}"', (w, [name]) => {
    moduleNamed(w, name as string);
  }),
  step('the "{name}" module version matches the OSS package version', (w, [name]) => {
    expect(moduleNamed(w, name as string).version).toBe(UPSTREAM_OSS_VERSION);
  }),
  step('the "{name}" module features contain "{feature}"', (w, [name, feature]) => {
    expect(moduleNamed(w, name as string).features).toContain(feature);
  }),
];
