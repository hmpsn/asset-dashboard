/**
 * Wave 13 — Pure unit tests for server/keyword-command-center.ts.
 *
 * Covers all exported pure utility functions (no DB, no external API calls):
 * - feedbackState
 * - ensureRow
 * - assignmentPriority
 * - sourceFromExplanation
 * - sourceFromKeywordGap
 * - isInactiveTracking
 * - protectedReason
 * - lifecycleStatus
 * - statusLabel
 * - localPriority
 * - sortRows / sortRowsForQuery
 * - matchesFilter
 * - matchesSearch
 * - stripLocalSeoVisibility
 * - paginateRows
 * - filterCount
 * - filterNeedsLocalCandidates
 * - buildCounts
 * - buildFilterFacetsFromCounts
 * - trackedKeywordMatchesFilter
 */
import { describe, it, expect } from 'vitest';
import {
  feedbackState,
  ensureRow,
  assignmentPriority,
  sourceFromExplanation,
  sourceFromKeywordGap,
  isInactiveTracking,
  protectedReason,
  lifecycleStatus,
  statusLabel,
  localPriority,
  sortRows,
  sortRowsForQuery,
  matchesFilter,
  matchesSearch,
  stripLocalSeoVisibility,
  paginateRows,
  filterCount,
  filterNeedsLocalCandidates,
  buildCounts,
  buildFilterFacetsFromCounts,
  trackedKeywordMatchesFilter,
} from '../../server/keyword-command-center.js';
import {
  KEYWORD_COMMAND_CENTER_STATUS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterFilter,
} from '../../shared/types/keyword-command-center.js';
import {
  TRACKED_KEYWORD_STATUS,
  TRACKED_KEYWORD_SOURCE,
  type TrackedKeyword,
} from '../../shared/types/rank-tracking.js';
import {
  LOCAL_SEO_VISIBILITY_POSTURE,
  type LocalSeoKeywordVisibilitySummary,
} from '../../shared/types/local-seo.js';

// ─── Helper factories ──────────────────────────────────────────────────────────

function makeTrackedKeyword(overrides: Partial<TrackedKeyword> = {}): TrackedKeyword {
  return {
    query: 'test keyword',
    pinned: false,
    addedAt: '2024-01-01T00:00:00Z',
    status: TRACKED_KEYWORD_STATUS.ACTIVE,
    source: TRACKED_KEYWORD_SOURCE.MANUAL,
    ...overrides,
  };
}

function makeVisibilitySummary(
  posture: LocalSeoKeywordVisibilitySummary['posture'],
  overrides: Partial<LocalSeoKeywordVisibilitySummary> = {},
): LocalSeoKeywordVisibilitySummary {
  return {
    keyword: 'test keyword',
    normalizedKeyword: 'test keyword',
    marketId: 'market-1',
    marketLabel: 'Austin, TX',
    capturedAt: '2024-01-01T00:00:00Z',
    posture,
    label: 'Test label',
    detail: 'Test detail',
    localPackPresent: false,
    marketCount: 1,
    markets: [],
    visibleMarketCount: 0,
    possibleMatchMarketCount: 0,
    localPackOnlyMarketCount: 0,
    notVisibleMarketCount: 0,
    degradedMarketCount: 0,
    ...overrides,
  };
}

