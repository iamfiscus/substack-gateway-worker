// Port of upstream packages/gateway_oss/features/steps/health.py (bc2e875).

import { type StepRegistry, step } from '../runner';
import { SUBSTACK_HOST, type World } from './common';

const FEED_FOLLOWING = `GET ${SUBSTACK_HOST}/api/v1/feed/following`;

export const healthSteps: StepRegistry<World> = [
  step('the Substack API is reachable', (w) => {
    w.routes[FEED_FOLLOWING] = () => new Response(null, { status: 200 });
  }),
  step('the Substack API is unreachable', (w) => {
    w.routes[FEED_FOLLOWING] = () => {
      throw new TypeError('connection refused');
    };
  }),
  step('the Substack API times out', (w) => {
    w.routes[FEED_FOLLOWING] = () => {
      throw new DOMException('request timed out', 'TimeoutError');
    };
  }),
  step('the Substack feed/following endpoint returns status {status:d}', (w, [status]) => {
    w.routes[FEED_FOLLOWING] = () => new Response(null, { status: Number(status) });
  }),
];
