import { describe, expect, it } from 'vitest';
import { SubstackAPIError } from '../../src/clients/errors';
import { PublicationClient } from '../../src/clients/publication';
import { DraftMarkdownError } from '../../src/converters/dialect/errors';
import { markdownToDraftDoc } from '../../src/converters/draftMarkdown';
import { resolveDraftBody, UnresolvedNodeError } from '../../src/converters/resolveDraftBody';
import { ImagesService } from '../../src/services/images';
import { WatermarkService } from '../../src/services/watermark';
import { createFakeSubstack } from '../support/fakeSubstack';

const IMAGE_RESP = {
  id: 1,
  url: 'https://substack-post-media.s3.amazonaws.com/x.png',
  contentType: 'image/png',
  bytes: 72180,
  imageWidth: 2387,
  imageHeight: 203,
};
const WM_URL = 'https://substack-post-media.s3.amazonaws.com/wm.png';
const EMBED = {
  url: 'https://datawrapper.dwcdn.net/boimj/2/',
  thumbnail_url: 'https://s3/x.png',
  thumbnail_url_full: 'https://s3/x-full.png',
  height: 400,
  title: 'Which mistake hurts more',
  description: '',
};
const P = 'example.substack.com/api/v1';

function setup(extra: Record<string, unknown> = {}) {
  const fake = createFakeSubstack({
    [`POST ${P}/image`]: IMAGE_RESP,
    [`POST ${P}/image/watermark`]: { url: WM_URL },
    [`GET ${P}/datawrapper-embed`]: EMBED,
    ...extra,
  });
  const pub = new PublicationClient({
    publicationUrl: 'https://example.substack.com',
    substackSid: 's',
    connectSid: 'c',
    fetcher: fake,
    timeoutMs: 5000,
  });
  const deps = { images: new ImagesService(pub), watermark: new WatermarkService(pub), pub };
  return { fake, deps };
}

const docOf = (...content: unknown[]) => ({ type: 'doc', content }) as never;
const imageNode = (
  src: string,
  o: { alt?: string; image_attrs?: object; watermark?: object | null } = {},
) => ({
  type: '_unresolved_image',
  attrs: { src, alt: 'A cat', image_attrs: {}, watermark: null, ...o },
});
const bodies = (fake: { calls: Request[] }) => Promise.all(fake.calls.map((c) => c.clone().json()));
const imgAttrs = (resolved: unknown, i = 0) => {
  const top = (resolved as { content: { content: { attrs: Record<string, unknown> }[] }[] })
    .content;
  return (top[i] as { content: { attrs: Record<string, unknown> }[] }).content[0]?.attrs ?? {};
};

const HOSTED = 'https://substack-post-media.s3.amazonaws.com/public/images/x_1536x1024.png';
const WM = { scale: 0.06, position: 'top-right', opacity: 65 };

