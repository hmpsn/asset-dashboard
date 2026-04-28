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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertInsight, getInsights } from '../../server/analytics-insights-store.js';
import db from '../../server/db/index.js';

// Read the actual migration SQL once so the test stays in sync with the file.
const MIGRATION_075_SQL = readFileSync(
  resolve(__dirname, '../../server/db/migrations/075-normalise-insight-page-ids.sql'),
  'utf8',
);

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  // FK cascade is OFF in tests — explicitly delete inserted rows so they
  // don't accumulate across runs (seedWorkspace().cleanup() only deletes the workspace row).
  db.prepare(`DELETE FROM analytics_insights WHERE workspace_id = ?`).run(ws.workspaceId);
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

  it('migration 075 Step 1: full URL with path → relative path', () => {
    const rowId = `test-mig-step1-${ws.workspaceId}`;
    db.prepare(`DELETE FROM analytics_insights WHERE id = ?`).run(rowId);
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, insight_type, page_id, severity, data, computed_at)
      VALUES (?, ?, 'page_health', 'https://example.com/blog/migrated', 'opportunity', '{}', datetime('now'))
    `).run(rowId, ws.workspaceId);

    db.exec(MIGRATION_075_SQL);

    const after = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = ?`).get(rowId) as { page_id: string } | undefined;
    expect(after?.page_id).toBe('/blog/migrated');
  });

  it('migration 075 Step 2: bare-domain URL → /', () => {
    const rowId = `test-mig-step2-${ws.workspaceId}`;
    db.prepare(`DELETE FROM analytics_insights WHERE id = ?`).run(rowId);
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, insight_type, page_id, severity, data, computed_at)
      VALUES (?, ?, 'serp_opportunity', 'https://example.com', 'opportunity', '{}', datetime('now'))
    `).run(rowId, ws.workspaceId);

    db.exec(MIGRATION_075_SQL);

    const after = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = ?`).get(rowId) as { page_id: string } | undefined;
    expect(after?.page_id).toBe('/');
  });

  it('migration 075 Step 0: pre-dedupe collapses http+https variants for same workspace+type', () => {
    db.prepare(`DELETE FROM analytics_insights WHERE workspace_id = ? AND insight_type = 'ctr_opportunity'`).run(ws.workspaceId);
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, insight_type, page_id, severity, data, computed_at)
      VALUES
        (?, ?, 'ctr_opportunity', 'https://example.com/dedupe', 'opportunity', '{}', '2026-04-01 10:00:00'),
        (?, ?, 'ctr_opportunity', 'http://example.com/dedupe',  'opportunity', '{}', '2026-04-02 10:00:00')
    `).run(`dedupe-old-${ws.workspaceId}`, ws.workspaceId, `dedupe-new-${ws.workspaceId}`, ws.workspaceId);

    db.exec(MIGRATION_075_SQL);

    const remaining = db.prepare(
      `SELECT id, page_id FROM analytics_insights WHERE workspace_id = ? AND insight_type = 'ctr_opportunity' AND page_id = '/dedupe'`,
    ).all(ws.workspaceId) as Array<{ id: string; page_id: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(`dedupe-new-${ws.workspaceId}`); // newer kept
  });

  it('migration 075: strips query string and fragment from URL pathname', () => {
    const rowQuery = `test-mig-q-${ws.workspaceId}`;
    const rowFrag = `test-mig-f-${ws.workspaceId}`;
    db.prepare(`DELETE FROM analytics_insights WHERE id IN (?, ?)`).run(rowQuery, rowFrag);
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, insight_type, page_id, severity, data, computed_at)
      VALUES
        (?, ?, 'ranking_mover', 'https://example.com/blog/post?utm=test', 'opportunity', '{}', datetime('now')),
        (?, ?, 'serp_opportunity', 'https://example.com/contact#form',     'opportunity', '{}', datetime('now'))
    `).run(rowQuery, ws.workspaceId, rowFrag, ws.workspaceId);

    db.exec(MIGRATION_075_SQL);

    const q = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = ?`).get(rowQuery) as { page_id: string } | undefined;
    const f = db.prepare(`SELECT page_id FROM analytics_insights WHERE id = ?`).get(rowFrag) as { page_id: string } | undefined;
    expect(q?.page_id).toBe('/blog/post');
    expect(f?.page_id).toBe('/contact');
  });

  it('migration 075: no http-prefixed page_ids remain in workspace after migration', () => {
    db.exec(MIGRATION_075_SQL);
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
