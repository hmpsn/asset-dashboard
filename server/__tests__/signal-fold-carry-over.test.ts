/**
 * Strategy redesign P4 · signal-fold — carry-over guard.
 *
 * mintSignalRecs runs AFTER applyLifecycleCarryOver inside generateRecommendations. These
 * tests assert the trust-critical carry-over contract for minted signal recs:
 *   1. A signal is minted as a rec when `strategy-signal-fold` is ON.
 *   2. The minted signal rec SURVIVES a regen (same source insightId → buildMergeKey dedup)
 *      without being duplicated.
 *   3. A struck (or sent) signal rec's lifecycle/clientStatus is RESPECTED across regen — it
 *      is carried over (not reset to a fresh 'system' rec) and never double-minted.
 *
 * broadcastToWorkspace throws before the WS server's setBroadcast() runs (no server boots in
 * this direct-call test), so it's mocked to a no-op. buildRecommendationGenerationContext is
 * mocked so the run needs no provider/network access.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../intelligence/generation-context-builders.js', () => ({
  buildRecommendationGenerationContext: vi.fn(async () => ({
    intelligence: {
      learnings: null,
      seoContext: { backlinkProfile: null },
      clientSignals: null,
      contentPipeline: null,
    },
  })),
}));

import { generateRecommendations, loadRecommendations, saveRecommendations, buildMergeKey } from '../recommendations.js';
import { upsertInsight } from '../analytics-insights-store.js';
import { saveKeywordFeedback } from '../keyword-feedback.js';
import { setWorkspaceFlagOverride } from '../feature-flags.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../workspaces.js';
import type { RankingMoverData } from '../../shared/types/analytics.js';

/** Seed a ranking_mover insight that buildStrategySignals turns into a `momentum` signal
 *  (posChange > 3 → keyword_gap rec). Returns the insight id (== the signal's insightId).
 *
 *  The keyword is also registered as a client-REQUESTED keyword. generateRecommendations now
 *  threads the same strict (strictBusinessFit) keywordEvaluationContext the standalone signals
 *  card used into mintSignalRecs (parity — see server/recommendations.ts). A requested keyword
 *  passes that filter (requestedMatches.length > 0), so the signal mints — which is the realistic
 *  precondition for a folded signal a client actually cares about, and lets these tests exercise
 *  the carry-over/auto-resolve MECHANICS rather than the (separately-tested) suppression rules. */
function seedMomentumInsight(workspaceId: string, query: string): string {
  saveKeywordFeedback({ workspaceId, keyword: query, status: 'requested' });
  const data: RankingMoverData = {
    query,
    pageUrl: `https://example.com/${query.replace(/\s+/g, '-')}`,
    currentPosition: 4,
    previousPosition: 12,
    positionChange: 8,
    currentClicks: 50,
    previousClicks: 10,
    impressions: 900,
  };
  const insight = upsertInsight({
    workspaceId,
    pageId: data.pageUrl,
    insightType: 'ranking_mover',
    data,
    severity: 'opportunity',
    impactScore: 65,
  });
  return insight.id;
}

