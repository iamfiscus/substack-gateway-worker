// Port of upstream features/steps/{profiles,me,posts}.py Given steps (bc2e875):
// the fake Substack routes for profiles, own-profile, posts, notes and following.
// Substack's global API lives on substack.com; the publication API on the
// credential's publication host.

import { type StepRegistry, step } from '../runner';
import { loadSample, pubHost, SUBSTACK_HOST, type World } from './common';

const GLOBAL = `${SUBSTACK_HOST}/api/v1`;

const status = (code: number) => () => new Response(null, { status: code });

export const readDomainSteps: StepRegistry<World> = [
  // profiles
  step(
    'the Substack public profile endpoint returns the sample response for "{handle}"',
    (w, [handle]) => {
      w.routes[`GET ${GLOBAL}/user/${handle}/public_profile`] = loadSample(
        `user/${handle}/public_profile`,
      );
    },
  ),
  step(
    'the Substack public profile endpoint for "{slug}" returns status {status:d}',
    (w, [slug, code]) => {
      w.routes[`GET ${GLOBAL}/user/${slug}/public_profile`] = status(Number(code));
    },
  ),
  step(
    'the Substack public profile endpoint for "{slug}" returns a response with no id field',
    (w, [slug]) => {
      w.routes[`GET ${GLOBAL}/user/${slug}/public_profile`] = { handle: slug, name: 'Test' };
    },
  ),
  step(
    'the Substack public profile endpoint for "{slug}" returns a response with a non-integer id',
    (w, [slug]) => {
      w.routes[`GET ${GLOBAL}/user/${slug}/public_profile`] = {
        id: 'not-a-number',
        handle: slug,
        name: 'Test',
      };
    },
  ),
  step(
    'the Substack profile notes endpoint returns the sample response for user {id:d}',
    (w, [id]) => {
      w.routes[`GET ${pubHost(w)}/api/v1/reader/feed/profile/${id}`] = loadSample(
        `feed/profile/${id}?types=note`,
      );
    },
  ),

  // me
  step('the Substack handles endpoint returns the sample response', (w) => {
    w.routes[`GET ${GLOBAL}/handle/options`] = loadSample('handle/options');
  }),
  step('the Substack handles endpoint returns the empty handles response', (w) => {
    w.routes[`GET ${GLOBAL}/handle/options`] = { potentialHandles: [] };
  }),
  step('the Substack handles endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`GET ${GLOBAL}/handle/options`] = status(Number(code));
  }),
  step('the Substack notes endpoint returns the sample response', (w) => {
    w.routes[`GET ${pubHost(w)}/api/v1/notes`] = loadSample('notes');
  }),
  step('the Substack notes endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`GET ${pubHost(w)}/api/v1/notes`] = status(Number(code));
  }),
  step('the Substack posts endpoint returns the sample response for user {id:d}', (w) => {
    w.routes[`GET ${GLOBAL}/profile/posts`] = loadSample('profile/posts');
  }),
  step('the Substack user-settings endpoint returns user id {id:d}', (w, [id]) => {
    w.routes[`GET ${GLOBAL}/user-settings`] = {
      userSettings: [
        {
          user_id: Number(id),
          type: 'last_home_tab',
          value_bool: null,
          value_datetime: null,
          value_integer: null,
          value_text: 'inbox',
        },
      ],
      qualifiesForBadge: false,
    };
  }),
  step('the Substack user-settings endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`GET ${GLOBAL}/user-settings`] = status(Number(code));
  }),
  step(
    'the Substack subscriber-lists endpoint returns the sample response for user {id:d}',
    (w, [id]) => {
      w.routes[`GET ${pubHost(w)}/api/v1/user/${id}/subscriber-lists`] = loadSample(
        `user/${id}/subscriber-lists`,
      );
    },
  ),

  // posts
  step('the Substack full post endpoint returns the sample response for post {id:d}', (w, [id]) => {
    w.routes[`GET ${GLOBAL}/posts/by-id/${id}`] = loadSample(`posts/by-id/${id}`);
  }),
  step(
    'the Substack full post endpoint for post {id:d} returns status {status:d}',
    (w, [id, code]) => {
      w.routes[`GET ${GLOBAL}/posts/by-id/${id}`] = status(Number(code));
    },
  ),

  // posts: comments (upstream steps/posts.py)
  step('the Substack comments endpoint returns the sample response for post {id:d}', (w, [id]) => {
    w.routes[`GET ${pubHost(w)}/api/v1/post/${id}/comments`] = loadSample(`post/${id}/comments`);
  }),
  step(
    'the Substack comments endpoint for post {id:d} returns status {status:d}',
    (w, [id, code]) => {
      w.routes[`GET ${pubHost(w)}/api/v1/post/${id}/comments`] = status(Number(code));
    },
  ),

  // reader (upstream steps/reader.py, comment_engagement.py, note_engagement.py)
  step(
    'the Substack reader comment endpoint returns the sample response for id {id:d}',
    (w, [id]) => {
      w.routes[`GET ${pubHost(w)}/api/v1/reader/comment/${id}`] = loadSample(
        `reader/comment/${id}`,
      );
    },
  ),
  step(
    'the Substack reader comment endpoint for id {id:d} returns status {status:d}',
    (w, [id, code]) => {
      w.routes[`GET ${pubHost(w)}/api/v1/reader/comment/${id}`] = status(Number(code));
    },
  ),
  step(
    'the Substack reader comment endpoint for id {id:d} resolves to post {post_id:d}',
    (w, [id, postId]) => {
      w.routes[`GET ${pubHost(w)}/api/v1/reader/comment/${id}`] = {
        item: {
          entity_key: 'k',
          context: { timestamp: '2024-01-15T10:00:00.000Z', users: [] },
          post: { id: Number(postId), title: 'Parent post', post_date: '2024-01-15T10:00:00.000Z' },
          comment: { id: Number(id), body: 'parent', name: 'Ann', reaction_count: 1 },
        },
      };
    },
  ),
  step('the Substack comment replies endpoint for id {id:d} returns two replies', (w, [id]) => {
    w.routes[`GET ${pubHost(w)}/api/v1/reader/comment/${id}/replies`] = twoReplies;
  }),
  // Upstream mocks note replies on the global host, comment replies on the publication host.
  step('the Substack note-replies endpoint returns two replies for note {id:d}', (w, [id]) => {
    w.routes[`GET ${GLOBAL}/reader/comment/${id}/replies`] = twoReplies;
  }),
];

const twoReplies = {
  commentBranches: [{ comment: { id: 1, body: 'first' } }, { comment: { id: 2, body: 'second' } }],
};