describe('resolveDraftBody', () => {
  it('returns a plain doc unchanged', async () => {
    const { deps } = setup();
    const doc = docOf({ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] });
    expect(await resolveDraftBody(doc, deps)).toEqual(doc);
  });

  it('leaves a latex block untouched', async () => {
    const { deps } = setup();
    const doc = docOf({
      type: 'latex_block',
      attrs: { persistentExpression: 'x', id: 'ABCDEFGHIJ' },
    });
    expect(await resolveDraftBody(doc, deps)).toEqual(doc);
  });

  it('raises on an unknown placeholder', async () => {
    const { deps } = setup();
    const doc = docOf({ type: '_unresolved_video', attrs: { src: 'https://x/y.mp4' } });
    await expect(resolveDraftBody(doc, deps)).rejects.toBeInstanceOf(UnresolvedNodeError);
  });

  it('resolves a datawrapper placeholder via the normalized url', async () => {
    const { fake, deps } = setup();
    const doc = docOf({
      type: '_unresolved_datawrapper',
      attrs: { url: 'https://datawrapper.dwcdn.net/boimj/2/' },
    });
    const resolved = await resolveDraftBody(doc, deps);
    expect((resolved as { content: unknown[] }).content[0]).toEqual({
      type: 'datawrapper',
      attrs: {
        url: 'https://datawrapper.dwcdn.net/boimj/2/',
        thumbnail_url: 'https://s3/x.png',
        thumbnail_url_full: 'https://s3/x-full.png',
        height: 400,
        title: 'Which mistake hurts more',
        description: '',
      },
    });
    expect(fake.calls).toHaveLength(1);
    const u = new URL(fake.calls[0]?.url as string);
    expect(u.pathname).toBe('/api/v1/datawrapper-embed');
    expect(u.searchParams.get('url')).toBe('https://www.datawrapper.de/_/boimj/');
  });

  it('never fetches an attrs.url that is not a Datawrapper chart (SSRF backstop)', async () => {
    const { fake, deps } = setup();
    for (const url of [
      'https://app.datawrapper.de/chart/AbC12/visualize',
      'https://evil.example/_/boimj/',
      'http://169.254.169.254/latest/meta-data',
    ]) {
      const doc = docOf({ type: '_unresolved_datawrapper', attrs: { url } });
      await expect(resolveDraftBody(doc, deps)).rejects.toBeInstanceOf(DraftMarkdownError);
    }
    expect(fake.calls).toEqual([]);
  });

  it('fills datawrapper defaults when the embed omits them', async () => {
    const { deps } = setup({ [`GET ${P}/datawrapper-embed`]: { url: 'https://dw/x/1/' } });
    const doc = docOf({
      type: '_unresolved_datawrapper',
      attrs: { url: 'https://datawrapper.dwcdn.net/boimj/2/' },
    });
    const resolved = (await resolveDraftBody(doc, deps)) as { content: { attrs: unknown }[] };
    expect(resolved.content[0]?.attrs).toEqual({
      url: 'https://dw/x/1/',
      thumbnail_url: null,
      thumbnail_url_full: null,
      height: 400,
      title: '',
      description: '',
    });
  });

  it('rejects a datawrapper embed without a url as a 502', async () => {
    const { deps } = setup({ [`GET ${P}/datawrapper-embed`]: {} });
    const doc = docOf({
      type: '_unresolved_datawrapper',
      attrs: { url: 'https://datawrapper.dwcdn.net/boimj/2/' },
    });
    await expect(resolveDraftBody(doc, deps)).rejects.toBeInstanceOf(SubstackAPIError);
  });

  it('resolves an external image through an upload', async () => {
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(docOf(imageNode('data:image/png;base64,QUJD')), deps);
    const node = (resolved as { content: { type: string; content: { type: string }[] }[] })
      .content[0];
    expect(node?.type).toBe('captionedImage');
    expect(node?.content[0]?.type).toBe('image2');
    expect(imgAttrs(resolved)).toMatchObject({
      src: IMAGE_RESP.url,
      width: 2387,
      height: 203,
      bytes: 72180,
      type: 'image/png',
      alt: 'A cat',
      isProcessing: false,
    });
    expect(await bodies(fake)).toEqual([{ image: 'data:image/png;base64,QUJD' }]);
  });

  it('turns an empty alt into null', async () => {
    const { deps } = setup();
    const resolved = await resolveDraftBody(docOf(imageNode('https://x/y.png', { alt: '' })), deps);
    expect(imgAttrs(resolved).alt).toBeNull();
  });

  it.each([
    'https://substack-post-media.s3.amazonaws.com/public/images/x.png',
    'https://substackcdn.com/image/fetch/x.png',
  ])('does not re-upload a Substack-hosted image (%s)', async (src) => {
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(docOf(imageNode(src)), deps);
    expect(imgAttrs(resolved)).toMatchObject({
      src,
      alt: 'A cat',
      width: null,
      height: null,
      bytes: null,
      type: null,
      isProcessing: false,
    });
    expect(fake.calls).toEqual([]);
  });

  it('watermarks a hosted image', async () => {
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(docOf(imageNode(HOSTED, { watermark: WM })), deps);
    expect(imgAttrs(resolved)).toMatchObject({
      src: WM_URL,
      srcNoWatermark: HOSTED,
      alt: 'A cat',
      isProcessing: false,
    });
    expect(await bodies(fake)).toEqual([
      { image: HOSTED, offsetX: 1433, offsetY: 6, width: 93, height: 93, opacity: 65 },
    ]);
    expect(new URL(fake.calls[0]?.url as string).pathname).toBe('/api/v1/image/watermark');
  });

  it('watermarks the upload of an external image, sized from the upload', async () => {
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(
      docOf(
        imageNode('https://example.com/cat.png', {
          watermark: { scale: 0.1, position: 'bottom-left', opacity: 30 },
        }),
      ),
      deps,
    );
    expect(imgAttrs(resolved)).toMatchObject({
      src: WM_URL,
      srcNoWatermark: IMAGE_RESP.url,
      width: 2387,
      height: 203,
      bytes: 72180,
      type: 'image/png',
    });
    expect(await bodies(fake)).toEqual([
      { image: 'https://example.com/cat.png' },
      { image: IMAGE_RESP.url, offsetX: 14, offsetY: 0, width: 203, height: 203, opacity: 30 },
    ]);
  });

  it('regenerates the watermark from the original', async () => {
    const original = 'https://substack-post-media.s3.amazonaws.com/public/images/o_1000x500.png';
    const stale = 'https://substack-post-media.s3.amazonaws.com/public/images/stale.png';
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(
      docOf(
        imageNode(stale, {
          image_attrs: { srcNoWatermark: original, imageSize: 'large' },
          watermark: { scale: 0.06, position: 'top-left', opacity: 65 },
        }),
      ),
      deps,
    );
    expect(imgAttrs(resolved)).toMatchObject({
      srcNoWatermark: original,
      src: WM_URL,
      imageSize: 'large',
    });
    expect(await bodies(fake)).toEqual([
      { image: original, offsetX: 8, offsetY: 4, width: 60, height: 60, opacity: 65 },
    ]);
  });

  it('keeps an explicit srcNoWatermark when there is no watermark instruction', async () => {
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(
      docOf(imageNode(HOSTED, { image_attrs: { srcNoWatermark: 'https://o/x.png' } })),
      deps,
    );
    expect(imgAttrs(resolved).srcNoWatermark).toBe('https://o/x.png');
    expect(fake.calls).toEqual([]);
  });

  it('keeps size attributes on an external image', async () => {
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(
      docOf(
        imageNode('https://example.com/cat.png', {
          image_attrs: {
            imageSize: 'large',
            resizeWidth: 1200,
            align: 'center',
            fullscreen: false,
          },
        }),
      ),
      deps,
    );
    expect(imgAttrs(resolved)).toMatchObject({
      imageSize: 'large',
      resizeWidth: 1200,
      align: 'center',
      fullscreen: false,
      srcNoWatermark: null,
      width: 2387,
    });
    expect(fake.calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/v1/image']);
  });

  it('raises before the watermark call when the size is unknown', async () => {
    const src = 'https://substackcdn.com/image/fetch/abc';
    const { fake, deps } = setup();
    const err = await resolveDraftBody(docOf(imageNode(src, { watermark: WM })), deps).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(DraftMarkdownError);
    expect(err.reason).toBe(`cannot watermark ${src}: image size unknown`);
    expect(err.line).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it('uploads images one at a time, in document order', async () => {
    const seen: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const { deps } = setup({
      [`POST ${P}/image`]: async (req: Request) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        seen.push(((await req.json()) as { image: string }).image);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return IMAGE_RESP;
      },
    });
    const doc = docOf(
      imageNode('https://a/1.png'),
      { type: 'blockquote', content: [imageNode('https://a/2.png')] },
      imageNode('https://a/3.png'),
    );
    await resolveDraftBody(doc, deps);
    expect(seen).toEqual(['https://a/1.png', 'https://a/2.png', 'https://a/3.png']);
    expect(maxInFlight).toBe(1);
  });

  it('resolves a 5,000-word body with 12 external images in exactly 12 image subrequests', async () => {
    const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do'.split(' ');
    const paragraphs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const para = Array.from({ length: 5000 / 12 }, (_, j) => words[(i + j) % words.length]).join(
        ' ',
      );
      paragraphs.push(`${para}\n\n![chart ${i}](https://example.com/img-${i}.png)`);
    }
    const md = paragraphs.join('\n\n');
    expect(
      md
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .split(/\s+/)
        .filter(Boolean).length,
    ).toBeGreaterThanOrEqual(4990);
    const { fake, deps } = setup();
    const resolved = await resolveDraftBody(markdownToDraftDoc(md), deps);
    const posts = fake.calls.filter(
      (c) => c.method === 'POST' && new URL(c.url).pathname === '/api/v1/image',
    );
    expect(posts).toHaveLength(12);
    expect(fake.calls).toHaveLength(12);
    expect(JSON.stringify(resolved)).not.toContain('_unresolved_');
  });
});
