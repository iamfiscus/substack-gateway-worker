// Port of upstream packages/gateway_oss/features/steps/drafts.py and the draft
// `When` steps of mcp_tools.py (bc2e875).

import { expect } from 'vitest';
import { canonicalJson } from '../../support/canon';
import { type StepRegistry, step } from '../runner';
import { json, loadSample, pubHost, pubUrl, SUBSTACK_HOST, send, type World } from './common';
import { callTool } from './mcp';

const RICH_SAMPLE = 'draft/get-rich-response';
const status = (code: number) => () => new Response(null, { status: code });

const USER_SETTINGS_RESPONSE = {
  userSettings: [
    {
      user_id: 254824415,
      type: 'last_home_tab',
      value_bool: null,
      value_datetime: null,
      value_integer: null,
      value_text: 'inbox',
    },
  ],
  qualifiesForBadge: false,
};

const draftKey = (w: World, method: string, id?: string) =>
  `${method} ${pubHost(w)}/api/v1/drafts${id === undefined ? '' : `/${id}`}`;
const draftUrl = (w: World, id?: number) =>
  `${pubUrl(w)}/api/v1/drafts${id === undefined ? '' : `/${id}`}`;
const watermarkUrl = (w: World) => `${pubUrl(w)}/api/v1/image/watermark`;

function userSettings(w: World): void {
  w.routes[`GET ${SUBSTACK_HOST}/api/v1/user-settings`] = USER_SETTINGS_RESPONSE;
}

function upstreamCalls(w: World, method: string, url: string): Request[] {
  return (w.fake?.calls ?? []).filter((r) => r.method === method && r.url === url);
}

async function singleUpstreamJson(
  w: World,
  method: string,
  url: string,
): Promise<Record<string, unknown>> {
  const calls = upstreamCalls(w, method, url);
  expect(calls, `Expected one upstream ${method} to ${url}`).toHaveLength(1);
  return (await (calls[0] as Request).clone().json()) as Record<string, unknown>;
}

async function createdImages(w: World): Promise<Record<string, unknown>[]> {
  const sent = await singleUpstreamJson(w, 'POST', draftUrl(w));
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
    } else if (node !== null && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (o.type === 'image2') found.push(o.attrs as Record<string, unknown>);
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(JSON.parse(sent.draft_body as string));
  return found;
}

