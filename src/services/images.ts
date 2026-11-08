// Port of gateway_drafts/image.py (upstream bc2e875).

import { lenientBase64ToBytes } from '../auth/credentials';
import { SubstackAPIError } from '../clients/errors';
import type { PublicationClient } from '../clients/publication';

export type UploadedImage = {
  id: number;
  url: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
};

/** Upload cap, checked before an image is base64-encoded for Substack (upstream has none). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TOO_LARGE = 'Image too large (max 10 MB)';

/** Decode an MCP `image_base64` argument, refusing more than MAX_IMAGE_BYTES. */
export function decodeImageBase64(b64: string): Uint8Array {
  const bytes = lenientBase64ToBytes(b64);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(IMAGE_TOO_LARGE);
  return bytes;
}

/** Build a `data:<mime>;base64,<...>` URI for Substack's image field. */
export function dataUri(contentType: string, bytes: Uint8Array): string {
  // Chunked: spreading a large array into fromCharCode overflows the stack.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function fromSubstack(data: unknown): UploadedImage {
  const d = (data ?? {}) as Record<string, unknown>;
  if (
    typeof d.id !== 'number' ||
    typeof d.url !== 'string' ||
    typeof d.imageWidth !== 'number' ||
    typeof d.imageHeight !== 'number' ||
    typeof d.bytes !== 'number' ||
    typeof d.contentType !== 'string'
  ) {
    throw new SubstackAPIError(502, "Substack's image endpoint returned an unexpected response");
  }
  return {
    id: d.id,
    url: d.url,
    width: d.imageWidth,
    height: d.imageHeight,
    bytes: d.bytes,
    contentType: d.contentType,
  };
}

/**
 * Uploads images to Substack's publication image endpoint: `POST /api/v1/image`
 * takes a data URI or a URL in `image`, re-hosts it, and returns the canonical
 * URL and pixel dimensions the `image2` node needs.
 */
export class ImagesService {
  constructor(private readonly pub: PublicationClient) {}

  async upload(image: string): Promise<UploadedImage> {
    return fromSubstack(await this.pub.post('image', { json: { image } }));
  }
}
