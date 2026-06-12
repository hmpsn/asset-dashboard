/**
 * Integration test: concurrent generation guard for keyword strategy.
 *
 * Fires two simultaneous POST requests for the same workspace and asserts
 * exactly one of them returns 409 with an "already being generated" message.
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
const ctx = createEphemeralTestContext(import.meta.url);

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

afterAll(async () => {
  cleanup?.();
  await ctx.stopServer();
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
      fetch(`${ctx.BASE}/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`${ctx.BASE}/api/webflow/keyword-strategy/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);

    const statuses = [res1.status, res2.status];
    // One request must be rejected (409), the other must have proceeded (not 409)
    expect(statuses).toContain(409);
    expect(statuses.some(s => s !== 409)).toBe(true);

    const failedRes = res1.status === 409 ? res1 : res2;
    const json = await failedRes.json();
    expect(json.error).toMatch(/already being generated/i);
  }, 30_000);
});
