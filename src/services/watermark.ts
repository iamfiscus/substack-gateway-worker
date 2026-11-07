// Port of gateway_drafts/watermark.py (upstream bc2e875): watermarking of draft
// images through Substack's `image/watermark` endpoint.

import { SubstackAPIError } from '../clients/errors';
import type { PublicationClient } from '../clients/publication';
import { PyValueError } from '../converters/dialect/errors';

export type Position = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export type WatermarkSpec = { scale: number; position: Position; opacity: number };

export const DEFAULT_WATERMARK_SPEC: WatermarkSpec = {
  scale: 0.06,
  position: 'top-right',
  opacity: 65,
};

const SIZE_IN_NAME = /_(\d+)x(\d+)\.[A-Za-z0-9]+$/;

/** Python round(): half to even. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function clamp(offset: number, limit: number): number {
  return Math.max(0, Math.min(offset, limit));
}

/**
 * `[offsetX, offsetY, size]` for the square watermark overlay. Mirrors the web
 * editor: `scale` of the image width, 0.4% of the width from the top/bottom
 * edge and four pixels further from the left/right edge; clamped to fit.
 */
export function computeGeometry(
  width: number,
  height: number,
  spec: WatermarkSpec,
): [number, number, number] {
  // Round away float noise (0.06 * 1000 == 60.00000000000001) before ceil.
  let size = Math.ceil(pyRound(spec.scale * width * 1e6) / 1e6);
  size = Math.max(1, Math.min(size, width, height));
  const offsetY = pyRound(0.004 * width);
  const offsetX = offsetY + 4;
  const x = spec.position.endsWith('right') ? width - size - offsetX : offsetX;
  const y = spec.position.startsWith('bottom') ? height - size - offsetY : offsetY;
  return [clamp(x, width - size), clamp(y, height - size), size];
}

/** Parse the `_<W>x<H>.<ext>` suffix Substack puts on hosted image names. */
export function imageDimensionsFromUrl(url: string): [number, number] | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    // urlsplit accepts relative references; take what precedes ? and #.
    path = url.split(/[?#]/, 1)[0] ?? '';
  }
  const match = SIZE_IN_NAME.exec(path);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2])];
}

export class WatermarkService {
  constructor(private readonly pub: PublicationClient) {}

  /** Overlay the publication logo on `originalUrl`; return the new URL. */
  async apply(
    originalUrl: string,
    width: number,
    height: number,
    spec: WatermarkSpec = DEFAULT_WATERMARK_SPEC,
  ): Promise<string> {
    const [offsetX, offsetY, size] = computeGeometry(width, height, spec);
    const noUrl = () =>
      new SubstackAPIError(502, `Substack's watermark endpoint returned no URL for ${originalUrl}`);
    let data: unknown;
    try {
      data = await this.pub.post('image/watermark', {
        json: {
          image: originalUrl,
          offsetX,
          offsetY,
          width: size,
          height: size,
          opacity: spec.opacity,
        },
      });
    } catch (err) {
      // Not JSON: the client already raised 502; upstream says it with the URL.
      if (err instanceof PyValueError) throw noUrl();
      if (
        err instanceof SubstackAPIError &&
        err.status === 502 &&
        err.message === 'Substack returned non-JSON response'
      ) {
        throw noUrl();
      }
      throw err;
    }
    const url =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).url
        : undefined;
    if (typeof url !== 'string' || url === '') throw noUrl();
    return url;
  }
}
