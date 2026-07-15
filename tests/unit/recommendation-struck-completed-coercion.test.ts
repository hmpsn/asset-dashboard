/**
 * Reconcile C4 — struck≠completed payload safety net at the write choke point.
 *
 * BACKGROUND: recommendation_items is the row-authoritative store. Its `status` and
 * `lifecycle` COLUMNS are derived on write FROM the payload JSON, and reads parse the
 * payload ONLY (itemRowToRecommendation). Migration 168 added a trigger pair that
 * RAISE(ABORT) on lifecycle='struck' AND status='completed', plus a one-time cleanup
 * UPDATE — but that cleanup fixed only the COLUMN, not the payload JSON. So a legacy
 * blob whose payload says {lifecycle:'struck', status:'completed'} would (a) still be
 * SERVED as completed on a struck rec, and (b) ABORT the whole delete-then-reinsert
 * (writeItems) transaction on the next regen/backfill because the reinserted column is
 * re-derived from the stale payload.
 *
 * These tests pin the write-path safety net: saveRecommendationSet / writeItems must
 * COERCE a struck+completed rec to status 'pending' in BOTH the status COLUMN and the
 * stringified payload, and must NOT abort. This is the primary defense (it also guards
 * the A4 backfill path, which calls writeItems).
 */
import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  saveRecommendationSet,
  loadRecommendationSet,
} from '../../server/domains/recommendations/storage.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const seededWorkspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of seededWorkspaceIds) {
    // Cascade removes recommendation_items via trg_recommendation_sets_delete_items.
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(workspaceId);
  }
  seededWorkspaceIds.clear();
});

function makeWorkspaceId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeRec(workspaceId: string, id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = '2026-07-01T00:00:00.000Z';
  return {
    id,
    workspaceId,
    priority: 'fix_now',
    type: 'technical',
    title: `Rec ${id}`,
    description: 'desc',
    insight: 'insight',
    impact: 'high',
    effort: 'low',
    impactScore: 42,
    source: 'audit:title',
    affectedPages: ['/services'],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: '5-10%',
    actionType: 'manual',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSet(workspaceId: string, recs: Recommendation[]): RecommendationSet {
  return {
    workspaceId,
    generatedAt: '2026-07-01T00:00:00.000Z',
    recommendations: recs,
    summary: {
      fixNow: recs.length,
      fixSoon: 0,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 42,
      trafficAtRisk: 100,
      totalOpportunityValue: 0,
      actionableOpportunityValue: 0,
    },
  };
}

function readRow(workspaceId: string, id: string): { status: string; lifecycle: string | null; payload: string } {
  return db.prepare(
    `SELECT status, lifecycle, payload FROM recommendation_items WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, id) as { status: string; lifecycle: string | null; payload: string };
}

describe('saveRecommendationSet — struck≠completed coercion at the write choke point', () => {
  it('coerces a struck+completed rec to pending in BOTH the status column AND the parsed payload, without aborting', () => {
    const workspaceId = makeWorkspaceId('ws_struck_completed');
    const badRec = makeRec(workspaceId, 'rec-struck-done', {
      lifecycle: 'struck',
      status: 'completed',
      struckAt: '2026-07-20T09:00:00.000Z',
    });

    // Must not throw (no trigger ABORT) — the coerce-and-continue safety net.
    expect(() => saveRecommendationSet(makeSet(workspaceId, [badRec]))).not.toThrow();

    const row = readRow(workspaceId, 'rec-struck-done');
    // Column-level coercion.
    expect(row.status).toBe('pending');
    expect(row.lifecycle).toBe('struck');

    // Payload-level coercion — the stale 'completed' must NOT survive in the blob,
    // because reads parse the payload only.
    const payload = JSON.parse(row.payload) as Recommendation;
    expect(payload.status).toBe('pending');
    expect(payload.lifecycle).toBe('struck');
    // Unrelated payload fields are preserved.
    expect(payload.struckAt).toBe('2026-07-20T09:00:00.000Z');

    // Round-trip through the reader (which parses the payload only) sees pending.
    const loaded = loadRecommendationSet(workspaceId);
    const loadedRec = loaded?.recommendations.find(r => r.id === 'rec-struck-done');
    expect(loadedRec?.status).toBe('pending');
    expect(loadedRec?.lifecycle).toBe('struck');
  });

  it('leaves a struck rec with a NON-completed status untouched', () => {
    const workspaceId = makeWorkspaceId('ws_struck_pending');
    const rec = makeRec(workspaceId, 'rec-struck-inprogress', {
      lifecycle: 'struck',
      status: 'in_progress',
    });

    saveRecommendationSet(makeSet(workspaceId, [rec]));

    const row = readRow(workspaceId, 'rec-struck-inprogress');
    expect(row.status).toBe('in_progress');
    expect(row.lifecycle).toBe('struck');
    expect((JSON.parse(row.payload) as Recommendation).status).toBe('in_progress');
  });

  it('leaves a completed rec that is NOT struck untouched (active + completed is legal)', () => {
    const workspaceId = makeWorkspaceId('ws_active_completed');
    const rec = makeRec(workspaceId, 'rec-active-done', {
      lifecycle: 'active',
      status: 'completed',
    });

    saveRecommendationSet(makeSet(workspaceId, [rec]));

    const row = readRow(workspaceId, 'rec-active-done');
    expect(row.status).toBe('completed');
    expect(row.lifecycle).toBe('active');
    expect((JSON.parse(row.payload) as Recommendation).status).toBe('completed');
  });
});
