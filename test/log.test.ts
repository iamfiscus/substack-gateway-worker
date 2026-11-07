import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log';

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const lines: string[] = [];
  return { lines, log: createLogger(level, (l) => lines.push(l)) };
}

describe('createLogger', () => {
  it('redacts sensitive keys at any depth and any case', () => {
    const { lines, log } = capture();
    log.info('req', {
      token: 'x-secret',
      headers: { cookie: 'y-secret', Authorization: 'z-secret', 'X-Gateway-Token': 'w-secret' },
      list: [{ substack_sid: 'a-secret', connect_sid: 'b-secret', ok: 1 }],
    });
    const out = lines.join('\n');
    for (const s of ['x-secret', 'y-secret', 'z-secret', 'w-secret', 'a-secret', 'b-secret']) {
      expect(out).not.toContain(s);
    }
    expect(out).toContain('"ok":1');
  });

  it('respects level and exposes a LogFn adapter', () => {
    const { lines, log } = capture('info');
    log.debug('hidden');
    log.log('info', 'shown');
    log.log('debug', 'hidden too');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: 'info', msg: 'shown' });
  });

  it('survives circular fields', () => {
    const { lines, log } = capture();
    const a: Record<string, unknown> = {};
    a.self = a;
    log.info('c', a);
    expect(lines).toHaveLength(1);
  });
});
