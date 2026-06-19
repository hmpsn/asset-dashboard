import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// broadcastToWorkspace throws when called before the WS server's setBroadcast() runs (no server
// boots in this direct-call test). Mock it so the scan's broadcast is a no-op we can also assert on.
const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { runSentRecStalenessScan } from '../../server/recommendation-staleness.js';
import { countActivityByType } from '../../server/activity-log.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

// NOTE: server/feature-flags.ts exposes setWorkspaceFlagOverride(key, workspaceId, enabled)
// (verified before authoring — there is no setFeatureFlagOverride/clearFeatureFlagOverride).
// runSentRecStalenessScan iterates listWorkspaces() and checks the per-workspace flag, so a
// per-workspace override is the correct path to flag the seeded workspace ON.
describe('runSentRecStalenessScan', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace();
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
    const oldSent = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    // NOTE: loadRecommendations() validates each rec against recommendationSchema on READ and
    // DROPS items that fail (Schema vs stored shape rule). updatedAt is REQUIRED in that schema —
    // the plan's example seeds omitted it; a seed without updatedAt silently persists then reads
    // back empty. Verified against server/schemas/workspace-schemas.ts before authoring.
    const recs: Recommendation[] = [{
      id: 'rec-stale-1', type: 'content_refresh', title: 'Old sent rec', description: 'd', insight: 'i',
      impact: 'high', effort: 'low', impactScore: 70, priority: 'fix_now', actionType: 'manual',
      trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', workspaceId: wsId,
      affectedPages: ['/pricing'], source: 'test',
      clientStatus: 'sent', sentAt: oldSent, lifecycle: 'active',
      status: 'pending', createdAt: oldSent, updatedAt: oldSent,
    } as unknown as Recommendation];
    saveRecommendations({ workspaceId: wsId, generatedAt: oldSent, recommendations: recs, summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });
    setWorkspaceFlagOverride('strategy-staleness-scan', wsId, true);
  });

  afterAll(() => {
    setWorkspaceFlagOverride('strategy-staleness-scan', wsId, null);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    cleanup();
  });

  it('writes one rec_nudge_stale activity for the old sent rec and broadcasts', () => {
    const result = runSentRecStalenessScan();
    expect(result.workspacesScanned).toBeGreaterThanOrEqual(1);
    expect(result.nudgesWritten).toBeGreaterThanOrEqual(1);
    expect(countActivityByType(wsId, 'rec_nudge_stale', 30)).toBe(1);
    const bc = broadcastState.calls.find(
      c => c.workspaceId === wsId && c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED,
    );
    expect(bc).toBeDefined();
  });

  it('is idempotent — a second scan within the dedup window writes no new activity', () => {
    runSentRecStalenessScan();
    expect(countActivityByType(wsId, 'rec_nudge_stale', 30)).toBe(1);
  });
});
