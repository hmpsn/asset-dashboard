/**
 * SEO Decision Engine — CROSS-PHASE end-to-end "plumbing" integration test (P6/P7/P8).
 *
 * Purpose: catch "data is fetched but never surfaces" / dark-loop wiring bugs that the
 * existing per-phase route tests MISS. Those tests verify route GATING (flag/tier → 404/403)
 * and seed the stores DIRECTLY — they never run the actual refresh JOB with provider data
 * and then assert the data reaches a USER-FACING read. This test does exactly that for each
 * paid phase, proving the full chain:
 *
 *     provider data  →  REAL refresh job  →  store write  →  user-facing read surfaces it
 *
 * Mock seam: the jobs all read `getConfiguredProvider()` from server/seo-data-provider.js.
 * We vi.mock that one export to return FAKE_PROVIDER, whose getNationalSerp / getBusinessListings
 * / getLlmMentions return the PARSED result objects (NationalSerpResult / BusinessListingResult[]
 * / LlmMentionsResult) — i.e. what the parser would produce — because the job calls the provider
 * METHOD, not the raw parser. The parsed shapes are derived from the validated DataForSEO fixtures
 * (tests/fixtures/dataforseo-*.ts) so the values are realistic, not invented.
 *
 * This is an IN-PROCESS test (no spawned server) so vi.mock takes effect in the same module graph
 * the job functions run in. The DB auto-initializes when server modules are imported. Each phase
 * sets the workspace up to pass ALL of its job gates (the #1 risk: a job that silently no-ops
 * because the workspace isn't configured) and asserts the chain link-by-link with LOUD messages
 * that name the broken link.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NationalSerpResult,
  BusinessListingResult,
  LlmMentionsResult,
} from '../../server/seo-data-provider.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

// ─── Provider seam mock (registered BEFORE the server imports below) ──────────
// The jobs call getConfiguredProvider(); we swap ONLY that export for a fake whose
// methods return realistic PARSED results. Everything else in seo-data-provider.js
// (types, DEFAULT_SEO_DATA_PROVIDER, etc.) is preserved via importActual.
const providerState = vi.hoisted(() => ({
  national: null as NationalSerpResult | null,
  listings: [] as BusinessListingResult[],
  llm: null as LlmMentionsResult | null,
  nationalCalls: 0,
  listingCalls: 0,
  llmCalls: 0,
  // P4 geo-threading capture: the fake getNationalSerp records the request arg
  // (where locationCode/languageCode land) so the test can assert the workspace
  // target-geo flowed all the way into the provider call body.
  nationalRequests: [] as Array<{ locationCode?: number; languageCode?: string }>,
  llmRequests: [] as Array<{ locationCode?: number; locationName?: string; languageCode?: string }>,
}));
const intelligenceState = vi.hoisted(() => ({
  invalidateIntelligenceCache: vi.fn(),
}));
const broadcastState = vi.hoisted(() => ({
  broadcastToWorkspace: vi.fn(),
}));

// broadcastToWorkspace() throws if setBroadcast() was never called (it normally is, in
// index.ts at server boot). This in-process test never boots the server, so stub the
// broadcast module to a no-op — the jobs fire WS events after their store writes, and we
// assert the STORE/READ chain, not the broadcast.
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: broadcastState.broadcastToWorkspace,
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: intelligenceState.invalidateIntelligenceCache,
}));

vi.mock('../../server/seo-data-provider.js', async (importActual) => {
  const actual = await importActual<typeof import('../../server/seo-data-provider.js')>();
  const FAKE_PROVIDER = {
    name: 'fake-test-provider',
    async getNationalSerp(
      request?: { keyword?: string; ownerDomain?: string; locationCode?: number; languageCode?: string },
    ): Promise<NationalSerpResult> {
      providerState.nationalCalls++;
      // P4: capture the geo the job threaded into the provider request body.
      providerState.nationalRequests.push({
        locationCode: request?.locationCode,
        languageCode: request?.languageCode,
      });
      if (!providerState.national) throw new Error('test bug: providerState.national not set');
      return providerState.national;
    },
    async getBusinessListings(): Promise<BusinessListingResult[]> {
      providerState.listingCalls++;
      return providerState.listings;
    },
    async getLlmMentions(
      request?: { locationCode?: number; locationName?: string; languageCode?: string },
    ): Promise<LlmMentionsResult> {
      providerState.llmCalls++;
      providerState.llmRequests.push({
        locationCode: request?.locationCode,
        locationName: request?.locationName,
        languageCode: request?.languageCode,
      });
      if (!providerState.llm) throw new Error('test bug: providerState.llm not set');
      return providerState.llm;
    },
  };
  return {
    ...actual,
    getConfiguredProvider: () => FAKE_PROVIDER,
  };
});

// ─── Imports (after mock registration) ───────────────────────────────────────
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { createJob } from '../../server/jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

// P6 — national SERP
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { runNationalSerpRefreshJob } from '../../server/national-serp.js';
import { getLatestSerpSnapshots } from '../../server/serp-snapshots-store.js';
import { buildKeywordCommandCenterDetail } from '../../server/keyword-command-center.js';

// P7 — local GBP
import { updateLocalSeoConfiguration } from '../../server/local-seo.js';
import { createClientLocation } from '../../server/client-locations.js';
import { runLocalGbpRefreshJob } from '../../server/local-gbp.js';
import { getLatestBusinessListings } from '../../server/business-listings-store.js';
import { generateRecommendations, saveRecommendations } from '../../server/recommendations.js';

// P8 — AI visibility (LLM mentions)
import { runLlmMentionsRefreshJob } from '../../server/llm-mentions.js';
import { getLatestLlmMentions } from '../../server/llm-mentions-store.js';
import { assembleSeoContext } from '../../server/intelligence/seo-context-slice.js';

// P1 — value-first keyword scoring reuses addTrackedKeyword + buildKeywordCommandCenterDetail
//      (both already imported in the P6 block above).

// P2 — measured effort prior → recommendation opportunity score
import { recordAction } from '../../server/outcome-tracking.js';
import {
  runEmvCalibration,
  getEffortPriorDays,
  MIN_EFFORT_SAMPLES,
} from '../../server/outcome-emv-calibration.js';

// P3 — AI-Overview free signal → seoContext serpFeatures
import { upsertPageKeyword, listPageKeywords } from '../../server/page-keywords.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

// P4 — workspace target-geo → provider request body
import { workspaceProviderGeo } from '../../server/seo-target-geo.js';

const createdWorkspaceIds: string[] = [];

afterEach(() => {
  // Reset the provider payloads + call counters between tests so a leftover value
  // from one phase can't mask a missing wire in another.
  providerState.national = null;
  providerState.listings = [];
  providerState.llm = null;
  providerState.nationalCalls = 0;
  providerState.listingCalls = 0;
  providerState.llmCalls = 0;
  providerState.nationalRequests = [];
  providerState.llmRequests = [];
  intelligenceState.invalidateIntelligenceCache.mockClear();
  broadcastState.broadcastToWorkspace.mockClear();
});

afterAll(() => {
  for (const id of createdWorkspaceIds) {
    try { deleteWorkspace(id); } catch { /* best-effort cleanup */ }
  }
});

