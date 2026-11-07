import { z } from 'zod';
import type { GatewayExtension } from '../../src/context';
import { mcpTool } from '../../src/mcp/server';
import { runFeature } from './runner';
import { commonSteps, createWorld } from './steps/common';
import { mcpSteps } from './steps/mcp';

// TODO(Task 9): drop this placeholder once the real notes tools register
// get_note; it exercises the same mcpTool credential path the real tool uses.
const placeholderGetNote: GatewayExtension = {
  name: 'test-placeholder-get-note',
  registerMcp: (server) =>
    mcpTool(
      server,
      'get_note',
      {
        description: 'placeholder',
        inputSchema: z.object({ note_id: z.number().int() }),
        annotations: { readOnlyHint: true },
        feature: 'mcp:notes:get',
      },
      async ({ note_id }) => ({ id: note_id }),
    ),
};

await runFeature('test/features/mcp/credentials.feature', [...commonSteps, ...mcpSteps], {
  world: () => createWorld({ extensions: [placeholderGetNote] }),
});
