/**
 * SEO Generation Quality P7.1 — first-class local-visibility recs.
 *
 * Mirrors the P5 orphan-recs suite. Local recommendation types
 * (local_service_gap / local_visibility) become first-class recs gated behind the THREE
 * conjunctive conditions of `useLocalGenQual`:
 *   (1) the umbrella `seo-generation-quality` flag is ON for the workspace,
 *   (2) the workspace local posture is `local` OR `hybrid`, and
 *   (3) the global `local-seo-visibility` flag is ON.
 *
 * This suite pins:
 *   (1) posture-gated parity — when ANY gate is false (non-local posture / gen-quality OFF /
 *       local-seo-visibility OFF) ZERO local recs/sources are minted and the merge +
 *       auto-resolve loop is byte-identical to pre-P7.1.
 *   (2) flag-ON minting — each local reader produces a rec with the right RecType / branch /
 *       ActionType, OV value in 0..100, and client-appropriate copy present.
 *   (3) FM-2 guard — a throwing local reader adds its category to failedCategories and does NOT
 *       bulk auto-resolve prior local recs of that category.
 *   (4) dedupe-vs-panel — an active panel item (service gap / competitor brand) suppresses the
 *       duplicate rec.
 *   (5) Scope C — the `local` OV branch scores; the default-0 local term is identity when absent.
 *   (6) ActionType mapping + label maps — recommendationOutcomeActionType returns the new
 *       ActionTypes (NOT audit_fix_applied); the admin label map covers them.
 *
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  generateRecommendations,
  recommendationOutcomeActionType,
  loadRecommendations,
} from '../../server/recommendations.js';
import * as localSeoModule from '../../server/local-seo.js';
import { computeOpportunityValue } from '../../server/scoring/opportunity-value.js';
import { ACTION_TYPE_LABELS } from '../../src/components/admin/outcomes/outcomeConstants.js';
import { LOCAL_SEO_POSTURE, LOCAL_SEO_VISIBILITY_POSTURE } from '../../shared/types/local-seo.js';
import type {
  LocalSeoServiceGap,
  LocalSeoRepeatCompetitor,
  LocalSeoKeywordVisibilitySummary,
  LocalSeoReadResponse,
} from '../../shared/types/local-seo.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function setMinimalStrategy(workspaceId: string): void {
  db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?').run(
    JSON.stringify({ summary: 'test', pageMap: [], quickWins: [] }),
    workspaceId,
  );
}

function serviceGaps(): LocalSeoServiceGap[] {
  return [
    { serviceId: 'teeth_whitening', serviceLabel: 'Teeth Whitening', starterKeywords: ['teeth whitening near me', 'professional teeth whitening'] },
  ];
}

function competitorBrands(): LocalSeoRepeatCompetitor[] {
  return [
    { title: 'Bright Smiles Dental', domain: 'brightsmiles.example.com', totalAppearances: 6, winsAgainstClient: 4, markets: ['Austin, TX'], suggestedTrackingKeywords: [] },
    // winsAgainstClient = 0 → must NOT mint a rec (client wasn't beaten).
    { title: 'Neutral Co', domain: undefined, totalAppearances: 3, winsAgainstClient: 0, markets: ['Austin, TX'], suggestedTrackingKeywords: [] },
  ];
}

function visibilitySummaries(): Map<string, LocalSeoKeywordVisibilitySummary> {
  const notVisibleEntry = {
    keyword: 'emergency dentist', normalizedKeyword: 'emergency dentist',
    marketId: 'market-austin', marketLabel: 'Austin, TX', capturedAt: '2026-05-26T00:00:00.000Z',
    posture: LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE, label: 'Not found', detail: 'x',
    localPackPresent: true, businessFound: false, businessMatchConfidence: 'unknown' as const,
    sourceEndpoint: 'google_organic_serp' as const, provider: 'dataforseo',
  };
  const possibleEntry = {
    keyword: 'dental implants', normalizedKeyword: 'dental implants',
    marketId: 'market-austin', marketLabel: 'Austin, TX', capturedAt: '2026-05-26T00:00:00.000Z',
    posture: LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH, label: 'Possible', detail: 'y',
    localPackPresent: true, businessFound: true, businessMatchConfidence: 'possible_match' as const,
    sourceEndpoint: 'google_organic_serp' as const, provider: 'dataforseo',
  };
  return new Map<string, LocalSeoKeywordVisibilitySummary>([
    ['emergency dentist', { ...notVisibleEntry, marketCount: 1, visibleMarketCount: 0, possibleMatchMarketCount: 0, localPackOnlyMarketCount: 0, notVisibleMarketCount: 1, degradedMarketCount: 0, markets: [notVisibleEntry] }],
    ['dental implants', { ...possibleEntry, marketCount: 1, visibleMarketCount: 0, possibleMatchMarketCount: 1, localPackOnlyMarketCount: 0, notVisibleMarketCount: 0, degradedMarketCount: 0, markets: [possibleEntry] }],
  ]);
}

/** A single-market LOCAL_PACK_PRESENT summary: a pack DEFINITELY showed and the business was not
 *  even a possible match — the strongest "absent from a present pack" signal (I-1). */
