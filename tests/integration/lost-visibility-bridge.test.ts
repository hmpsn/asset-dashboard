/**
 * Integration tests for the lost-visibility insight bridge (G1 — audit #9).
 *
 * Tests that the bridge-lost-visibility bridge correctly:
 * - Mints a lost_visibility insight from discovered_queries data
 * - Is idempotent (upsert, no duplicate rows)
 * - Respects existing resolution status (does not un-resolve admin work)
 * - Mints an opportunity_event of type 'rank_drop'
 * - Returns { modified: 0 } when there are zero lost-visibility queries
 *
 * Uses seedWorkspace() + cleanup() pattern (no server required — direct module imports).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  getInsight,
  getInsights,
  resolveInsight,
} from '../../server/analytics-insights-store.js';
import {
  upsertDiscoveredQueries,
  detectLostVisibility,
  type DiscoveredQueryObservation,
} from '../../server/client-discovered-queries.js';
import { listActiveOpportunityEvents } from '../../server/opportunity-events.js';
import { runLostVisibilityBridge } from '../../server/bridge-lost-visibility.js';

let ws: ReturnType<typeof seedWorkspace>;

// Helper: seed N lost-visibility rows for the test workspace
function seedLostVisibilityRows(workspaceId: string, count: number): void {
  const baseDate = '2026-05-01';
  const snapshotDate = '2026-06-09';
  const observations: DiscoveredQueryObservation[] = [];
  for (let i = 0; i < count; i++) {
    observations.push({
      query: `test lost query ${i}`,
      position: 5 + i,
      clicks: 10,
      impressions: 200 + i * 50,
      ctr: 0.05,
      seenDate: baseDate,
    });
  }
  upsertDiscoveredQueries(workspaceId, observations, baseDate);
  // Mark them all as lost (14+ days since last_seen, snapshot_count >= 2)
  // We need snapshot_count >= 2 — upsert again with a different date
  const observations2: DiscoveredQueryObservation[] = observations.map(o => ({
    ...o,
    seenDate: baseDate,
  }));
  // second upsert increments snapshot_count
  upsertDiscoveredQueries(workspaceId, observations2, '2026-05-02');
  // Now detectLostVisibility with today > last_seen + 14 days
  detectLostVisibility(workspaceId, snapshotDate);
}

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  ws.cleanup();
});

describe('bridge-lost-visibility', () => {
  it('returns { modified: 0 } when no lost-visibility queries exist', async () => {
    const result = await runLostVisibilityBridge(ws.workspaceId);
    expect(result).toEqual({ modified: 0 });
    const insight = getInsight(ws.workspaceId, null, 'lost_visibility');
    expect(insight).toBeUndefined();
  });

  it('mints a lost_visibility insight with correct fields when queries are lost', async () => {
    seedLostVisibilityRows(ws.workspaceId, 5);

    const result = await runLostVisibilityBridge(ws.workspaceId);
    expect(result.modified).toBe(1);

    const insight = getInsight(ws.workspaceId, null, 'lost_visibility');
    expect(insight).toBeDefined();
    expect(insight!.insightType).toBe('lost_visibility');
    expect(insight!.bridgeSource).toBe('bridge-lost-visibility');
    expect(insight!.domain).toBe('search');

    // lostCount >= 1
    expect(insight!.data.lostCount).toBeGreaterThanOrEqual(1);
    expect(insight!.impactScore).toBeGreaterThan(0);

    // severity: warning when count >= 3
    expect(insight!.severity).toBe('warning');

    // topQueries array present with correct shape
    expect(Array.isArray(insight!.data.topQueries)).toBe(true);
    const firstQuery = insight!.data.topQueries[0];
    expect(firstQuery).toBeDefined();
    expect(typeof firstQuery.query).toBe('string');
    expect(firstQuery.query.length).toBeGreaterThan(0);
    expect(typeof firstQuery.totalImpressions).toBe('number');
    expect(typeof firstQuery.lastSeen).toBe('string');

    // detectedAt is an ISO date string
    expect(typeof insight!.data.detectedAt).toBe('string');
    expect(insight!.data.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('is idempotent — running twice produces exactly one insight row', async () => {
    const result2 = await runLostVisibilityBridge(ws.workspaceId);
    // Upsert: same workspace + same insight_type + same page_id (null) = one row
    expect(result2.modified).toBe(1);

    const all = getInsights(ws.workspaceId, 'lost_visibility');
    expect(all.length).toBe(1);
  });

  it('mints an opportunity_event of type rank_drop with source bridge-lost-visibility', async () => {
    const events = listActiveOpportunityEvents(ws.workspaceId);
    const bridgeEvent = events.find(
      e => e.type === 'rank_drop' && e.source === 'bridge-lost-visibility',
    );
    expect(bridgeEvent).toBeDefined();
    expect(bridgeEvent!.boost).toBeGreaterThan(0);
    expect(bridgeEvent!.halfLifeDays).toBeGreaterThan(0);
  });

  it('respects resolution status — resolved insight is not un-resolved on re-run', async () => {
    const existing = getInsight(ws.workspaceId, null, 'lost_visibility');
    expect(existing).toBeDefined();

    // Admin resolves the insight
    resolveInsight(existing!.id, ws.workspaceId, 'resolved', 'Fixed by admin', 'admin');

    const resolved = getInsight(ws.workspaceId, null, 'lost_visibility');
    expect(resolved!.resolutionStatus).toBe('resolved');

    // Bridge re-runs — must NOT overwrite resolution_status
    await runLostVisibilityBridge(ws.workspaceId);

    const afterBridge = getInsight(ws.workspaceId, null, 'lost_visibility');
    // resolutionStatus is preserved by the upsert (intentionally omitted in ON CONFLICT)
    expect(afterBridge!.resolutionStatus).toBe('resolved');
  });

  it('enrichment field fallback — topQueries query field is always a non-empty string', async () => {
    const insight = getInsight(ws.workspaceId, null, 'lost_visibility');
    expect(insight).toBeDefined();
    for (const q of insight!.data.topQueries) {
      expect(typeof q.query).toBe('string');
      expect(q.query.length).toBeGreaterThan(0);
    }
  });
});