/** createWorkspace seeds a 14-day Growth trial; this resolves a clean, explicit Growth tier. */
function makeGrowthWorkspace(name: string, liveDomain: string): string {
  const ws = createWorkspace(name);
  createdWorkspaceIds.push(ws.id);
  updateWorkspace(ws.id, { tier: 'growth', liveDomain });
  return ws.id;
}

// ═══════════════════════════════════════════════════════════════════════════
// P6 — national-serp: provider data flows job → serp_snapshots → KCC drawer
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P6 national-serp', () => {
  it('P6 national-serp: provider data flows job → serp_snapshots → keyword-command-center drawer', async () => {
    const KEYWORD = 'what is dropshipping and how does it work';
    const wsId = makeGrowthWorkspace('Plumbing P6 — National SERP', 'https://squareup.com');

    // Job gates for runNationalSerpRefreshJob:
    //   tier growth ✓ (makeGrowthWorkspace) · liveDomain ✓ · provider.getNationalSerp ✓ (mock)
    //   ≥1 tracked keyword ✓ (below). The KCC overlay + reads are flag-gated on
    //   'national-serp-tracking', so enable it for this workspace.
    setWorkspaceFlagOverride('national-serp-tracking', wsId, true);
    // A tracked keyword both passes the job's "no tracked keywords" gate AND seeds a KCC
    // row (ensureRow in populateDraftRows) for the overlay to merge onto.
    addTrackedKeyword(wsId, KEYWORD, { pinned: false });

    // Parsed national-SERP result for the owner domain (squareup.com), derived from
    // SERP_WITH_AI_OVERVIEW: squareup.com ranks (organic rank_absolute 5 → position) and
    // appears in the AI Overview references[] (→ aiOverviewCited true, aiOverviewPresent true).
    providerState.national = {
      query: KEYWORD,
      position: 5,
      matchedUrl: 'https://squareup.com/us/en/the-bottom-line/operating-your-business/what-is-drop-shipping',
      features: ['ai_overview', 'people_also_ask', 'organic'],
      aiOverviewPresent: true,
      aiOverviewCited: true,
    };

    // ── Run the REAL job ──
    const job = createJob(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, { workspaceId: wsId });
    await runNationalSerpRefreshJob(wsId, job.id);

    // Guard: the job must have actually called the provider — if it no-op'd on a gate,
    // nationalCalls stays 0 and every assertion below would be debugging the wrong thing.
    expect(
      providerState.nationalCalls,
      'P6: job never called provider.getNationalSerp — it no-op\'d on a gate (tier / liveDomain / tracked keywords / flag). Workspace not set up to pass the job gates.',
    ).toBeGreaterThan(0);

    // ── Link 1: store write ──
    const snapshots = getLatestSerpSnapshots(wsId);
    expect(
      snapshots.length,
      'P6: job ran but getLatestSerpSnapshots empty — store write broken (job → serp_snapshots).',
    ).toBeGreaterThan(0);
    const snap = snapshots.find(s => s.query.toLowerCase().includes('dropshipping'));
    expect(
      snap,
      'P6: snapshots stored but none match the tracked keyword — query write/normalization broken.',
    ).toBeDefined();
    expect(snap!.position).toBe(5);
    expect(snap!.aiOverviewCited).toBe(true);

    // ── Link 2: user-facing read (KCC drawer detail) surfaces the overlay ──
    const detail = await buildKeywordCommandCenterDetail(wsId, KEYWORD, { includeLocalSeo: false });
    expect(
      detail,
      'P6: snapshot stored but KCC detail returned null — drawer read found no base source for the tracked keyword.',
    ).not.toBeNull();
    expect(
      detail!.row.metrics.nationalPosition,
      'P6: snapshot stored but KCC row missing nationalPosition — overlay read broken (serp_snapshots → keyword-command-center drawer).',
    ).toBe(5);
    expect(
      detail!.row.metrics.aiOverviewCited,
      'P6: snapshot stored but KCC row missing aiOverviewCited — overlay read broken (AI-Overview citation not surfaced in the drawer).',
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P7 — local-gbp: provider data flows job → business_listing_snapshots → recommendation
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P7 local-gbp', () => {
  it('P7 local-gbp: provider data flows job → business_listing_snapshots → local_visibility recommendation', async () => {
    const wsId = makeGrowthWorkspace('Plumbing P7 — Local GBP', 'https://acme-coffee.example');

    // Job gates for runLocalGbpRefreshJob:
    //   tier growth ✓ · provider.getBusinessListings ✓ (mock) · ≥1 ACTIVE market WITH
    //   coordinates ✓ (below) · a confirmed client location helps owner identity. The
    //   recommendation read + competitor search both depend on the 'local-gbp' flag /
    //   intelligenceProfile.industry (→ category), so set all of them.
    setWorkspaceFlagOverride('local-gbp', wsId, true);
    // intelligenceProfile.industry → the `category` the job uses for the competitor search.
    updateWorkspace(wsId, { intelligenceProfile: { industry: 'Coffee shop' } });

    // Active market WITH coordinates (activeMarketsWithCoords requires status ACTIVE + lat/lng).
    updateLocalSeoConfiguration(
      wsId,
      {
        // LOCAL posture gates the entire local recommendation block (recommendations.ts
        // `useLocalGenQual` at line ~2047 wraps B4). UNKNOWN (the default) → B4 skipped.
        posture: 'local',
        markets: [{
          label: 'San Francisco, CA',
          city: 'San Francisco',
          stateOrRegion: 'CA',
          country: 'United States',
          latitude: 37.7749,
          longitude: -122.4194,
          status: 'active',
        }],
      },
      true,
    );
    // A confirmed location gives the owner search an identity axis (location.name).
    createClientLocation(wsId, {
      name: 'Acme Coffee Roasters',
      city: 'San Francisco',
      stateOrRegion: 'CA',
      country: 'United States',
      status: 'confirmed',
    });

    // Parsed business listings: an OWNED listing with FEW reviews + a competitor with MANY.
    // The owner is found by the by-name search, which (because the workspace HAS identity:
    // liveDomain) only stores a result whose isOwned === true. So the owner result must carry
    // isOwned: true. The competitor comes from the category search (isOwned forced false by the
    // job). Review gap = 120 - 8 = 112 ≥ 10 → mints a review_gap rec.
    providerState.listings = [
      {
        title: 'Acme Coffee Roasters',
        placeId: 'place-owner-acme',
        domain: 'acme-coffee.example',
        category: 'Coffee shop',
        city: 'San Francisco',
        rating: 4.4,
        reviewCount: 8,
        totalPhotos: 12,
        claimed: true,
        isOwned: true,
      },
      {
        title: 'Rival Roasters',
        placeId: 'place-comp-rival',
        domain: 'rival.example',
        category: 'Coffee shop',
        city: 'San Francisco',
        rating: 4.8,
        reviewCount: 120,
        totalPhotos: 80,
        claimed: true,
        isOwned: false,
      },
    ];

    // ── Run the REAL job ──
    intelligenceState.invalidateIntelligenceCache.mockClear();
    broadcastState.broadcastToWorkspace.mockClear();
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH, { workspaceId: wsId });
    await runLocalGbpRefreshJob(wsId, job.id);

    expect(
      providerState.listingCalls,
      'P7: job never called provider.getBusinessListings — it no-op\'d on a gate (tier / active market with coordinates / provider method). Workspace not set up to pass the job gates.',
    ).toBeGreaterThan(0);

    // ── Link 1: store write (owned + competitor) ──
    const listings = getLatestBusinessListings(wsId);
    expect(
      listings.length,
      'P7: job ran but getLatestBusinessListings empty — store write broken (job → business_listing_snapshots).',
    ).toBeGreaterThan(0);
    const owned = listings.find(l => l.isOwned === true);
    const competitor = listings.find(l => l.isOwned !== true);
    expect(
      owned,
      'P7: listings stored but no OWNED listing — owner search / is_owned authority broken (the owner by-name result with isOwned:true was not persisted).',
    ).toBeDefined();
    expect(
      competitor,
      'P7: listings stored but no COMPETITOR listing — category competitor search write broken.',
    ).toBeDefined();
    expect(owned!.reviewCount).toBe(8);
    expect(competitor!.reviewCount).toBe(120);
    expect(intelligenceState.invalidateIntelligenceCache).toHaveBeenCalledTimes(1);
    expect(intelligenceState.invalidateIntelligenceCache).toHaveBeenCalledWith(wsId);
    expect(
      intelligenceState.invalidateIntelligenceCache.mock.invocationCallOrder[0],
      'P7: persisted listing snapshots must invalidate intelligence before refresh_completed invites a refetch.',
    ).toBeLessThan(broadcastState.broadcastToWorkspace.mock.invocationCallOrder[0]);

    // ── Link 2: user-facing read (recommendations) mints a local_visibility rec ──
    const recSet = await generateRecommendations(wsId);
    const localRecs = recSet.recommendations.filter(r => r.type === 'local_visibility');
    expect(
      localRecs.length,
      'P7: listings stored but generateRecommendations minted no local_visibility rec — the B4 listings→rec block is broken (business_listing_snapshots → recommendations).',
    ).toBeGreaterThan(0);
    const reviewGapRec = localRecs.find(r => r.source.startsWith('local_visibility:review_gap:'));
    const gbpRec = localRecs.find(r => r.source.startsWith('local_visibility:gbp_completeness:'));
    expect(
      reviewGapRec ?? gbpRec,
      'P7: local_visibility rec exists but its source is neither review_gap: nor gbp_completeness: — the rec source-keying is broken.',
    ).toBeDefined();
    // The 112-review gap specifically must fire the review-gap rec.
    expect(
      reviewGapRec,
      'P7: a 112-review gap between owner (8) and competitor (120) did NOT produce a review_gap rec — the review-gap comparison (same-market competitor reduce) is broken.',
    ).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P8 — ai-visibility: provider data flows job → llm_mention_snapshots → seoContext slice
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P8 ai-visibility', () => {
  it('P8 ai-visibility: provider data flows job → llm_mention_snapshots → seoContext aiVisibility summary', async () => {
    const wsId = makeGrowthWorkspace('Plumbing P8 — AI Visibility', 'https://acme.example');
    // workspace.name is the brand source for share-of-voice; createWorkspace set it above.

    // Job gates for runLlmMentionsRefreshJob:
    //   tier growth ✓ · liveDomain ✓ · provider.getLlmMentions ✓ (mock). The seoContext
    //   aiVisibility summary is unconditional (the `ai-visibility` flag was retired in
    //   flag-sunset Wave 2b).
    // P8 reuses P4 target-geo (also unconditional since flag-sunset Wave 2b retired
    // `geo-targeting`): the LLM mentions provider request must carry the non-US market
    // instead of falling back to United States.
    updateWorkspace(wsId, {
      targetGeo: { locationCode: 2124, languageCode: 'fr', countryCode: 'CA', label: 'Canada · French' },
    });

    // Parsed LLM-mentions result: mentions > 0, shareOfVoice defined, competitors + sourceDomains
    // (derived from the LLM_MENTIONS_AGG fixture shape — chat_gpt platform, co-mentioned brands).
    providerState.llm = {
      domain: 'acme.example',
      platform: 'chat_gpt',
      mentions: 14,
      aiSearchVolume: 520,
      shareOfVoice: 0.37,
      competitors: [
        { name: 'Rival Brews', mentions: 22, aiSearchVolume: 910 },
        { name: 'Third Wave Co', mentions: 9 },
      ],
      sourceDomains: [
        { domain: 'wikipedia.org', mentions: 6 },
        { domain: 'reddit.com', mentions: 4 },
      ],
    };

    // ── Run the REAL job ──
    intelligenceState.invalidateIntelligenceCache.mockClear();
    broadcastState.broadcastToWorkspace.mockClear();
    const job = createJob(BACKGROUND_JOB_TYPES.LLM_MENTIONS_REFRESH, { workspaceId: wsId });
    await runLlmMentionsRefreshJob(wsId, job.id);

    expect(
      providerState.llmCalls,
      'P8: job never called provider.getLlmMentions — it no-op\'d on a gate (tier / liveDomain / provider method / budget). Workspace not set up to pass the job gates.',
    ).toBeGreaterThan(0);
    expect(
      providerState.llmRequests[0],
      'P8: job called provider.getLlmMentions but the fake captured no request object — cannot assert geo threading.',
    ).toMatchObject({ locationCode: 2124, locationName: 'Canada', languageCode: 'fr' });

    // ── Link 1: store write ──
    const snapshot = getLatestLlmMentions(wsId, 'chat_gpt');
    expect(
      snapshot,
      'P8: job ran but getLatestLlmMentions(chat_gpt) empty — store write broken (job → llm_mention_snapshots).',
    ).toBeDefined();
    expect(snapshot!.mentions).toBe(14);
    expect(snapshot!.shareOfVoice).toBeCloseTo(0.37, 5);
    expect(snapshot!.competitors.length).toBeGreaterThan(0);
    expect(intelligenceState.invalidateIntelligenceCache).toHaveBeenCalledTimes(1);
    expect(intelligenceState.invalidateIntelligenceCache).toHaveBeenCalledWith(wsId);

    // ── Link 2: user-facing read (seoContext intelligence slice) surfaces aiVisibility ──
    const seoContext = await assembleSeoContext(wsId);
    expect(
      seoContext.aiVisibility,
      'P8: snapshot stored but assembleSeoContext returned no aiVisibility summary — the slice read is broken (llm_mention_snapshots → seo-context-slice). The AI context / AdminChat would be blind to AI visibility.',
    ).toBeDefined();
    expect(
      seoContext.aiVisibility!.mentions,
      'P8: aiVisibility summary present but mentions missing — slice field wiring broken.',
    ).toBe(14);
    expect(
      seoContext.aiVisibility!.shareOfVoice,
      'P8: aiVisibility summary present but shareOfVoice missing — slice field wiring broken.',
    ).toBeCloseTo(0.37, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EARLY PHASES (P1–P4) — the same fetch/compute → store → surface plumbing
// guard applied to the older, less-recently-reviewed phases. Each chain drives
// the REAL code path and asserts the data reaches the user-facing surface, with
// every link failing LOUDLY (a message naming the broken stage) so a "computed
// but never surfaced" dark-loop break can't pass silently.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// P1 — value-first keyword scoring: commercial signals → KCC drawer row valueReasons
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P1 value-first keyword scoring', () => {
  it('P1 value-scoring: a tracked keyword with commercial signals surfaces valueReasons in the KCC drawer row', async () => {
    const KEYWORD = 'commercial property insurance quote';
    const wsId = makeGrowthWorkspace('Plumbing P1 — Value Scoring', 'https://acme-insure.example');

    // P1 made computeKeywordValueScore the unconditional Hub sort metric + the
    // keywordValueReasons chips. Value scoring is always on (buildValueScoringConfig
    // returns { on: true }) — no feature flag. The chain we prove:
    //   tracked keyword carrying cpc/volume/intent  →  populateDraftRows merges them
    //   onto row.metrics  →  finalizeDraftRow runs computeKeywordValueComponents +
    //   keywordValueReasons  →  buildKeywordCommandCenterDetail returns the row with a
    //   non-empty valueReasons[] that KeywordDetailDrawer renders.
    //
    // addTrackedKeyword carries cpc/volume/difficulty/intent straight onto the
    // tracked-keyword row (AddTrackedKeywordOptions), which populateDraftRows merges
    // into row.metrics — exactly the inputs computeKeywordValueComponents reads.
    addTrackedKeyword(wsId, KEYWORD, {
      volume: 2400,        // > 0 → real demand signal ("Strong demand")
      cpc: 18.5,           // > 0 → commercial value + "$18.5 CPC" reason
      difficulty: 38,      // present → winnability ("Winnable · KD 38")
      intent: 'commercial', // a PROVIDED intent (regex-derived does NOT count) → "Commercial intent"
    });

    // ── Link 1: the merged row carries the commercial signals (compute inputs present) ──
    const detail = await buildKeywordCommandCenterDetail(wsId, KEYWORD, { includeLocalSeo: false });
    expect(
      detail,
      'P1: tracked keyword exists but KCC detail returned null — the drawer read found no base source for the tracked keyword.',
    ).not.toBeNull();
    expect(
      detail!.row.metrics.cpc,
      'P1: tracked keyword had a cpc but row.metrics.cpc is missing — the trackedKeywords → row.metrics merge dropped the commercial signal (no value-scoring input).',
    ).toBe(18.5);
    expect(
      detail!.row.metrics.intent,
      'P1: tracked keyword had an intent but row.metrics.intent is missing — the trackedKeywords → row.metrics merge dropped the intent signal.',
    ).toBe('commercial');

    // ── Link 2: user-facing read (KCC drawer row) surfaces valueReasons ──
    // This is the dark-loop guard: the rows/model path passes valueScoring into
    // finalizeDraftRow, but the DETAIL path must too — otherwise the drawer's
    // value-first reason chips are silently empty.
    expect(
      detail!.row.valueReasons,
      'P1: row has commercial signals but valueReasons is undefined — value-first scoring not wired into the KCC DRAWER row (finalizeDraftRow ran without the valueScoring config in the detail path). The drawer\'s value-reason chips would be silently empty.',
    ).toBeDefined();
    expect(
      detail!.row.valueReasons!.length,
      'P1: valueReasons present but empty — keywordValueReasons produced no chips for a keyword that carries cpc + volume + difficulty + intent (signal gate / reason builder broken).',
    ).toBeGreaterThan(0);
    // The commercial intent + CPC must be the leading reason — proves the actual
    // value components (not a placeholder) drove the chips.
    expect(
      detail!.row.valueReasons!.some(r => /commercial intent/i.test(r)),
      `P1: valueReasons present but none mention the commercial intent — the resolved intent did not reach keywordValueReasons. Got: ${JSON.stringify(detail!.row.valueReasons)}`,
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P2 — measured effort prior: completed outcomes → getEffortPriorDays read
//      (the "loop is closed" check) → the OV scorer uses it
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P2 effort prior', () => {
  it('P2 effort-prior: ≥ MIN_EFFORT_SAMPLES completed outcomes feed a measured median back through getEffortPriorDays into the rec opportunity score', async () => {
    const wsId = makeGrowthWorkspace('Plumbing P2 — Effort Prior', 'https://acme-effort.example');

    // P2 threads getEffortPriorDays (median time-to-implement from completed,
    // live, platform-executed, recommendation-sourced outcomes) into
    // computeOpportunityValue.effortDays. The chain we prove is the OUTCOME →
    // PRIOR read (the "loop is closed" link — outcomes are stored AND read back):
    //   record ≥ MIN_EFFORT_SAMPLES completed actions of one action type, each
    //   started N days before completion  →  runEmvCalibration computes the median
    //   →  getEffortPriorDays(ws)[type] returns N (not undefined).
    //
    // We seed via recordAction (sourceFlag 'live' + attribution 'platform_executed'
    // are REQUIRED for the effort-sample filter) whose source_id joins to a saved rec
    // whose createdAt is N days ago → measured effort ≈ N days.
    expect(
      MIN_EFFORT_SAMPLES,
      'P2: MIN_EFFORT_SAMPLES unexpectedly large — this test seeds 3 samples; bump the seed count if the threshold rose.',
    ).toBeLessThanOrEqual(3);

    const EFFORT_DAYS = 12;
    const now = new Date().toISOString();
    const startedAt = new Date(Date.now() - EFFORT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const recIds = ['p2-ep1', 'p2-ep2', 'p2-ep3'];

    // Save completed recs whose createdAt anchors the effort-measurement start.
    const recommendations: Recommendation[] = recIds.map(id => ({
      id, // tracked_actions.source_id joins to this rec id (effort start = createdAt)
      workspaceId: wsId,
      priority: 'fix_soon',
      type: 'technical',
      title: `seed ${id}`,
      description: '',
      insight: '',
      impact: 'medium',
      effort: 'medium',
      impactScore: 50,
      source: `audit:${id}`,
      affectedPages: [],
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: 'gain',
      actionType: 'manual',
      status: 'completed',
      assignedTo: 'client',
      createdAt: startedAt,
      updatedAt: now,
    }));
    saveRecommendations({
      workspaceId: wsId,
      generatedAt: now,
      recommendations,
      summary: { fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: null },
    });

    // Record a completed, live, platform-executed action per rec (the effort sample).
    for (const id of recIds) {
      recordAction({ // recordAction-ok: wsId created via makeGrowthWorkspace above
        workspaceId: wsId,
        actionType: 'audit_fix_applied',
        sourceType: 'recommendation',
        sourceId: id,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: now },
        sourceFlag: 'live',
        baselineConfidence: 'exact',
        attribution: 'platform_executed',
        predictedEmv: null,
      });
    }

    // ── Run the REAL calibration (the median computation) ──
    runEmvCalibration(wsId);

    // ── Link 1: the outcome→prior read returns the MEASURED median (loop closed) ──
    const priors = getEffortPriorDays(wsId);
    expect(
      priors.audit_fix_applied,
      'P2: 3 completed live platform-executed audit_fix_applied outcomes stored, but getEffortPriorDays returned no measured prior — the outcomes→calibration→prior read is a dark loop (effort sample filter / median write / prior read broken).',
    ).toBeDefined();
    expect(
      priors.audit_fix_applied!,
      `P2: measured prior present but not ≈ ${EFFORT_DAYS}d (got ${priors.audit_fix_applied}) — the created_at − rec.createdAt effort computation is wrong.`,
    ).toBeGreaterThan(EFFORT_DAYS - 1.5);
    expect(priors.audit_fix_applied!).toBeLessThan(EFFORT_DAYS + 1.5);

    // ── Link 2 (best-effort): the rec scorer consumes the prior. ──
    // NARROWED + documented: the FULL "prior lowers roiPerEffortDay" direction proof
    // lives in tests/integration/recommendations-effort-priors.test.ts, which mocks
    // diagnostic-store to inject a rec to score. This plumbing guard is deliberately
    // self-contained (no per-phase store mocks beyond the provider seam), so a bare
    // workspace has no diagnostic/insight inputs and generateRecommendations may emit
    // ZERO recs — that is NOT a P2 wiring break, just an empty input set. Link 1 above
    // (getEffortPriorDays returns the measured median) is the authoritative "loop is
    // closed" assertion. Here we only assert the consumer doesn't THROW and, IF it
    // emits any scored rec, that rec carries an OV opportunity score.
    const recSet = await generateRecommendations(wsId);
    const scored = recSet.recommendations.find(r => r.opportunity != null);
    if (scored) {
      expect(
        scored.opportunity?.roiPerEffortDay,
        'P2: a recommendation was generated but carries no OV opportunity score — computeOpportunityValue (the effortDays consumer that reads the measured prior) did not run.',
      ).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P3 — AI-Overview free signal: page_keyword serp features → seoContext.serpFeatures
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P3 AI-Overview signal', () => {
  it('P3 ai-overview: an ai_overview serp feature on a page_keyword surfaces in assembleSeoContext.serpFeatures.aiOverview', async () => {
    const wsId = makeGrowthWorkspace('Plumbing P3 — AI Overview', 'https://acme-aeo.example');

    // P3 extracts the free `ai_overview` serp signal (already in serp_item_types from
    // ranked-keywords reads, no extra API call) into page_keywords.serp_features, then
    // aggregates it in the seoContext slice (→ the content-brief AEO directive + the
    // client serpOpportunities count). The chain we prove:
    //   upsertPageKeyword with serpFeatures including 'ai_overview'  →  listPageKeywords
    //   hydrates it  →  assembleSeoContext flatMaps + counts ai_overview  →
    //   seoContext.serpFeatures.aiOverview reflects it.
    //
    // 'ai_overview' is a RAW string label (no numeric serp-feature code) that passes
    // through parseSerpFeatures unchanged and is counted by f === 'ai_overview'.
    const pageKeyword: PageKeywordMap = {
      pagePath: '/aeo-answer-hub',
      pageTitle: 'AEO Answer Hub',
      primaryKeyword: 'how does answer engine optimization work',
      secondaryKeywords: [],
      serpFeatures: ['featured_snippet', 'ai_overview', 'people_also_ask'],
    };
    upsertPageKeyword(wsId, pageKeyword);

    // ── Link 1: store write round-trips the ai_overview signal ──
    const readBack = listPageKeywords(wsId);
    const stored = readBack.find(p => p.pagePath === '/aeo-answer-hub');
    expect(
      stored,
      'P3: upsertPageKeyword ran but listPageKeywords did not return the page — page_keywords store write/read broken.',
    ).toBeDefined();
    expect(
      stored!.serpFeatures,
      'P3: page stored but serpFeatures missing — the serp_features column write/parse (migration 051) is broken.',
    ).toContain('ai_overview');

    // ── Link 2: user-facing read (seoContext slice) surfaces the AI-Overview count ──
    const seoContext = await assembleSeoContext(wsId);
    expect(
      seoContext.serpFeatures,
      'P3: ai_overview stored on a page_keyword but assembleSeoContext returned no serpFeatures aggregation — the slice does not read page_keywords serp features (dark loop). The content-brief AEO directive + client serpOpportunities count would be blind to it.',
    ).toBeDefined();
    expect(
      seoContext.serpFeatures!.aiOverview,
      'P3: serpFeatures present but aiOverview count is 0 — the ai_overview signal stored on a page_keyword did NOT reach seoContext.serpFeatures.aiOverview. The free AI-Overview extraction is a dark loop.',
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P4 — workspace target-geo: targetGeo threads into the provider request
// (the `geo-targeting` flag that used to gate this was retired in flag-sunset
// Wave 2b — it was globally ON in prod, so the resolution is now unconditional.)
// ═══════════════════════════════════════════════════════════════════════════
describe('SEO Decision Engine plumbing — P4 target-geo', () => {
  it('P4 target-geo: a non-US workspace targetGeo threads through workspaceProviderGeo AND into the national-serp provider request', async () => {
    const KEYWORD = 'assurance habitation montreal';
    const wsId = makeGrowthWorkspace('Plumbing P4 — Target Geo', 'https://acme-ca.example');

    // P4 routes the workspace targetGeo through workspaceProviderGeo into provider call
    // request bodies (so non-US clients aren't queried as US/'en'). Canada = locationCode
    // 2124, language 'fr'. The US default is locationCode 2840 / 'en'. The chain we prove
    // is BOTH halves: the contract helper every caller depends on, AND a real caller
    // (the national-serp job) actually threading the captured geo into the provider request.
    const CANADA_LOCATION = 2124;
    const CANADA_LANGUAGE = 'fr';
    const US_LOCATION = 2840;

    // ── Contract: targetGeo set → the workspace geo (NOT the US default) ──
    updateWorkspace(wsId, { targetGeo: { locationCode: CANADA_LOCATION, languageCode: CANADA_LANGUAGE, countryCode: 'CA', label: 'Canada' } });
    const geo = workspaceProviderGeo(wsId);
    expect(
      geo.locationCode,
      `P4: Canada targetGeo set, but workspaceProviderGeo returned locationCode ${geo.locationCode} (expected ${CANADA_LOCATION}) — targetGeo not resolved (still defaulting to US ${US_LOCATION}?).`,
    ).toBe(CANADA_LOCATION);
    expect(geo.languageCode, 'P4: languageCode is not the set fr — targetGeo language not resolved.').toBe(CANADA_LANGUAGE);

    // ── Real plumbing: the national-serp job must thread that geo into the provider request ──
    // Job gates: tier growth ✓ · liveDomain ✓ · provider.getNationalSerp ✓ (mock) ·
    // ≥1 tracked keyword ✓. The fake getNationalSerp captures the request arg.
    addTrackedKeyword(wsId, KEYWORD, { pinned: false });
    providerState.national = {
      query: KEYWORD,
      position: null,
      matchedUrl: null,
      features: ['organic'],
      aiOverviewPresent: false,
      aiOverviewCited: null,
    };

    const job = createJob(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, { workspaceId: wsId });
    await runNationalSerpRefreshJob(wsId, job.id);

    expect(
      providerState.nationalCalls,
      'P4: national-serp job never called the provider — it no-op\'d on a gate (tier / liveDomain / tracked keywords). Cannot assert geo threading.',
    ).toBeGreaterThan(0);
    const req = providerState.nationalRequests.find(r => r.locationCode != null);
    expect(
      req,
      'P4: provider was called but no request carried a locationCode — the job did not thread workspaceProviderGeo into the getNationalSerp request body at all.',
    ).toBeDefined();
    expect(
      req!.locationCode,
      `P4: provider request locationCode is ${req!.locationCode} (expected Canada ${CANADA_LOCATION}, NOT US ${US_LOCATION}) — targetGeo set, but the geo threading into the provider request is dark (a non-US client would be queried as US).`,
    ).toBe(CANADA_LOCATION);
    expect(
      req!.languageCode,
      `P4: provider request languageCode is ${req!.languageCode} (expected ${CANADA_LANGUAGE}) — language not threaded into the provider request.`,
    ).toBe(CANADA_LANGUAGE);
  });
});