/** Build a minimal KeywordCommandCenterRow for filter/sort tests. */
function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'seo agency',
    normalizedKeyword: 'seoagency',
    lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
    statusLabel: 'In Strategy',
    sourceLabels: [],
    metrics: {},
    tracking: { status: 'not_tracked' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

// ─── feedbackState ────────────────────────────────────────────────────────────

describe('feedbackState', () => {
  it('returns approved feedback state', () => {
    const result = feedbackState({
      keyword: 'seo', status: 'approved', reason: 'Fits brand', source: 'admin', updated_at: '2024-01-01',
    });
    expect(result).toEqual({
      status: 'approved',
      reason: 'Fits brand',
      source: 'admin',
      updatedAt: '2024-01-01',
    });
  });

  it('returns declined feedback state', () => {
    const result = feedbackState({
      keyword: 'seo', status: 'declined', reason: null, source: null, updated_at: null,
    });
    expect(result).toEqual({ status: 'declined', reason: undefined, source: undefined, updatedAt: undefined });
  });

  it('returns requested feedback state', () => {
    const result = feedbackState({
      keyword: 'seo', status: 'requested', reason: 'Client wants this', source: 'client', updated_at: '2024-02-01',
    });
    expect(result?.status).toBe('requested');
    expect(result?.reason).toBe('Client wants this');
  });

  it('returns undefined for unknown status', () => {
    const result = feedbackState({
      keyword: 'seo', status: 'pending', reason: null, source: null, updated_at: null,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty status string', () => {
    const result = feedbackState({
      keyword: 'seo', status: '', reason: null, source: null, updated_at: null,
    });
    expect(result).toBeUndefined();
  });

  it('handles null reason/source gracefully by converting to undefined', () => {
    const result = feedbackState({
      keyword: 'kw', status: 'approved', reason: null, source: null, updated_at: null,
    });
    expect(result?.reason).toBeUndefined();
    expect(result?.source).toBeUndefined();
    expect(result?.updatedAt).toBeUndefined();
  });
});

// ─── ensureRow ────────────────────────────────────────────────────────────────

describe('ensureRow', () => {
  it('creates a new row for a fresh keyword', () => {
    const rows = new Map();
    const row = ensureRow(rows, 'content marketing');
    expect(row).not.toBeNull();
    expect(row!.keyword).toBe('content marketing');
    expect(row!.sourceLabels).toEqual([]);
    expect(row!.metrics).toEqual({});
  });

  it('returns existing row on second call with same keyword', () => {
    const rows = new Map();
    const first = ensureRow(rows, 'seo agency');
    first!.metrics.volume = 500;
    const second = ensureRow(rows, 'SEO Agency');
    expect(second).toBe(first);
    expect(second!.metrics.volume).toBe(500);
  });

  it('returns null for empty string keyword', () => {
    const rows = new Map();
    const result = ensureRow(rows, '');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only keyword', () => {
    const rows = new Map();
    const result = ensureRow(rows, '   ');
    expect(result).toBeNull();
  });

  it('trims the keyword on the stored row', () => {
    const rows = new Map();
    const row = ensureRow(rows, '  content strategy  ');
    expect(row!.keyword).toBe('content strategy');
  });

  it('stores normalized keyword separately from display keyword', () => {
    const rows = new Map();
    const row = ensureRow(rows, 'Content Marketing');
    expect(row!.keyword).toBe('Content Marketing');
    expect(row!.normalizedKeyword).toBeTruthy();
    expect(typeof row!.normalizedKeyword).toBe('string');
  });
});

// ─── assignmentPriority ───────────────────────────────────────────────────────

describe('assignmentPriority', () => {
  it('page_keyword has priority 4 (highest)', () => {
    expect(assignmentPriority('page_keyword')).toBe(4);
  });

  it('content_gap has priority 3', () => {
    expect(assignmentPriority('content_gap')).toBe(3);
  });

  it('site_keyword has priority 2', () => {
    expect(assignmentPriority('site_keyword')).toBe(2);
  });

  it('raw_evidence has priority 1', () => {
    expect(assignmentPriority('raw_evidence')).toBe(1);
  });

  it('undefined role has priority 0 (lowest)', () => {
    expect(assignmentPriority(undefined)).toBe(0);
  });

  it('page_keyword > content_gap > site_keyword > raw_evidence > undefined', () => {
    expect(assignmentPriority('page_keyword')).toBeGreaterThan(assignmentPriority('content_gap'));
    expect(assignmentPriority('content_gap')).toBeGreaterThan(assignmentPriority('site_keyword'));
    expect(assignmentPriority('site_keyword')).toBeGreaterThan(assignmentPriority('raw_evidence'));
    expect(assignmentPriority('raw_evidence')).toBeGreaterThan(assignmentPriority(undefined));
  });
});

// ─── sourceFromExplanation ────────────────────────────────────────────────────

describe('sourceFromExplanation', () => {
  const baseExplanation = {
    keyword: 'seo agency',
    normalizedKeyword: 'seoagency',
    surfaceLabel: 'Strategy',
    sourceEvidence: [],
    reasons: [],
    fitSignals: [],
    nextAction: { type: 'watch' as const, label: 'Watch', detail: 'Monitor' },
  };

  it('returns page_assignment label for page_keyword role', () => {
    const result = sourceFromExplanation({
      ...baseExplanation,
      role: 'page_keyword',
      pageTitle: 'SEO Services',
      pagePath: '/services',
    });
    expect(result.kind).toBe('page_assignment');
    expect(result.label).toBe('Page assignment');
    expect(result.detail).toBe('SEO Services');
  });

  it('falls back to pagePath when pageTitle is absent', () => {
    const result = sourceFromExplanation({
      ...baseExplanation,
      role: 'page_keyword',
      pagePath: '/services',
    });
    expect(result.detail).toBe('/services');
  });

  it('returns content_gap label for content_gap role', () => {
    const result = sourceFromExplanation({
      ...baseExplanation,
      role: 'content_gap',
      nextAction: { type: 'generate_brief' as const, label: 'Generate Brief', detail: 'Blog post about X' },
    });
    expect(result.kind).toBe('content_gap');
    expect(result.label).toBe('Content opportunity');
    expect(result.detail).toBe('Blog post about X');
  });

  it('returns raw_evidence label for competitor_gap role', () => {
    const result = sourceFromExplanation({
      ...baseExplanation,
      role: 'competitor_gap',
      sourceEvidence: ['competitor.com'],
      nextAction: { type: 'review_evidence' as const, label: 'Review', detail: 'Check evidence' },
    });
    expect(result.kind).toBe('raw_evidence');
    expect(result.detail).toBe('competitor.com');
  });

  it('uses fallback detail for competitor_gap with no source evidence', () => {
    const result = sourceFromExplanation({
      ...baseExplanation,
      role: 'competitor_gap',
      sourceEvidence: [],
      nextAction: { type: 'review_evidence' as const, label: 'Review', detail: 'Check' },
    });
    expect(result.detail).toBe('Provider keyword gap');
  });

  it('returns strategy label for site_keyword role', () => {
    const result = sourceFromExplanation({
      ...baseExplanation,
      role: 'site_keyword',
      surfaceLabel: 'Site Keyword',
    });
    expect(result.kind).toBe('strategy');
    expect(result.label).toBe('Strategy keyword');
    expect(result.detail).toBe('Site Keyword');
  });
});

// ─── sourceFromKeywordGap ─────────────────────────────────────────────────────

describe('sourceFromKeywordGap', () => {
  it('builds raw_evidence label from gap competitor info', () => {
    const result = sourceFromKeywordGap({
      keyword: 'seo services',
      competitorDomain: 'competitor.com',
      competitorPosition: 3,
      volume: 1000,
      difficulty: 40,
    });
    expect(result.kind).toBe('raw_evidence');
    expect(result.label).toBe('Raw provider evidence');
    expect(result.detail).toBe('competitor.com ranks #3');
  });

  it('handles position 1', () => {
    const result = sourceFromKeywordGap({
      keyword: 'kw',
      competitorDomain: 'top-site.com',
      competitorPosition: 1,
      volume: 500,
      difficulty: 30,
    });
    expect(result.detail).toBe('top-site.com ranks #1');
  });
});

// ─── isInactiveTracking ───────────────────────────────────────────────────────

describe('isInactiveTracking', () => {
  it('returns false for active keyword', () => {
    expect(isInactiveTracking(makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.ACTIVE }))).toBe(false);
  });

  it('returns false when status is undefined (defaults to active)', () => {
    expect(isInactiveTracking(makeTrackedKeyword({ status: undefined }))).toBe(false);
  });

  it('returns true for paused keyword', () => {
    expect(isInactiveTracking(makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.PAUSED }))).toBe(true);
  });

  it('returns true for deprecated keyword', () => {
    expect(isInactiveTracking(makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.DEPRECATED }))).toBe(true);
  });

  it('returns true for replaced keyword', () => {
    expect(isInactiveTracking(makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.REPLACED }))).toBe(true);
  });
});

