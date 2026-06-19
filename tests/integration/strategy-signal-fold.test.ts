/**
 * Strategy redesign P4 · signal-fold (Lane A) — integration.
 *
 * The standalone IntelligenceSignals card is being deleted; its feed is now minted as real
 * Recommendation rows at generateRecommendations() time, gated behind `strategy-signal-fold`
 * (server-side, per-workspace). This suite exercises the FULL mint path through the real DB
 * layer (createEphemeralTestContext → shared DATA_DIR DB), then reads the result back over the
 * real admin HTTP endpoint (GET /api/recommendations/:ws) so the read path is covered too.
 *
 *   flag-ON  → a workspace with intelligence signals mints them as recs (correct RecType
 *              mapping per signal type, source:'signal:<insightId>', deduped per insight).
 *   flag-OFF → no signal recs minted (byte-identical: the rec set carries zero `signal:` rows).
 *
 * The mint read path reused is exactly the standalone card's: getInsights(ws) →
 * buildStrategySignals(insights). The signals are produced by seeding the same AnalyticsInsight
 * rows buildStrategySignals reads (ranking_mover → momentum, competitor_gap → content_gap,
 * strategyAlignment='misaligned' → misalignment).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// generateRecommendations runs IN this test process (writing to the shared DATA_DIR DB the
// child server reads). The test process never calls setBroadcast(), so the real
// broadcastToWorkspace would throw "called before init". Mock it to a no-op — the broadcast
// itself is not under test here (the minted recs ride the existing RECOMMENDATIONS_UPDATED
// event; this suite verifies the MINT + read path). Same pattern as
// recommendation-regen-preserves-lifecycle.test.ts.
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { generateRecommendations, loadRecommendations } from '../../server/recommendations.js';
import { upsertInsight, deleteInsightsForWorkspace } from '../../server/analytics-insights-store.js';
import { saveKeywordFeedback } from '../../server/keyword-feedback.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { RankingMoverData, CompetitorGapData } from '../../shared/types/analytics.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
// The ephemeral server boots with APP_PASSWORD='' (admin gate open), so the admin HMAC route
// GET /api/recommendations/:ws is reachable via the plain `api` helper — no token needed.
const { api } = ctx;
let wsId = '';

// generateRecommendations now threads the standalone signals card's strict (strictBusinessFit)
// keywordEvaluationContext into mintSignalRecs (parity — server/recommendations.ts). On a minimal
// test workspace with no business context, that filter suppresses every keyword (a `business_mismatch`
// escalation). Registering each seeded keyword as client-REQUESTED makes the signal pass the filter
// (requestedMatches.length > 0) — the realistic precondition for a folded signal — so these tests
// exercise the MINT/dedup mechanics rather than the (separately-tested) suppression rules.
function requestKeyword(ws: string, keyword: string): void {
  saveKeywordFeedback({ workspaceId: ws, keyword, status: 'requested' });
}

/** A ranking_mover insight (posChange > 3) → buildStrategySignals emits a `momentum` signal
 *  → mintSignalRecs maps it to a `keyword_gap` rec. Returns the insight id (== signal.insightId). */
function seedMomentum(query: string): string {
  requestKeyword(wsId, query);
  const data: RankingMoverData = {
    query,
    pageUrl: `https://example.com/${query.replace(/\s+/g, '-')}`,
    currentPosition: 3,
    previousPosition: 14,
    positionChange: 11,
    currentClicks: 80,
    previousClicks: 12,
    impressions: 1500,
  };
  return upsertInsight({
    workspaceId: wsId,
    pageId: data.pageUrl,
    insightType: 'ranking_mover',
    data,
    severity: 'opportunity',
    impactScore: 75,
  }).id;
}

/** A competitor_gap insight → `content_gap` signal → `topic_cluster` rec. */
function seedCompetitorGap(keyword: string): string {
  requestKeyword(wsId, keyword);
  const data: CompetitorGapData = {
    keyword,
    competitorDomain: 'competitor.example',
    competitorPosition: 2,
    ourPosition: null,
    volume: 1200,
    difficulty: 30,
  };
  return upsertInsight({
    workspaceId: wsId,
    pageId: null,
    insightType: 'competitor_gap',
    data,
    severity: 'opportunity',
    impactScore: 55,
  }).id;
}

/** A misaligned insight (strategyAlignment='misaligned') → `misalignment` signal → `strategy` rec. */
function seedMisalignment(strategyKeyword: string): string {
  requestKeyword(wsId, strategyKeyword);
  // page_health is a benign insight type carrying the strategy* enrichment columns the
  // misalignment branch keys off (strategyAlignment + strategyKeyword) — buildStrategySignals
  // reads those columns, not the insight type, for the misalignment signal.
  return upsertInsight({
    workspaceId: wsId,
    pageId: `https://example.com/${strategyKeyword.replace(/\s+/g, '-')}`,
    insightType: 'page_health',
    data: { score: 40, trend: 'declining', clicks: 5, impressions: 200, position: 18, ctr: 1 },
    severity: 'warning',
    impactScore: 45,
    strategyKeyword,
    strategyAlignment: 'misaligned',
  }).id;
}

function signalRecs(set: RecommendationSet | null): Recommendation[] {
  return (set?.recommendations ?? []).filter(r => r.source.startsWith('signal:'));
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Strategy Signal Fold Integration').id;
  updateWorkspace(wsId, {
    keywordStrategy: { generatedAt: '2026-06-18T00:00:00.000Z', siteKeywords: [], opportunities: [] },
  });
}, 25_000);

