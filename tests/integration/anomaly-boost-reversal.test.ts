/**
 * Integration test: anomaly boost reversal on dismiss.
 *
 * Verifies the full cycle:
 * 1. Insight created with a known score
 * 2. Anomaly boost applied (+10) via applyScoreAdjustment
 * 3. Anomaly dismissed via HTTP POST
 * 4. Boost reversed — insight score returns to original value
 *
 * Port: 13253
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertInsight, getInsights } from '../../server/analytics-insights-store.js';
import { applyScoreAdjustment } from '../../server/insight-score-adjustments.js';
import type { CtrOpportunityData, ContentDecayData } from '../../shared/types/analytics.js';
import db from '../../server/db/index.js';
import { setFlagOverride } from '../../server/feature-flags.js';

const ctx = createTestContext(13253);
const { postJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  // Enable bridge-anomaly-boost BEFORE server starts so the server's first
  // cache load picks up the flag as true (no 10s cache expiry delay).
  setFlagOverride('bridge-anomaly-boost', true);
  await ctx.startServer();
  const ws = createWorkspace('Anomaly Boost Reversal Test');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  // Clean up test data and restore flag to default
  db.prepare('DELETE FROM anomalies WHERE workspace_id = ?').run(testWsId);
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(testWsId);
  setFlagOverride('bridge-anomaly-boost', null);
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

/**
 * Insert a raw anomaly row into the DB for testing.
 * This bypasses the detection pipeline — we just need a dismissable anomaly.
 */