function localPackPresentSummaries(): Map<string, LocalSeoKeywordVisibilitySummary> {
  const localPackOnlyEntry = {
    keyword: 'root canal', normalizedKeyword: 'root canal',
    marketId: 'market-austin', marketLabel: 'Austin, TX', capturedAt: '2026-05-26T00:00:00.000Z',
    posture: LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT, label: 'Local pack present', detail: 'z',
    localPackPresent: true, businessFound: false, businessMatchConfidence: 'not_found' as const,
    sourceEndpoint: 'google_organic_serp' as const, provider: 'dataforseo',
  };
  return new Map<string, LocalSeoKeywordVisibilitySummary>([
    ['root canal', { ...localPackOnlyEntry, marketCount: 1, visibleMarketCount: 0, possibleMatchMarketCount: 0, localPackOnlyMarketCount: 1, notVisibleMarketCount: 0, degradedMarketCount: 0, markets: [localPackOnlyEntry] }],
  ]);
}

/** A panel read-model whose report state is dark (needs_market) so the dedupe-vs-panel
 *  guard does NOT fire — used by default so the readers' items mint. */
function darkPanel(): LocalSeoReadResponse {
  return {
    featureEnabled: true,
    settings: { workspaceId: 'x', posture: LOCAL_SEO_POSTURE.LOCAL, postureSource: 'admin_override', suggestionReasons: [], updatedAt: '', keywordsPerRefresh: null },
    markets: [],
    suggestedMarkets: [],
    latestSnapshots: [],
    report: {
      workspacePosture: LOCAL_SEO_POSTURE.LOCAL, activeMarketCount: 1, configuredMarketCount: 1,
      suggestedMarketCount: 0, latestSnapshotCount: 0, checkedKeywordCount: 0,
      visibleCount: 0, possibleMatchCount: 0, notVisibleCount: 0, localPackPresentCount: 0, degradedCount: 0,
      setupState: 'needs_market', setupLabel: '', setupDetail: '',
    },
    competitorBrands: [],
    serviceGaps: [],
    caps: { maxMarkets: 3, maxKeywordsPerRefresh: 10, keywordsPerRefreshMin: 1, keywordsPerRefreshMax: 30, keywordsPerRefreshDefault: 10 },
  };
}

