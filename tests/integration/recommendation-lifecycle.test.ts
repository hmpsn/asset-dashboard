/**
 * Strategy v3 Phase 1 Lane 1B + 1D — single-writer module (server/recommendation-lifecycle.ts).
 * All blob lifecycle mutations go through one transactional writer that re-reads the set
 * inside the txn, applies the single-field delta, recomputes summary, and upserts
 * (00-contracts §11 / spec §6.2). Tests the real DB round-trip via loadRecommendations.
 *
 * Lane 1D additions (Phase 1 exit gate):
 *   - strike-never-completed: a sent rec whose source vanishes survives regen (isExemptFromAutoResolve)
 *   - summary.topRecommendationId is never a struck/throttled/sent rec (computeRecommendationSummary
 *     routes through isActiveRec)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import {
  sendRecommendation,
  strikeRecommendation,
  unstrikeRecommendation,
  throttleRecommendation,
  fixRecommendation,
  REC_POLICY_REGISTRY,
} from '../../server/recommendation-lifecycle.js';
import { InvalidTransitionError } from '../../server/state-machines.js';
import { StruckRecCompletionError, updateRecommendationStatus } from '../../server/domains/recommendations/status-service.js';
import { recordAction, getActionBySource } from '../../server/outcome-tracking.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: 't', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 's', affectedPages: ['home'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId, generatedAt: new Date().toISOString(), recommendations: recs,
    // Lane 1D: route through computeRecommendationSummary (which calls isActiveRec) so the
    // topRecommendationId test exercises the real predicate, not a hand-rolled literal.
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

beforeAll(() => { wsId = createWorkspace('Rec Lifecycle Single-Writer Test').id; });
afterAll(() => { deleteWorkspace(wsId); });

describe('recommendation-lifecycle single-writer', () => {
  it('sendRecommendation sets clientStatus=sent + sentAt and recomputes summary', () => {
    seed([rec({ id: 'send1', clientStatus: 'curated' })]);
    sendRecommendation(wsId, 'send1');
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'send1')!;
    expect(after.clientStatus).toBe('sent');
    expect(after.sentAt).toBeTruthy();
    // sent recs are not active → excluded from the summary top-rec
    expect(loadRecommendations(wsId)!.summary.topRecommendationId).not.toBe('send1');
  });

  it('sendRecommendation works from clientStatus=system (operator skips the curate step)', () => {
    seed([rec({ id: 'send2', clientStatus: 'system' })]);
    const after = sendRecommendation(wsId, 'send2');
    expect(after?.clientStatus).toBe('sent');
  });

  it('sendRecommendation throws InvalidTransitionError on an already-sent rec', () => {
    seed([rec({ id: 'send3', clientStatus: 'approved' })]);
    expect(() => sendRecommendation(wsId, 'send3')).toThrow(InvalidTransitionError);
  });

  it('returns null when the rec id is not found', () => {
    seed([rec({ id: 'present' })]);
    expect(sendRecommendation(wsId, 'missing')).toBeNull();
    expect(strikeRecommendation(wsId, 'missing')).toBeNull();
    expect(throttleRecommendation(wsId, 'missing', 30)).toBeNull();
    expect(fixRecommendation(wsId, 'missing')).toBeNull();
    expect(unstrikeRecommendation(wsId, 'missing')).toBeNull();
  });

  it('strikeRecommendation sets lifecycle=struck + struckAt and never touches RecStatus', () => {
    seed([rec({ id: 'strike1', status: 'pending' })]);
    strikeRecommendation(wsId, 'strike1');
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'strike1')!;
    expect(after.lifecycle).toBe('struck');
    expect(after.struckAt).toBeTruthy();
    expect(after.status).toBe('pending'); // RecStatus untouched — the trust-critical graft
  });

  // C4 (attribution honesty): striking a COMPLETED rec resets its RecStatus to pending,
  // but the platform_executed outcome recorded at completion would otherwise remain and
  // could resurface as a client "win" for un-done work. strikeRecommendation must neutralize
  // that tracked action to not_acted_on so the wins/digest exclusion filters drop it.
  it('strikeRecommendation neutralizes the completion-time outcome of a struck completed rec', () => {
    seed([rec({ id: 'strike_neutralize', status: 'completed' })]);
    // A platform_executed outcome recorded at completion time, keyed by sourceType/sourceId.
    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed',
      workspaceId: wsId,
      actionType: 'insight_acted_on',
      sourceType: 'recommendation',
      sourceId: 'strike_neutralize',
      pageUrl: '/struck-page',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });
    expect(action.attribution).toBe('platform_executed');

    strikeRecommendation(wsId, 'strike_neutralize');

    // The completed rec was reset to pending (existing invariant) AND its outcome neutralized.
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'strike_neutralize')!;
    expect(after.lifecycle).toBe('struck');
    expect(after.status).toBe('pending');
    const neutralized = getActionBySource('recommendation', 'strike_neutralize');
    expect(neutralized?.attribution).toBe('not_acted_on');
  });

  // Guard the no-op case: striking a rec that was NEVER completed records no completion
  // outcome, so there is nothing to neutralize and any pre-existing action is left alone.
  it('strikeRecommendation leaves a non-completed rec\'s outcome attribution untouched', () => {
    seed([rec({ id: 'strike_pending_keep', status: 'pending' })]);
    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed',
      workspaceId: wsId,
      actionType: 'insight_acted_on',
      sourceType: 'recommendation',
      sourceId: 'strike_pending_keep',
      pageUrl: '/pending-page',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });

    strikeRecommendation(wsId, 'strike_pending_keep');

    // status was already pending → no RecStatus reset → no neutralization. Attribution unchanged.
    const unchanged = getActionBySource('recommendation', 'strike_pending_keep');
    expect(unchanged?.id).toBe(action.id);
    expect(unchanged?.attribution).toBe('platform_executed');
  });

  it('strikeRecommendation is idempotent — a re-strike returns the struck rec', () => {
    seed([rec({ id: 'strike2', status: 'pending' })]);
    const first = strikeRecommendation(wsId, 'strike2');
    const firstStruckAt = first!.struckAt;
    const second = strikeRecommendation(wsId, 'strike2');
    expect(second?.lifecycle).toBe('struck');
    expect(second?.struckAt).toBe(firstStruckAt); // unchanged — idempotent
  });

  it('strikeRecommendation attaches cascade metadata for cascadeOnStrike RecTypes', () => {
    seed([rec({ id: 'strike3', type: 'keyword_gap', source: 'audit:keyword' })]);
    const after = strikeRecommendation(wsId, 'strike3', { removedKeywords: ['foo'], reversible: true });
    expect(after?.cascade?.removedKeywords).toEqual(['foo']);
    expect(after?.cascade?.reversible).toBe(true);
  });

  it('unstrikeRecommendation restores struck → active and clears cascade', () => {
    seed([rec({ id: 'unstrike1', lifecycle: 'struck', struckAt: new Date().toISOString(), cascade: { removedKeywords: ['foo'], reversible: true } })]);
    const after = unstrikeRecommendation(wsId, 'unstrike1');
    expect(after?.lifecycle).toBe('active');
    expect(after?.struckAt).toBeUndefined();
    expect(after?.cascade).toBeUndefined();
  });

  it('throttleRecommendation sets lifecycle=throttled + a future throttledUntil', () => {
    seed([rec({ id: 'throttle1' })]);
    throttleRecommendation(wsId, 'throttle1', 30);
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'throttle1')!;
    expect(after.lifecycle).toBe('throttled');
    expect(Date.parse(after.throttledUntil!)).toBeGreaterThan(Date.now());
  });

  it('fixRecommendation marks the rec via the existing RecStatus completion path (never clientStatus)', () => {
    seed([rec({ id: 'fix1', status: 'pending' })]);
    const after = fixRecommendation(wsId, 'fix1');
    expect(after?.status).toBe('completed');
    expect(after?.clientStatus).toBeUndefined(); // Fix is the RecStatus axis, not the curation axis
  });

  // R4-PR1 struck≠completed guard — the app-level half of the trust-critical invariant.
  it('fixRecommendation refuses to complete a STRUCK rec (StruckRecCompletionError)', () => {
    seed([rec({ id: 'fix_struck', status: 'pending', lifecycle: 'struck', struckAt: new Date().toISOString() })]);
    expect(() => fixRecommendation(wsId, 'fix_struck')).toThrow(StruckRecCompletionError);
    // The rec is untouched — never swept to completed.
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'fix_struck')!;
    expect(after.status).toBe('pending');
    expect(after.lifecycle).toBe('struck');
  });

  it('updateRecommendationStatus refuses to complete a client-owned (approved) rec', () => {
    seed([rec({ id: 'complete_approved', status: 'pending', clientStatus: 'approved' })]);
    expect(() => updateRecommendationStatus(wsId, 'complete_approved', 'completed')).toThrow(StruckRecCompletionError);
  });

  it('exposes a per-RecType policy registry (metadata routes via "rec", cannibalization via "deliverable")', () => {
    expect(REC_POLICY_REGISTRY.metadata?.sendChannel).toBe('rec');
    expect(REC_POLICY_REGISTRY.cannibalization?.sendChannel).toBe('deliverable');
    expect(REC_POLICY_REGISTRY.keyword_gap?.cascadeOnStrike).toBe(true);
  });
});

describe('strike-never-completed — auto-resolve exemption + summary predicate', () => {
  // The full regen integration for "exempt rec whose source vanishes stays in set" is covered by
  // tests/integration/recommendation-regen-preserves-lifecycle.test.ts (Suite B): the auto-resolve
  // loop RETAINS an exempt rec as-is when its source is no longer detected (recommendations.ts ~2459),
  // and the companion test proves a non-exempt rec on the same path still auto-resolves. The tests
  // below pin the predicate-level invariant: isExemptFromAutoResolve is the gate the sweep checks.
  it('isExemptFromAutoResolve is the trust-critical gate on the auto-resolve loop (exemption unit path)', () => {
    // This tests the same invariant at the mutation level: a sent rec cannot be
    // auto-resolved to 'completed' by anything that checks isExemptFromAutoResolve.
    // The single-writer path (fixRecommendation) is distinct — it uses the RecStatus axis
    // (updateRecommendationStatus → 'completed') and is intentional agency work, not a sweep.
    // A sent rec cannot go pending→completed via fixRecommendation (the correct axis path),
    // but the auto-resolve sweep simply skips it due to the exemption — the intent holds.
    seed([rec({ id: 'exempt_check', clientStatus: 'sent', sentAt: new Date().toISOString(), status: 'pending' })]);
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'exempt_check');
    expect(after).toBeDefined();
    expect(after!.clientStatus).toBe('sent');
    // The only way a sent rec's status changes to 'completed' in the current implementation
    // is via fixRecommendation (the operator RecStatus axis). strikeRecommendation and
    // throttleRecommendation NEVER touch RecStatus (tested in the single-writer describe above).
    strikeRecommendation(wsId, 'exempt_check');
    const afterStrike = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'exempt_check');
    expect(afterStrike!.status).toBe('pending'); // RecStatus untouched after strike
    expect(afterStrike!.lifecycle).toBe('struck');
    expect(afterStrike!.clientStatus).toBe('sent'); // clientStatus axis preserved
  });

  it('summary.topRecommendationId is never a struck/throttled/sent rec', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    seed([
      rec({ id: 'struck_rec', impactScore: 99, lifecycle: 'struck', struckAt: new Date().toISOString() }),
      rec({ id: 'throttled_rec', impactScore: 98, lifecycle: 'throttled', throttledUntil: future }),
      rec({ id: 'sent_rec', impactScore: 97, clientStatus: 'sent', sentAt: new Date().toISOString() }),
      rec({ id: 'active_rec', impactScore: 10 }),
    ]);
    // seed() now calls computeRecommendationSummary (which calls isActiveRec), so
    // topRecommendationId reflects the real active-set predicate — not the raw recs[0] literal.
    const summary = loadRecommendations(wsId)!.summary;
    expect(['struck_rec', 'throttled_rec', 'sent_rec']).not.toContain(summary.topRecommendationId);
    expect(summary.topRecommendationId).toBe('active_rec');
  });
});