// ─── protectedReason ─────────────────────────────────────────────────────────

describe('protectedReason', () => {
  it('returns undefined for undefined keyword', () => {
    expect(protectedReason(undefined)).toBeUndefined();
  });

  it('returns "Pinned keyword" for pinned keyword', () => {
    expect(protectedReason(makeTrackedKeyword({ pinned: true }))).toBe('Pinned keyword');
  });

  it('returns "Client-requested keyword" for client_requested source', () => {
    expect(protectedReason(makeTrackedKeyword({ pinned: false, source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED }))).toBe('Client-requested keyword');
  });

  it('returns "Manual keyword" for manual source', () => {
    expect(protectedReason(makeTrackedKeyword({ pinned: false, source: TRACKED_KEYWORD_SOURCE.MANUAL }))).toBe('Manual keyword');
  });

  it('returns undefined for strategy_primary source (not protected)', () => {
    expect(protectedReason(makeTrackedKeyword({ pinned: false, source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY }))).toBeUndefined();
  });

  it('pinned takes precedence over source', () => {
    const result = protectedReason(makeTrackedKeyword({ pinned: true, source: TRACKED_KEYWORD_SOURCE.MANUAL }));
    expect(result).toBe('Pinned keyword');
  });
});

// ─── lifecycleStatus ──────────────────────────────────────────────────────────