function insertTestAnomaly(workspaceId: string, id: string, type: string): void {
  db.prepare(`
    INSERT INTO anomalies (id, workspace_id, workspace_name, type, severity,
      title, description, metric, current_value, previous_value, change_pct,
      ai_summary, detected_at, dismissed_at, acknowledged_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workspaceId, 'Test Workspace', type, 'critical',
    'Test anomaly', 'Test description', 'clicks', 100, 200, -50,
    null, new Date().toISOString(), null, null, 'gsc',
  );
}

describe('Anomaly boost reversal on dismiss', () => {
  it('reverses score boost when last anomaly is dismissed', async () => {
    const originalScore = 50;

    // Step 1: Create an insight with a known score
    const insight = upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/boost-reversal',
      insightType: 'page_health',
      data: { score: 72, trend: 'declining' },
      severity: 'warning',
      impactScore: originalScore,
      domain: 'traffic',
    });
    expect(insight.impactScore).toBe(originalScore);

    // Step 2: Apply anomaly boost (+10) — simulates what the bridge does
    const { data: boostedData, adjustedScore } = applyScoreAdjustment(
      insight.data, originalScore, 'anomaly', 10,
    );
    expect(adjustedScore).toBe(originalScore + 10); // 60

    // Persist the boosted score
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/boost-reversal',
      insightType: 'page_health',
      data: boostedData,
      severity: 'warning',
      impactScore: adjustedScore,
      domain: 'traffic',
      anomalyLinked: true,
    });

    // Verify the boost persisted
    const boostedInsights = getInsights(testWsId);
    const boosted = boostedInsights.find(
      i => i.pageId === '/test/boost-reversal' && i.insightType === 'page_health',
    );
    expect(boosted).toBeDefined();
    expect(boosted!.impactScore).toBe(60);
    expect((boosted!.data as Record<string, unknown>)._originalBaseScore).toBe(originalScore);
    expect((boosted!.data as Record<string, unknown>)._scoreAdjustments).toEqual({ anomaly: 10 });

    // Step 3: Insert a test anomaly and dismiss it via HTTP
    const anomalyId = crypto.randomBytes(8).toString('hex');
    insertTestAnomaly(testWsId, anomalyId, 'traffic_drop');

    const res = await postJson(`/api/anomalies/${anomalyId}/dismiss`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dismissed).toBe(true);

    // Step 4: Verify the boost was reversed — score should return to original
    const afterInsights = getInsights(testWsId);
    const reversed = afterInsights.find(
      i => i.pageId === '/test/boost-reversal' && i.insightType === 'page_health',
    );
    expect(reversed).toBeDefined();
    expect(reversed!.impactScore).toBe(originalScore); // Back to 50
    expect(reversed!.anomalyLinked).toBe(false);

    // The 'anomaly' key should be removed from _scoreAdjustments
    const adjAfter = (reversed!.data as Record<string, unknown>)._scoreAdjustments as Record<string, number>;
    expect(adjAfter).toBeDefined();
    expect(adjAfter).not.toHaveProperty('anomaly');
  });

  it('does NOT reverse boost when other active anomalies remain', async () => {
    const originalScore = 40;

    // Create an insight
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/multi-anomaly',
      insightType: 'content_decay',
      data: { decayRate: 0.5 },
      severity: 'warning',
      impactScore: originalScore,
      domain: 'traffic',
    });

    // Apply anomaly boost
    const { data: boostedData, adjustedScore } = applyScoreAdjustment(
      { decayRate: 0.5 } as unknown as ContentDecayData, originalScore, 'anomaly', 10,
    );
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/multi-anomaly',
      insightType: 'content_decay',
      data: boostedData,
      severity: 'warning',
      impactScore: adjustedScore,
      domain: 'traffic',
      anomalyLinked: true,
    });

    // Insert TWO anomalies
    const anomalyId1 = 'multi_' + crypto.randomBytes(6).toString('hex');
    const anomalyId2 = 'multi_' + crypto.randomBytes(6).toString('hex');
    insertTestAnomaly(testWsId, anomalyId1, 'traffic_drop');
    insertTestAnomaly(testWsId, anomalyId2, 'impressions_drop');

    // Dismiss only ONE anomaly
    const res1 = await postJson(`/api/anomalies/${anomalyId1}/dismiss`, {});
    expect(res1.status).toBe(200);

    // Boost should still be present because anomalyId2 is still active
    const afterInsights = getInsights(testWsId);
    const stillBoosted = afterInsights.find(
      i => i.pageId === '/test/multi-anomaly' && i.insightType === 'content_decay',
    );
    expect(stillBoosted).toBeDefined();
    expect(stillBoosted!.impactScore).toBe(originalScore + 10); // Still boosted

    // Now dismiss the second anomaly
    const res2 = await postJson(`/api/anomalies/${anomalyId2}/dismiss`, {});
    expect(res2.status).toBe(200);

    // NOW the boost should be reversed
    const finalInsights = getInsights(testWsId);
    const finalInsight = finalInsights.find(
      i => i.pageId === '/test/multi-anomaly' && i.insightType === 'content_decay',
    );
    expect(finalInsight).toBeDefined();
    expect(finalInsight!.impactScore).toBe(originalScore); // Back to 40
  });

  it('does not affect insights that have no anomaly adjustment', async () => {
    const originalScore = 70;

    // Create an insight WITHOUT any anomaly boost
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/no-boost',
      insightType: 'ranking_opportunity',
      data: { estimatedGain: 500 },
      severity: 'opportunity',
      impactScore: originalScore,
      domain: 'search',
    });

    // Insert and dismiss an anomaly
    const anomalyId = 'nobst_' + crypto.randomBytes(6).toString('hex');
    insertTestAnomaly(testWsId, anomalyId, 'ctr_drop');

    await postJson(`/api/anomalies/${anomalyId}/dismiss`, {});

    // The insight without a boost should be unchanged
    const afterInsights = getInsights(testWsId);
    const unchanged = afterInsights.find(
      i => i.pageId === '/test/no-boost' && i.insightType === 'ranking_opportunity',
    );
    expect(unchanged).toBeDefined();
    expect(unchanged!.impactScore).toBe(originalScore); // Still 70, untouched
  });

  it('does not reverse boosts on resolved insights', async () => {
    // Clean up any anomalies from previous tests that might interfere
    db.prepare('DELETE FROM anomalies WHERE workspace_id = ? AND dismissed_at IS NULL').run(testWsId);

    const originalScore = 55;

    // Create an insight, boost it, then mark it resolved
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/resolved-insight',
      insightType: 'ctr_opportunity',
      data: { impressions: 1000 },
      severity: 'opportunity',
      impactScore: originalScore,
      domain: 'search',
    });

    const { data: boostedData, adjustedScore } = applyScoreAdjustment(
      { impressions: 1000 } as unknown as CtrOpportunityData, originalScore, 'anomaly', 10,
    );
    const boosted = upsertInsight({
      workspaceId: testWsId,
      pageId: '/test/resolved-insight',
      insightType: 'ctr_opportunity',
      data: boostedData,
      severity: 'opportunity',
      impactScore: adjustedScore,
      domain: 'search',
      anomalyLinked: true,
    });

    // Mark it resolved via direct DB update (resolveInsight requires the insight id)
    db.prepare('UPDATE analytics_insights SET resolution_status = ? WHERE id = ?')
      .run('resolved', boosted.id);

    // Insert and dismiss an anomaly
    const anomalyId = 'resol_' + crypto.randomBytes(6).toString('hex');
    insertTestAnomaly(testWsId, anomalyId, 'traffic_drop');

    await postJson(`/api/anomalies/${anomalyId}/dismiss`, {});

    // Resolved insight should NOT have its boost reversed
    const afterInsights = getInsights(testWsId);
    const resolvedInsight = afterInsights.find(
      i => i.pageId === '/test/resolved-insight' && i.insightType === 'ctr_opportunity',
    );
    expect(resolvedInsight).toBeDefined();
    // Score should still be boosted because resolved insights are skipped
    expect(resolvedInsight!.impactScore).toBe(adjustedScore); // Still 65
  });
});
