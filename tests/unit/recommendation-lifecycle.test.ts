/**
 * Strategy v3 Phase 1 — lifecycle foundation unit tests.
 * isActiveRec is the ONE active-set predicate (00-contracts §2 / spec §6.4).
 */
import { describe, it, expect } from 'vitest';
import { isActiveRec, isExemptFromAutoResolve } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: 'ws1', priority: 'fix_now', type: 'metadata',
    title: 't', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 's', affectedPages: [], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

describe('isActiveRec', () => {
  it('treats a legacy rec (no v3 fields) as active', () => {
    expect(isActiveRec(rec())).toBe(true);
  });
  it('excludes completed and dismissed (RecStatus terminal)', () => {
    expect(isActiveRec(rec({ status: 'completed' }))).toBe(false);
    expect(isActiveRec(rec({ status: 'dismissed' }))).toBe(false);
  });
  it('excludes struck recs', () => {
    expect(isActiveRec(rec({ lifecycle: 'struck' }))).toBe(false);
  });
  it('excludes throttled recs whose throttledUntil is in the future', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isActiveRec(rec({ lifecycle: 'throttled', throttledUntil: future }))).toBe(false);
  });
  it('re-includes a throttled rec once throttledUntil has passed (on-read resurface)', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isActiveRec(rec({ lifecycle: 'throttled', throttledUntil: past }))).toBe(true);
  });
  it('excludes sent / approved / declined (client already received/resolved)', () => {
    expect(isActiveRec(rec({ clientStatus: 'sent' }))).toBe(false);
    expect(isActiveRec(rec({ clientStatus: 'approved' }))).toBe(false);
    expect(isActiveRec(rec({ clientStatus: 'declined' }))).toBe(false);
  });
  it('includes curated and discussing (still in the active operator/loop set)', () => {
    expect(isActiveRec(rec({ clientStatus: 'curated' }))).toBe(true);
    expect(isActiveRec(rec({ clientStatus: 'discussing' }))).toBe(true);
  });
});

describe('auto-resolve exemption (clientStatus in {sent,discussing,approved} OR lifecycle in {struck,throttled})', () => {
  it('exempts a sent rec from the destructive auto-resolve → completed sweep', () => {
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'sent' }))).toBe(true);
  });
  it('exempts discussing + approved recs', () => {
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'discussing' }))).toBe(true);
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'approved' }))).toBe(true);
  });
  it('exempts struck + throttled recs (else unstrike/throttle reversibility breaks: a swept→completed rec stays dead)', () => {
    expect(isExemptFromAutoResolve(rec({ lifecycle: 'struck' }))).toBe(true);
    expect(isExemptFromAutoResolve(rec({ lifecycle: 'throttled' }))).toBe(true);
  });
  it('does NOT exempt system / curated / declined recs (they may auto-resolve normally)', () => {
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'system' }))).toBe(false);
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'curated' }))).toBe(false);
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'declined' }))).toBe(false);
    expect(isExemptFromAutoResolve(rec())).toBe(false); // legacy / no v3 field
  });
});
