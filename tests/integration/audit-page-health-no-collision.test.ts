/**
 * Audits must not clobber analytics page_health metrics (2026-06-09 audit confirmed #5).
 *
 * reports.ts saveSnapshot Bridge #12 wrote insightType 'page_health' with HARDCODED
 * zero metrics, colliding with analytics-intelligence's real-GSC/GA4 page_health on the
 * same (workspace_id, page_id, 'page_health') key — every audit zeroed real traffic data
 * (which feeds client InsightCards sorting + AI prompts). The fix migrates Bridge #12 to
 * the audit_finding type (its own key space) so the audit's issue data lives alongside,
 * not on top of, the analytics page_health row.
 *
 * Port: none (no HTTP server; saveSnapshot is called directly).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveSnapshot } from '../../server/reports.js';
import { upsertInsight, getInsight, getInsights } from '../../server/analytics-insights-store.js';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import type { SeoAuditResult } from '../../server/seo-audit.js';

let wsId = '';
const SITE_ID = 'site-pagehealth-collision';

beforeAll(() => {
  setBroadcast(() => {}, () => {});
  const ws = createWorkspace('Page Health Collision', SITE_ID);
  wsId = ws.id;
});

afterAll(() => { deleteWorkspace(wsId); });
afterEach(() => {
  db.prepare("DELETE FROM analytics_insights WHERE workspace_id = ?").run(wsId);
});

/** Bridges fire-and-forget via fireBridge(); poll until the audit_finding lands (or timeout). */
async function waitForAuditFinding(workspaceId: string, pageId: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getInsight(workspaceId, pageId, 'audit_finding')) return;
    await new Promise(r => setTimeout(r, 25));
  }
}

function auditWithIssues(pagePath: string): SeoAuditResult {
  return {
    siteScore: 60,
    totalPages: 1,
    errors: 1,
    warnings: 1,
    infos: 0,
    pages: [{
      pageId: 'wf-page-1',
      page: 'Home',
      slug: pagePath.replace(/^\//, ''),
      url: `https://example.com${pagePath}`,
      score: 55,
      issues: [
        { check: 'title-missing', severity: 'error', message: 'Missing title', recommendation: 'Add a title' },
        { check: 'alt-missing', severity: 'warning', message: 'Missing alt text', recommendation: 'Add alt' },
      ],
    }],
    siteWideIssues: [],
  };
}

describe('audit page_health collision', () => {
  it('a saveSnapshot audit does NOT overwrite an analytics page_health row with zero metrics', async () => {
    const PAGE = '/home';
    // Seed an analytics-sourced page_health insight with REAL traffic metrics.
    upsertInsight({
      workspaceId: wsId,
      pageId: PAGE,
      insightType: 'page_health',
      data: {
        score: 82, trend: 'stable', clicks: 340, impressions: 5200, position: 7.4, ctr: 0.065,
        pageviews: 410, bounceRate: 0.38, avgEngagementTime: 55,
      },
      severity: 'positive',
      impactScore: 18,
      domain: 'search',
      pageTitle: 'Home',
    });

    saveSnapshot(SITE_ID, 'Page Health Collision', auditWithIssues(PAGE));
    await waitForAuditFinding(wsId, PAGE);

    const pageHealth = getInsight(wsId, PAGE, 'page_health');
    // The analytics metrics survive — the audit no longer writes a zero-metric page_health.
    expect(pageHealth).toBeTruthy();
    expect(pageHealth!.data.clicks).toBe(340);
    expect(pageHealth!.data.impressions).toBe(5200);
    expect(pageHealth!.data.score).toBe(82);
    // No page_health row was rebased to the audit's zero-metric blob.
    expect(pageHealth!.data.bridgeSource ?? pageHealth!.bridgeSource).not.toBe('bridge-audit-page-health');
  });

  it('the audit instead records its issues as an audit_finding insight for the page', async () => {
    const PAGE = '/home';
    saveSnapshot(SITE_ID, 'Page Health Collision', auditWithIssues(PAGE));
    await waitForAuditFinding(wsId, PAGE);

    const finding = getInsight(wsId, PAGE, 'audit_finding');
    expect(finding).toBeTruthy();
    expect(finding!.data.issueCount).toBe(2);
    expect(finding!.bridgeSource).toBe('bridge-audit-page-health');

    // And no zero-metric page_health row was created by the audit.
    const pageHealthRows = getInsights(wsId).filter(i => i.insightType === 'page_health');
    for (const row of pageHealthRows) {
      expect(row.data.source).not.toBe('bridge_12_audit_page_health');
    }
  });
});
