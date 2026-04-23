/**
 * Integration tests for discovery_sources.raw_content size cap (migration 067).
 *
 * Verifies that:
 * - A 1 MB paste is accepted (200 response)
 * - A 2 MB paste is rejected with either 400 (app-layer Zod limit) or 413 (DB trigger)
 *
 * The DB trigger in migration 067 is defense-in-depth behind the app-layer
 * Zod validation on the route. Together, they prevent oversized content from
 * reaching the database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13225);
let wsId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const seed = seedWorkspace();
  wsId = seed.workspaceId;
  cleanup = seed.cleanup;
});

afterAll(() => {
  cleanup();
  ctx.stopServer();
});

describe('discovery_sources.raw_content size cap (migration 067)', () => {
  it('accepts a 1MB paste', async () => {
    const body = {
      rawContent: 'a'.repeat(1024 * 1024),
      sourceType: 'brand_doc' as const,
    };
    const res = await ctx.postJson(`/api/discovery/${wsId}/sources/text`, body);
    expect(res.status).toBe(200);
  });

  it('rejects a 2MB paste with 400 or 413', async () => {
    const body = {
      rawContent: 'a'.repeat(2 * 1024 * 1024),
      sourceType: 'brand_doc' as const,
    };
    const res = await ctx.postJson(`/api/discovery/${wsId}/sources/text`, body);
    // App-layer Zod .max(MAX_TEXT_BYTES) on the route returns 400.
    // Once DB trigger lands, a bypass (direct insertion over the limit) rejects with 413.
    expect([400, 413]).toContain(res.status);
  });
});
