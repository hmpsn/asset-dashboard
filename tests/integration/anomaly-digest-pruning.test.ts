/**
 * G2/C1 integration test: anomaly_digest stale-row pruning.
 *
 * Covers the C1 scenarios — the prune must:
 *   1. Run even when a workspace has NO fresh anomalies this cycle (the bug: prune was inside
 *      `if (detected.length > 0)`, so a cleared workspace kept stale rows forever).
 *   2. Run for workspaces that have lost all data connections (the M3 path — `continue` skipped
 *      the prune entirely).
 *   3. NOT delete a still-active anomaly's digest row. An ongoing anomaly is suppressed from
 *      `detected` by alreadyDetected()'s 48h window, so its row is not re-stamped each cycle;
 *      the prune cutoff must lag cycleStart by that window so the row survives (the bug: the
 *      cutoff was `cycleStart`, which deleted the still-active row).
 *
 * This test FAILS against pre-C1-fix code: a no-connection workspace was `continue`d with no
 * prune, so the stale row would NOT be deleted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertAnomalyDigestInsight, getInsight } from '../../server/analytics-insights-store.js';
import { runAnomalyDetection } from '../../server/anomaly-detection.js';
import type { AnomalyDigestData } from '../../shared/types/analytics.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url);

let testWsId = '';

function digestData(anomalyType: string, firstDetected: string): AnomalyDigestData {
  return {
    anomalyType,
    metric: 'clicks',
    currentValue: 100,
    expectedValue: 200,
    deviationPercent: -50,
    durationDays: 3,
    firstDetected,
    severity: 'critical',
  };
}

/** Force a digest row's computed_at to a specific ISO timestamp (simulate an aged row). */
function setComputedAt(workspaceId: string, anomalyType: string, metric: string, iso: string): void {
  const pageId = `anomaly:${anomalyType}:${metric}`;
  db.prepare(
    `UPDATE analytics_insights SET computed_at = ? WHERE workspace_id = ? AND insight_type = 'anomaly_digest' AND page_id = ?`,
  ).run(iso, workspaceId, pageId);
}

beforeAll(async () => {
  await ctx.startServer();
  // A workspace with NO data connections — detection `continue`s past it, exercising the
  // unconditional + M3 prune path.
  const ws = createWorkspace('Anomaly Digest Pruning Test');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('anomaly_digest stale pruning (G2/C1)', () => {
  it('prunes a stale row but preserves a still-active (within-dedup-window) row', async () => {
    const now = Date.now();

    // STALE row: computed_at = 60h ago (older than the 48h dedup window) — anomaly has cleared.
    upsertAnomalyDigestInsight({
      workspaceId: testWsId,
      anomalyType: 'traffic_drop',
      metric: 'clicks',
      data: digestData('traffic_drop', new Date(now - 60 * 3600_000).toISOString()),
      severity: 'critical',
      domain: 'traffic',
      impactScore: 90,
    });
    setComputedAt(testWsId, 'traffic_drop', 'clicks', new Date(now - 60 * 3600_000).toISOString());

    // ACTIVE row: computed_at = 10h ago (WITHIN the 48h window). Represents an ongoing anomaly
    // suppressed from this cycle's `detected` set — it must NOT be pruned.
    upsertAnomalyDigestInsight({
      workspaceId: testWsId,
      anomalyType: 'impressions_drop',
      metric: 'impressions',
      data: digestData('impressions_drop', new Date(now - 30 * 3600_000).toISOString()),
      severity: 'warning',
      domain: 'search',
      impactScore: 60,
    });
    setComputedAt(testWsId, 'impressions_drop', 'impressions', new Date(now - 10 * 3600_000).toISOString());

    // Sanity: both rows present before the cycle.
    expect(getInsight(testWsId, 'anomaly:traffic_drop:clicks', 'anomaly_digest')).toBeDefined();
    expect(getInsight(testWsId, 'anomaly:impressions_drop:impressions', 'anomaly_digest')).toBeDefined();

    // Run a forced detection cycle. testWsId has no data connections, so detection `continue`s
    // past it and the unconditional prune (cutoff = cycleStart − 48h) runs.
    await runAnomalyDetection(true);

    // Stale row pruned (computed_at < cycleStart − 48h).
    expect(
      getInsight(testWsId, 'anomaly:traffic_drop:clicks', 'anomaly_digest'),
      'stale anomaly_digest row should be pruned once its anomaly clears',
    ).toBeUndefined();

    // Active row preserved (computed_at within the dedup window).
    expect(
      getInsight(testWsId, 'anomaly:impressions_drop:impressions', 'anomaly_digest'),
      'a still-active anomaly digest row must NOT be deleted during the dedup window',
    ).toBeDefined();
  }, 60_000);
});
