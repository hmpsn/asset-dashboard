/**
 * Integration test: audit_finding insight dedup — upsert updates data, preserves resolution.
 *
 * Verifies Bridge #12 behavior after the dedup-skip fix:
 * - First audit creates the insight
 * - Second audit with different issue data UPDATES the insight (not skips)
 * - A resolved insight keeps its resolution status after re-audit
 *
 * Port: 13314
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertInsight, getInsights, resolveInsight } from '../../server/analytics-insights-store.js';

const ctx = createTestContext(13314);

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Dedup Test Workspace');
  wsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  ctx.stopServer();
});

describe('audit_finding insight dedup fix', () => {
  it('re-upsert refreshes issue data on a non-resolved insight', () => {
    // Simulate first bridge run: create insight with 2 issues
    const first = upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/test-page',
      pageTitle: '/test-page',
      severity: 'warning',
      data: { scope: 'page', issueCount: 2, issueMessages: 'missing-alt; slow-lcp', source: 'bridge_12' },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });
    expect(first.data).toMatchObject({ issueCount: 2 });

    // Simulate second bridge run: same page, now 5 issues
    const second = upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/test-page',
      pageTitle: '/test-page',
      severity: 'critical',
      data: { scope: 'page', issueCount: 5, issueMessages: 'missing-alt; slow-lcp; missing-h1; duplicate-title; no-robots', source: 'bridge_12' },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });
    expect(second.data).toMatchObject({ issueCount: 5 });

    // Fetch from store — there should be only ONE insight (upserted, not duplicated)
    const all = getInsights(wsId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/test-page');
    expect(all).toHaveLength(1);
    expect(all[0].data).toMatchObject({ issueCount: 5, issueMessages: expect.stringContaining('missing-h1') });
  });

  it('re-upsert does NOT reset resolution status', () => {
    // Create insight and resolve it
    upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/resolved-page',
      severity: 'warning',
      data: { scope: 'page', issueCount: 1, issueMessages: 'missing-alt', source: 'bridge_12' },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });
    const insights = getInsights(wsId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/resolved-page');
    expect(insights).toHaveLength(1);
    resolveInsight(insights[0].id, wsId, 'resolved', 'Fixed manually', 'admin');

    // Re-upsert (simulates second audit run)
    upsertInsight({
      workspaceId: wsId,
      insightType: 'audit_finding',
      pageId: '/resolved-page',
      severity: 'critical',
      data: { scope: 'page', issueCount: 3, issueMessages: 'new-issue-1; new-issue-2; new-issue-3', source: 'bridge_12' },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });

    const after = getInsights(wsId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/resolved-page');
    expect(after).toHaveLength(1);
    // Data refreshed
    expect(after[0].data).toMatchObject({ issueCount: 3 });
    // Resolution preserved
    expect(after[0].resolutionStatus).toBe('resolved');
  });
});