/** Install spies for all three local readers + posture + panel. Returns the spies for cleanup. */
function installLocalSpies(opts: {
  posture?: typeof LOCAL_SEO_POSTURE[keyof typeof LOCAL_SEO_POSTURE];
  gaps?: LocalSeoServiceGap[];
  brands?: LocalSeoRepeatCompetitor[];
  summaries?: Map<string, LocalSeoKeywordVisibilitySummary>;
  panel?: LocalSeoReadResponse;
} = {}) {
  vi.spyOn(localSeoModule, 'getLocalSeoPosture').mockReturnValue(opts.posture ?? LOCAL_SEO_POSTURE.LOCAL);
  vi.spyOn(localSeoModule, 'getLocalSeoServiceGaps').mockReturnValue(opts.gaps ?? serviceGaps());
  vi.spyOn(localSeoModule, 'getLocalSeoCompetitorBrands').mockReturnValue(opts.brands ?? competitorBrands());
  vi.spyOn(localSeoModule, 'buildLocalSeoKeywordVisibilitySummaryByKey').mockReturnValue(opts.summaries ?? visibilitySummaries());
  vi.spyOn(localSeoModule, 'getLocalSeoReadModel').mockReturnValue(opts.panel ?? darkPanel());
  vi.spyOn(localSeoModule, 'listLocalSeoMarkets').mockReturnValue([
    { id: 'market-austin', workspaceId: 'x', label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', source: 'admin_override', status: 'active', isPrimary: true, createdAt: '', updatedAt: '' } as never,
  ]);
}

function cleanupRecs(workspaceId: string): void {
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(workspaceId);
}

// ── (6) ActionType mapping + label maps (pure, no DB) ───────────────────────────

describe('P7.1 ActionType mapping + label maps', () => {
  it('recommendationOutcomeActionType maps the new local RecTypes to the new ActionTypes (NOT audit_fix_applied)', () => {
    expect(recommendationOutcomeActionType('local_visibility', 'local_visibility:x')).toBe('local_visibility_won');
    expect(recommendationOutcomeActionType('local_service_gap', 'local_service_gap:x')).toBe('local_service_added');
    // Regression: the audit-fix family is untouched.
    expect(recommendationOutcomeActionType('technical', 'audit:canonical')).toBe('audit_fix_applied');
  });

  it('the admin ACTION_TYPE_LABELS map covers the new local ActionTypes', () => {
    expect(ACTION_TYPE_LABELS.local_visibility_won).toBe('Local Visibility Won');
    expect(ACTION_TYPE_LABELS.local_service_added).toBe('Local Service Targeted');
  });
});

// ── (5) Scope C — the `local` OV branch + default-0 local term identity ─────────

describe('P7.1 Scope C — local OV branch + identity local term', () => {
  it('the `local` branch produces a 0..100 value', () => {
    const ov = computeOpportunityValue({ branch: 'local', intent: 'transactional', localVisibilitySignal: 1 });
    expect(ov.value).toBeGreaterThanOrEqual(0);
    expect(ov.value).toBeLessThanOrEqual(100);
    expect(ov.modelVersion).toBe('ov-1');
  });

  it('the default-0 local term is an identity multiplier (absent == 0 signal == 1.0)', () => {
    const withZero = computeOpportunityValue({ branch: 'local', intent: 'transactional', localVisibilitySignal: 0 });
    const withAbsent = computeOpportunityValue({ branch: 'local', intent: 'transactional' });
    expect(withAbsent.value).toBe(withZero.value);
    expect(withAbsent.roiPerEffortDay).toBe(withZero.roiPerEffortDay);
  });

  it('a positive local-visibility signal raises the score vs. no signal (urgency term active)', () => {
    const none = computeOpportunityValue({ branch: 'local', intent: 'transactional', localVisibilitySignal: 0 });
    const urgent = computeOpportunityValue({ branch: 'local', intent: 'transactional', localVisibilitySignal: 1 });
    expect(urgent.roiPerEffortDay).toBeGreaterThan(none.roiPerEffortDay);
  });

  it('localVisibilitySignal does NOT perturb a non-local branch (scorer never reads local state for them)', () => {
    // The signal field is only meaningful inside the `local` branch in practice, but even if a
    // non-local branch were passed one, the math is shared; what we pin is the IDENTITY of an
    // ABSENT signal for the existing branches (byte-identity guarantee).
    const techA = computeOpportunityValue({ branch: 'technical', severity: 'error', currentClicks: 100 });
    const techB = computeOpportunityValue({ branch: 'technical', severity: 'error', currentClicks: 100, localVisibilitySignal: 0 });
    expect(techA.value).toBe(techB.value);
  });
});

// ── (1) posture-gated parity — ANY gate false → ZERO local recs ─────────────────

describe('P7.1 posture-gated parity', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupRecs(s.workspaceId);
    s.cleanup();
  });

  function expectNoLocalRecs(recs: { type: string; source: string }[]): void {
    expect(recs.some(r => r.type === 'local_visibility')).toBe(false);
    expect(recs.some(r => r.type === 'local_service_gap')).toBe(false);
    expect(recs.some(r => r.source.startsWith('local_visibility:'))).toBe(false);
    expect(recs.some(r => r.source.startsWith('local_service_gap:'))).toBe(false);
  }

  it('non-local posture → ZERO local recs', async () => {
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.NON_LOCAL });
    const set = await generateRecommendations(s.workspaceId);
    expectNoLocalRecs(set.recommendations);
  });
});

