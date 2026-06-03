/**
 * OV Divergence shadow-logging tests (PR4).
 *
 * Covers:
 *   1. generateRecommendations writes an ov_divergence row — verifies agree/
 *      legacy_top/ov_top correctness on a workspace seeded so legacy and OV
 *      rank differently.
 *   2. recordOvDivergence never throws on degenerate inputs (empty recs, no
 *      opportunity attached, already-completed recs).
 *   3. listOvDivergence is workspace-scoped (rows from wsA don't appear in wsB).
 */

// ── Module-level mocks (hoisted by Vitest) ───────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

// Inject a high-signal CTR opportunity so the OV scorer can produce a score
// materially different from the legacy score for the same rec.
vi.mock('../../server/analytics-insights-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/analytics-insights-store.js')>();
  return {
    ...actual,
    getInsights: (wsId: string, type?: string) => {
      if (type === 'ctr_opportunity') {
        return [{
          id: 'ins_ovd_test_1',
          workspaceId: wsId,
          pageId: '/services/hvac',
          insightType: 'ctr_opportunity',
          severity: 'warning' as const,
          computedAt: new Date().toISOString(),
          data: {
            query: 'hvac services',
            pageUrl: '/services/hvac',
            position: 5.0,
            actualCtr: 0.8,
            expectedCtr: 5.5,
            ctrRatio: 0.15,
            impressions: 4000,
            // Large estimatedClickGap drives a high OV value, so this rec will
            // likely rank differently between legacy and OV scoring.
            estimatedClickGap: 188,
          },
        }];
      }
      return [];
    },
  };
});

