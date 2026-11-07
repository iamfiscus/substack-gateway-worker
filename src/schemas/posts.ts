// Port of gateway_posts/schemas.py and the post models of
// gateway_core/models/substack.py (upstream bc2e875).

import { z } from '@hono/zod-openapi';
import { htmlToMarkdown } from '../converters/htmlToMarkdown';

// ---- Substack models (input) ----

export const SubstackPreviewPost = z.object({
  id: z.number().int(),
  title: z.string(),
  post_date: z.string(),
  subtitle: z.string().nullish(),
  truncated_body_text: z.string().nullish(),
  slug: z.string().nullish(),
  canonical_url: z.string().nullish(),
});
export type SubstackPreviewPost = z.infer<typeof SubstackPreviewPost>;

export const SubstackProfilePostsPage = z.object({
  posts: z.array(SubstackPreviewPost).default([]),
  nextCursor: z.string().nullish(),
});
export type SubstackProfilePostsPage = z.infer<typeof SubstackProfilePostsPage>;

export const SubstackFullPost = z.object({
  id: z.number().int(),
  title: z.string(),
  slug: z.string(),
  post_date: z.string(),
  canonical_url: z.string(),
  subtitle: z.string().nullish(),
  truncated_body_text: z.string().nullish(),
  // Substack has used both body_html and htmlBody; merged via `body_html || html_body`.
  body_html: z.string().nullish(),
  htmlBody: z.string().nullish(),
  reactions: z.record(z.string(), z.number().int()).nullish(),
  restacks: z.number().int().nullish(),
  postTags: z.array(z.object({ name: z.string(), slug: z.string().nullish() })).nullish(),
  cover_image: z.string().nullish(),
});
export type SubstackFullPost = z.infer<typeof SubstackFullPost>;

export const SubstackPostResponse = z.object({ post: SubstackFullPost });

// ---- Gateway responses (output) ----

export const PostResponse = z
  .object({
    id: z.number().int(),
    title: z.string(),
    subtitle: z.string().nullable(),
    truncated_body: z.string().nullable(),
    published_at: z.string(),
  })
  .openapi('PostResponse');
export type PostResponse = z.infer<typeof PostResponse>;

export const PostsPageResponse = z
  .object({ items: z.array(PostResponse), next: z.string().nullable() })
  .openapi('PostsPageResponse');
export type PostsPageResponse = z.infer<typeof PostsPageResponse>;

export const FullPostResponse = z
  .object({
    id: z.number().int(),
    title: z.string(),
    slug: z.string(),
    subtitle: z.string().nullable(),
    url: z.string(),
    published_at: z.string(),
    html_body: z.string().nullable(),
    markdown: z.string().nullable(),
    truncated_body: z.string().nullable(),
    reactions: z.record(z.string(), z.number().int()).nullable(),
    restacks: z.number().int().nullable(),
    tags: z.array(z.string()).nullable(),
    cover_image: z.string().nullable(),
  })
  .openapi('FullPostResponse');
export type FullPostResponse = z.infer<typeof FullPostResponse>;

export function postResponse(post: SubstackPreviewPost): PostResponse {
  return {
    id: post.id,
    title: post.title,
    subtitle: post.subtitle ?? null,
    truncated_body: post.truncated_body_text ?? null,
    published_at: post.post_date,
  };
}

export function postsPageResponse(page: SubstackProfilePostsPage): PostsPageResponse {
  return { items: page.posts.map(postResponse), next: page.nextCursor ?? null };
}

export function fullPostResponse(post: SubstackFullPost): FullPostResponse {
  // Python `or`: an empty body_html falls through to html_body.
  const rawHtml = post.body_html || post.htmlBody;
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    subtitle: post.subtitle ?? null,
    url: post.canonical_url,
    published_at: post.post_date,
    html_body: rawHtml ?? null,
    markdown: rawHtml ? htmlToMarkdown(rawHtml) : null,
    truncated_body: post.truncated_body_text ?? null,
    reactions: post.reactions ?? null,
    restacks: post.restacks ?? null,
    // Python truthiness: an empty tag list is None.
    tags: post.postTags?.length ? post.postTags.map((t) => t.name) : null,
    cover_image: post.cover_image ?? null,
  };
}
