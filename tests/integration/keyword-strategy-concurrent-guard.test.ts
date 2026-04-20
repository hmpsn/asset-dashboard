/**
 * Integration test: concurrent generation guard for keyword strategy.
 *
 * Fires two simultaneous POST requests for the same workspace and asserts
 * exactly one of them returns 409 with an "already being generated" message.
 *
 * Port: 13321
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const PORT = 13321;
const ctx = createTestContext(PORT);

let workspaceId: string;
let cleanup: () => void;

let originalOpenAiKey: string | undefined;

beforeAll(async () => {
  // Set a fake OpenAI key so the handler proceeds past the key-present check
  // and reaches the first async operation — the point where concurrent guard fires.
  originalOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-fake-key-for-concurrent-guard-test';
  await ctx.startServer();
  const seeded = seedWorkspace({ tier: 'premium' });
  workspaceId = seeded.workspaceId;
  cleanup = seeded.cleanup;
}, 30_000);

afterAll(() => {
  cleanup?.();
  ctx.stopServer();
  if (originalOpenAiKey !== undefined) {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
});

describe('keyword strategy — concurrent generation guard', () => {
  it('returns 409 when a generation is already in flight for the same workspace', async () => {
    const body = JSON.stringify({});

    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(409);

    const failedRes = res1.status === 409 ? res1 : res2;
    const json = await failedRes.json();
    expect(json.error).toMatch(/already being generated/i);
  }, 30_000);
});
