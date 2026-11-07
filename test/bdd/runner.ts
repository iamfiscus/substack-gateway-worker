// BDD runner: binds pytest-bdd-style step definitions (parse patterns) to the
// steps of a .feature file, via @amiceli/vitest-cucumber.

import { readFile } from 'node:fs/promises';
import { describeFeature, loadFeatureFromText } from '@amiceli/vitest-cucumber';

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

// vitest-cucumber compiles every step text into a RegExp (escaping only `?`)
// and reads `{word}` as a parameter expression, so step text such as
// `"**bold**"` throws "Nothing to repeat". Steps are therefore handed to it
// under an alias with those characters swapped for their fullwidth lookalikes;
// the registry here always matches the original text.
const REGEX_HAZARDS: Record<string, string> = {
  '\\': '\uff3c',
  '*': '\uff0a',
  '+': '\uff0b',
  '(': '\uff08',
  ')': '\uff09',
  '[': '\uff3b',
  ']': '\uff3d',
  '{': '\uff5b',
  '}': '\uff5d',
};

function regexInert(text: string): string {
  return text.replace(/[\\*+()[\]{}]/g, (c) => REGEX_HAZARDS[c] ?? c);
}

type DocString = { stepLine: string; text: string };

/**
 * The doc strings of a feature file, in file order, each with the (trimmed)
 * step line it follows and the indentation of its opening delimiter removed.
 * vitest-cucumber's own copy is lossy: it drops doc-string lines starting with
 * `#` (it reads them as comments), trims every line, and lets ``` close a """
 * doc string. A doc string here closes only on its own delimiter.
 */
function rawDocStrings(source: string): DocString[] {
  const docs: DocString[] = [];
  let open: { stepLine: string; indent: number; delimiter: string; lines: string[] } | null = null;
  let previous = '';
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (open) {
      if (trimmed.startsWith(open.delimiter)) {
        docs.push({ stepLine: open.stepLine, text: open.lines.join('\n') });
        open = null;
      } else {
        const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
        open.lines.push(line.slice(Math.min(indent, open.indent)));
      }
    } else if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      const indent = line.length - line.trimStart().length;
      open = { stepLine: previous, indent, delimiter: trimmed.slice(0, 3), lines: [] };
    } else if (trimmed) {
      previous = trimmed;
    }
  }
  return docs;
}

const STEP_LINE = /^(\s*(?:Given|When|Then|And|But)\s+)(.*?)\s*$/;
const SCENARIO_LINE = /^\s*Scenario( Outline)?:/;
const REPEAT_MARK = '\u200b';

/**
 * vitest-cucumber refuses a scenario that repeats a step (upstream
 * drafts.feature checks `the response status code is 200` twice), so each
 * repeat gets a run of zero-width spaces appended, stripped again before the
 * step is matched.
 */
function markRepeatedSteps(source: string): string {
  let seen = new Map<string, number>();
  return source
    .split(/\r?\n/)
    .map((line) => {
      if (SCENARIO_LINE.test(line)) seen = new Map();
      const m = STEP_LINE.exec(line);
      if (!m) return line;
      const details = m[2] as string;
      const count = seen.get(details) ?? 0;
      seen.set(details, count + 1);
      return count === 0 ? line : `${m[1]}${details}${REPEAT_MARK.repeat(count)}`;
    })
    .join('\n');
}

function unmark(details: string): string {
  return details.replace(/\u200b+$/, '');
}

export async function runFeature<W>(
  path: string,
  steps: StepRegistry<W>,
  opts: RunFeatureOptions<W>,
): Promise<void> {
  const source = await readFile(path, 'utf8');
  const feature = loadFeatureFromText(markRepeatedSteps(source));
  // Background and Rule blocks are not supported here, so every doc string
  // belongs to a scenario step; pair them up in file order by step line.
  const docs = rawDocStrings(source);
  const docOf = new Map<object, string>();
  let next = 0;
  for (const scenario of feature.scenarii) {
    for (const s of scenario.steps) {
      const doc = docs[next];
      if (doc && doc.stepLine === `${s.type} ${unmark(s.details)}`) {
        docOf.set(s, doc.text);
        next++;
      }
    }
  }
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
          const text = unmark(s.details);
          (s as { details: string }).details = regexInert(s.details);
          if (skipped) {
            fns[keyword](s.details, () => {});
            continue;
          }
          const { def, args } = matchStep(steps, text);
          fns[keyword](s.details, async () => {
            await def.run(world, args, { docString: docOf.get(s) ?? null });
          });
        }
      });
    }
  });
}
