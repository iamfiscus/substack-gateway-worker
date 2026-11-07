// Port of upstream features/steps/{notes_create,note_engagement,comment_engagement,
// post_engagement}.py and the write `When` steps of mcp_tools.py (bc2e875).

import { type StepDef, type StepRegistry, step } from '../runner';
import { loadSample, pubHost, SUBSTACK_HOST, send, type World } from './common';
import { callTool } from './mcp';

const GLOBAL = `${SUBSTACK_HOST}/api/v1`;
const status = (code: number) => () => new Response(null, { status: code });
const num = (v: string | undefined) => Number(v);

/** pytest-bdd `parsers.re(r"I send PUT (?P<path>\S+)")`: a path has no spaces. */
function bodylessStep(method: 'PUT' | 'POST'): StepDef<World> {
  return {
    pattern: `I send ${method} <path>`,
    regex: new RegExp(`^I send ${method} (\\S+)$`),
    run: (w, [path]) => send(w, method, path as string),
  };
}

export const writeDomainSteps: StepRegistry<World> = [
  bodylessStep('PUT'),
  bodylessStep('POST'),

  // notes_create
  step('the Substack create-note endpoint returns the sample response', (w) => {
    w.routes[`POST ${GLOBAL}/comment/feed/`] = loadSample('comment/response');
  }),
  step('the Substack create-note endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`POST ${GLOBAL}/comment/feed/`] = status(num(code));
  }),
  step('the Substack create-attachment endpoint returns the sample response', (w) => {
    w.routes[`POST ${GLOBAL}/comment/attachment/`] = loadSample('comment/attachment-response');
  }),
  step('the Substack create-attachment endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`POST ${GLOBAL}/comment/attachment/`] = status(num(code));
  }),
  step(
    'the Substack delete-note endpoint returns status {status:d} for note {id:d}',
    (w, [code, id]) => {
      w.routes[`DELETE ${pubHost(w)}/api/v1/comment/${id}`] = status(num(code));
    },
  ),

  // note_engagement
  step(
    'the Substack like-note endpoint returns status {status:d} for note {id:d}',
    (w, [code, id]) => {
      w.routes[`POST ${GLOBAL}/comment/${id}/reaction`] = status(num(code));
    },
  ),
  step(
    'the Substack unlike-note endpoint returns status {status:d} for note {id:d}',
    (w, [code, id]) => {
      w.routes[`DELETE ${GLOBAL}/comment/${id}/reaction`] = status(num(code));
    },
  ),
  step('the Substack note-reply endpoint returns id {id:d}', (w, [id]) => {
    w.routes[`POST ${GLOBAL}/comment/feed/`] = {
      id: num(id),
      date: '2026-08-04',
      status: 'published',
    };
  }),

  // comment_engagement
  step(
    'the Substack post comment endpoint for post {post_id:d} returns id {id:d}',
    (w, [postId, id]) => {
      w.routes[`POST ${pubHost(w)}/api/v1/post/${postId}/comment`] = {
        id: num(id),
        body: 'hello',
      };
    },
  ),
  step(
    'the Substack comment reply endpoint for post {post_id:d} returns id {id:d}',
    (w, [postId, id]) => {
      w.routes[`POST ${pubHost(w)}/api/v1/post/${postId}/comment`] = { id: num(id), body: 're' };
    },
  ),
  step(
    'the Substack delete comment endpoint for id {id:d} returns status {status:d}',
    (w, [id, code]) => {
      w.routes[`DELETE ${pubHost(w)}/api/v1/comment/${id}`] = status(num(code));
    },
  ),
  step('the Substack comment reaction endpoint for id {id:d} accepts a like', (w, [id]) => {
    w.routes[`POST ${pubHost(w)}/api/v1/comment/${id}/reaction`] = { ok: true };
  }),
  step('the Substack comment reaction endpoint for id {id:d} accepts an unlike', (w, [id]) => {
    w.routes[`DELETE ${pubHost(w)}/api/v1/comment/${id}/reaction`] = { ok: true };
  }),

  // post_engagement
  step(
    'the Substack like-post endpoint returns status {status:d} for post {id:d}',
    (w, [code, id]) => {
      w.routes[`POST ${GLOBAL}/post/${id}/reaction`] = status(num(code));
    },
  ),
  step(
    'the Substack unlike-post endpoint returns status {status:d} for post {id:d}',
    (w, [code, id]) => {
      w.routes[`DELETE ${GLOBAL}/post/${id}/reaction`] = status(num(code));
    },
  ),
  step('the Substack restack-post endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`POST ${GLOBAL}/restack/feed`] = status(num(code));
  }),

  // MCP When steps
  step('I call the MCP tool like_note with note_id {id:d}', (w, [id]) =>
    callTool(w, 'like_note', { note_id: num(id) }),
  ),
  step('I call the MCP tool unlike_note with note_id {id:d}', (w, [id]) =>
    callTool(w, 'unlike_note', { note_id: num(id) }),
  ),
  step('I call the MCP tool reply_to_note with note_id {id:d} and body "{body}"', (w, [id, body]) =>
    callTool(w, 'reply_to_note', { note_id: num(id), body }),
  ),
  step(
    'I call the MCP tool create_post_comment with post_id {id:d} and body "{body}"',
    (w, [id, body]) => callTool(w, 'create_post_comment', { post_id: num(id), body }),
  ),
  step(
    'I call the MCP tool reply_to_post_comment with comment_id {id:d} and body "{body}"',
    (w, [id, body]) => callTool(w, 'reply_to_post_comment', { comment_id: num(id), body }),
  ),
  step('I call the MCP tool delete_post_comment with comment_id {id:d}', (w, [id]) =>
    callTool(w, 'delete_post_comment', { comment_id: num(id) }),
  ),
  step('I call the MCP tool like_post_comment with comment_id {id:d}', (w, [id]) =>
    callTool(w, 'like_post_comment', { comment_id: num(id) }),
  ),
  step('I call the MCP tool unlike_post_comment with comment_id {id:d}', (w, [id]) =>
    callTool(w, 'unlike_post_comment', { comment_id: num(id) }),
  ),
  step('I call the MCP tool like_post with post_id {id:d}', (w, [id]) =>
    callTool(w, 'like_post', { post_id: num(id) }),
  ),
  step('I call the MCP tool unlike_post with post_id {id:d}', (w, [id]) =>
    callTool(w, 'unlike_post', { post_id: num(id) }),
  ),
  step('I call the MCP tool restack_post with post_id {id:d}', (w, [id]) =>
    callTool(w, 'restack_post', { post_id: num(id) }),
  ),
];
