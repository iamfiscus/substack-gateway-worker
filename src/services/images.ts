// Port of gateway_drafts/image.py (upstream bc2e875).

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
