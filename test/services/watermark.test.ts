import { describe, expect, it } from 'vitest';
import { SubstackAPIError } from '../../src/clients/errors';
import { PublicationClient } from '../../src/clients/publication';
import {
  computeGeometry,
  imageDimensionsFromUrl,
  type Position,
  WatermarkService,
  type WatermarkSpec,
} from '../../src/services/watermark';
import { createFakeSubstack } from '../support/fakeSubstack';

const spec = (o: Partial<WatermarkSpec> = {}): WatermarkSpec => ({
  scale: 0.06,
  position: 'top-right',
  opacity: 65,
  ...o,
});
const POSITIONS: Position[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

describe('computeGeometry', () => {
  it.each([
    [1536, 1024, [1433, 6, 93]],
    [1081, 222, [1008, 4, 65]],
  ])('default geometry matches the web editor (%i x %i)', (w, h, expected) => {
    expect(computeGeometry(w, h, spec())).toEqual(expected);
  });

  it('mirrors the other corners', () => {
    expect(computeGeometry(1000, 500, spec({ position: 'bottom-left' }))).toEqual([8, 436, 60]);
    expect(computeGeometry(1000, 500, spec({ position: 'top-left' }))).toEqual([8, 4, 60]);
    expect(computeGeometry(1000, 500, spec({ position: 'bottom-right' }))).toEqual([932, 436, 60]);
    expect(computeGeometry(1000, 500, spec({ position: 'top-right' }))).toEqual([932, 4, 60]);
  });

  it('scale changes size', () => {
    expect(computeGeometry(1000, 500, spec({ scale: 0.1 }))).toEqual([892, 4, 100]);
  });

  it.each(POSITIONS)('clamps a full-width watermark inside the image (%s)', (position) => {
    const [x, y, size] = computeGeometry(1000, 500, spec({ scale: 1, position }));
    expect(size).toBe(500);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1000 - size);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(500 - size);
  });

  it.each(POSITIONS.flatMap((p) => [0.06, 1].map((s) => [p, s] as const)))(
    'keeps a tiny image inside (%s, %d)',
    (position, scale) => {
      const [x, y, size] = computeGeometry(10, 10, spec({ scale, position }));
      expect(size).toBeGreaterThanOrEqual(1);
      expect(size).toBeLessThanOrEqual(10);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10 - size);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10 - size);
    },
  );

  it('is at least one pixel', () => {
    expect(computeGeometry(10, 10, spec({ scale: 0.0001 }))[2]).toBe(1);
  });
});

describe('imageDimensionsFromUrl', () => {
  it('parses the _WxH suffix', () => {
    expect(
      imageDimensionsFromUrl(
        'https://substack-post-media.s3.amazonaws.com/public/images/x_1081x222.png',
      ),
    ).toEqual([1081, 222]);
    expect(imageDimensionsFromUrl('https://substackcdn.com/image/fetch/abc')).toBeNull();
  });

  it('ignores the query string', () => {
    expect(imageDimensionsFromUrl('https://h/public/images/x_10x20.jpeg?v=1')).toEqual([10, 20]);
  });
});

const URL_ = 'https://s3/x_1536x1024.png';
function serviceWith(handler: unknown) {
  const fake = createFakeSubstack({ 'POST example.substack.com/api/v1/image/watermark': handler });
  const pub = new PublicationClient({
    publicationUrl: 'https://example.substack.com',
    substackSid: 's',
    connectSid: 'c',
    fetcher: fake,
    timeoutMs: 5000,
  });
  return { fake, service: new WatermarkService(pub) };
}

describe('WatermarkService', () => {
  it.each([
    ['not JSON', () => new Response('<html>blocked</html>', { status: 200 })],
    ['empty body', () => new Response(null, { status: 204 })],
    ['no url', {}],
    ['empty url', { url: '' }],
    ['non-string url', { url: 7 }],
    ['array', ['https://s3/wm.png']],
  ])('turns a bad response (%s) into a 502 naming the image', async (_n, handler) => {
    const { service } = serviceWith(handler);
    const err = await service.apply(URL_, 1536, 1024, spec()).catch((e) => e);
    expect(err).toBeInstanceOf(SubstackAPIError);
    expect(err.status).toBe(502);
    expect(err.message).toContain(URL_);
  });

  it('posts the geometry and returns the url', async () => {
    const { fake, service } = serviceWith({ url: 'https://s3/wm.png' });
    expect(await service.apply(URL_, 1536, 1024, spec({ opacity: 40 }))).toBe('https://s3/wm.png');
    expect(await fake.calls[0]?.json()).toEqual({
      image: URL_,
      offsetX: 1433,
      offsetY: 6,
      width: 93,
      height: 93,
      opacity: 40,
    });
  });
});
