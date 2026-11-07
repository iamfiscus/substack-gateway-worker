import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';
import { readDomainSteps } from './steps/readDomains';

const steps = [...commonSteps, ...readDomainSteps, ...mcpSteps];
const WRITE = 'TODO(Task 10): note write paths';

await runFeature('test/features/mcp/notes.feature', steps, { world: () => createWorld() });

// Only the read scenario of the engagement features runs here.
await runFeature('test/features/api/note_engagement.feature', steps, {
  world: () => createWorld(),
  skip: {
    'Successfully like a note': WRITE,
    'Like note Substack API error returns 502': WRITE,
    'Like note authentication failure returns 401': WRITE,
    'Missing x-gateway-token header returns 422 on like': WRITE,
    'Successfully unlike a note': WRITE,
    'Unlike note authentication failure returns 401': WRITE,
    'Successfully reply to a note': WRITE,
  },
});
await runFeature('test/features/mcp/note_engagement.feature', steps, {
  world: () => createWorld(),
  skip: {
    'like_note returns confirmation message': WRITE,
    'unlike_note returns confirmation message': WRITE,
    'reply_to_note returns the created reply id': WRITE,
  },
});