describe('lifecycleStatus', () => {
  function makeDraftRow(overrides: Record<string, unknown> = {}) {
    return {
      keyword: 'test',
      normalizedKeyword: 'test',
      sourceLabels: [],
      metrics: {},
      ...overrides,
    };
  }

  it('declined feedback → DECLINED', () => {
    expect(lifecycleStatus(makeDraftRow({ feedback: { status: 'declined' } }))).toBe(KEYWORD_COMMAND_CENTER_STATUS.DECLINED);
  });

  it('inactive tracking → RETIRED', () => {
    const row = makeDraftRow({
      tracking: makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.PAUSED }),
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.RETIRED);
  });

  it('approved feedback → IN_STRATEGY', () => {
    expect(lifecycleStatus(makeDraftRow({ feedback: { status: 'approved' } }))).toBe(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY);
  });

  it('requested feedback → NEEDS_REVIEW', () => {
    expect(lifecycleStatus(makeDraftRow({ feedback: { status: 'requested' } }))).toBe(KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW);
  });

  it('explanation with page_keyword role → IN_STRATEGY', () => {
    const row = makeDraftRow({
      explanation: {
        keyword: 'test', normalizedKeyword: 'test', role: 'page_keyword',
        surfaceLabel: '', sourceEvidence: [], reasons: [], fitSignals: [],
        nextAction: { type: 'watch', label: '', detail: '' },
      },
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY);
  });

  it('explanation with competitor_gap role (only) → falls through to later rules', () => {
    const row = makeDraftRow({
      explanation: {
        keyword: 'test', normalizedKeyword: 'test', role: 'competitor_gap',
        surfaceLabel: '', sourceEvidence: [], reasons: [], fitSignals: [],
        nextAction: { type: 'review_evidence', label: '', detail: '' },
        rawEvidenceOnly: true,
      },
      rawEvidenceOnly: true,
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE);
  });

  it('assignment with page_keyword role → IN_STRATEGY', () => {
    const row = makeDraftRow({ assignment: { role: 'page_keyword', pagePath: '/test' } });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY);
  });

  it('assignment with raw_evidence role does NOT count as IN_STRATEGY', () => {
    const row = makeDraftRow({ assignment: { role: 'raw_evidence' } });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE);
  });

  it('Wave 3d-ii: strategy-OWNED tracking (strategyOwned=true) → IN_STRATEGY', () => {
    const row = makeDraftRow({
      tracking: makeTrackedKeyword({ strategyOwned: true, status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY);
  });

  it('Wave 3d-ii: a STRATEGY_* source WITHOUT strategyOwned is NOT IN_STRATEGY (decoupled)', () => {
    // Classification is decoupled from the source enum — a strategy-sourced row that
    // reconcile does not currently own (strategyOwned undefined) falls through to
    // TRACKED, not IN_STRATEGY.
    const row = makeDraftRow({
      tracking: makeTrackedKeyword({ source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY, status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.TRACKED);
  });

  it('active tracking with manual source → TRACKED', () => {
    const row = makeDraftRow({
      tracking: makeTrackedKeyword({ source: TRACKED_KEYWORD_SOURCE.MANUAL, status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.TRACKED);
  });

  it('rawEvidenceOnly flag → RAW_EVIDENCE', () => {
    const row = makeDraftRow({ rawEvidenceOnly: true });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE);
  });

  it('row with rank (but no tracking/feedback) → NEEDS_REVIEW', () => {
    const row = makeDraftRow({ rank: { query: 'test', position: 5, clicks: 10, impressions: 100, ctr: 0.1 } });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW);
  });

  it('row with localCandidate (no tracking/feedback) → NEEDS_REVIEW', () => {
    const row = makeDraftRow({
      localCandidate: {
        keyword: 'test', selected: false, source: 'local_variant',
        sourceLabel: 'Local variant', detail: 'Candidate',
      },
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW);
  });

  it('bare row with no signals → RAW_EVIDENCE', () => {
    const row = makeDraftRow({});
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE);
  });

  it('DECLINED takes priority over RETIRED (feedback.status = declined checked first)', () => {
    const row = makeDraftRow({
      feedback: { status: 'declined' },
      tracking: makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.PAUSED }),
    });
    expect(lifecycleStatus(row)).toBe(KEYWORD_COMMAND_CENTER_STATUS.DECLINED);
  });
});

// ─── statusLabel ─────────────────────────────────────────────────────────────

describe('statusLabel', () => {
  it('IN_STRATEGY → "In Strategy"', () => {
    expect(statusLabel(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY)).toBe('In Strategy');
  });

  it('TRACKED → "Tracked"', () => {
    expect(statusLabel(KEYWORD_COMMAND_CENTER_STATUS.TRACKED)).toBe('Tracked');
  });

  it('NEEDS_REVIEW → "Needs Review"', () => {
    expect(statusLabel(KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW)).toBe('Needs Review');
  });

  it('RAW_EVIDENCE → "Raw Evidence"', () => {
    expect(statusLabel(KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE)).toBe('Raw Evidence');
  });

  it('DECLINED → "Declined"', () => {
    expect(statusLabel(KEYWORD_COMMAND_CENTER_STATUS.DECLINED)).toBe('Declined');
  });

  it('RETIRED → "Retired"', () => {
    expect(statusLabel(KEYWORD_COMMAND_CENTER_STATUS.RETIRED)).toBe('Retired');
  });
});

// ─── localPriority ────────────────────────────────────────────────────────────

describe('localPriority', () => {
  it('returns NEEDS_SETUP when activeMarketCount is 0', () => {
    const result = localPriority(undefined, 0);
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP);
    expect(result.priorityLabel).toBe('Needs setup');
  });

  it('returns INVESTIGATE/Ready to check when no visibility and markets exist', () => {
    const result = localPriority(undefined, 1);
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE);
    expect(result.priorityLabel).toBe('Ready to check');
  });

  it('returns DEFEND for VISIBLE posture', () => {
    const result = localPriority(makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE), 1);
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND);
    expect(result.priorityLabel).toBe('Defend');
  });

  it('returns INVESTIGATE for POSSIBLE_MATCH posture', () => {
    const result = localPriority(makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH), 1);
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE);
    expect(result.priorityLabel).toBe('Investigate');
  });

  it('returns INVESTIGATE for PROVIDER_DEGRADED posture', () => {
    const result = localPriority(makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED), 1);
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE);
  });

  it('returns HIGH_OPPORTUNITY for LOCAL_PACK_PRESENT posture', () => {
    const result = localPriority(makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT), 1);
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY);
    expect(result.priorityLabel).toBe('High opportunity');
  });

  it('returns HIGH_OPPORTUNITY for NOT_VISIBLE + localPackPresent', () => {
    const result = localPriority(
      makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE, { localPackPresent: true }),
      1,
    );
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY);
  });

  it('returns LOW_PRIORITY for NOT_VISIBLE without local pack', () => {
    const result = localPriority(
      makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE, { localPackPresent: false }),
      1,
    );
    expect(result.priority).toBe(KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.LOW_PRIORITY);
    expect(result.priorityLabel).toBe('Low priority');
  });
});

// ─── sortRows ─────────────────────────────────────────────────────────────────

describe('sortRows', () => {
  it('sorts by lifecycleStatus order: IN_STRATEGY before TRACKED', () => {
    const a = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: {} });
    const b = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, metrics: {} });
    expect(sortRows(a, b)).toBeGreaterThan(0);
    expect(sortRows(b, a)).toBeLessThan(0);
  });

  it('sorts DECLINED before RETIRED (DECLINED=4, RETIRED=5 in status order)', () => {
    const a = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.DECLINED });
    const b = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RETIRED });
    expect(sortRows(a, b)).toBeLessThan(0);
    expect(sortRows(b, a)).toBeGreaterThan(0);
  });

  it('same status: higher volume comes first', () => {
    const a = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, metrics: { volume: 100 } });
    const b = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, metrics: { volume: 1000 } });
    expect(sortRows(a, b)).toBeGreaterThan(0);
    expect(sortRows(b, a)).toBeLessThan(0);
  });

  it('same status and volume: falls back to impressions', () => {
    const a = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: { impressions: 50 } });
    const b = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: { impressions: 500 } });
    expect(sortRows(a, b)).toBeGreaterThan(0);
  });

  it('same status, volume, and impressions: falls back to alphabetical by keyword', () => {
    const a = makeRow({ keyword: 'zebra', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE, metrics: {} });
    const b = makeRow({ keyword: 'apple', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE, metrics: {} });
    expect(sortRows(a, b)).toBeGreaterThan(0);
    expect(sortRows(b, a)).toBeLessThan(0);
  });

  it('identical rows return 0', () => {
    const a = makeRow({ keyword: 'same', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: { volume: 100 } });
    const b = makeRow({ keyword: 'same', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: { volume: 100 } });
    expect(sortRows(a, b)).toBe(0);
  });
});

