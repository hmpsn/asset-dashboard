/**
 * Integration tests for usage tracking and AI usage API endpoints.
 *
 * Tests:
 * - GET /api/ai/usage (global AI usage stats)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13207);
const { api } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

describe('Usage / AI API', () => {
  it('GET /api/ai/usage returns 200 with usage data', async () => {
    const res = await api('/api/ai/usage');
    expect(res.status).toBe(200);
    const body = await res.json();
    // AI usage endpoint returns usage tracking data
    expect(body).toBeDefined();
  });
});
