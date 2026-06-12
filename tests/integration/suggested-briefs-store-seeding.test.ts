/**
 * Integration test: /api/content-briefs/:workspaceId/suggested store-seeding.
 *
 * When the /suggested route is called with ranking_opportunity insights in the DB,
 * it seeds the suggested_briefs store (SHA dedup prevents duplicate rows).
 * The store's accept/dismiss lifecycle still works after seeding.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, patchJson } = ctx;

let testWsId = '';

function seedInsight(overrides: Partial<{
  id: string;
  workspace_id: string;
  insight_type: string;
  page_id: string | null;
  page_title: string | null;
  impact_score: number;
  severity: string;
  pipeline_status: string | null;
  strategy_alignment: string | null;
  strategy_keyword: string | null;
  data: string;
  computed_at: string;
}> = {}): string {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO analytics_insights
      (id, workspace_id, insight_type, page_id, page_title, impact_score, severity,
       pipeline_status, strategy_alignment, strategy_keyword, data, computed_at)
    VALUES
      (@id, @workspace_id, @insight_type, @page_id, @page_title, @impact_score, @severity,
       @pipeline_status, @strategy_alignment, @strategy_keyword, @data, @computed_at)
  `).run({
    id,
    workspace_id: overrides.workspace_id ?? testWsId,
    insight_type: overrides.insight_type ?? 'ranking_opportunity',
    page_id: overrides.page_id ?? '/services/test',
    page_title: overrides.page_title ?? 'Test page',
    impact_score: overrides.impact_score ?? 80,
    severity: overrides.severity ?? 'opportunity',
    pipeline_status: overrides.pipeline_status ?? null,
    strategy_alignment: overrides.strategy_alignment ?? null,
    strategy_keyword: overrides.strategy_keyword ?? null,
    data: overrides.data ?? JSON.stringify({ query: 'seo tools test', currentPosition: 12, impressions: 3000 }),
    computed_at: overrides.computed_at ?? new Date().toISOString(),
  });
  return id;
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Store Seeding Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(testWsId);
  db.prepare('DELETE FROM suggested_briefs WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('GET /api/content-briefs/:workspaceId/suggested — store seeding', () => {
  it('returns signals array response (backward-compat shape)', async () => {
    const res = await api(`/api/content-briefs/${testWsId}/suggested`);
    expect(res.status).toBe(200);
    const body = await res.json() as { signals: unknown[] };
    expect(body).toHaveProperty('signals');
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('calling /suggested with a ranking_opportunity insight seeds the store', async () => {
    const insightId = seedInsight({ insight_type: 'ranking_opportunity', impact_score: 80 });
    try {
      // Trigger seeding
      const seedRes = await api(`/api/content-briefs/${testWsId}/suggested`);
      expect(seedRes.status).toBe(200);

      // Store should now have a pending brief for this workspace
      const listRes = await api(`/api/suggested-briefs/${testWsId}`);
      expect(listRes.status).toBe(200);
      const briefs = await listRes.json() as Array<{ keyword: string; source: string; status: string }>;
      const seeded = briefs.find(b => b.source === 'ranking_opportunity');
      expect(seeded).toBeDefined();
      expect(seeded?.status).toBe('pending');
    } finally {
      db.prepare('DELETE FROM analytics_insights WHERE id = ?').run(insightId);
      db.prepare('DELETE FROM suggested_briefs WHERE workspace_id = ? AND source = ?').run(testWsId, 'ranking_opportunity');
    }
  });

  it('repeated /suggested calls do not create duplicate store entries (SHA dedup)', async () => {
    const insightId = seedInsight({ insight_type: 'ranking_opportunity', impact_score: 80 });
    try {
      await api(`/api/content-briefs/${testWsId}/suggested`);
      await api(`/api/content-briefs/${testWsId}/suggested`);

      const listRes = await api(`/api/suggested-briefs/${testWsId}`);
      const briefs = await listRes.json() as Array<{ source: string }>;
      const rankingBriefs = briefs.filter(b => b.source === 'ranking_opportunity');
      // Only one entry despite two seeding calls (dedup by keyword hash)
      expect(rankingBriefs.length).toBe(1);
    } finally {
      db.prepare('DELETE FROM analytics_insights WHERE id = ?').run(insightId);
      db.prepare('DELETE FROM suggested_briefs WHERE workspace_id = ? AND source = ?').run(testWsId, 'ranking_opportunity');
    }
  });
});

describe('Accept lifecycle: PATCH accepted removes brief from default list', () => {
  it('accepting a brief via PATCH marks it accepted and hides it from the default list', async () => {
    const briefId = randomUUID();
    db.prepare(`
      INSERT INTO suggested_briefs
        (id, workspace_id, keyword, page_url, source, reason, priority, status,
         created_at, resolved_at, snoozed_until, dismissed_keyword_hash)
      VALUES
        (@id, @workspace_id, @keyword, NULL, 'ranking_opportunity', 'Test reason', 'high', 'pending',
         @created_at, NULL, NULL, @dismissed_keyword_hash)
    `).run({
      id: briefId,
      workspace_id: testWsId,
      keyword: 'accept-lifecycle-keyword',
      created_at: new Date().toISOString(),
      dismissed_keyword_hash: 'abc123def4567890', // fake hash — dedup test not goal here
    });

    try {
      // Accept it
      const acceptRes = await patchJson(`/api/suggested-briefs/${testWsId}/${briefId}`, { status: 'accepted' });
      expect(acceptRes.status).toBe(200);
      const accepted = await acceptRes.json() as { status: string; resolvedAt: string };
      expect(accepted.status).toBe('accepted');
      expect(accepted.resolvedAt).toBeTruthy();

      // Default list (no ?all) should NOT include accepted briefs
      const listRes = await api(`/api/suggested-briefs/${testWsId}`);
      const briefs = await listRes.json() as Array<{ id: string }>;
      expect(briefs.find(b => b.id === briefId)).toBeUndefined();
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });
});