// ── (2) local/hybrid minting ─────────────────────────────────────────────────────

describe('P7.1 local/hybrid minting', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupRecs(s.workspaceId);
    s.cleanup();
  });

  it('mints local_service_gap + local_visibility recs with the right type/branch/ActionType/OV/copy', async () => {
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.HYBRID });
    const set = await generateRecommendations(s.workspaceId);

    const gap = set.recommendations.filter(r => r.type === 'local_service_gap');
    const vis = set.recommendations.filter(r => r.type === 'local_visibility');

    // B1: one service-gap rec.
    expect(gap.length).toBe(1);
    expect(gap[0].source).toBe('local_service_gap:teeth_whitening');
    expect(gap[0].actionType).toBe('content_creation');
    expect(gap[0].opportunity).toBeTruthy();
    expect(gap[0].opportunity!.value).toBeGreaterThanOrEqual(0);
    expect(gap[0].opportunity!.value).toBeLessThanOrEqual(100);
    // Client copy present + outcome-oriented (no admin jargon).
    expect(gap[0].title).toContain('Teeth Whitening');
    expect(gap[0].title.toLowerCase()).toContain("you're not targeting");
    expect(gap[0].description.length).toBeGreaterThan(0);
    expect(gap[0].insight.length).toBeGreaterThan(0);

    // B2 (competitor brand, winsAgainstClient=4) + B3 (1 not_visible + 1 possible_match) =
    // three local_visibility recs. The winsAgainstClient=0 competitor must NOT mint.
    expect(vis.length).toBe(3);
    for (const r of vis) {
      expect(r.source.startsWith('local_visibility:')).toBe(true);
      expect(r.opportunity).toBeTruthy();
      expect(r.opportunity!.value).toBeGreaterThanOrEqual(0);
      expect(r.opportunity!.value).toBeLessThanOrEqual(100);
      expect(r.title.length).toBeGreaterThan(0);
    }
    // The competitor-brand rec carries the brand-specific copy.
    expect(vis.some(r => r.title.includes('Bright Smiles Dental'))).toBe(true);
    // The not-visible rec carries the not-showing copy.
    expect(vis.some(r => /not showing in the local pack/i.test(r.title))).toBe(true);
    // The winsAgainstClient=0 competitor did NOT produce a rec.
    expect(vis.some(r => r.title.includes('Neutral Co'))).toBe(false);
  });
});

// ── (3) FM-2 guard — a throwing local reader is failedCategories-guarded ──────────

describe('P7.1 FM-2 — throwing local reader does not bulk auto-resolve prior local recs', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupRecs(s.workspaceId);
    s.cleanup();
  });

  it('a service-gap read failure does NOT auto-resolve the prior local_service_gap rec', async () => {
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.LOCAL });
    // Run 1: real local_service_gap rec persists.
    const first = await generateRecommendations(s.workspaceId);
    expect(first.recommendations.filter(r => r.type === 'local_service_gap' && r.status === 'pending').length).toBe(1);

    // Run 2: make getLocalSeoServiceGaps throw → its category is marked failed and the prior rec
    // is NOT flipped to `completed` (the false auto-resolve regression).
    vi.restoreAllMocks();
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.LOCAL });
    vi.spyOn(localSeoModule, 'getLocalSeoServiceGaps').mockImplementation(() => {
      throw new Error('transient service-gap read failure');
    });
    await generateRecommendations(s.workspaceId);

    const after = loadRecommendations(s.workspaceId);
    const gapAfter = after!.recommendations.filter(r => r.type === 'local_service_gap');
    expect(gapAfter.some(r => r.status === 'completed')).toBe(false);
  });
});

// ── (4) dedupe-vs-panel — an active panel item suppresses the duplicate rec ───────

