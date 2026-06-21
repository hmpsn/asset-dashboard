// tests/unit/rec-operator-overrides.test.ts
//
// The Issue — operator-steering store (server/rec-operator-overrides.ts).
//
// Unit-level coverage of the rec_operator_override CRUD that backs the three curation verbs
// (correct wording / reorder / add-a-rec). The store is the trust substrate: overrides are
// keyed on rec_id, applied ONLY at display boundaries, and NEVER baked into the
// recommendation_sets blob. This file asserts the store's own contract:
//
//   • setWordingOverride → getOperatorOverrides round-trips title/insight.
//   • Clearing a field (empty/absent) drops it; an all-NULL row is deleted entirely
//     (so a cleared override restores the source wording — no orphan row).
//   • Length caps (REC_WORDING_TITLE_MAX / REC_WORDING_INSIGHT_MAX) are enforced.
//   • setSortOrders assigns 0..n-1 to the listed recIds and CLEARS stale sort_order on a
//     rec dropped from the running order.
//   • applyWordingOverrides returns CLONES (mutating the result never mutates the input rec —
//     loadRecommendations stays pure) and overrides ONLY the present fields.
//
// Pattern: in-process DB (same DATA_DIR), seedWorkspace for the FK parent, full cleanup.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  getOperatorOverrides,
  setWordingOverride,
  setSortOrders,
  applyWordingOverrides,
  getSortOrderMap,
  RecWordingOverrideError,
} from '../../server/rec-operator-overrides.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import {
  REC_WORDING_TITLE_MAX,
  REC_WORDING_INSIGHT_MAX,
} from '../../shared/types/rec-operator-steering.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

let seeded: SeededFullWorkspace;
let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: 'Source title', description: 'd', insight: 'Source insight', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:title', affectedPages: ['home'], trafficAtRisk: 10,
    impressionsAtRisk: 100, estimatedGain: 'Could lift organic clicks', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function rowCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM rec_operator_override WHERE workspace_id = ?')
    .get(wsId) as { n: number }).n;
}

beforeEach(() => {
  seeded = seedWorkspace();
  wsId = seeded.workspaceId;
});

afterEach(() => {
  db.prepare('DELETE FROM rec_operator_override WHERE workspace_id = ?').run(wsId);
  seeded.cleanup();
});

describe('rec_operator_override store — wording', () => {
  it('setWordingOverride then getOperatorOverrides round-trips title + insight', () => {
    setWordingOverride(wsId, 'r1', { title: 'Corrected title', insight: 'Corrected insight' });
    const { wording } = getOperatorOverrides(wsId);
    expect(wording.get('r1')).toEqual({ title: 'Corrected title', insight: 'Corrected insight' });
  });

  it('overriding only title leaves insight absent (overrides only the present field)', () => {
    setWordingOverride(wsId, 'r1', { title: 'Only title' });
    const { wording } = getOperatorOverrides(wsId);
    const entry = wording.get('r1');
    expect(entry?.title).toBe('Only title');
    expect(entry?.insight).toBeUndefined();
  });

  it('MERGE — a partial payload updates only its fields; an ABSENT field is preserved', () => {
    // title and insight are independent overrides (the inline editor commits each separately on blur),
    // so a partial {title} call updates title and LEAVES insight unchanged. This matters for regen:
    // editing the title must never freeze a stale source-insight copy that would later mask a
    // freshly-regenerated insight.
    setWordingOverride(wsId, 'r1', { title: 'T', insight: 'I' });
    setWordingOverride(wsId, 'r1', { title: 'T2' }); // insight absent → preserved
    const { wording } = getOperatorOverrides(wsId);
    const entry = wording.get('r1');
    expect(entry).toBeDefined();
    expect(entry?.title).toBe('T2');
    expect(entry?.insight).toBe('I'); // PRESERVED, not cleared
    expect(rowCount()).toBe(1);
  });

  it('a blank field clears ONLY that field; the row survives while the other field remains', () => {
    // {title:''} clears title; insight (absent) is preserved → the row stays alive on its insight.
    setWordingOverride(wsId, 'r1', { title: 'T', insight: 'I' });
    expect(rowCount()).toBe(1);
    setWordingOverride(wsId, 'r1', { title: '' });
    expect(rowCount()).toBe(1);
    const entry = getOperatorOverrides(wsId).wording.get('r1');
    expect(entry?.title).toBeUndefined();
    expect(entry?.insight).toBe('I');
  });

  it('keeps a row alive when a full payload sets one field and blanks the other', () => {
    setWordingOverride(wsId, 'r1', { title: '', insight: 'I' }); // title cleared, insight set
    const { wording } = getOperatorOverrides(wsId);
    const entry = wording.get('r1');
    expect(entry).toBeDefined();
    expect(entry?.title).toBeUndefined();
    expect(entry?.insight).toBe('I');
    expect(rowCount()).toBe(1);
  });

  it('clearing BOTH fields deletes the all-NULL row entirely (restores source wording)', () => {
    setWordingOverride(wsId, 'r1', { title: 'T', insight: 'I' });
    expect(rowCount()).toBe(1);
    setWordingOverride(wsId, 'r1', { title: '', insight: '' });
    expect(rowCount()).toBe(0);
    const { wording } = getOperatorOverrides(wsId);
    expect(wording.get('r1')).toBeUndefined();
  });

  it('rejects an over-cap title with RecWordingOverrideError and persists no row', () => {
    const overlong = 'x'.repeat(REC_WORDING_TITLE_MAX + 50);
    // The store enforces caps by REJECTION (throw), never truncation — the route maps it to a 400.
    expect(() => setWordingOverride(wsId, 'r1', { title: overlong })).toThrow(RecWordingOverrideError);
    expect(rowCount()).toBe(0);
    expect(getOperatorOverrides(wsId).wording.get('r1')).toBeUndefined();
  });

  it('rejects an over-cap insight with RecWordingOverrideError and persists no row', () => {
    const overlong = 'y'.repeat(REC_WORDING_INSIGHT_MAX + 50);
    expect(() => setWordingOverride(wsId, 'r1', { insight: overlong })).toThrow(RecWordingOverrideError);
    expect(rowCount()).toBe(0);
    expect(getOperatorOverrides(wsId).wording.get('r1')).toBeUndefined();
  });
});

