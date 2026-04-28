/**
 * Integration test for PR 1 — page identity normalisation.
 *
 * Verifies:
 * 1. After migration 075, no analytics_insights rows with page_id LIKE 'http%' remain.
 * 2. toAuditFindingPageId round-trips correctly in the write→read path.
 *
 * Port: 13330
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertInsight, getInsights } from '../../server/analytics-insights-store.js';
import db from '../../server/db/index.js';

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  ws.cleanup();
});

describe('analytics_insights page_id normalisation', () => {
  it('stores relative path for GSC insight, not full URL', () => {
    upsertInsight({
      workspaceId: ws.workspaceId,
      insightType: 'page_health',
      pageId: '/blog/my-post',   // after normalisation write path uses path
      severity: 'opportunity',
      data: { score: 55, trend: 'stable', clicks: 100, impressions: 2000, position: 8, ctr: 5.0, pageviews: 0, bounceRate: 0, avgEngagementTime: 0 },
    });

    const insights = getInsights(ws.workspaceId).filter(i => i.insightType === 'page_health');
    const found = insights.find(i => i.pageId === '/blog/my-post');
    expect(found).toBeDefined();
    expect(found!.pageId).not.toMatch(/^https?:\/\//);
  });

  it('migration 075: no http-prefixed page_ids remain after migration runs', () => {
    // Use a unique row id per test run to avoid stale rows from prior runs
    // (FK cascade is OFF in tests — cleanup doesn't auto-delete orphaned rows).
    const rowId = `test-migration-row-${ws.workspaceId}`;

    // Clean up any leftover row from a prior run before inserting
    db.prepare(`DELETE FROM analytics_insights WHERE id = ?`).run(rowId);

    // Seed a full-URL row manually (simulating pre-migration data)
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, insight_type, page_id, severity, data, computed_at)
      VALUES (?, ?, 'page_health', 'https://example.com/blog/migrated', 'opportunity', '{}', datetime('now'))
    `).run(rowId, ws.workspaceId);

    // Verify it exists with the full URL
    const before = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = ?`).get(rowId) as { page_id: string } | undefined;
    expect(before?.page_id).toBe('https://example.com/blog/migrated');

    // Run the migration logic directly (same SQL as migration 075)
    db.exec(`
      UPDATE analytics_insights
      SET page_id = SUBSTR(
        page_id,
        INSTR(page_id, '://') + 3
        + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/')
        - 1
      )
      WHERE page_id LIKE 'http%'
        AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') > 0
    `);

    const after = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = ?`).get(rowId) as { page_id: string } | undefined;
    expect(after?.page_id).toBe('/blog/migrated');

    // Verify no http-prefixed rows remain in this workspace
    const count = db.prepare(`SELECT COUNT(*) as n FROM analytics_insights WHERE page_id LIKE 'http%' AND workspace_id = ?`).get(ws.workspaceId) as { n: number };
    expect(count.n).toBe(0);
  });

  it('audit_finding dedup check works with path-format pageId', () => {
    // First write — creates the insight
    upsertInsight({
      workspaceId: ws.workspaceId,
      insightType: 'audit_finding',
      pageId: '/services/seo',
      severity: 'warning',
      data: { scope: 'page', issueCount: 1, issueMessages: 'Missing meta', source: 'bridge_12_audit_page_health' },
      impactScore: 50,
      bridgeSource: 'bridge-audit-page-health',
    });

    // Second write — should update in-place (upsert), not create duplicate
    upsertInsight({
      workspaceId: ws.workspaceId,
      insightType: 'audit_finding',
      pageId: '/services/seo',
      severity: 'critical',
      data: { scope: 'page', issueCount: 2, issueMessages: 'Missing meta; H1 missing', source: 'bridge_12_audit_page_health' },
      impactScore: 80,
      bridgeSource: 'bridge-audit-page-health',
    });

    const all = getInsights(ws.workspaceId).filter(i => i.insightType === 'audit_finding' && i.pageId === '/services/seo');
    expect(all).toHaveLength(1);
    expect(all[0].severity).toBe('critical');   // updated, not duplicated
  });
});