export const draftSteps: StepRegistry<World> = [
  step(
    'the Substack get-draft endpoint returns the sample response for draft {id:d}',
    (w, [id]) => {
      w.routes[draftKey(w, 'GET', id)] = loadSample('draft/get-response');
    },
  ),
  step('the Substack get-draft endpoint returns the rich sample for draft {id:d}', (w, [id]) => {
    w.routes[draftKey(w, 'GET', id)] = loadSample(RICH_SAMPLE);
  }),
  step(
    'the Substack get-draft endpoint returns status {status:d} for draft {id:d}',
    (w, [code, id]) => {
      w.routes[draftKey(w, 'GET', id)] = status(Number(code));
    },
  ),
  step(
    'the Substack update-draft endpoint returns the sample response for draft {id:d}',
    (w, [id]) => {
      w.routes[draftKey(w, 'PUT', id)] = loadSample('draft/get-response');
    },
  ),
  step(
    'the Substack update-draft endpoint returns status {status:d} for draft {id:d}',
    (w, [code, id]) => {
      w.routes[draftKey(w, 'PUT', id)] = status(Number(code));
    },
  ),
  step(
    'the Substack delete-draft endpoint returns status {status:d} for draft {id:d}',
    (w, [code, id]) => {
      w.routes[draftKey(w, 'DELETE', id)] = status(Number(code));
    },
  ),
  step('the Substack watermark endpoint returns "{url}"', (w, [url]) => {
    w.routes[`POST ${pubHost(w)}/api/v1/image/watermark`] = { url };
  }),
  step('the Substack list-drafts endpoint returns the sample response', (w) => {
    w.routes[`GET ${pubHost(w)}/api/v1/post_management/drafts`] =
      loadSample('drafts/list-response');
  }),
  step('the Substack list-drafts endpoint returns status {status:d}', (w, [code]) => {
    w.routes[`GET ${pubHost(w)}/api/v1/post_management/drafts`] = status(Number(code));
  }),
  step('the Substack user-settings endpoint returns the sample response', (w) => userSettings(w)),
  step('the Substack create-draft endpoint returns the sample response', (w) => {
    userSettings(w);
    w.routes[draftKey(w, 'POST')] = () =>
      Response.json(loadSample('draft/response'), { status: 201 });
  }),
  step('the Substack create-draft endpoint returns status {status:d}', (w, [code]) => {
    userSettings(w);
    w.routes[draftKey(w, 'POST')] = status(Number(code));
  }),

  step('no Substack PUT request was sent', (w) => {
    const puts = (w.fake?.calls ?? []).filter((r) => r.method === 'PUT');
    expect(puts, 'Expected no upstream PUT').toHaveLength(0);
  }),
  step('no Substack POST request was sent to the drafts endpoint', (w) => {
    expect(upstreamCalls(w, 'POST', draftUrl(w)), 'Expected no upstream draft POST').toHaveLength(
      0,
    );
  }),

  step(
    'I send PUT /api/v1/drafts/{id:d} with the body and updated_at from the previous response',
    async (w, [id]) => {
      expect(w.response?.status, w.bodyText).toBe(200);
      const fetched = json(w);
      await send(w, 'PUT', `/api/v1/drafts/${id}`, {
        body: fetched.body,
        expected_updated_at: fetched.updated_at,
      });
    },
  ),
  step('the upstream draft PUT body equals the rich sample draft_body', async (w) => {
    const sent = await singleUpstreamJson(w, 'PUT', draftUrl(w, 189535264));
    const expected = (loadSample(RICH_SAMPLE) as { draft_body: string }).draft_body;
    expect(canonicalJson(JSON.parse(sent.draft_body as string))).toBe(
      canonicalJson(JSON.parse(expected)),
    );
  }),
  step(
    'the upstream watermark request has offsetX {x:d} offsetY {y:d} width {w:d}',
    async (w, [x, y, width]) => {
      const body = await singleUpstreamJson(w, 'POST', watermarkUrl(w));
      expect([body.offsetX, body.offsetY, body.width, body.height]).toEqual([
        Number(x),
        Number(y),
        Number(width),
        Number(width),
      ]);
    },
  ),
  step(
    'the upstream watermark request is for image "{url}" with opacity {opacity:d}',
    async (w, [url, opacity]) => {
      const body = await singleUpstreamJson(w, 'POST', watermarkUrl(w));
      expect(body.image).toBe(url);
      expect(body.opacity).toBe(Number(opacity));
    },
  ),
  step(
    'the created draft has one image with src "{src}" and srcNoWatermark "{original}"',
    async (w, [src, original]) => {
      const images = await createdImages(w);
      expect(images).toHaveLength(1);
      expect(images[0]?.src).toBe(src);
      expect(images[0]?.srcNoWatermark).toBe(original);
    },
  ),

  // MCP (upstream mcp_tools.py and drafts.py)
  step('I call the MCP tool list_drafts', (w) => callTool(w, 'list_drafts', {})),
  step('I call the MCP tool get_draft with draft_id {id:d}', (w, [id]) =>
    callTool(w, 'get_draft', { draft_id: Number(id) }),
  ),
  step('I call the MCP tool create_draft with title "{title}"', (w, [title]) =>
    callTool(w, 'create_draft', { title }),
  ),
  step(
    'I call the MCP tool update_draft with draft_id {id:d}, title "{title}" and expected_updated_at "{expected}"',
    (w, [id, title, expected]) =>
      callTool(w, 'update_draft', {
        draft_id: Number(id),
        title,
        expected_updated_at: expected,
      }),
  ),
  step('I call the MCP tool create_draft with a broken substack-node fence body', (w) =>
    callTool(w, 'create_draft', { title: 'Test Draft', body: '```substack-node\n{oops\n```' }),
  ),
  step('I call the MCP tool delete_draft with draft_id {id:d}', (w, [id]) =>
    callTool(w, 'delete_draft', { draft_id: Number(id) }),
  ),
  step('I call the MCP tool get_draft then update_draft with draft_id {id:d}', async (w, [id]) => {
    const fetched = await callTool(w, 'get_draft', { draft_id: Number(id) });
    expect(fetched.isError, fetched.text ?? '').toBe(false);
    await callTool(w, 'update_draft', {
      draft_id: Number(id),
      body: fetched.result?.body,
      expected_updated_at: fetched.result?.updated_at,
    });
  }),
  step('I call the MCP tool create_draft with body "{body}"', (w, [body]) =>
    callTool(w, 'create_draft', { title: 'Test Draft', body }),
  ),
];
