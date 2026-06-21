/**
 * Unit tests for the SHARED recommendation predicates (audit-resolution launch PR, Lane E).
 *
 * `isActiveRec` + `isCuratedForClient` were consolidated into the single source of truth
 * `shared/recommendation-predicates.ts`; `server/recommendations.ts` re-exports them for back-compat.
 *
 * These assert:
 *   - isActiveRec: terminal status / struck / future-throttle / post-send clientStatus all exclude;
 *     legacy (absent v3 fields) → active.
 *   - isCuratedForClient: sent|approved|discussing → true; declined / system / curated / struck → false.
 *   - the DELIBERATE overlap: a `discussing` rec is BOTH isActiveRec true AND isCuratedForClient true
 *     (the in-code red-line that travelled with the extraction — never assume they are complements).
 *   - single-source identity: server/recommendations.js re-exports the SAME function object as
 *     shared/recommendation-predicates.js (=== identity), proving there is exactly one implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  isActiveRec,
  isCuratedForClient,
} from '../../shared/recommendation-predicates.js';
import {
  isActiveRec as serverIsActiveRec,
  isCuratedForClient as serverIsCuratedForClient,
} from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

// A minimal valid Recommendation; per-test overrides flip the lifecycle/clientStatus axes.
function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const ts = new Date().toISOString();
  return {
    id: 'rec_1',
    workspaceId: 'ws_1',
    priority: 'fix_now',
    type: 'content',
    title: 'Rec',
    description: 'desc',
    insight: 'why',
    impact: 'high',
    effort: 'low',
    impactScore: 60,
    source: 'audit:test',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'gain',
    actionType: 'manual',
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe('isActiveRec — the operator-active (proposable) set', () => {
  it('a legacy rec (no v3 fields) is active', () => {
    expect(isActiveRec(makeRec())).toBe(true);
  });

  it('a curated rec (clientStatus=curated, not yet sent) is still active', () => {
    expect(isActiveRec(makeRec({ clientStatus: 'curated', lifecycle: 'active' }))).toBe(true);
  });

  it('terminal RecStatus excludes (completed / dismissed)', () => {
    expect(isActiveRec(makeRec({ status: 'completed' }))).toBe(false);
    expect(isActiveRec(makeRec({ status: 'dismissed' }))).toBe(false);
  });

  it('a struck rec is not active', () => {
    expect(isActiveRec(makeRec({ lifecycle: 'struck' }))).toBe(false);
  });

  it('a future-throttled rec is not active; a past-throttle auto-resurfaces', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(isActiveRec(makeRec({ lifecycle: 'throttled', throttledUntil: future }))).toBe(false);
    // Past the throttle window → active again (no cron; resurfaces on-read).
    expect(isActiveRec(makeRec({ lifecycle: 'throttled', throttledUntil: past }))).toBe(true);
  });

  it('post-send clientStatus excludes (sent / approved / declined)', () => {
    expect(isActiveRec(makeRec({ clientStatus: 'sent' }))).toBe(false);
    expect(isActiveRec(makeRec({ clientStatus: 'approved' }))).toBe(false);
    expect(isActiveRec(makeRec({ clientStatus: 'declined' }))).toBe(false);
  });

  it('honors an injected `now` for the throttle comparison', () => {
    const t = Date.parse('2026-06-20T00:00:00.000Z');
    const throttledUntil = '2026-06-25T00:00:00.000Z';
    // now BEFORE the throttle end → still throttled (inactive).
    expect(isActiveRec(makeRec({ lifecycle: 'throttled', throttledUntil }), t)).toBe(false);
    // now AFTER the throttle end → active again.
    expect(isActiveRec(makeRec({ lifecycle: 'throttled', throttledUntil }), Date.parse('2026-06-26T00:00:00.000Z'))).toBe(true);
  });
});

describe('isCuratedForClient — the client-seen (curated) set', () => {
  it('sent / approved / discussing → curated for the client', () => {
    expect(isCuratedForClient(makeRec({ clientStatus: 'sent' }))).toBe(true);
    expect(isCuratedForClient(makeRec({ clientStatus: 'approved' }))).toBe(true);
    expect(isCuratedForClient(makeRec({ clientStatus: 'discussing' }))).toBe(true);
  });

  it('declined / system / curated → NOT curated for the client', () => {
    expect(isCuratedForClient(makeRec({ clientStatus: 'declined' }))).toBe(false);
    expect(isCuratedForClient(makeRec({ clientStatus: 'system' }))).toBe(false);
    expect(isCuratedForClient(makeRec({ clientStatus: 'curated' }))).toBe(false);
  });

  it('a legacy rec (no clientStatus) is NOT curated for the client', () => {
    expect(isCuratedForClient(makeRec())).toBe(false);
  });

  it('a struck rec is never curated even if it was sent (the recall affordance)', () => {
    expect(isCuratedForClient(makeRec({ clientStatus: 'sent', lifecycle: 'struck' }))).toBe(false);
  });
});

describe('the deliberate isActiveRec ∩ isCuratedForClient overlap on `discussing`', () => {
  it('a discussing rec is BOTH active for the operator AND curated for the client', () => {
    const rec = makeRec({ clientStatus: 'discussing', lifecycle: 'active' });
    // The red-line: they DELIBERATELY overlap here; never treat them as complements.
    expect(isActiveRec(rec)).toBe(true);
    expect(isCuratedForClient(rec)).toBe(true);
    // Concretely: isActiveRec is NOT the complement of isCuratedForClient on this rec.
    expect(isActiveRec(rec)).not.toBe(!isCuratedForClient(rec));
  });
});

describe('single source of truth — server re-exports the shared predicates (=== identity)', () => {
  it('server/recommendations.isActiveRec IS shared/recommendation-predicates.isActiveRec', () => {
    expect(serverIsActiveRec).toBe(isActiveRec);
  });

  it('server/recommendations.isCuratedForClient IS shared/recommendation-predicates.isCuratedForClient', () => {
    expect(serverIsCuratedForClient).toBe(isCuratedForClient);
  });
});
