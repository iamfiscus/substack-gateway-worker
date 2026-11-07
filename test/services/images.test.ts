import { expect, it } from 'vitest';
import { SubstackAPIError } from '../../src/clients/errors';
import { PublicationClient } from '../../src/clients/publication';
import { dataUri, ImagesService } from '../../src/services/images';
import { createFakeSubstack } from '../support/fakeSubstack';

const RESPONSE = {
  id: 303467639,
  url: 'https://substack-post-media.s3.amazonaws.com/public/images/e175.png',
  contentType: 'image/png',
  bytes: 72180,
  imageWidth: 2387,
  imageHeight: 203,
};

function pubWith(routes: Record<string, unknown>) {
  const fake = createFakeSubstack(routes);
  const pub = new PublicationClient({
    publicationUrl: 'https://example.substack.com',
    substackSid: 's',
    connectSid: 'c',
    fetcher: fake,
    timeoutMs: 5000,
  });
  return { fake, pub };
}

it('posts the image field and normalizes the response', async () => {
  const { fake, pub } = pubWith({ 'POST example.substack.com/api/v1/image': RESPONSE });
  const result = await new ImagesService(pub).upload('data:image/png;base64,QUJD');
  expect(fake.calls).toHaveLength(1);
  expect(await fake.calls[0]?.json()).toEqual({ image: 'data:image/png;base64,QUJD' });
  expect(result).toEqual({
    id: 303467639,
    url: RESPONSE.url,
    width: 2387,
    height: 203,
    bytes: 72180,
    contentType: 'image/png',
  });
});

it('rejects a malformed upload response as a 502', async () => {
  const { pub } = pubWith({ 'POST example.substack.com/api/v1/image': { id: 1 } });
  await expect(new ImagesService(pub).upload('x')).rejects.toBeInstanceOf(SubstackAPIError);
});

it('builds a base64 data URI', () => {
  expect(dataUri('image/png', new TextEncoder().encode('ABC'))).toBe('data:image/png;base64,QUJD');
  const big = new Uint8Array(100_000).fill(255);
  expect(dataUri('a/b', big).length).toBe('data:a/b;base64,'.length + Math.ceil(100_000 / 3) * 4);
});