// ─── sortRowsForQuery ─────────────────────────────────────────────────────────

describe('sortRowsForQuery', () => {
  it('undefined sort → default sortRows comparator', () => {
    const fn = sortRowsForQuery(undefined);
    const a = makeRow({ keyword: 'a', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, metrics: {} });
    const b = makeRow({ keyword: 'b', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: {} });
    expect(fn(a, b)).toBeLessThan(0);
  });

  it('"keyword" sort → alphabetical by keyword', () => {
    const fn = sortRowsForQuery('keyword');
    const a = makeRow({ keyword: 'zebra' });
    const b = makeRow({ keyword: 'apple' });
    expect(fn(a, b)).toBeGreaterThan(0);
    expect(fn(b, a)).toBeLessThan(0);
  });

  it('"demand" sort → higher volume first', () => {
    const fn = sortRowsForQuery('demand');
    const a = makeRow({ metrics: { volume: 200 } });
    const b = makeRow({ metrics: { volume: 2000 } });
    expect(fn(a, b)).toBeGreaterThan(0);
    expect(fn(b, a)).toBeLessThan(0);
  });

  it('"demand" sort equal volumes → falls back to default sort', () => {
    const fn = sortRowsForQuery('demand');
    const a = makeRow({ keyword: 'b', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: { volume: 500 } });
    const b = makeRow({ keyword: 'a', lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, metrics: { volume: 500 } });
    // Same demand → alphabetical fallback
    expect(fn(a, b)).toBeGreaterThan(0);
  });

  it('"rank" sort → lower position number first', () => {
    const fn = sortRowsForQuery('rank');
    const a = makeRow({ metrics: { currentPosition: 10 } });
    const b = makeRow({ metrics: { currentPosition: 2 } });
    expect(fn(a, b)).toBeGreaterThan(0);
    expect(fn(b, a)).toBeLessThan(0);
  });

  it('"rank" sort with undefined position → infinity (sorts last)', () => {
    const fn = sortRowsForQuery('rank');
    const a = makeRow({ metrics: {} });
    const b = makeRow({ metrics: { currentPosition: 5 } });
    expect(fn(a, b)).toBeGreaterThan(0);
  });
});

// ─── matchesFilter ────────────────────────────────────────────────────────────

describe('matchesFilter', () => {
  it('ALL filter matches any row', () => {
    const row = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.DECLINED });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.ALL)).toBe(true);
  });

  it('CONTENT filter matches content_gap assignment', () => {
    const row = makeRow({ assignment: { role: 'content_gap' } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.CONTENT)).toBe(true);
  });

  it('CONTENT filter rejects non-content_gap assignment', () => {
    const row = makeRow({ assignment: { role: 'page_keyword' } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.CONTENT)).toBe(false);
  });

  it('PAGE_ASSIGNED filter matches page_keyword assignment', () => {
    const row = makeRow({ assignment: { role: 'page_keyword', pagePath: '/about' } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED)).toBe(true);
  });

  it('LOCAL filter matches rows with localSeoState', () => {
    const row = makeRow({
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE,
        lifecycleLabel: 'Candidate',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE,
        priorityLabel: 'Investigate',
        detail: 'Test',
        checked: false,
        sourceLabels: [],
      },
    });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.LOCAL)).toBe(true);
  });

  it('LOCAL filter rejects rows without localSeoState', () => {
    const row = makeRow({ localSeoState: undefined });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.LOCAL)).toBe(false);
  });

  it('LOCAL_CANDIDATES filter matches CANDIDATE lifecycle', () => {
    const row = makeRow({
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE,
        lifecycleLabel: 'Local candidate',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE,
        priorityLabel: 'Investigate',
        detail: 'Candidate',
        checked: false,
        sourceLabels: [],
      },
    });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES)).toBe(true);
  });

  it('LOCAL_CANDIDATES filter rejects SELECTED lifecycle', () => {
    const row = makeRow({
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED,
        lifecycleLabel: 'Selected',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND,
        priorityLabel: 'Defend',
        detail: 'Selected',
        checked: true,
        sourceLabels: [],
      },
    });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES)).toBe(false);
  });

  it('VISIBLE_LOCALLY filter matches VISIBLE posture', () => {
    const row = makeRow({ localSeo: makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE) });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY)).toBe(true);
  });

  it('POSSIBLE_MATCH filter matches POSSIBLE_MATCH posture', () => {
    const row = makeRow({ localSeo: makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH) });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH)).toBe(true);
  });

  it('NOT_VISIBLE filter matches NOT_VISIBLE posture', () => {
    const row = makeRow({ localSeo: makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE) });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE)).toBe(true);
  });

  it('NOT_VISIBLE filter also matches LOCAL_PACK_PRESENT posture', () => {
    const row = makeRow({ localSeo: makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT) });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE)).toBe(true);
  });

  it('NOT_CHECKED filter matches localSeoState present + not checked', () => {
    const row = makeRow({
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE,
        lifecycleLabel: 'Candidate',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE,
        priorityLabel: 'Investigate',
        detail: 'Candidate',
        checked: false,
        sourceLabels: [],
      },
    });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED)).toBe(true);
  });

  it('NOT_CHECKED filter rejects checked rows', () => {
    const row = makeRow({
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED,
        lifecycleLabel: 'Checked locally',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND,
        priorityLabel: 'Defend',
        detail: 'Checked',
        checked: true,
        sourceLabels: [],
      },
    });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED)).toBe(false);
  });

  it('PROVIDER_DEGRADED filter matches PROVIDER_DEGRADED posture', () => {
    const row = makeRow({ localSeo: makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED) });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED)).toBe(true);
  });

  it('REQUESTED filter matches requested feedback status', () => {
    const row = makeRow({ feedback: { status: 'requested' } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED)).toBe(true);
  });

  it('REQUESTED filter rejects approved feedback', () => {
    const row = makeRow({ feedback: { status: 'approved' } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED)).toBe(false);
  });

  it('TRACKED filter matches active tracking status', () => {
    const row = makeRow({ tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(true);
  });

  it('TRACKED filter rejects not_tracked', () => {
    const row = makeRow({ tracking: { status: 'not_tracked' } });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(false);
  });

  it('LOST_VISIBILITY filter matches isLostVisibility flag', () => {
    const row = makeRow({ isLostVisibility: true });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY)).toBe(true);
  });

  it('LOST_VISIBILITY filter rejects rows without flag', () => {
    const row = makeRow({ isLostVisibility: false });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY)).toBe(false);
  });

  it('IN_STRATEGY filter matches by lifecycleStatus', () => {
    const row = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(true);
  });

  it('DECLINED filter matches by lifecycleStatus', () => {
    const row = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.DECLINED });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.DECLINED)).toBe(true);
  });

  it('RETIRED filter matches by lifecycleStatus', () => {
    const row = makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RETIRED });
    expect(matchesFilter(row, KEYWORD_COMMAND_CENTER_FILTERS.RETIRED)).toBe(true);
  });
});

