/**
 * Reconcile A4 — R7-PR1 recommendation blob → rows backfill sweep.
 *
 * Pins the ADDITIVE materializeAllRecommendationItems() sweep:
 *   - blob with N valid + 1 malformed rec → N rows written + 1 dropped entry (NOT zero rows)
 *   - second run writes 0 rows (idempotence via the count>0 guard)
 *   - a workspace that already has rows is left untouched (blob NOT re-read)
 *   - carry-over fidelity: client_status/lifecycle/throttledUntil/sentAt/struckAt
 *     survive byte-for-byte from the blob rec onto the row + payload
 *   - one workspace failing mid-transaction does not prevent the next workspace's backfill
 *
 * The read fallback in loadRecommendationSet stays intact and is NOT exercised as
 * a cutover here — this is the additive backfill half only.
 */
import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  materializeAllRecommendationItems,
  loadRecommendationSet,
} from '../../server/domains/recommendations/storage.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

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

/** Seed a blob-only workspace: a recommendation_sets row with NO recommendation_items rows. */
function seedBlobOnly(
  workspaceId: string,
  recsOrRawArray: Recommendation[] | unknown[],
  summary: Record<string, unknown> = { fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 42, trafficAtRisk: 100 },
): void {
  seededWorkspaceIds.add(workspaceId);
  db.prepare(
    `INSERT INTO recommendation_sets (workspace_id, generated_at, recommendations, summary)
     VALUES (?, ?, ?, ?)`,
  ).run(
    workspaceId,
    '2026-07-01T00:00:00.000Z',
    JSON.stringify(recsOrRawArray),
    JSON.stringify(summary),
  );
}

function countItems(workspaceId: string): number {
  return (db.prepare('SELECT COUNT(*) as cnt FROM recommendation_items WHERE workspace_id = ?').get(workspaceId) as { cnt: number }).cnt;
}

