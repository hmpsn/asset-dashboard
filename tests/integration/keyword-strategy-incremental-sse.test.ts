/**
 * Integration test for keyword strategy SSE incremental early-exit path.
 *
 * Regression: when mode=incremental and all pages are already fresh, the handler
 * returned early via res.end() without writing a `data:` event. The frontend
 * checks evt.done to invalidate React Query caches — without this event the UI
 * appeared to hang after an incremental no-op.
 *
 * Fix: emit `data: { done: true, strategy: ..., upToDate: true }` before res.end().
 *
 * Setup mirrors keyword-strategy-incremental.test.ts (port 13315):
 *   - Fake OPENAI_API_KEY before spawn so the key-presence check passes
 *   - Workspace with webflowSiteId (passes the "no site" check) + premium tier
 *   - Three fresh page_keywords rows (< 7d) so getPagesNeedingAnalysis → toAnalyze = []
 *   - With a fake siteId/no token, sitemap is empty → fresh skeletons injected from DB
 *   - Early exit fires before any real AI call
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import {
  createWorkspace,
  deleteWorkspace,
  updateWorkspace,
} from '../../server/workspaces.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

// Verify port is free: grep -r 'createTestContext(' tests/ | grep -o '1[0-9]\{4\}' | sort -n | tail -5
const PORT = 13320;

const ctx = createTestContext(PORT);
let workspaceId = '';

beforeAll(async () => {
  // Set fake API keys BEFORE startServer() so the spawned child process inherits them.
  // The early-exit path fires before any real AI or Webflow write calls.
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = 'test-fake-key-for-incremental-sse-test';
  }
  if (!process.env.WEBFLOW_API_TOKEN) {
    process.env.WEBFLOW_API_TOKEN = 'test-fake-webflow-token-for-incremental-sse-test';
  }

  await ctx.startServer();

  const ws = createWorkspace('SSE Incremental Early Exit Test');
  workspaceId = ws.id;

  // Premium tier so strategy_generations limit doesn't block us.
  // Fake webflowSiteId so the "No Webflow site linked" check passes.
  // Set a minimal keywordStrategy so ws.keywordStrategy is non-null on early exit.
  updateWorkspace(workspaceId, {
    webflowSiteId: 'fake-site-id-sse-early-exit-test',
    tier: 'premium',
    keywordStrategy: {
      siteKeywords: ['seo agency'],
      pageMap: [],
      opportunities: [],
      generatedAt: new Date().toISOString(),
    },
  });

  // Seed three fresh pages (< 7 days old) so getPagesNeedingAnalysis returns toAnalyze = [].
  // With a fake siteId/no token, sitemap discovery returns empty; the fresh skeleton
  // injection re-adds these DB rows to pageInfo so the early-exit condition triggers.
  const recentDate = new Date().toISOString();
  for (const path of ['/page-a', '/page-b', '/page-c']) {
    upsertPageKeyword(workspaceId, {
      pagePath: path,
      pageTitle: path.replace('/', ''),
      primaryKeyword: `keyword for ${path}`,
      secondaryKeywords: [],
      searchIntent: 'informational',
      analysisGeneratedAt: recentDate,
    } as PageKeywordMap);
  }
}, 25_000);

afterAll(() => {
  ctx.stopServer();
  if (workspaceId) deleteWorkspace(workspaceId);
});

describe('keyword strategy — incremental early exit SSE', () => {
  it('sends { done: true, upToDate: true } data event on SSE incremental no-op', async () => {
    // SSE request — the Accept: text/event-stream header activates the streaming path.
    const res = await fetch(
      `http://localhost:${PORT}/api/webflow/keyword-strategy/${workspaceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ mode: 'incremental' }),
      }
    );

    expect(res.status).toBe(200);
    const text = await res.text();

    // Parse all `data: {...}` lines from the SSE stream
    const dataLines = text.split('\n').filter(l => l.startsWith('data: '));
    const events = dataLines.map(l => {
      try { return JSON.parse(l.slice(6)); } catch { return null; }
    }).filter(Boolean);

    expect(events.length).toBeGreaterThan(0);

    // The done event must be present with upToDate: true and a valid strategy
    const doneEvent = events.find((e: Record<string, unknown>) => e.done === true);
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.upToDate).toBe(true);
    // Validate strategy is non-null so frontend cache invalidation path triggers
    expect(doneEvent?.strategy).toBeTruthy();
  });
});