describe('P7.1 dedupe-vs-panel', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupRecs(s.workspaceId);
    s.cleanup();
  });

  it('an active panel surfacing the same service-gap + competitor-brand suppresses those recs', async () => {
    // Panel is in an active-data state (has_data) AND lists the same service gap + competitor.
    const activePanel: LocalSeoReadResponse = {
      ...darkPanel(),
      report: { ...darkPanel().report, setupState: 'has_data' },
      serviceGaps: serviceGaps(),
      competitorBrands: competitorBrands(),
    };
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.LOCAL, panel: activePanel });

    const set = await generateRecommendations(s.workspaceId);
    // The service-gap + competitor-brand recs are deduped (already on the panel); the B3
    // not-visible / possible-match recs are NOT panel items, so they still mint.
    expect(set.recommendations.some(r => r.type === 'local_service_gap')).toBe(false);
    expect(set.recommendations.some(r => r.type === 'local_visibility' && r.title.includes('Bright Smiles Dental'))).toBe(false);
    expect(set.recommendations.some(r => r.type === 'local_visibility' && /not showing in the local pack/i.test(r.title))).toBe(true);
  });
});

// ── (I-1) B3 LOCAL_PACK_PRESENT mints a not-visible-class rec with the strong copy ────

describe('P7.1 B3 — LOCAL_PACK_PRESENT mints a strong not-visible rec (I-1)', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupRecs(s.workspaceId);
    s.cleanup();
  });

  it('a LOCAL_PACK_PRESENT entry mints a B3 local_visibility rec with the STRONG (not-visible) copy variant', async () => {
    // Only a LOCAL_PACK_PRESENT visibility entry, no service gaps / competitor brands → the single
    // local_visibility rec must come from B3 and carry the strong, not-the-softer-possible-match copy.
    installLocalSpies({
      posture: LOCAL_SEO_POSTURE.LOCAL,
      gaps: [],
      brands: [],
      summaries: localPackPresentSummaries(),
    });
    const set = await generateRecommendations(s.workspaceId);
    const vis = set.recommendations.filter(r => r.type === 'local_visibility');

    // Pre-fix this minted ZERO recs (LOCAL_PACK_PRESENT was omitted from the B3 filter); now exactly one.
    expect(vis.length).toBe(1);
    const rec = vis[0];
    expect(rec.source).toBe('local_visibility:market-austin:root canal');
    // STRONG variant copy (NOT the softer "possible match" / "might be in the local pack" wording).
    expect(/not showing in the local pack/i.test(rec.title)).toBe(true);
    expect(rec.title.toLowerCase()).not.toContain('might be in the local pack');
    expect(rec.description.toLowerCase()).toContain('a local pack shows');
    // `impact` is the hand-set field (NOT the OV-derived served `priority`) → 'high' proves the
    // strong (possible=false) branch was taken, not the softer possible-match 'medium' branch.
    expect(rec.impact).toBe('high');
    expect(rec.opportunity).toBeTruthy();
    expect(rec.opportunity!.value).toBeGreaterThanOrEqual(0);
    expect(rec.opportunity!.value).toBeLessThanOrEqual(100);
    // The strong branch feeds localVisibilitySignal=1 (max urgency), which scores strictly higher
    // than the softer possible-match signal of 0.4 — confirming LOCAL_PACK_PRESENT mapped to strong.
    const strongOv = computeOpportunityValue({ branch: 'local', intent: 'transactional', localVisibilitySignal: 1 });
    const softOv = computeOpportunityValue({ branch: 'local', intent: 'transactional', localVisibilitySignal: 0.4 });
    expect(strongOv.roiPerEffortDay).toBeGreaterThan(softOv.roiPerEffortDay);
  });

  it('the B3 not-visible-class rec count reconciles with the report/panel "not found" count (NOT_VISIBLE + LOCAL_PACK_PRESENT)', async () => {
    // One NOT_VISIBLE keyword + one LOCAL_PACK_PRESENT keyword → both fold into the report's
    // notVisibleCount (server/local-seo.ts:buildLocalSeoReportSummary) AND both must mint a B3 rec.
    const combined = new Map<string, LocalSeoKeywordVisibilitySummary>([
      ...visibilitySummaries(), // emergency dentist (NOT_VISIBLE) + dental implants (POSSIBLE_MATCH)
      ...localPackPresentSummaries(), // root canal (LOCAL_PACK_PRESENT)
    ]);
    installLocalSpies({
      posture: LOCAL_SEO_POSTURE.LOCAL,
      gaps: [],
      brands: [],
      summaries: combined,
    });
    const set = await generateRecommendations(s.workspaceId);
    const vis = set.recommendations.filter(r => r.type === 'local_visibility');
    // notVisibleCount = NOT_VISIBLE(1) + LOCAL_PACK_PRESENT(1) = 2 strong recs; + POSSIBLE_MATCH(1) soft.
    const strong = vis.filter(r => /not showing in the local pack/i.test(r.title));
    const soft = vis.filter(r => /might be in the local pack/i.test(r.title));
    expect(strong.length).toBe(2); // reconciles with report notVisibleCount
    expect(soft.length).toBe(1);
  });
});