describe('materializeAllRecommendationItems — additive backfill sweep', () => {
  it('writes N rows for N valid recs and reports the 1 malformed rec as dropped (not zero rows)', () => {
    const workspaceId = makeWorkspaceId('ws_backfill_mixed');
    const validA = makeRec(workspaceId, 'rec-valid-a');
    const validB = makeRec(workspaceId, 'rec-valid-b', { priority: 'fix_soon' });
    // Malformed: impactScore is a string, which the schema rejects. Keep a stable id
    // so the dropped entry can be asserted by recId.
    const malformed = { ...makeRec(workspaceId, 'rec-broken'), impactScore: 'not-a-number' };

    seedBlobOnly(workspaceId, [validA, malformed, validB]);

    const result = materializeAllRecommendationItems();

    expect(countItems(workspaceId)).toBe(2);

    const ids = db.prepare(
      'SELECT id FROM recommendation_items WHERE workspace_id = ? ORDER BY rank_order ASC',
    ).all(workspaceId).map((r) => (r as { id: string }).id);
    expect(ids).toEqual(['rec-valid-a', 'rec-valid-b']);

    // This workspace's contribution to the aggregate counts.
    expect(result.rowsWritten).toBeGreaterThanOrEqual(2);
    const dropped = result.dropped.filter(d => d.workspaceId === workspaceId);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].recId).toBe('rec-broken');
    expect(dropped[0].reason).toBeTruthy();
  });

  it('is idempotent: a second sweep writes 0 rows for an already-backfilled workspace (count>0 guard)', () => {
    const workspaceId = makeWorkspaceId('ws_backfill_idempotent');
    seedBlobOnly(workspaceId, [makeRec(workspaceId, 'rec-1'), makeRec(workspaceId, 'rec-2')]);

    materializeAllRecommendationItems();
    expect(countItems(workspaceId)).toBe(2);

    const second = materializeAllRecommendationItems();
    // No rows added on the second pass for this workspace.
    expect(countItems(workspaceId)).toBe(2);
    // The already-populated workspace contributes nothing to blobRecs (skipped before blob read).
    expect(second.dropped.filter(d => d.workspaceId === workspaceId)).toHaveLength(0);
  });

  it('leaves a workspace that already has rows untouched and does not re-read its blob', () => {
    const workspaceId = makeWorkspaceId('ws_backfill_preexisting');
    // Seed the set + one real row, plus a DIVERGENT blob that must NOT be read.
    seedBlobOnly(workspaceId, [{ garbage: true }]);
    db.prepare(
      `INSERT INTO recommendation_items
        (workspace_id, id, rank_order, type, priority, status, source, impact,
         impact_score, client_status, lifecycle, target_keyword, created_at, updated_at, payload)
       VALUES (?, 'pre-existing', 0, 'technical', 'fix_now', 'pending', 'audit:title', 'high',
         42, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(
      workspaceId,
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      JSON.stringify(makeRec(workspaceId, 'pre-existing')),
    );

    const result = materializeAllRecommendationItems();

    // Untouched: still exactly the one pre-existing row, blob never materialized.
    expect(countItems(workspaceId)).toBe(1);
    const row = db.prepare('SELECT id FROM recommendation_items WHERE workspace_id = ?').get(workspaceId) as { id: string };
    expect(row.id).toBe('pre-existing');
    // The divergent/garbage blob was never read, so it produces no dropped entry.
    expect(result.dropped.filter(d => d.workspaceId === workspaceId)).toHaveLength(0);
  });

  it('carries client_status / lifecycle / throttledUntil / sentAt / struckAt byte-for-byte from the blob rec', () => {
    const workspaceId = makeWorkspaceId('ws_backfill_carryover');
    const throttledUntil = '2026-08-01T00:00:00.000Z';
    const sentAt = '2026-07-15T12:34:56.000Z';
    const struckAt = '2026-07-20T09:00:00.000Z';
    const rec = makeRec(workspaceId, 'rec-carry', {
      clientStatus: 'sent',
      lifecycle: 'throttled',
      throttledUntil,
      sentAt,
      struckAt,
    });
    seedBlobOnly(workspaceId, [rec]);

    materializeAllRecommendationItems();

    const row = db.prepare(
      `SELECT client_status, lifecycle, payload FROM recommendation_items
       WHERE workspace_id = ? AND id = 'rec-carry'`,
    ).get(workspaceId) as { client_status: string | null; lifecycle: string | null; payload: string };

    // Column-level carry-over.
    expect(row.client_status).toBe('sent');
    expect(row.lifecycle).toBe('throttled');

    // Payload-level carry-over (throttledUntil/sentAt/struckAt ride in the payload blob).
    const payload = JSON.parse(row.payload) as Recommendation;
    expect(payload.clientStatus).toBe('sent');
    expect(payload.lifecycle).toBe('throttled');
    expect(payload.throttledUntil).toBe(throttledUntil);
    expect(payload.sentAt).toBe(sentAt);
    expect(payload.struckAt).toBe(struckAt);

    // Round-trip through the reader carries them too.
    const loaded = loadRecommendationSet(workspaceId);
    const loadedRec = loaded?.recommendations.find(r => r.id === 'rec-carry');
    expect(loadedRec?.clientStatus).toBe('sent');
    expect(loadedRec?.lifecycle).toBe('throttled');
    expect(loadedRec?.throttledUntil).toBe(throttledUntil);
    expect(loadedRec?.sentAt).toBe(sentAt);
    expect(loadedRec?.struckAt).toBe(struckAt);
  });

  it('one workspace failing mid-transaction does not prevent the next workspace being backfilled', () => {
    // Workspace A: a blob whose recommendations column is corrupt JSON so the read path
    // yields zero valid recs; workspace B is a clean blob that must still materialize.
    const workspaceA = makeWorkspaceId('ws_backfill_fail_a');
    const workspaceB = makeWorkspaceId('ws_backfill_ok_b');

    // A: valid set row but recommendations is unparseable JSON → 0 valid recs, no rows.
    seededWorkspaceIds.add(workspaceA);
    db.prepare(
      `INSERT INTO recommendation_sets (workspace_id, generated_at, recommendations, summary)
       VALUES (?, ?, ?, ?)`,
    ).run(workspaceA, '2026-07-01T00:00:00.000Z', '{"broken"', '{"broken"');

    seedBlobOnly(workspaceB, [makeRec(workspaceB, 'rec-b1'), makeRec(workspaceB, 'rec-b2')]);

    const result = materializeAllRecommendationItems();

    // B is fully materialized regardless of A.
    expect(countItems(workspaceB)).toBe(2);
    expect(result.workspaces).toBeGreaterThanOrEqual(2);
  });

  it('returns aggregate counts across workspaces', () => {
    const workspaceId = makeWorkspaceId('ws_backfill_counts');
    seedBlobOnly(workspaceId, [makeRec(workspaceId, 'rec-x'), makeRec(workspaceId, 'rec-y')]);

    const result = materializeAllRecommendationItems();

    expect(typeof result.workspaces).toBe('number');
    expect(typeof result.blobRecs).toBe('number');
    expect(typeof result.rowsWritten).toBe('number');
    expect(Array.isArray(result.dropped)).toBe(true);
    expect(result.rowsWritten).toBeGreaterThanOrEqual(2);
  });
});
