/**
 * Integration test: bulk-accept-fixes Webflow API failure handling.
 *
 * updatePageSeo() returns { success: boolean, error?: string } — it does NOT
 * throw on Webflow API errors. Before the PR #1 Platform Health Sprint fix,
 * a bare `await updatePageSeo(...)` silently treated failures as successes,
 * inflating the `applied` count.
 *
 * This test verifies that when Webflow rejects the update, the job result
 * correctly increments `failed` and does NOT increment `applied`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock updatePageSeo to simulate a Webflow API failure.
// Must be hoisted before any module imports so the server loads the mocked version.
vi.mock('../../server/webflow.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...original,
    updatePageSeo: vi.fn().mockResolvedValue({ success: false, error: 'Webflow 429: rate limited' }),
  };
});

import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

// ── Unique port ──────────────────────────────────────────────────────────────
const ctx = createTestContext(13224);
const { api, postJson } = ctx;

const SITE_ID = 'site_bulkfail_test';
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Bulk Accept Failure Test');
  wsId = ws.id;
  updateWorkspace(wsId, { webflowSiteId: SITE_ID });
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  ctx.stopServer();
});

/** Poll GET /api/jobs/:id until status is terminal (done/error/cancelled). */
async function waitForJob(jobId: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/api/jobs/${jobId}`);
    if (res.status === 200) {
      const job = await res.json() as { status: string; result?: Record<string, unknown> };
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        return job as Record<string, unknown>;
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

describe('bulk-accept-fixes — Webflow API failure increments failed count', () => {
  it('reports failed=N and applied=0 when all Webflow updates fail', async () => {
    const fixes = [
      { pageId: 'page_001', check: 'meta-description', suggestedFix: 'Better meta description for page one' },
      { pageId: 'page_002', check: 'meta-description', suggestedFix: 'Better meta description for page two' },
    ];

    const startRes = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: SITE_ID,
      fixes,
    });
    expect(startRes.status).toBe(200);
    const { jobId } = await startRes.json() as { jobId: string };
    expect(typeof jobId).toBe('string');

    const job = await waitForJob(jobId);
    const result = job.result as { applied: number; failed: number; total: number } | undefined;

    // All Webflow calls fail → applied must be 0, failed must equal total
    expect(result?.applied).toBe(0);
    expect(result?.failed).toBe(fixes.length);
    expect(result?.total).toBe(fixes.length);
  });
});
