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
}));

// broadcastToWorkspace() throws if setBroadcast() was never called (it normally is, in
// index.ts at server boot). This in-process test never boots the server, so stub the
// broadcast module to a no-op — the jobs fire WS events after their store writes, and we
// assert the STORE/READ chain, not the broadcast.
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/seo-data-provider.js', async (importActual) => {
  const actual = await importActual<typeof import('../../server/seo-data-provider.js')>();
  const FAKE_PROVIDER = {
    name: 'fake-test-provider',
    async getNationalSerp(): Promise<NationalSerpResult> {
      providerState.nationalCalls++;
      if (!providerState.national) throw new Error('test bug: providerState.national not set');
      return providerState.national;
    },
    async getBusinessListings(): Promise<BusinessListingResult[]> {
      providerState.listingCalls++;
      return providerState.listings;
    },
    async getLlmMentions(): Promise<LlmMentionsResult> {
      providerState.llmCalls++;
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
import { generateRecommendations } from '../../server/recommendations.js';

// P8 — AI visibility (LLM mentions)
import { runLlmMentionsRefreshJob } from '../../server/llm-mentions.js';
import { getLatestLlmMentions } from '../../server/llm-mentions-store.js';
import { assembleSeoContext } from '../../server/intelligence/seo-context-slice.js';

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
    //   aiVisibility summary is flag-gated on 'ai-visibility', so enable it.
    setWorkspaceFlagOverride('ai-visibility', wsId, true);

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
    const job = createJob(BACKGROUND_JOB_TYPES.LLM_MENTIONS_REFRESH, { workspaceId: wsId });
    await runLlmMentionsRefreshJob(wsId, job.id);

    expect(
      providerState.llmCalls,
      'P8: job never called provider.getLlmMentions — it no-op\'d on a gate (tier / liveDomain / provider method / budget). Workspace not set up to pass the job gates.',
    ).toBeGreaterThan(0);

    // ── Link 1: store write ──
    const snapshot = getLatestLlmMentions(wsId, 'chat_gpt');
    expect(
      snapshot,
      'P8: job ran but getLatestLlmMentions(chat_gpt) empty — store write broken (job → llm_mention_snapshots).',
    ).toBeDefined();
    expect(snapshot!.mentions).toBe(14);
    expect(snapshot!.shareOfVoice).toBeCloseTo(0.37, 5);
    expect(snapshot!.competitors.length).toBeGreaterThan(0);

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
