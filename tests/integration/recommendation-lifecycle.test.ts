/**
 * Strategy v3 Phase 1 Lane 1B — single-writer module (server/recommendation-lifecycle.ts).
 * All blob lifecycle mutations go through one transactional writer that re-reads the set
 * inside the txn, applies the single-field delta, recomputes summary, and upserts
 * (00-contracts §11 / spec §6.2). Tests the real DB round-trip via loadRecommendations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import {
  sendRecommendation,
  strikeRecommendation,
  unstrikeRecommendation,
  throttleRecommendation,
  fixRecommendation,
  REC_POLICY_REGISTRY,
} from '../../server/recommendation-lifecycle.js';
import { InvalidTransitionError } from '../../server/state-machines.js';
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
    summary: { fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null },
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

  it('exposes a per-RecType policy registry (metadata routes via "rec", cannibalization via "deliverable")', () => {
    expect(REC_POLICY_REGISTRY.metadata?.sendChannel).toBe('rec');
    expect(REC_POLICY_REGISTRY.cannibalization?.sendChannel).toBe('deliverable');
    expect(REC_POLICY_REGISTRY.keyword_gap?.cascadeOnStrike).toBe(true);
  });
});
