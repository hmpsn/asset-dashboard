/**
 * Reconcile R4-PR1 — rec↔deliverable divergence sweep (READ-ONLY report).
 *
 * The sweep compares each sent/decided rec's clientStatus against its recommendation:<id> deliverable
 * mirror and REPORTS the pairs that disagree, MUTATING NOTHING. These tests exercise the REAL
 * deliverable store + REAL rec set (not mocks) and assert:
 *   - a hand-seeded divergent pair (rec approved, mirror still awaiting_client) is FLAGGED, and the
 *     mirror row is UNCHANGED after the sweep (no repair, no status write)
 *   - a missing-mirror rec (sent, no deliverable) is flagged missing_mirror
 *   - an in-sync pair (rec approved, mirror approved) is NOT flagged
 *   - a system/curated rec (never sent) with no mirror is NOT flagged (no mirror expected)
 *   - the per-workspace flag gates it: flag-OFF → the workspace is not scanned (no pairs)
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the recommendation adapter the mirror + sweep resolve.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  saveRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { upsertDeliverable, findBySourceRef } from '../../server/client-deliverables.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  runDeliverableDivergenceSweep,
  sweepWorkspaceDivergence,
  classifyDivergence,
} from '../../server/deliverable-divergence-sweep.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { DeliverableStatus } from '../../shared/types/client-deliverable.js';

let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'content',
    title: 'Rec title', description: 'd', insight: 'why this matters', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:content', affectedPages: ['/blog/x'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'Could capture demand', actionType: 'manual',
    targetKeyword: 'widgets', status: 'pending', clientStatus: 'system', lifecycle: 'active',
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function seedRecs(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

/** Seed a recommendation:<id> deliverable mirror at a given status directly through the store. */
function seedMirror(recId: string, status: DeliverableStatus): void {
  upsertDeliverable({
    workspaceId: wsId,
    type: 'recommendation',
    kind: 'decision',
    status,
    title: `Rec ${recId}`,
    summary: 'why this matters',
    payload: { family: 'recommendation', recommendationId: recId },
    source: 'recommendation-mirror',
    sourceRef: `recommendation:${recId}`,
  });
}

beforeAll(() => {
  wsId = createWorkspace('Divergence Sweep Test').id;
  // Flag ON for this workspace so the sweep scans it (dark-launched per-workspace).
  setWorkspaceFlagOverride('strategy-divergence-sweep', wsId, true);
});

afterAll(() => {
  setWorkspaceFlagOverride('strategy-divergence-sweep', wsId, null);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
});

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(wsId);
});

describe('classifyDivergence (pure comparator)', () => {
  it('flags a rec approved while the mirror is still awaiting_client (mirror_behind, path #1)', () => {
    const d = classifyDivergence(wsId, { id: 'r', clientStatus: 'approved' }, { id: 'cd_1', status: 'awaiting_client' });
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('mirror_behind');
    expect(d!.recClientStatus).toBe('approved');
    expect(d!.mirrorStatus).toBe('awaiting_client');
  });

  it('flags a mirror decided while the rec is still sent (rec_behind, path #2)', () => {
    const d = classifyDivergence(wsId, { id: 'r', clientStatus: 'sent' }, { id: 'cd_2', status: 'approved' });
    expect(d!.kind).toBe('rec_behind');
  });

  it('flags a genuine decision conflict (rec approved, mirror declined)', () => {
    const d = classifyDivergence(wsId, { id: 'r', clientStatus: 'approved' }, { id: 'cd_3', status: 'declined' });
    expect(d!.kind).toBe('decision_conflict');
  });

  it('flags a sent/decided rec with NO mirror as missing_mirror', () => {
    const d = classifyDivergence(wsId, { id: 'r', clientStatus: 'sent' }, null);
    expect(d!.kind).toBe('missing_mirror');
    expect(d!.mirrorStatus).toBeNull();
  });

  it('does NOT flag an in-sync pair (rec approved, mirror approved)', () => {
    expect(classifyDivergence(wsId, { id: 'r', clientStatus: 'approved' }, { id: 'cd', status: 'approved' })).toBeNull();
  });

  it('does NOT flag a system/curated rec (never sent → no mirror expected)', () => {
    expect(classifyDivergence(wsId, { id: 'r', clientStatus: 'system' }, null)).toBeNull();
    expect(classifyDivergence(wsId, { id: 'r', clientStatus: 'curated' }, null)).toBeNull();
    expect(classifyDivergence(wsId, { id: 'r', clientStatus: undefined }, null)).toBeNull();
  });
});

