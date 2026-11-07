// Port of gateway_drafts/converters/draft_body_resolver.py (upstream bc2e875):
// replaces the parser's `_unresolved_*` media placeholders with real nodes.

import { SubstackAPIError } from '../clients/errors';
import type { PublicationClient } from '../clients/publication';
import type { ImagesService } from '../services/images';
import {
  imageDimensionsFromUrl,
  type WatermarkService,
  type WatermarkSpec,
} from '../services/watermark';
import { fillDefaults } from './dialect/attrs';
import { isSubstackHosted } from './dialect/blocks';
import { DraftMarkdownError } from './dialect/errors';
import { normalizeDatawrapperUrl } from './dialect/fences';
import type { Node } from './dialect/inline';

const PLACEHOLDER_PREFIX = '_unresolved_';

/**
 * A placeholder node reached the resolver without a resolution branch. A
 * leftover placeholder is a bug, never shipped.
 */
export class UnresolvedNodeError extends Error {
  override name = 'UnresolvedNodeError';
}

export type ResolveDeps = {
  images: ImagesService;
  watermark: WatermarkService;
  pub: PublicationClient;
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
// Python truthiness for the `x or y` idioms upstream uses on strings.
const truthy = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '' && v !== false && v !== 0;

/** Walk the doc, replacing media placeholders with resolved nodes, in document order. */
export async function resolveDraftBody(doc: Node, deps: ResolveDeps): Promise<Node> {
  const resolved = (await resolveNode(doc, deps)) as Node;
  assertNoPlaceholders(resolved);
  return resolved;
}

async function resolveNode(node: unknown, deps: ResolveDeps): Promise<unknown> {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) out.push(await resolveNode(item, deps));
    return out;
  }
  if (isObj(node)) {
    if (node.type === '_unresolved_datawrapper') return resolveDatawrapper(node, deps);
    if (node.type === '_unresolved_image') return resolveImage(node, deps);
    const out: Obj = {};
    for (const [key, value] of Object.entries(node)) out[key] = await resolveNode(value, deps);
    return out;
  }
  return node;
}

async function resolveDatawrapper(node: Obj, { pub }: ResolveDeps): Promise<Obj> {
  // Never fetch attrs.url as given: re-normalize to the fixed datawrapper.de
  // host (a DraftMarkdownError for anything else) and fetch only that.
  const resolveUrl = normalizeDatawrapperUrl((node.attrs as Obj).url as string);
  const data = await pub.get('datawrapper-embed', { query: { url: resolveUrl } });
  if (!isObj(data) || typeof data.url !== 'string') {
    throw new SubstackAPIError(502, "Substack's datawrapper-embed endpoint returned no URL");
  }
  const pick = (key: string, fallback: unknown) =>
    Object.hasOwn(data, key) ? data[key] : fallback;
  return {
    type: 'datawrapper',
    attrs: {
      url: data.url,
      thumbnail_url: pick('thumbnail_url', null),
      thumbnail_url_full: pick('thumbnail_url_full', null),
      height: pick('height', 400),
      title: pick('title', ''),
      description: pick('description', ''),
    },
  };
}

async function resolveImage(node: Obj, { images, watermark: wm }: ResolveDeps): Promise<Obj> {
  const attrs = node.attrs as Obj;
  const src = attrs.src as string;
  const imageAttrs: Obj = { ...((attrs.image_attrs as Obj | null | undefined) ?? {}) };
  const explicitOriginal = imageAttrs.srcNoWatermark as string | undefined;
  delete imageAttrs.srcNoWatermark;
  const watermark = (attrs.watermark ?? null) as Obj | null;

  const final: Obj = { alt: truthy(attrs.alt) ? attrs.alt : null };
  let finalSrc = src;
  let uploadSize: [number, number] | null = null;
  if (!isSubstackHosted(src)) {
    const result = await images.upload(src);
    finalSrc = result.url;
    uploadSize = [result.width, result.height];
    Object.assign(final, {
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      type: result.contentType,
    });
  }
  if (watermark !== null) {
    // The overlay always goes on the pristine image, never a prior result.
    const original = truthy(explicitOriginal) ? (explicitOriginal as string) : finalSrc;
    const size = uploadSize ?? imageDimensionsFromUrl(original) ?? imageDimensionsFromUrl(finalSrc);
    if (size === null) {
      throw new DraftMarkdownError(`cannot watermark ${src}: image size unknown`);
    }
    finalSrc = await wm.apply(original, size[0], size[1], watermark as unknown as WatermarkSpec);
    final.srcNoWatermark = original;
  } else if (explicitOriginal !== undefined) {
    final.srcNoWatermark = explicitOriginal;
  }
  Object.assign(final, imageAttrs);
  final.src = finalSrc;
  return {
    type: 'captionedImage',
    content: [{ type: 'image2', attrs: fillDefaults('image2', final) }],
  };
}

function assertNoPlaceholders(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) assertNoPlaceholders(item);
  } else if (isObj(node)) {
    if (typeof node.type === 'string' && node.type.startsWith(PLACEHOLDER_PREFIX)) {
      throw new UnresolvedNodeError(node.type);
    }
    for (const value of Object.values(node)) assertNoPlaceholders(value);
  }
}