afterAll(async () => {
  setWorkspaceFlagOverride('strategy-signal-fold', wsId, null);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

beforeEach(() => {
  deleteInsightsForWorkspace(wsId);
});

describe('strategy-signal-fold — flag-ON mints signals as recs', () => {
  beforeEach(() => {
    setWorkspaceFlagOverride('strategy-signal-fold', wsId, true);
  });

  it('mints each signal type with the correct RecType mapping and source discriminator', async () => {
    const momentumId = seedMomentum('emergency plumber denver');
    const gapId = seedCompetitorGap('water heater repair');
    const misalignId = seedMisalignment('commercial hvac');

    await generateRecommendations(wsId);
    const recs = signalRecs(loadRecommendations(wsId));

    // One rec per seeded signal, each sourced off its insightId.
    const momentumRec = recs.find(r => r.source === `signal:${momentumId}`);
    const gapRec = recs.find(r => r.source === `signal:${gapId}`);
    const misalignRec = recs.find(r => r.source === `signal:${misalignId}`);

    expect(momentumRec?.type).toBe('keyword_gap');   // momentum → keyword_gap
    expect(gapRec?.type).toBe('topic_cluster');      // content_gap → topic_cluster
    expect(misalignRec?.type).toBe('strategy');      // misalignment → strategy

    // source discriminator: every minted signal rec is `signal:`-prefixed.
    expect(recs.length).toBe(3); // one rec per seeded signal — guards the .every() below from being vacuous
    expect(recs.every(r => r.source.startsWith('signal:'))).toBe(true); // every-ok: length asserted === 3 on the line above
    // impactScore flows straight from the signal (pure map — no OV opportunity attached).
    expect(momentumRec?.impactScore).toBe(75);
    expect(momentumRec?.opportunity).toBeUndefined();
  });

  it('dedups by insightId — a signal already minted is not minted twice on regen', async () => {
    const momentumId = seedMomentum('dedup keyword');

    await generateRecommendations(wsId);
    await generateRecommendations(wsId); // regen with same insight present

    const recs = signalRecs(loadRecommendations(wsId)).filter(r => r.source === `signal:${momentumId}`);
    expect(recs).toHaveLength(1); // deduped — no second copy
  });

  it('surfaces the minted signal recs over the real admin GET endpoint', async () => {
    seedMomentum('admin endpoint keyword');
    await generateRecommendations(wsId);

    const res = await api(`/api/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecommendationSet;
    const minted = body.recommendations.filter(r => r.source.startsWith('signal:'));
    expect(minted.length).toBeGreaterThanOrEqual(1);
    expect(minted.every(r => ['keyword_gap', 'topic_cluster', 'strategy'].includes(r.type))).toBe(true); // every-ok: length guarded on the line above
    // The mint never maps a signal to `competitor` (Lane C's RecType).
    expect(minted.some(r => r.type === 'competitor')).toBe(false);
  });
});

describe('strategy-signal-fold — flag-OFF mints nothing (byte-identical)', () => {
  // A FRESH workspace per case: the flag gates MINTING, not carry-over. A signal rec minted in
  // an earlier flag-ON case (on the shared `wsId`) would legitimately carry over across regen
  // regardless of the flag — so to assert "mints nothing" cleanly we use a workspace that never
  // saw the flag ON. (The shared-workspace carry-over-vs-flag interaction is covered by the
  // carry-over unit suite.)
  let offWsId = '';

  beforeEach(() => {
    offWsId = createWorkspace('Signal Fold Flag Off').id;
    updateWorkspace(offWsId, {
      keywordStrategy: { generatedAt: '2026-06-18T00:00:00.000Z', siteKeywords: [], opportunities: [] },
    });
    setWorkspaceFlagOverride('strategy-signal-fold', offWsId, false);
  });

  afterEach(() => {
    setWorkspaceFlagOverride('strategy-signal-fold', offWsId, null);
    deleteInsightsForWorkspace(offWsId);
    deleteWorkspace(offWsId);
  });

  function seedMomentumFor(ws: string, query: string): void {
    const data: RankingMoverData = {
      query, pageUrl: `https://example.com/${query.replace(/\s+/g, '-')}`,
      currentPosition: 3, previousPosition: 14, positionChange: 11,
      currentClicks: 80, previousClicks: 12, impressions: 1500,
    };
    upsertInsight({ workspaceId: ws, pageId: data.pageUrl, insightType: 'ranking_mover', data, severity: 'opportunity', impactScore: 75 });
  }

  it('mints zero signal recs when the flag is off, even with signals present', async () => {
    seedMomentumFor(offWsId, 'flag off keyword');

    await generateRecommendations(offWsId);
    const recs = signalRecs(loadRecommendations(offWsId));
    expect(recs).toHaveLength(0);
  });

  it('the admin GET payload carries no signal recs when the flag is off', async () => {
    seedMomentumFor(offWsId, 'flag off endpoint keyword');
    await generateRecommendations(offWsId);

    const res = await api(`/api/recommendations/${offWsId}`);
    const body = (await res.json()) as RecommendationSet;
    expect(body.recommendations.some(r => r.source.startsWith('signal:'))).toBe(false);
  });
});