describe('rec_operator_override store — sort order', () => {
  it('setSortOrders assigns 0..n-1 in the given order', () => {
    setSortOrders(wsId, ['a', 'b', 'c']);
    const map = getSortOrderMap(wsId);
    expect(map.get('a')).toBe(0);
    expect(map.get('b')).toBe(1);
    expect(map.get('c')).toBe(2);
    const { sortOrder } = getOperatorOverrides(wsId);
    expect(sortOrder.get('a')).toBe(0);
    expect(sortOrder.get('c')).toBe(2);
  });

  it('a rec dropped from the running order has its stale sort_order cleared', () => {
    setSortOrders(wsId, ['a', 'b', 'c']);
    expect(getSortOrderMap(wsId).get('c')).toBe(2);
    // Re-order without 'c' — its stale order must be dropped, not stranded at 2.
    setSortOrders(wsId, ['b', 'a']);
    const map = getSortOrderMap(wsId);
    expect(map.get('b')).toBe(0);
    expect(map.get('a')).toBe(1);
    expect(map.get('c')).toBeUndefined();
  });

  it('preserves a wording override on a row that is also reordered', () => {
    setWordingOverride(wsId, 'a', { title: 'Keep me' });
    setSortOrders(wsId, ['a', 'b']);
    expect(getOperatorOverrides(wsId).wording.get('a')?.title).toBe('Keep me');
    expect(getSortOrderMap(wsId).get('a')).toBe(0);
  });
});

describe('applyWordingOverrides — display-only, returns clones', () => {
  it('overrides title/insight where present and leaves un-overridden recs untouched', () => {
    setWordingOverride(wsId, 'r1', { title: 'Corrected title' });
    const input = [rec({ id: 'r1' }), rec({ id: 'r2', title: 'Other' })];
    const out = applyWordingOverrides(wsId, input);
    const r1 = out.find(r => r.id === 'r1')!;
    const r2 = out.find(r => r.id === 'r2')!;
    expect(r1.title).toBe('Corrected title');
    expect(r1.insight).toBe('Source insight'); // insight not overridden → source preserved
    expect(r2.title).toBe('Other'); // no override → unchanged
  });

  it('returns CLONES — mutating the result never mutates the input rec (loadRecommendations stays pure)', () => {
    setWordingOverride(wsId, 'r1', { title: 'Corrected title', insight: 'Corrected insight' });
    const original = rec({ id: 'r1' });
    const input = [original];
    const out = applyWordingOverrides(wsId, input);
    // The clone carries the override; the SOURCE rec object is untouched.
    expect(out[0].title).toBe('Corrected title');
    expect(original.title).toBe('Source title');
    expect(original.insight).toBe('Source insight');
    expect(out[0]).not.toBe(original);
    // Mutating the returned clone must not write back into the input.
    out[0].title = 'Mutated';
    expect(original.title).toBe('Source title');
  });

  it('with no overrides, returns recs whose wording equals the source (no-op pass)', () => {
    const input = [rec({ id: 'r1' })];
    const out = applyWordingOverrides(wsId, input);
    expect(out[0].title).toBe('Source title');
    expect(out[0].insight).toBe('Source insight');
  });
});
