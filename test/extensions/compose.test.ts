import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { NullValueCache } from '../../src/context';
import { composeExtensions } from '../../src/extensions/compose';
import type { GatewayExtension } from '../../src/extensions/types';

const cache = { getOrCall: <T>(_k: string, f: () => Promise<T>) => f() };
const resolver = { resolve: async () => null };

describe('composeExtensions (single-provider rule)', () => {
  it('throws on a duplicate valueCache naming both extensions', () => {
    expect(() =>
      composeExtensions([
        { name: 'a', valueCache: cache },
        { name: 'b', valueCache: cache },
      ]),
    ).toThrow('duplicate provider valueCache from a and b');
  });

  it.each([
    ['statsCache', { statsCache: {} as never }],
    ['credentialResolver', { credentialResolver: resolver }],
    ['fetcher', { fetcher: async () => new Response() }],
    ['authenticate', { authenticate: async () => null }],
  ] as [string, Partial<GatewayExtension>][])('throws on a duplicate %s', (kind, part) => {
    expect(() =>
      composeExtensions([
        { name: 'a', ...part },
        { name: 'b', ...part },
      ]),
    ).toThrow(`duplicate provider ${kind} from a and b`);
  });

  it('selects the only provider of each kind and tolerates none', () => {
    expect(composeExtensions([{ name: 'a' }, { name: 'b' }]).valueCache).toBeNull();
    const out = composeExtensions([
      { name: 'a', valueCache: cache },
      { name: 'b', credentialResolver: resolver },
    ]);
    expect(out.valueCache).toBe(cache);
    expect(out.credentialResolver).toBe(resolver);
  });

  it('createApp surfaces the startup error', () => {
    expect(() =>
      createApp({
        extensions: [
          { name: 'a', valueCache: cache },
          { name: 'b', valueCache: cache },
        ],
      }),
    ).toThrow('duplicate provider valueCache');
  });

  it('defaults to no providers: statsCache null, valueCache NullValueCache', async () => {
    expect(composeExtensions([]).statsCache).toBeNull();
    let seen: { statsCache: unknown; valueCache: unknown } | null = null;
    const probe: GatewayExtension = {
      name: 'probe',
      registerMcp: (_s, ctx) => {
        seen = { statsCache: ctx.statsCache, valueCache: ctx.valueCache };
      },
    };
    const app = createApp({ extensions: [probe] });
    await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      },
      { LOG_LEVEL: 'error' },
    );
    expect(seen).not.toBeNull();
    const got = seen as unknown as { statsCache: unknown; valueCache: unknown };
    expect(got.statsCache).toBeNull();
    expect(got.valueCache).toBeInstanceOf(NullValueCache);
  });
});
