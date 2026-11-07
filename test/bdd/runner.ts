// BDD runner: binds pytest-bdd-style step definitions (parse patterns) to the
// steps of a .feature file, via @amiceli/vitest-cucumber.

import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber';

export type StepExtra = { docString: string | null };
export type StepFn<W> = (world: W, args: string[], extra: StepExtra) => unknown;
export type StepDef<W> = { pattern: string; regex: RegExp; run: StepFn<W> };
export type StepRegistry<W> = readonly StepDef<W>[];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Define a step with a pytest-bdd `parsers.parse` pattern: `{name}` matches any
 * text (lazily), `{name:d}` matches an integer. The match is anchored.
 */
export function step<W>(pattern: string, run: StepFn<W>): StepDef<W> {
  let src = '';
  let last = 0;
  for (const m of pattern.matchAll(/\{(\w+)(:d)?\}/g)) {
    src += escapeRegex(pattern.slice(last, m.index));
    src += m[2] ? '(-?\\d+)' : '(.+?)';
    last = (m.index ?? 0) + m[0].length;
  }
  src += escapeRegex(pattern.slice(last));
  return { pattern, regex: new RegExp(`^${src}$`, 's'), run };
}

export function matchStep<W>(
  steps: StepRegistry<W>,
  text: string,
): { def: StepDef<W>; args: string[] } {
  const hits = steps.flatMap((def) => {
    const m = def.regex.exec(text);
    return m ? [{ def, args: m.slice(1) }] : [];
  });
  if (hits.length === 0) throw new Error(`No step definition matches: "${text}"`);
  if (hits.length > 1) {
    const patterns = hits.map((h) => h.def.pattern).join(' | ');
    throw new Error(`Ambiguous step "${text}" matches: ${patterns}`);
  }
  return hits[0] as { def: StepDef<W>; args: string[] };
}

export type RunFeatureOptions<W> = {
  /** Fresh per-scenario state. */
  world: () => W;
  /** Scenario name → reason (a TODO naming the task that enables it). */
  skip?: Record<string, string>;
};

type Keyword = 'Given' | 'When' | 'Then' | 'And' | 'But';

export async function runFeature<W>(
  path: string,
  steps: StepRegistry<W>,
  opts: RunFeatureOptions<W>,
): Promise<void> {
  const feature = await loadFeature(path);
  const skip = opts.skip ?? {};
  for (const name of Object.keys(skip)) {
    if (!feature.getScenarioByName(name)) throw new Error(`skip: no scenario named "${name}"`);
  }
  describeFeature(feature, ({ Scenario }) => {
    for (const scenario of feature.scenarii) {
      const skipped = scenario.description in skip;
      const define = skipped ? Scenario.skip : Scenario;
      define(scenario.description, (fns) => {
        const world = skipped ? (undefined as W) : opts.world();
        for (const s of scenario.steps) {
          const keyword = s.type as Keyword;
          if (skipped) {
            fns[keyword](s.details, () => {});
            continue;
          }
          const { def, args } = matchStep(steps, s.details);
          fns[keyword](s.details, async () => {
            await def.run(world, args, { docString: s.docStrings });
          });
        }
      });
    }
  });
}