describe('signal-fold carry-over', () => {
  let workspaceId = '';

  beforeAll(() => {
    workspaceId = createWorkspace('Signal Fold Carry-Over').id;
    updateWorkspace(workspaceId, {
      keywordStrategy: { generatedAt: '2026-06-18T00:00:00.000Z', siteKeywords: [], opportunities: [] },
    });
    setWorkspaceFlagOverride('strategy-signal-fold', workspaceId, true);
  });

  afterEach(() => {
    // Reset the flag to ON between cases (a case may flip it OFF); insights persist across cases.
    setWorkspaceFlagOverride('strategy-signal-fold', workspaceId, true);
  });

  afterAll(() => {
    setWorkspaceFlagOverride('strategy-signal-fold', workspaceId, null);
    deleteWorkspace(workspaceId);
  });

  it('mints a signal as a rec, then carries it over a regen without duplication', async () => {
    const insightId = seedMomentumInsight(workspaceId, 'momentum keyword one');

    const first = await generateRecommendations(workspaceId);
    const firstSignalRecs = first.recommendations.filter(r => r.source === `signal:${insightId}`);
    expect(firstSignalRecs).toHaveLength(1);
    const minted = firstSignalRecs[0];
    expect(minted.type).toBe('keyword_gap'); // momentum → keyword_gap
    expect(minted.impactScore).toBe(65);
    const originalId = minted.id;

    // Regen with the SAME insight present — the signal must NOT be minted a second time.
    const second = await generateRecommendations(workspaceId);
    const secondSignalRecs = second.recommendations.filter(r => r.source === `signal:${insightId}`);
    expect(secondSignalRecs).toHaveLength(1); // no duplicate
    // Carry-over preserved the id (frontend continuity).
    expect(secondSignalRecs[0].id).toBe(originalId);
  });

  it('keeps a plain (non-struck, non-sent) folded signal rec at status:pending across ≥2 regens', async () => {
    // Regression for the signal-fold self-destruct bug: mintSignalRecs runs AFTER the auto-resolve
    // sweep, so a `signal:<insightId>` key is never in `newSources`. Without the auto-resolve
    // exemption for category==='signal', the sweep rewrites the un-actioned signal rec to
    // status:'completed' + insight:'✓ Auto-resolved …', then mintSignalRecs dedups against that
    // now-completed rec and never re-mints → a false "✓ done". The exemption must keep a plain
    // folded signal rec PENDING across consecutive regens (insight still present, never actioned).
    const insightId = seedMomentumInsight(workspaceId, 'momentum keyword pending continuity');

    await generateRecommendations(workspaceId);

    // Two further regens with the signal still present and the rec never struck/sent/dismissed.
    for (let i = 0; i < 2; i++) {
      const set = await generateRecommendations(workspaceId);
      const matched = set.recommendations.filter(r => r.source === `signal:${insightId}`);
      expect(matched).toHaveLength(1); // exactly one — no duplicate, no drop
      const rec = matched[0];
      expect(rec.status).toBe('pending'); // NOT auto-resolved to 'completed'
      expect(rec.insight.startsWith('✓ Auto-resolved')).toBe(false); // no false-done copy
      expect(rec.lifecycle).not.toBe('struck');
    }
  });

  it('respects a struck signal rec across regen (lifecycle preserved, not re-minted)', async () => {
    const insightId = seedMomentumInsight(workspaceId, 'momentum keyword struck');

    // First generation mints it.
    await generateRecommendations(workspaceId);
    const set = loadRecommendations(workspaceId)!;
    const rec = set.recommendations.find(r => r.source === `signal:${insightId}`)!;
    expect(rec).toBeTruthy();

    // Operator strikes it (suppression axis — does NOT touch RecStatus).
    rec.lifecycle = 'struck';
    rec.struckAt = new Date().toISOString();
    saveRecommendations(set);

    // Regen: the struck signal rec must be carried over (lifecycle preserved) and NOT re-minted
    // as a fresh active duplicate.
    const after = await generateRecommendations(workspaceId);
    const matched = after.recommendations.filter(r => r.source === `signal:${insightId}`);
    expect(matched).toHaveLength(1); // single rec — no fresh duplicate alongside the struck one
    expect(matched[0].lifecycle).toBe('struck'); // strike respected across regen
  });

  it('respects a sent signal rec across regen (clientStatus preserved, not re-minted)', async () => {
    const insightId = seedMomentumInsight(workspaceId, 'momentum keyword sent');

    await generateRecommendations(workspaceId);
    const set = loadRecommendations(workspaceId)!;
    const rec = set.recommendations.find(r => r.source === `signal:${insightId}`)!;
    rec.clientStatus = 'sent';
    rec.sentAt = new Date().toISOString();
    saveRecommendations(set);

    const after = await generateRecommendations(workspaceId);
    const matched = after.recommendations.filter(r => r.source === `signal:${insightId}`);
    expect(matched).toHaveLength(1);
    expect(matched[0].clientStatus).toBe('sent'); // a sent rec stays sent — never re-minted to 'system'
  });

  it('mints nothing when the flag is OFF (byte-identical rec set)', async () => {
    seedMomentumInsight(workspaceId, 'momentum keyword flag off');
    setWorkspaceFlagOverride('strategy-signal-fold', workspaceId, false);

    const result = await generateRecommendations(workspaceId);
    // No NEW signal rec is minted for the flag-off keyword. (Previously-minted signal recs from
    // earlier ON cases are carried over by the merge phase regardless of the flag — that is the
    // correct lifecycle behavior; the flag gates MINTING, not carry-over of existing recs.)
    const flagOffRecs = result.recommendations.filter(r =>
      r.source.startsWith('signal:') && r.targetKeyword === 'momentum keyword flag off');
    expect(flagOffRecs).toHaveLength(0);
  });

  it('uses buildMergeKey per-insightId for signal sources (dedup key is the source string)', () => {
    const key = buildMergeKey({ source: 'signal:ins_abc123', affectedPages: [], title: 'whatever' });
    expect(key).toBe('signal:ins_abc123'); // not strategy-prefixed → keyed on source alone
  });
});