// ─── matchesSearch ────────────────────────────────────────────────────────────

describe('matchesSearch', () => {
  it('undefined search → matches everything', () => {
    const row = makeRow({ keyword: 'seo agency', normalizedKeyword: 'seoagency' });
    expect(matchesSearch(row, undefined)).toBe(true);
  });

  it('empty string search → matches everything', () => {
    const row = makeRow({ keyword: 'seo agency', normalizedKeyword: 'seoagency' });
    expect(matchesSearch(row, '')).toBe(true);
  });

  it('case-insensitive match on normalizedKeyword', () => {
    const row = makeRow({ keyword: 'SEO Agency', normalizedKeyword: 'seoagency' });
    expect(matchesSearch(row, 'seo')).toBe(true);
  });

  it('no match when keyword does not contain search term', () => {
    const row = makeRow({ keyword: 'plumbing services', normalizedKeyword: 'plumbingservices' });
    expect(matchesSearch(row, 'dentist')).toBe(false);
  });

  it('matches on assignment pagePath', () => {
    const row = makeRow({
      normalizedKeyword: 'something',
      assignment: { role: 'page_keyword', pagePath: '/dental-services' },
    });
    expect(matchesSearch(row, 'dental')).toBe(true);
  });

  it('matches on assignment pageTitle', () => {
    const row = makeRow({
      normalizedKeyword: 'something',
      assignment: { role: 'page_keyword', pageTitle: 'Dental Services Page' },
    });
    expect(matchesSearch(row, 'dental')).toBe(true);
  });

  it('does not match on pagePath when absent', () => {
    const row = makeRow({ normalizedKeyword: 'xyz', assignment: { role: 'page_keyword' } });
    expect(matchesSearch(row, 'dental')).toBe(false);
  });
});

// ─── stripLocalSeoVisibility ──────────────────────────────────────────────────

describe('stripLocalSeoVisibility', () => {
  it('returns undefined as-is', () => {
    expect(stripLocalSeoVisibility(undefined)).toBeUndefined();
  });

  it('strips topCompetitors from summary', () => {
    const summary = makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE, {
      topCompetitors: [{ name: 'Competitor A', rank: 1 }],
      markets: [],
    });
    const result = stripLocalSeoVisibility(summary);
    expect(result?.topCompetitors).toBeUndefined();
  });

  it('strips topCompetitors from nested markets', () => {
    const summary = makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE, {
      markets: [
        {
          keyword: 'test', normalizedKeyword: 'test', marketId: 'm1',
          marketLabel: 'Austin', capturedAt: '2024-01-01',
          posture: LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE,
          label: 'Visible', detail: 'Detail',
          topCompetitors: [{ name: 'Comp', rank: 1 }],
        },
      ],
    });
    const result = stripLocalSeoVisibility(summary);
    expect(result?.markets[0].topCompetitors).toBeUndefined();
  });

  it('preserves other fields', () => {
    const summary = makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE);
    const result = stripLocalSeoVisibility(summary);
    expect(result?.posture).toBe(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE);
    expect(result?.keyword).toBe('test keyword');
    expect(result?.marketLabel).toBe('Austin, TX');
  });
});

// ─── paginateRows ─────────────────────────────────────────────────────────────

