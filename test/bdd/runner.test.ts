import { describe, expect, it } from 'vitest';
import { matchStep, runFeature, step } from './runner';

type W = { n: number };

const steps = [
  step<W>('a counter at {n:d}', (w, [n]) => {
    w.n = Number(n);
  }),
  step<W>('I add "{x}"', (w, [x]) => {
    w.n += Number(x);
  }),
  step<W>('the counter is {n:d}', (w, [n]) => {
    expect(w.n).toBe(Number(n));
  }),
];

await runFeature('test/bdd/fixtures/runner.feature', steps, {
  world: () => ({ n: 0 }),
  skip: { 'A skipped scenario never runs': 'runner self-test' },
});

describe('step patterns', () => {
  it('anchors and escapes like parsers.parse', () => {
    const s = step('GET {path} (v{n:d}).', () => {});
    expect(s.regex.exec('GET /a?b=1 (v2).')?.slice(1)).toEqual(['/a?b=1', '2']);
    expect(s.regex.test('GET /a (v2).x')).toBe(false);
    expect(s.regex.test('GET /a (vx).')).toBe(false);
  });

  it('reports unmatched and ambiguous steps', () => {
    const reg = [step('field "{f}" is "{v}"', () => {}), step('field "{f}" is "x"', () => {})];
    expect(() => matchStep(reg, 'nothing')).toThrow('No step definition matches: "nothing"');
    expect(() => matchStep(reg, 'field "a" is "x"')).toThrow('Ambiguous step');
    expect(matchStep(reg, 'field "a" is "y"').args).toEqual(['a', 'y']);
  });

  it('refuses to skip a scenario that does not exist', async () => {
    await expect(
      runFeature('test/bdd/fixtures/runner.feature', steps, {
        world: () => ({ n: 0 }),
        skip: { 'No such scenario': 'x' },
      }),
    ).rejects.toThrow('skip: no scenario named "No such scenario"');
  });
});
