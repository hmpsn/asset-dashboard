/**
 * Integration tests for POST /api/public/tracked-keywords/:workspaceId
 *
 * Verifies:
 * - 200 response with updated keywords list immediately (non-blocking)
 * - Graceful handling when no SEO provider is configured
 *
 * Port: 13334
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const PORT = 13334;
const ctx = createTestContext(PORT);

let workspaceId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  // Empty clientPassword makes the workspace passwordless — requireClientPortalAuth
  // allows through without a session cookie (accessible by URL alone).
  const seed = seedWorkspace({ clientPassword: '' });
  workspaceId = seed.workspaceId;
  cleanup = seed.cleanup;
}, 30_000);

afterAll(async () => {
  cleanup?.();
  await ctx.stopServer();
});

describe('POST /api/public/tracked-keywords/:workspaceId — background enrichment', () => {
  it('returns 200 and the updated keywords list immediately (does not block on enrichment)', async () => {
    const start = Date.now();
    const res = await fetch(`http://localhost:${PORT}/api/public/tracked-keywords/${workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'seo strategy' }),
    });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    const body = await res.json() as { keywords: { query: string }[] };
    expect(body.keywords).toBeInstanceOf(Array);
    expect(body.keywords.some((k) => k.query === 'seo strategy')).toBe(true);
    // Response must not wait for enrichment (DataForSEO can take 1-3s)
    expect(elapsed).toBeLessThan(500);
  }, 10_000);

  it('returns 200 even when no SEO provider is configured', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/public/tracked-keywords/${workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'another keyword' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { keywords: { query: string }[] };
    expect(body.keywords).toBeInstanceOf(Array);
  }, 10_000);
});