describe('paginateRows', () => {
  const rows = Array.from({ length: 120 }, (_, i) =>
    makeRow({ keyword: `keyword-${i}`, normalizedKeyword: `keyword${i}` }),
  );

  it('returns page 1 with default page size of 50', () => {
    const result = paginateRows(rows, {});
    expect(result.rows).toHaveLength(50);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.totalRows).toBe(120);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('returns correct slice for page 2', () => {
    const result = paginateRows(rows, { page: 2, pageSize: 50 });
    expect(result.rows).toHaveLength(50);
    expect(result.page).toBe(2);
    expect(result.hasPreviousPage).toBe(true);
    expect(result.hasNextPage).toBe(true);
    expect(result.rows[0].keyword).toBe('keyword-50');
  });

  it('last page returns remaining rows', () => {
    const result = paginateRows(rows, { page: 3, pageSize: 50 });
    expect(result.rows).toHaveLength(20);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);
  });

  it('empty rows returns page 1 with 0 rows and 1 total page', () => {
    const result = paginateRows([], {});
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('caps pageSize at MAX of 100', () => {
    const result = paginateRows(rows, { pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });

  it('pageSize of 0 falls back to default (50) because 0 is falsy', () => {
    // Number(0) || DEFAULT_PAGE_SIZE → 0 || 50 = 50
    const result = paginateRows(rows, { pageSize: 0 });
    expect(result.pageSize).toBe(50);
  });

  it('clamps page to totalPages when page exceeds bounds', () => {
    const result = paginateRows(rows, { page: 999, pageSize: 50 });
    expect(result.page).toBe(result.totalPages);
  });

  it('clamps page to 1 when page < 1', () => {
    const result = paginateRows(rows, { page: -5 });
    expect(result.page).toBe(1);
  });
});

// ─── filterCount ─────────────────────────────────────────────────────────────

describe('filterCount', () => {
  const rows = [
    makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, assignment: { role: 'page_keyword' }, tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE } }),
    makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED, tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE } }),
    makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.DECLINED, tracking: { status: 'not_tracked' } }),
    makeRow({ lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE, assignment: { role: 'content_gap' }, tracking: { status: 'not_tracked' }, feedback: { status: 'requested' } }),
    makeRow({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW,
      tracking: { status: 'not_tracked' },
      isLostVisibility: true,
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE,
        lifecycleLabel: 'Local candidate',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE,
        priorityLabel: 'Investigate',
        detail: 'Candidate',
        checked: false,
        sourceLabels: [],
      },
      localSeo: makeVisibilitySummary(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE),
    }),
  ];

  it('ALL returns total row count', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.ALL)).toBe(5);
  });

  it('IN_STRATEGY counts rows with that lifecycleStatus', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(1);
  });

  it('TRACKED counts active tracking status', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(2);
  });

  it('CONTENT counts content_gap assignment', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.CONTENT)).toBe(1);
  });

  it('PAGE_ASSIGNED counts page_keyword assignment', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED)).toBe(1);
  });

  it('DECLINED counts by lifecycleStatus', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.DECLINED)).toBe(1);
  });

  it('REQUESTED counts requested feedback', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED)).toBe(1);
  });

  it('LOST_VISIBILITY counts isLostVisibility flag', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY)).toBe(1);
  });

  it('LOCAL counts rows with localSeoState', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.LOCAL)).toBe(1);
  });

  it('LOCAL_CANDIDATES counts CANDIDATE lifecycle', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES)).toBe(1);
  });

  it('VISIBLE_LOCALLY counts VISIBLE posture', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY)).toBe(1);
  });

  it('NOT_CHECKED counts localSeoState present + not checked', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED)).toBe(1);
  });

  it('returns 0 when no rows match', () => {
    expect(filterCount(rows, KEYWORD_COMMAND_CENTER_FILTERS.RETIRED)).toBe(0);
  });
});

// ─── filterNeedsLocalCandidates ───────────────────────────────────────────────

describe('filterNeedsLocalCandidates', () => {
  it('returns true for LOCAL_CANDIDATES filter', () => {
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES)).toBe(true);
  });

  it('returns false for ALL filter', () => {
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.ALL)).toBe(false);
  });

  it('returns false for IN_STRATEGY filter', () => {
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(false);
  });

  it('returns false for LOCAL filter (different from LOCAL_CANDIDATES)', () => {
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(filterNeedsLocalCandidates(undefined)).toBe(false);
  });

  it('returns false for TRACKED filter', () => {
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(false);
  });
});

// ─── buildCounts ─────────────────────────────────────────────────────────────

describe('buildCounts', () => {
  function makeRowWithStatus(status: typeof KEYWORD_COMMAND_CENTER_STATUS[keyof typeof KEYWORD_COMMAND_CENTER_STATUS], extra: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
    return makeRow({ lifecycleStatus: status, tracking: { status: 'not_tracked' }, ...extra });
  }

  const rows = [
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, { tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE } }),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.TRACKED, { tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE } }),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.DECLINED),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.RETIRED),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW, { isLostVisibility: true }),
    makeRowWithStatus(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY, {
      metrics: { volume: 0 },
      localSeoState: {
        lifecycle: KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE,
        lifecycleLabel: 'Candidate',
        priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE,
        priorityLabel: 'Investigate',
        detail: 'Test',
        checked: false,
        sourceLabels: [],
      },
    }),
  ];

  it('total counts all rows', () => {
    const counts = buildCounts(rows);
    expect(counts.total).toBe(rows.length);
  });

  it('inStrategy counts IN_STRATEGY status', () => {
    const counts = buildCounts(rows);
    expect(counts.inStrategy).toBe(3);
  });

  it('tracked counts active tracking status', () => {
    const counts = buildCounts(rows);
    // rows[1] and rows[2] have tracking.status = ACTIVE
    expect(counts.tracked).toBe(2);
  });

  it('needsReview counts NEEDS_REVIEW status', () => {
    const counts = buildCounts(rows);
    expect(counts.needsReview).toBe(2);
  });

  it('evidence counts RAW_EVIDENCE status', () => {
    const counts = buildCounts(rows);
    expect(counts.evidence).toBe(1);
  });

  it('declined counts DECLINED status', () => {
    const counts = buildCounts(rows);
    expect(counts.declined).toBe(1);
  });

  it('retired counts RETIRED status', () => {
    const counts = buildCounts(rows);
    expect(counts.retired).toBe(1);
  });

  it('lostVisibility counts isLostVisibility flag', () => {
    const counts = buildCounts(rows);
    expect(counts.lostVisibility).toBe(1);
  });

  it('local counts rows with localSeoState', () => {
    const counts = buildCounts(rows);
    expect(counts.local).toBe(1);
  });

  it('localCandidates counts CANDIDATE lifecycle', () => {
    const counts = buildCounts(rows);
    expect(counts.localCandidates).toBe(1);
  });

  it('missingVolume counts rows with no positive volume', () => {
    const counts = buildCounts(rows);
    // Most rows have empty metrics (volume is null/undefined), one has volume: 0
    // All rows with volume === null/undefined or <= 0 count as missing
    expect(counts.missingVolume).toBeGreaterThan(0);
  });

  it('returns zero counts for empty array', () => {
    const counts = buildCounts([]);
    expect(counts.total).toBe(0);
    expect(counts.inStrategy).toBe(0);
    expect(counts.tracked).toBe(0);
  });
});