describe('sweepWorkspaceDivergence (real store, read-only)', () => {
  it('flags a hand-seeded divergent pair AND leaves the mirror row untouched', () => {
    // rec is approved (client greenlit), but the mirror never advanced past awaiting_client.
    seedRecs([rec({ id: 'rec_div', clientStatus: 'approved' })]);
    seedMirror('rec_div', 'awaiting_client');

    const mirrorBefore = findBySourceRef(wsId, 'recommendation', 'recommendation:rec_div')!;
    expect(mirrorBefore.status).toBe('awaiting_client');
    const updatedAtBefore = mirrorBefore.updatedAt;

    const { divergentPairs, pairsChecked } = sweepWorkspaceDivergence(wsId);

    expect(pairsChecked).toBe(1);
    expect(divergentPairs).toHaveLength(1);
    expect(divergentPairs[0].recId).toBe('rec_div');
    expect(divergentPairs[0].kind).toBe('mirror_behind');
    expect(divergentPairs[0].deliverableId).toBe(mirrorBefore.id);

    // The sweep MUTATES NOTHING — the mirror row is byte-identical after the scan.
    const mirrorAfter = findBySourceRef(wsId, 'recommendation', 'recommendation:rec_div')!;
    expect(mirrorAfter.status).toBe('awaiting_client');
    expect(mirrorAfter.updatedAt).toBe(updatedAtBefore);
  });

  it('flags a sent rec with no mirror as missing_mirror', () => {
    seedRecs([rec({ id: 'rec_nomirror', clientStatus: 'sent', sentAt: new Date().toISOString() })]);
    const { divergentPairs } = sweepWorkspaceDivergence(wsId);
    expect(divergentPairs).toHaveLength(1);
    expect(divergentPairs[0].kind).toBe('missing_mirror');
  });

  it('does NOT flag an in-sync pair', () => {
    seedRecs([rec({ id: 'rec_sync', clientStatus: 'approved' })]);
    seedMirror('rec_sync', 'approved');
    const { divergentPairs, pairsChecked } = sweepWorkspaceDivergence(wsId);
    expect(pairsChecked).toBe(1);
    expect(divergentPairs).toHaveLength(0);
  });

  it('does NOT check a system/curated rec (never sent)', () => {
    seedRecs([rec({ id: 'rec_system', clientStatus: 'system' }), rec({ id: 'rec_curated', clientStatus: 'curated' })]);
    const { divergentPairs, pairsChecked } = sweepWorkspaceDivergence(wsId);
    expect(pairsChecked).toBe(0);
    expect(divergentPairs).toHaveLength(0);
  });
});

describe('runDeliverableDivergenceSweep (flag-gated cron pass)', () => {
  it('scans a flag-ON workspace and reports its divergent pairs', () => {
    seedRecs([rec({ id: 'rec_run', clientStatus: 'approved' })]);
    seedMirror('rec_run', 'awaiting_client');

    const result = runDeliverableDivergenceSweep();
    expect(result.workspacesScanned).toBeGreaterThanOrEqual(1);
    const mine = result.divergentPairs.filter((p) => p.workspaceId === wsId);
    expect(mine).toHaveLength(1);
    expect(mine[0].recId).toBe('rec_run');
  });

  it('flag-OFF → the workspace is not scanned (no pairs from it)', () => {
    seedRecs([rec({ id: 'rec_off', clientStatus: 'approved' })]);
    seedMirror('rec_off', 'awaiting_client');
    setWorkspaceFlagOverride('strategy-divergence-sweep', wsId, null);

    const result = runDeliverableDivergenceSweep();
    const mine = result.divergentPairs.filter((p) => p.workspaceId === wsId);
    expect(mine).toHaveLength(0);

    // Restore the flag for any subsequent test.
    setWorkspaceFlagOverride('strategy-divergence-sweep', wsId, true);
  });
});