// ── Imports (after mock declarations) ────────────────────────────────────────
import { seedWorkspace, seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import { generateRecommendations, saveRecommendations, sortRecommendations, deriveOvTier } from '../../server/recommendations.js';
import { recordOvDivergence, listOvDivergence } from '../../server/ov-divergence.js';
import type { Recommendation, RecPriority } from '../../shared/types/recommendations.js';
import db from '../../server/db/index.js';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<Recommendation> & { id: string }): Recommendation {
  return {
    workspaceId: 'ws_test',
    priority: 'fix_now' as RecPriority,
    type: 'technical',
    title: 'Test rec',
    description: '',
    insight: '',
    impact: 'medium',
    effort: 'low',
    impactScore: 50,
    source: 'audit:title',
    affectedPages: ['/'],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OV Divergence — generateRecommendations writes a row', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const s = seedWorkspace({});
    wsId = s.workspaceId;
    cleanup = s.cleanup;
  });

  afterAll(() => {
    db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(wsId);
    cleanup();
  });

  it('writes at least one ov_divergence row after generateRecommendations', async () => {
    await generateRecommendations(wsId);
    const rows = listOvDivergence(wsId, 10);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('row has expected shape (agree is boolean, computedAt is ISO string)', async () => {
    const rows = listOvDivergence(wsId, 1);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(typeof row.agree).toBe('boolean');
    expect(row.workspaceId).toBe(wsId);
    expect(row.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // legacyTop3 and ovTop3 should be arrays (may be empty for minimal workspace)
    expect(Array.isArray(row.legacyTop3)).toBe(true);
    expect(Array.isArray(row.ovTop3)).toBe(true);
    expect(Array.isArray(row.perRecDelta)).toBe(true);
  });
});

describe('OV Divergence — legacy vs OV rank divergence detection', () => {
  // Each it() gets its own workspace so timestamp ordering is deterministic.

  it('records agree=false when recs would rank differently under legacy vs OV', () => {
    const s = seedWorkspace({});
    try {
      // Construct two recs where legacy ranks A first (higher impactScore) but OV
      // would rank B first (B has higher opportunity.value).
      const recA = makeRec({
        id: 'rec_diverge_A',
        workspaceId: s.workspaceId,
        impactScore: 80,
        opportunity: {
          value: 30, // OV says A is only worth 30
          emvPerWeek: 5,
          predictedEmv: 60,
          roiPerEffortDay: 10,
          confidence: 1.0,
          calibration: 1.0,
          groundedSpine: 'computed',
          components: [],
          calibrationVersion: 'platform-default',
          modelVersion: 'ov-1',
        },
      });
      const recB = makeRec({
        id: 'rec_diverge_B',
        workspaceId: s.workspaceId,
        impactScore: 40,   // legacy ranks B lower
        opportunity: {
          value: 90, // OV says B is worth 90
          emvPerWeek: 50,
          predictedEmv: 600,
          roiPerEffortDay: 80,
          confidence: 1.0,
          calibration: 1.0,
          groundedSpine: 'computed',
          components: [],
          calibrationVersion: 'platform-default',
          modelVersion: 'ov-1',
        },
      });

      // Both recs same priority tier (fix_now) so the secondary comparator (impactScore) decides
      recordOvDivergence(s.workspaceId, [recA, recB], [], sortRecommendations, deriveOvTier);

      const rows = listOvDivergence(s.workspaceId, 5);
      expect(rows.length).toBe(1); // exactly one row for this fresh workspace
      const row = rows[0];

      // Legacy top should be recA (impactScore 80 > 40)
      expect(row.legacyTopRecId).toBe('rec_diverge_A');
      // OV top should be recB (opportunity.value 90 > 30)
      expect(row.ovTopRecId).toBe('rec_diverge_B');
      // Not the same → agree = false
      expect(row.agree).toBe(false);
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });

  it('records agree=true when recs rank identically under legacy and OV', () => {
    const s = seedWorkspace({});
    try {
      const rec1 = makeRec({
        id: 'rec_agree_1',
        workspaceId: s.workspaceId,
        impactScore: 70,
        opportunity: {
          value: 70,
          emvPerWeek: 30,
          predictedEmv: 360,
          roiPerEffortDay: 50,
          confidence: 1.0,
          calibration: 1.0,
          groundedSpine: 'computed',
          components: [],
          calibrationVersion: 'platform-default',
          modelVersion: 'ov-1',
        },
      });
      const rec2 = makeRec({
        id: 'rec_agree_2',
        workspaceId: s.workspaceId,
        impactScore: 40,
        opportunity: {
          value: 40,
          emvPerWeek: 10,
          predictedEmv: 120,
          roiPerEffortDay: 20,
          confidence: 0.5,
          calibration: 1.0,
          groundedSpine: 'computed',
          components: [],
          calibrationVersion: 'platform-default',
          modelVersion: 'ov-1',
        },
      });

      recordOvDivergence(s.workspaceId, [rec1, rec2], [], sortRecommendations, deriveOvTier);

      const rows = listOvDivergence(s.workspaceId, 5);
      expect(rows.length).toBe(1); // exactly one row for this fresh workspace
      expect(rows[0].agree).toBe(true);
      expect(rows[0].legacyTopRecId).toBe('rec_agree_1');
      expect(rows[0].ovTopRecId).toBe('rec_agree_1');
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });
});

describe('OV Divergence — degenerate inputs never throw', () => {
  // Each sub-test uses a fresh workspace to avoid timestamp-collision
  // across rapidly-sequential inserts in the same workspace.

  it('empty recs array does not throw', () => {
    const s = seedWorkspace({});
    try {
      expect(() => recordOvDivergence(s.workspaceId, [], [], sortRecommendations, deriveOvTier)).not.toThrow();
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });

  it('recs with no opportunity attached do not throw', () => {
    const s = seedWorkspace({});
    try {
      const rec = makeRec({ id: 'rec_no_opp', workspaceId: s.workspaceId });
      // Explicitly no opportunity field (it's optional on Recommendation)
      expect(() => recordOvDivergence(s.workspaceId, [rec], [], sortRecommendations, deriveOvTier)).not.toThrow();
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });

  it('all-completed recs produce legacyTopRecId=null and ovTopRecId=null', () => {
    const s = seedWorkspace({});
    try {
      const rec = makeRec({ id: 'rec_completed', workspaceId: s.workspaceId, status: 'completed' });
      recordOvDivergence(s.workspaceId, [rec], [], sortRecommendations, deriveOvTier);
      const rows = listOvDivergence(s.workspaceId, 1);
      expect(rows[0].legacyTopRecId).toBeNull();
      expect(rows[0].ovTopRecId).toBeNull();
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });

  it('invariantHeld ignores auto-resolved (completed) grounded recs — only the ACTIVE set counts', () => {
    const s = seedWorkspace({});
    try {
      const opp = (value: number, confidence: number, spine: 'roiScore' | 'computed') => ({
        value, emvPerWeek: value, predictedEmv: value, roiPerEffortDay: value, confidence, calibration: 1.0,
        groundedSpine: spine, components: [], calibrationVersion: 'platform-default', modelVersion: 'ov-1',
      });
      // A grounded rec auto-resolved THIS generation (completed) + an ACTIVE ungrounded rec.
      const completedGrounded = makeRec({ id: 'rec_done_grounded', workspaceId: s.workspaceId, status: 'completed', opportunity: opp(90, 1.0, 'roiScore') });
      const activeUngrounded = makeRec({ id: 'rec_active_ungrounded', workspaceId: s.workspaceId, status: 'pending', opportunity: opp(20, 0.5, 'computed') });
      recordOvDivergence(s.workspaceId, [completedGrounded, activeUngrounded], [], sortRecommendations, deriveOvTier);
      const rows = listOvDivergence(s.workspaceId, 1);
      // Regression: the completed grounded rec must NOT corrupt the invariant. Only the
      // active set is ungrounded, so the invariant holds (no grounded active rec to beat).
      expect(rows[0].ovTopRecId).toBe('rec_active_ungrounded');
      expect(rows[0].invariantHeld).toBe(true);
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });
});

describe('OV Divergence — workspace isolation', () => {
  let wsA: string;
  let wsB: string;
  let cleanup: () => void;

  beforeAll(() => {
    const pair = seedTwoWorkspaces();
    wsA = pair.wsA.workspaceId;
    wsB = pair.wsB.workspaceId;
    cleanup = pair.cleanup;
  });

  afterAll(() => {
    db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(wsA);
    db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(wsB);
    cleanup();
  });

  it('rows written for wsA do not appear in wsB queries', () => {
    const rec = makeRec({ id: 'rec_ws_a_1', workspaceId: wsA });
    recordOvDivergence(wsA, [rec], [], sortRecommendations, deriveOvTier);

    const bRows = listOvDivergence(wsB, 20);
    for (const r of bRows) {
      expect(r.workspaceId).toBe(wsB);
    }
    // wsB has no rows at all at this point
    expect(bRows.length).toBe(0);
  });

  it('listOvDivergence only returns rows for the requested workspace', () => {
    const recA = makeRec({ id: 'rec_ws_iso_a', workspaceId: wsA });
    const recB = makeRec({ id: 'rec_ws_iso_b', workspaceId: wsB });

    recordOvDivergence(wsA, [recA], [], sortRecommendations, deriveOvTier);
    recordOvDivergence(wsB, [recB], [], sortRecommendations, deriveOvTier);

    const aRows = listOvDivergence(wsA, 20);
    const bRows = listOvDivergence(wsB, 20);

    // All wsA rows must be for wsA
    for (const r of aRows) expect(r.workspaceId).toBe(wsA);
    // All wsB rows must be for wsB
    for (const r of bRows) expect(r.workspaceId).toBe(wsB);

    expect(aRows.length).toBeGreaterThan(0);
    expect(bRows.length).toBeGreaterThan(0);
  });
});