// ─── buildFilterFacetsFromCounts ──────────────────────────────────────────────

describe('buildFilterFacetsFromCounts', () => {
  const counts = {
    all: 100,
    inStrategy: 30,
    tracked: 25,
    needsReview: 10,
    content: 5,
    pageAssigned: 8,
    rawEvidence: 20,
    local: 15,
    localCandidates: 7,
    visibleLocally: 3,
    possibleMatch: 4,
    notVisible: 6,
    notChecked: 2,
    providerDegraded: 1,
    requested: 3,
    declined: 5,
    retired: 2,
    lostVisibility: 9,
    strikingDistance: 7,
  };

  it('returns 18 filter facets', () => {
    const result = buildFilterFacetsFromCounts(counts);
    expect(result).toHaveLength(18);
  });

  it('ALL facet has correct count', () => {
    const result = buildFilterFacetsFromCounts(counts);
    const all = result.find(f => f.id === KEYWORD_COMMAND_CENTER_FILTERS.ALL);
    expect(all?.count).toBe(100);
    expect(all?.label).toBe('All');
  });

  it('IN_STRATEGY facet has correct count', () => {
    const result = buildFilterFacetsFromCounts(counts);
    const f = result.find(f => f.id === KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY);
    expect(f?.count).toBe(30);
  });

  it('LOST_VISIBILITY facet has correct count', () => {
    const result = buildFilterFacetsFromCounts(counts);
    const f = result.find(f => f.id === KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY);
    expect(f?.count).toBe(9);
  });

  it('all facets have id, label, and count', () => {
    const result = buildFilterFacetsFromCounts(counts);
    for (const facet of result) {
      expect(facet).toHaveProperty('id');
      expect(facet).toHaveProperty('label');
      expect(facet).toHaveProperty('count');
    }
  });

  it('facet ids match expected filter constants', () => {
    const result = buildFilterFacetsFromCounts(counts);
    const ids = result.map(f => f.id);
    expect(ids).toContain(KEYWORD_COMMAND_CENTER_FILTERS.TRACKED);
    expect(ids).toContain(KEYWORD_COMMAND_CENTER_FILTERS.DECLINED);
    expect(ids).toContain(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES);
    expect(ids).toContain(KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED);
    expect(ids).not.toContain(KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED);
  });
});

// ─── trackedKeywordMatchesFilter ──────────────────────────────────────────────

describe('trackedKeywordMatchesFilter', () => {
  it('TRACKED filter: active keyword matches', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.ACTIVE });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(true);
  });

  it('TRACKED filter: undefined status defaults to active, matches', () => {
    const kw = makeTrackedKeyword({ status: undefined });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(true);
  });

  it('TRACKED filter: paused keyword does not match', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.PAUSED });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(false);
  });

  it('RETIRED filter: inactive keyword matches', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.PAUSED });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.RETIRED)).toBe(true);
  });

  it('RETIRED filter: deprecated keyword matches', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.DEPRECATED });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.RETIRED)).toBe(true);
  });

  it('RETIRED filter: active keyword does not match', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.ACTIVE });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.RETIRED)).toBe(false);
  });

  it('Wave 3d-ii IN_STRATEGY filter: active + strategyOwned=true matches', () => {
    const kw = makeTrackedKeyword({
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      strategyOwned: true,
    });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(true);
  });

  it('Wave 3d-ii IN_STRATEGY filter: active + STRATEGY_* source but NOT owned does not match (decoupled)', () => {
    // The filter now keys on ownership, not the source enum.
    const kw = makeTrackedKeyword({
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
    });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(false);
  });

  it('Wave 3d-ii IN_STRATEGY filter: active + MANUAL source (not owned) does not match', () => {
    const kw = makeTrackedKeyword({
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
    });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(false);
  });

  it('Wave 3d-ii IN_STRATEGY filter: inactive + strategyOwned=true does not match (status gate)', () => {
    const kw = makeTrackedKeyword({
      status: TRACKED_KEYWORD_STATUS.PAUSED,
      strategyOwned: true,
    });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)).toBe(false);
  });

  it('ALL filter: always returns true', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.PAUSED });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.ALL)).toBe(true);
  });

  it('other filter (e.g., CONTENT): always returns true', () => {
    const kw = makeTrackedKeyword({ status: TRACKED_KEYWORD_STATUS.ACTIVE });
    expect(trackedKeywordMatchesFilter(kw, KEYWORD_COMMAND_CENTER_FILTERS.CONTENT)).toBe(true);
  });
});
