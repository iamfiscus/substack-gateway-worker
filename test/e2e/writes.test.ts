// Ported from upstream e2e: notes.feature (create/delete), drafts.feature, comments.feature.
// Writes to Substack: run only against the throwaway publication. Skipped when
// unless E2E_ALLOW_WRITES=1, and never against a host containing "nerding".
import { afterEach, describe, expect, it } from 'vitest';
import {
  call,
  commentsEnabled,
  del,
  deleteDraft,
  enabled,
  expectStatus,
  get,
  POST_ID,
  post,
  put,
  richDialectBody,
  solidPng,
  writesAllowed,
} from './support';

describe.skipIf(!enabled || !writesAllowed)(
  'e2e: write scenarios (throwaway publication only)',
  () => {
    const drafts: string[] = [];
    afterEach(async () => {
      // Cleanup tolerates only a disabled-feature 403; anything else is reported.
      for (const id of drafts.splice(0)) {
        try {
          if ((await deleteDraft(id)) === 'forbidden') {
            console.warn(`e2e: draft ${id} left behind (drafts:delete disabled)`);
          }
        } catch (err) {
          console.warn(`e2e: cleanup of draft ${id} failed:`, err);
          throw err;
        }
      }
    });

    it('creates, fetches and deletes a note (needs api:notes:create + api:notes:delete)', async () => {
      const created = await post('/api/v1/notes', { content: 'e2e test note - safe to delete' });
      expectStatus(created, 201);
      const id = String(created.json().id);
      expect(created.json()).toHaveProperty('id');
      const fetched = await get(`/api/v1/notes/${id}`);
      expectStatus(fetched, 200);
      expect(fetched.json()).toHaveProperty('body');
      expectStatus(await del(`/api/v1/notes/${id}`), 204);
    });

    it('lists drafts', async () => {
      const r = await get('/api/v1/drafts');
      expectStatus(r, 200);
      expect(Array.isArray(r.json().items)).toBe(true);
    });

    it('draft lifecycle: create, fetch, update', async () => {
      const created = await post('/api/v1/drafts', {
        title: 'e2e test draft',
        body: 'Hello from e2e tests',
      });
      expectStatus(created, 201);
      expect(created.json()).toHaveProperty('id');
      expect(created.json()).toHaveProperty('uuid');
      const id = String(created.json().id);
      drafts.push(id);
      const fetched = await get(`/api/v1/drafts/${id}`);
      expectStatus(fetched, 200);
      expect(fetched.json()).toHaveProperty('title');
      expect(fetched.json()).toHaveProperty('body');
      expectStatus(await put(`/api/v1/drafts/${id}`, { title: 'updated e2e title' }), 200);
    });

    it('draft pre-publish and AI-detection reads', async () => {
      const created = await post('/api/v1/drafts', {
        title: 'e2e scan draft',
        body: 'Hello from e2e scan',
      });
      expectStatus(created, 201);
      const id = String(created.json().id);
      drafts.push(id);
      const pre = await get(`/api/v1/drafts/${id}/prepublish`);
      expectStatus(pre, 200);
      expect(pre.json()).toHaveProperty('errors');
      expect(pre.json()).toHaveProperty('suggestions');
      const ai = await get(`/api/v1/drafts/${id}/ai-detection`);
      expectStatus(ai, 200);
      expect(ai.json()).toHaveProperty('fraction_ai');
    });

    it('rich draft survives a round-trip', async () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(await solidPng(200, 100, [30, 90, 160]))], { type: 'image/png' }),
        'e2e-image.png',
      );
      const up = await call('POST', '/api/v1/images', { form });
      expectStatus(up, 201);
      const imageUrl: string = up.json().url ?? '';
      expect(imageUrl, 'hosted image URL needs a _<w>x<h> suffix for {watermark}').toMatch(
        /_\d+x\d+\.[A-Za-z0-9]+(?:$|[?#])/,
      );

      const created = await post('/api/v1/drafts', {
        title: 'e2e rich draft',
        body: richDialectBody(imageUrl),
      });
      expectStatus(created, 201);
      const id = String(created.json().id);
      drafts.push(id);

      const first = await get(`/api/v1/drafts/${id}`);
      expectStatus(first, 200);
      const body: string = first.json().body;
      expect(body.startsWith('::defaults{align=justify}\n')).toBe(true);
      for (const needle of [
        ':::align{center}',
        ':::align{left}',
        ':::callout',
        '::button[Subscribe now]{href=subscribe}',
        '::button[Share this post]{href=share}',
        '::button[Leave a comment]{href=comment}',
        '\n---\n',
      ]) {
        expect(body).toContain(needle);
      }
      expect(body.split('::button[').length - 1).toBe(3);
      const image = /^!\[E2E image\]\((\S+)\)\{(.*)\}$/m.exec(body);
      expect(image, `E2E image line missing in:\n${body}`).not.toBeNull();
      const [, src, attrs] = image as RegExpExecArray;
      expect(attrs).toContain('size=large');
      expect(attrs).toContain('original=');
      expect(attrs).toContain(imageUrl);
      expect(src).not.toBe(imageUrl);

      const u1 = await put(`/api/v1/drafts/${id}`, {
        body,
        expected_updated_at: first.json().updated_at,
      });
      expectStatus(u1, 200);
      expect(u1.json().updated_at).toBeTruthy();
      // Chained edit on the updated_at the previous PUT returned, not a fresh GET.
      const u2 = await put(`/api/v1/drafts/${id}`, {
        body,
        expected_updated_at: u1.json().updated_at,
      });
      expectStatus(u2, 200);
      const again = await get(`/api/v1/drafts/${id}`);
      expectStatus(again, 200);
      expect(again.json().body).toBe(body);
    });

    describe.skipIf(!commentsEnabled || !POST_ID)(
      'post comments (E2E_ENABLE_COMMENTS=1, E2E_POST_ID)',
      () => {
        it('lifecycle: create, reply, list, react, delete', async () => {
          const top = await post(`/api/v1/posts/${POST_ID}/comments`, {
            body: 'e2e top-level — safe to delete',
          });
          expectStatus(top, 201);
          const topId = String(top.json().id);
          const reply = await post(`/api/v1/comments/${topId}/comments`, {
            body: 'e2e reply — safe to delete',
          });
          expectStatus(reply, 201);
          const replyId = String(reply.json().id);
          const list = await get(`/api/v1/comments/${topId}/comments`);
          expectStatus(list, 200);
          expect(list.json().items.some((i: { id: number }) => i.id === Number(replyId))).toBe(
            true,
          );
          const one = await get(`/api/v1/comments/${topId}`);
          expectStatus(one, 200);
          expect(one.json()).toHaveProperty('id');
          expectStatus(await post(`/api/v1/comments/${topId}/reaction`), 204);
          expectStatus(await del(`/api/v1/comments/${topId}/reaction`), 204);
          expectStatus(await del(`/api/v1/comments/${replyId}`), 204);
          expectStatus(await del(`/api/v1/comments/${topId}`), 204);
        });

        it('reply to a non-existent comment returns 404', async () => {
          expectStatus(await post('/api/v1/comments/1/comments', { body: 'should fail' }), 404);
        });
      },
    );
  },
);