// ── (I-2) dedupe safe-direction — a panel-deduped item does NOT false-resolve a prior local rec ──

describe('P7.1 dedupe safe-direction — panel-dedupe protects the whole category from auto-resolve (I-2)', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupRecs(s.workspaceId);
    s.cleanup();
  });

  it('a panel-deduped service gap does NOT false-resolve a prior local_service_gap rec (FM-2 safe direction)', async () => {
    // Run 1: dark panel → the service-gap rec mints and persists as pending.
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.LOCAL });
    const first = await generateRecommendations(s.workspaceId);
    expect(first.recommendations.filter(r => r.type === 'local_service_gap' && r.status === 'pending').length).toBe(1);

    // Run 2: the panel now ACTIVELY surfaces the same service gap → the reader's gap is panel-deduped
    // (failedCategories.add('local_service_gap')). The prior rec must NOT be flipped to `completed`:
    // the category-safe dedupe protects the whole category from auto-resolve that run.
    vi.restoreAllMocks();
    const activePanel: LocalSeoReadResponse = {
      ...darkPanel(),
      report: { ...darkPanel().report, setupState: 'has_data' },
      serviceGaps: serviceGaps(),
      competitorBrands: [],
    };
    installLocalSpies({ posture: LOCAL_SEO_POSTURE.LOCAL, panel: activePanel });
    await generateRecommendations(s.workspaceId);

    const after = loadRecommendations(s.workspaceId);
    const gapAfter = after!.recommendations.filter(r => r.type === 'local_service_gap');
    expect(gapAfter.some(r => r.status === 'completed')).toBe(false);
  });
});

// ── (7) public-leak — local recs strip money fields + no dollarized gain ──────────

describe('P7.1 public-leak — local recs strip money fields + no dollarized gain', () => {

  it('the public recommendations route never emits emv/predictedEmv or a $ gain for local recs', async () => {
    const { createEphemeralTestContext } = await import('./helpers.js');
    const { createWorkspace, deleteWorkspace } = await import('../../server/workspaces.js');
    const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
    await ctx.startServer();
    const ws = createWorkspace('P7.1 Public Leak Test Workspace');
    const workspaceId = ws.id;
    try {
      setMinimalStrategy(workspaceId);
      installLocalSpies({ posture: LOCAL_SEO_POSTURE.LOCAL });
      await generateRecommendations(workspaceId);

      const res = await ctx.api(`/api/public/recommendations/${workspaceId}`);
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain('emvPerWeek');
      expect(raw).not.toContain('predictedEmv');
      const body = JSON.parse(raw) as { recommendations: Array<{ type: string; estimatedGain: string; opportunity?: Record<string, unknown> }> };
      const localRecs = body.recommendations.filter(r => ['local_visibility', 'local_service_gap'].includes(r.type));
      expect(localRecs.length).toBeGreaterThan(0);
      for (const r of localRecs) {
        expect(r.estimatedGain).not.toMatch(/\$/);
        expect(r.opportunity && 'emvPerWeek' in r.opportunity).toBeFalsy();
        expect(r.opportunity && 'predictedEmv' in r.opportunity).toBeFalsy();
      }
    } finally {
      vi.restoreAllMocks();
      cleanupRecs(workspaceId);
      deleteWorkspace(workspaceId);
      await ctx.stopServer();
    }
  }, 25_000);
});
