import db from './db/index.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { createStmtCache } from './db/stmt-cache.js';
import { isFeatureEnabled } from './feature-flags.js';
import { assembleStoredKeywordStrategy } from './keyword-strategy-assembler.js';
import { resolveSiteKeywordMetrics } from './site-keyword-metrics.js';
import {
  buildLocalSeoKeywordCandidates,
  countLocalSeoKeywordCandidates,
  buildLocalSeoKeywordVisibilityForKeyword,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  buildLocalSeoKeywordVisibilityByKey,
  getLocalSeoPosture,
  getPrimaryMarketLocationCode,
  listLocalSeoMarkets,
  type LocalSeoKeywordCandidate,
} from './local-seo.js';
import { computeKeywordValueScore, type ScoringContext } from './scoring/keyword-value-score.js';
import { createLogger } from './logger.js';
import { listPageKeywords, listPageKeywordsLite } from './page-keywords.js';
import { computeOpportunityScore, isSuspiciousPlannerGroupedVolume } from './keyword-strategy-helpers.js';
import {
  getLatestSnapshotRanks,
  getTrackedKeywords,
  removeTrackedKeyword,
  updateTrackedKeywords,
  type AddTrackedKeywordOptions,
} from './rank-tracking.js';
import { listTrackedKeywordRows } from './tracked-keywords-store.js';
import { InvalidTransitionError, TRACKED_KEYWORD_TRANSITIONS, validateTransition } from './state-machines.js';
import { getWorkspace } from './workspaces.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { buildKeywordStrategyUxPayload } from './keyword-strategy-ux.js';
import { WS_EVENTS } from './ws-events.js';
import { createVariantParentIndex, findBestParent, isJunkKeywordString, keywordComparisonKey, type VariantParentIndex } from '../shared/keyword-normalization.js';
import { isStrategyPoolEligibleKeyword } from './keyword-intelligence/rules.js';
import {
  getLostVisibilityKeys,
  getLostVisibilityQueries,
} from './client-discovered-queries.js';
import type { ContentGap, KeywordGapItem, KeywordStrategy, PageKeywordMap, Workspace } from '../shared/types/workspace.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterActionRequest,
  type KeywordCommandCenterActionResult,
  type KeywordCommandCenterAssignment,
  type KeywordCommandCenterBulkActionItem,
  type KeywordCommandCenterBulkActionRequest,
  type KeywordCommandCenterBulkActionResult,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterDetailResponse,
  type KeywordCommandCenterFeedbackState,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterFilterMeta,
  type KeywordCommandCenterLocalSeoState,
  type KeywordCommandCenterMetrics,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterResponse,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSort,
  type KeywordCommandCenterSourceLabel,
  type KeywordCommandCenterStatus,
  type KeywordCommandCenterSummaryResponse,
} from '../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type LatestRank,
  type TrackedKeyword,
} from '../shared/types/rank-tracking.js';
import type { KeywordStrategyExplanation } from '../shared/types/keyword-strategy-ux.js';

const RAW_EVIDENCE_ROW_LIMIT = 75;
const RANK_EVIDENCE_ROW_LIMIT = 50;
const LOCAL_CANDIDATE_ROW_LIMIT = 75;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * Universe-full safety ceiling (Task 3). When the `keyword-universe-full` flag is
 * ON the per-bucket caps (rank-evidence 50, raw-evidence 75, local 75) are lifted;
 * this is the single global backstop that protects the candidate Map from a
 * pathological GSC snapshot. It is a BACKSTOP, not the product cap — when it bites,
 * we keep the top-N BY VALUE (high-value head retained, low-value tail dropped) and
 * disclose the truncation honestly (rawEvidenceTotal > rawEvidenceReturned). Logged
 * at Pino debug when it truncates.
 */
const UNIVERSE_SAFETY_CEILING = 2000;

const log = createLogger('keyword-command-center');

const KEYWORD_UNIVERSE_FULL_FLAG = 'keyword-universe-full' as const;
const KEYWORD_VALUE_SCORING_FLAG = 'keyword-value-scoring' as const;

/**
 * Phase 1: per-request transient carrier for a finalized row's precomputed
 * value-first score. Kept OFF the public `KeywordCommandCenterRow` type (it must
 * never serialize to the client) — the `opportunity` accessor reads it as a
 * trivial field read when the flag is ON. A WeakMap so finalized rows that fall
 * out of scope are collected without leaking. `undefined` (key absent) flows
 * through `compareMetric` as missing-last, exactly like a no-signal score.
 */
const rowValueScore = new WeakMap<KeywordCommandCenterRow, number>();

/**
 * The SINGLE "select ranked-untracked GSC queries" function. Given the ranks that
 * have already passed each site's own exclusion predicate (not-already-a-row,
 * not-a-variant, etc.), apply the flag-derived selection so all five rank-evidence
 * sites stay in lockstep:
 *
 *  - Flag OFF: keep the top-50 BY IMPRESSIONS (byte-identical to the pre-Task-3
 *    `.sort((a,b)=>impressions desc).slice(0, RANK_EVIDENCE_ROW_LIMIT)`).
 *  - Flag ON: keep EVERY query with clicks>0 OR impressions>0 (impression-only
 *    ranking IS retained — owner decision), ordered BY VALUE
 *    (demand=impressions, then clicks, desc), capped at UNIVERSE_SAFETY_CEILING.
 *    When the cap bites, the low-value tail is dropped (value-ordered truncation).
 *
 * `total` is the TRUE pre-ceiling count of selected ranks (post value-filter), so
 * callers can disclose ceiling truncation honestly. `workspaceId` may be undefined
 * (defensive — resolves to flag-OFF/global behavior).
 */
function selectRankEvidence(
  filteredRanks: LatestRank[],
  workspaceId: string | undefined,
): { selected: LatestRank[]; total: number } {
  if (!isFeatureEnabled(KEYWORD_UNIVERSE_FULL_FLAG, workspaceId)) {
    const selected = [...filteredRanks]
      .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
      .slice(0, RANK_EVIDENCE_ROW_LIMIT);
    return { selected, total: Math.min(filteredRanks.length, RANK_EVIDENCE_ROW_LIMIT) };
  }
  // Flag ON: empirical-ranking universe — every query the site ranks for.
  const valued = filteredRanks
    .filter(rank => (rank.clicks ?? 0) > 0 || (rank.impressions ?? 0) > 0)
    .sort((a, b) => {
      // Value order: demand (impressions, the empirical-ranking demand proxy) then
      // clicks, descending. Mirrors the candidate-stage value sort so the page-1
      // selection equals the global value-ordered head.
      const demandDelta = (b.impressions ?? 0) - (a.impressions ?? 0);
      if (demandDelta !== 0) return demandDelta;
      return (b.clicks ?? 0) - (a.clicks ?? 0);
    });
  const total = valued.length;
  const selected = valued.slice(0, UNIVERSE_SAFETY_CEILING);
  if (total > UNIVERSE_SAFETY_CEILING) {
    log.debug(
      { workspaceId, total, kept: UNIVERSE_SAFETY_CEILING, dropped: total - UNIVERSE_SAFETY_CEILING },
      'keyword-command-center universe safety ceiling truncated rank evidence (value-ordered)',
    );
  }
  return { selected, total };
}

const stmts = createStmtCache(() => ({
  feedback: db.prepare<[workspaceId: string]>(
    'SELECT keyword, status, reason, source, updated_at FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC',
  ),
  upsertFeedback: db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (@workspace_id, @keyword, @status, @reason, @source, @declined_by)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      source = excluded.source,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `),
  deleteFeedback: db.prepare<[workspaceId: string, keyword: string]>(
    'DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?',
  ),
}));

interface FeedbackRow {
  keyword: string;
  status: string;
  reason: string | null;
  source: string | null;
  updated_at: string | null;
}

interface DraftRow {
  keyword: string;
  normalizedKeyword: string;
  sourceLabels: KeywordCommandCenterSourceLabel[];
  metrics: KeywordCommandCenterMetrics;
  assignment?: KeywordCommandCenterAssignment;
  feedback?: KeywordCommandCenterFeedbackState;
  tracking?: TrackedKeyword;
  explanation?: KeywordStrategyExplanation;
  localCandidate?: LocalSeoKeywordCandidate;
  rank?: LatestRank;
  variants?: LatestRank[];
  rawEvidenceOnly?: boolean;
}

interface LostVisibilityQuery {
  query: string;
  lastPosition: number | null;
  lastSeen: string;
  totalImpressions: number;
}

export interface CommandCenterSourceBundle {
  workspaceId: string;
  workspaceName?: string;
  strategy?: KeywordStrategy | null;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  keywordGaps: KeywordGapItem[];
  trackedKeywords: TrackedKeyword[];
  latestRanks: LatestRank[];
  feedback: Map<string, FeedbackRow>;
  localCandidates?: LocalSeoKeywordCandidate[];
  lostVisibilityRows?: LostVisibilityQuery[];
  includeStrategyUx?: boolean;
  includeWorkspaceIntelligence?: boolean;
}

/**
 * Per-request value-scoring gate (Phase 1). Built ONCE per request in the
 * rows-build entry points. `ctx` is present ONLY when `on` is true — when the
 * flag is OFF we skip the getLocalSeoPosture/listLocalSeoMarkets DB reads
 * entirely, so the flag-OFF path does no extra DB work and stays byte-identical.
 * The SAME config (same `ctx`) is threaded into both the candidate merge-back
 * (Task 1.3) and the row finalize (Task 1.4), so the two stages compute the
 * identical valueScore per key by construction.
 */
interface ValueScoringConfig {
  on: boolean;
  ctx?: ScoringContext;
}

/**
 * Build the per-request value-scoring config. When the flag is OFF, returns
 * `{ on: false }` WITHOUT touching the DB (no getLocalSeoPosture /
 * listLocalSeoMarkets). When ON, fetches posture + markets ONCE and captures the
 * business-profile city/state — never per keyword.
 */
function buildValueScoringConfig(workspace: Workspace): ValueScoringConfig {
  if (!isFeatureEnabled(KEYWORD_VALUE_SCORING_FLAG, workspace.id)) return { on: false };
  return {
    on: true,
    ctx: {
      posture: getLocalSeoPosture(workspace.id),
      markets: listLocalSeoMarkets(workspace.id),
      city: workspace.businessProfile?.address?.city?.toLowerCase(),
      state: workspace.businessProfile?.address?.state?.toLowerCase(),
    },
  };
}

interface RowFinalizeContext {
  workspaceId: string;
  localVisibilityByKeyword: Map<string, LocalSeoKeywordVisibilitySummary>;
  activeLocalMarketCount: number;
  lostVisibilityKeys?: Set<string>;
  /** Phase 1: when present + on, finalize computes the row valueScore once per key. */
  valueScoring?: ValueScoringConfig;
}

interface FinalizedRows {
  rows: KeywordCommandCenterRow[];
  rawEvidenceTotal: number;
  rawEvidenceReturned: number;
}

function addSource(row: DraftRow, source: KeywordCommandCenterSourceLabel): void {
  if (row.sourceLabels.some(existing => existing.kind === source.kind && existing.label === source.label && existing.detail === source.detail)) return;
  row.sourceLabels.push(source);
}

/**
 * Last-writer-wins metric merge over a bare metrics object, with the planner
 * sentinel guard. Shared by the row stage (`mergeMetrics`) and the candidate
 * stage's metric resolver (`resolveBundleMetrics`) so the two stages compute
 * IDENTICAL clicks/rank/difficulty/demand per key — the invariant that keeps
 * page-1 == global-top-N. `keyword` is the RAW display keyword (the sentinel
 * guard is keyword-aware).
 */
function mergeMetricsInto(keyword: string, target: KeywordCommandCenterMetrics, metrics: KeywordCommandCenterMetrics): KeywordCommandCenterMetrics {
  // Filter DataForSEO planner-grouped bucket sentinels before merging.
  // The Google Ads planner returns 1,000,000 as a grouped-forecast bucket value
  // paired with difficulty=21 when it can't pin granular data. Letting this through
  // overstates volume by orders of magnitude on branded long-tail keywords and
  // overwrites real provider data from other sources (the merge spreads later
  // sources over earlier ones, so a sentinel write after a real value wins).
  // See server/keyword-strategy-helpers.ts:isSuspiciousPlannerGroupedVolume.
  const filtered: KeywordCommandCenterMetrics = { ...metrics };
  if (isSuspiciousPlannerGroupedVolume(keyword, filtered.volume)) {
    filtered.volume = undefined;
    filtered.difficulty = undefined; // 21 is the paired sentinel difficulty — drop both
  }
  return {
    ...target,
    ...Object.fromEntries(Object.entries(filtered).filter(([, value]) => value != null)),
  };
}

function mergeMetrics(row: DraftRow, metrics: KeywordCommandCenterMetrics): void {
  row.metrics = mergeMetricsInto(row.keyword, row.metrics, metrics);
}

function readFeedbackRows(workspaceId: string): FeedbackRow[] {
  return stmts().feedback.all(workspaceId) as FeedbackRow[];
}

function readFeedback(workspaceId: string): Map<string, FeedbackRow> {
  const feedback = new Map<string, FeedbackRow>();
  for (const row of readFeedbackRows(workspaceId)) {
    const key = keywordComparisonKey(row.keyword);
    if (!key || feedback.has(key)) continue;
    feedback.set(key, row);
  }
  return feedback;
}

function safeLostVisibilityKeys(workspaceId: string): Set<string> {
  try {
    return getLostVisibilityKeys(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility keys');
    return new Set<string>();
  }
}

function safeLostVisibilityRows(workspaceId: string): LostVisibilityQuery[] {
  try {
    return getLostVisibilityQueries(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility rows');
    return [];
  }
}


export function feedbackState(row: FeedbackRow): KeywordCommandCenterFeedbackState | undefined {
  if (row.status !== 'approved' && row.status !== 'declined' && row.status !== 'requested') return undefined;
  return {
    status: row.status,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function ensureRow(rows: Map<string, DraftRow>, keyword: string): DraftRow | null {
  const normalizedKeyword = keywordComparisonKey(keyword);
  if (!normalizedKeyword) return null;
  const existing = rows.get(normalizedKeyword);
  if (existing) return existing;
  const row: DraftRow = {
    keyword: keyword.trim(),
    normalizedKeyword,
    sourceLabels: [],
    metrics: {},
  };
  rows.set(normalizedKeyword, row);
  return row;
}

export function assignmentPriority(role: KeywordCommandCenterAssignment['role'] | undefined): number {
  if (role === 'page_keyword') return 4;
  if (role === 'content_gap') return 3;
  if (role === 'site_keyword') return 2;
  if (role === 'raw_evidence') return 1;
  return 0;
}

function setAssignment(row: DraftRow, assignment: KeywordCommandCenterAssignment): void {
  if (assignmentPriority(assignment.role) >= assignmentPriority(row.assignment?.role)) {
    row.assignment = assignment;
  }
}

export function sourceFromExplanation(explanation: KeywordStrategyExplanation): KeywordCommandCenterSourceLabel {
  if (explanation.role === 'page_keyword') {
    return { kind: 'page_assignment', label: 'Page assignment', detail: explanation.pageTitle ?? explanation.pagePath };
  }
  if (explanation.role === 'content_gap') {
    return { kind: 'content_gap', label: 'Content opportunity', detail: explanation.nextAction.detail };
  }
  if (explanation.role === 'competitor_gap') {
    return { kind: 'raw_evidence', label: 'Raw provider evidence', detail: explanation.sourceEvidence[0] ?? 'Provider keyword gap' };
  }
  return { kind: 'strategy', label: 'Strategy keyword', detail: explanation.surfaceLabel };
}

export function sourceFromKeywordGap(gap: KeywordGapItem): KeywordCommandCenterSourceLabel {
  return {
    kind: 'raw_evidence',
    label: 'Raw provider evidence',
    detail: `${gap.competitorDomain} ranks #${gap.competitorPosition}`,
  };
}

export function isInactiveTracking(keyword: TrackedKeyword): boolean {
  return (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE;
}

export function protectedReason(keyword: TrackedKeyword | undefined): string | undefined {
  if (!keyword) return undefined;
  if (keyword.pinned) return 'Pinned keyword';
  if (keyword.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return 'Client-requested keyword';
  if (keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL) return 'Manual keyword';
  // Wave 3d-ii (Decision B): any gap-provenanced approval (sourceGapKey present) is
  // hard-protected — a client approved it off a content/keyword gap surface, so it
  // must never be auto-deprecated regardless of its current source label.
  if (keyword.sourceGapKey) return 'Gap-approved keyword';
  return undefined;
}

/**
 * #19b table-as-truth (Wave 3b-ii strip): return the strategy with its
 * `siteKeywordMetrics` resolved from the site_keyword_metrics table, the sole
 * store. All KCC consumers read `strategy.siteKeywordMetrics` off this object, so
 * overriding it once at each entry point repoints every downstream read. The blob
 * no longer carries siteKeywordMetrics.
 */
function withResolvedSiteKeywordMetrics(
  workspaceId: string,
  strategy: KeywordStrategy | null | undefined,
): KeywordStrategy | null | undefined {
  if (!strategy) return strategy;
  const resolved = resolveSiteKeywordMetrics(workspaceId);
  return { ...strategy, siteKeywordMetrics: resolved.length > 0 ? resolved : undefined };
}

/**
 * Infer the most likely tracking source when a tracked keyword's stored source is
 * UNKNOWN (typically a legacy migration artifact — pre-source-field rank_tracking_config
 * entries default to UNKNOWN via rank-tracking.ts:140). Cross-references the
 * workspace's current strategy + content gaps + feedback to recover provenance.
 *
 * Read-time only: does not write back to storage. Source ladder (most specific first):
 *   1. siteKeywordMetrics  → STRATEGY_PRIMARY (strategy explicitly produced metrics for it)
 *   2. siteKeywords        → STRATEGY_SITE_KEYWORD
 *   3. keyword_feedback (requested) → CLIENT_REQUESTED
 *   4. content_gaps        → CONTENT_GAP
 *   5. fallback            → original source (likely UNKNOWN)
 *
 * Applied at bundle assembly time so all downstream consumers — `sourceKeysForRows`,
 * `trackedKeywordMatchesFilter`, `protectedReason`, the row builder, summary counts —
 * see the inferred sources uniformly. Without bundle-level application, the
 * IN_STRATEGY filter would miss inferred-strategy keywords because
 * `trackedKeywordMatchesFilter` reads `keyword.source` directly.
 */
function inferTrackedKeywordSources(
  trackedKeywords: TrackedKeyword[],
  context: {
    strategy?: KeywordStrategy | null;
    contentGaps?: ContentGap[];
    feedback?: Map<string, FeedbackRow>;
  },
): TrackedKeyword[] {
  const siteKeywordMetricKeys = new Set(
    (context.strategy?.siteKeywordMetrics ?? [])
      .map(m => keywordComparisonKey(m.keyword))
      .filter(Boolean),
  );
  const siteKeywordKeys = new Set(
    (context.strategy?.siteKeywords ?? [])
      .map(k => keywordComparisonKey(k))
      .filter(Boolean),
  );
  const contentGapKeys = new Set(
    (context.contentGaps ?? [])
      .map(gap => keywordComparisonKey(gap.targetKeyword))
      .filter(Boolean),
  );
  return trackedKeywords.map(keyword => {
    const existing = keyword.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
    if (existing !== TRACKED_KEYWORD_SOURCE.UNKNOWN) return keyword;
    const normalized = keywordComparisonKey(keyword.query);
    if (!normalized) return keyword;
    if (siteKeywordMetricKeys.has(normalized)) return { ...keyword, source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY };
    if (siteKeywordKeys.has(normalized)) return { ...keyword, source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD };
    const fb = context.feedback?.get(normalized);
    if (fb?.status === 'requested') return { ...keyword, source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED };
    if (contentGapKeys.has(normalized)) return { ...keyword, source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP };
    return keyword;
  });
}

/**
 * Wave 3d-i/3d-ii ADMIN exposure: getTrackedKeywords STRIPS the TABLE-ONLY fields
 * (sourceGapKey, strategyOwned) so the general/public read path stays byte-identical.
 * KCC is admin-authed, so it may surface them — read from the table
 * (listTrackedKeywordRows, which uses rowToTrackedKeyword directly, NOT the stripping
 * resolver) and merge sourceGapKey + strategyOwned back onto the tracked keywords
 * keyed by keywordComparisonKey. strategyOwned is REQUIRED here so KCC's IN_STRATEGY
 * classification (lifecycleStatus + trackedKeywordMatchesFilter) sees real ownership
 * instead of undefined → false (which would under-count). Returns NEW objects (never
 * mutates the input) so callers downstream of getTrackedKeywords are unaffected.
 */
function mergeTrackedKeywordProvenance(
  workspaceId: string,
  trackedKeywords: TrackedKeyword[],
): TrackedKeyword[] {
  if (trackedKeywords.length === 0) return trackedKeywords;
  const gapKeyByQuery = new Map<string, string>();
  const ownedByQuery = new Map<string, boolean>();
  for (const row of listTrackedKeywordRows(workspaceId)) {
    const key = keywordComparisonKey(row.query);
    if (row.sourceGapKey) gapKeyByQuery.set(key, row.sourceGapKey);
    // `!== undefined` tri-state guard: `false` is a real value, not "absent".
    if (row.strategyOwned !== undefined) ownedByQuery.set(key, row.strategyOwned);
  }
  if (gapKeyByQuery.size === 0 && ownedByQuery.size === 0) return trackedKeywords;
  return trackedKeywords.map(keyword => {
    const key = keywordComparisonKey(keyword.query);
    const gapKey = gapKeyByQuery.get(key);
    const owned = ownedByQuery.get(key);
    if (gapKey === undefined && owned === undefined) return keyword;
    const next = { ...keyword };
    if (gapKey !== undefined) next.sourceGapKey = gapKey;
    if (owned !== undefined) next.strategyOwned = owned;
    return next;
  });
}

/**
 * Assemble the same inference context the live KCC read paths build (strategy
 * blob with site_keyword_metrics resolved table-first, assembled contentGaps,
 * feedback map) and run the canonical inferTrackedKeywordSources ladder ONCE.
 *
 * Injected into the tracked_keywords boot backfill (Wave 3c-i) so the table is
 * stamped with recovered sources for legacy UNKNOWN-source rows at populate time,
 * using the exact same ladder the read paths use — without coupling the store to
 * KCC (which would create a static import cycle rank-tracking → store → KCC →
 * rank-tracking). The ladder CANNOT recover MANUAL/RECOMMENDATION — those stay
 * UNKNOWN explicitly (never guessed).
 */
export function inferTrackedKeywordSourcesForWorkspace(
  workspaceId: string,
  trackedKeywords: TrackedKeyword[],
): TrackedKeyword[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return trackedKeywords;
  const strategy = withResolvedSiteKeywordMetrics(workspaceId, workspace.keywordStrategy);
  const contentGaps = assembleStoredKeywordStrategy(workspaceId)?.contentGaps ?? [];
  const feedback = readFeedback(workspaceId);
  return inferTrackedKeywordSources(trackedKeywords, { strategy, contentGaps, feedback });
}

/**
 * Friendly label for the addSource `detail` field. Avoids displaying the raw
 * "unknown" enum value as if it were real provenance.
 */
function trackingSourceDetail(source: TrackedKeyword['source'] | undefined): string | undefined {
  if (!source || source === TRACKED_KEYWORD_SOURCE.UNKNOWN) return undefined;
  return source.replace(/_/g, ' ');
}

export function lifecycleStatus(row: DraftRow): KeywordCommandCenterStatus {
  if (row.feedback?.status === 'declined') return KEYWORD_COMMAND_CENTER_STATUS.DECLINED;
  if (row.tracking && isInactiveTracking(row.tracking)) return KEYWORD_COMMAND_CENTER_STATUS.RETIRED;
  if (row.feedback?.status === 'approved') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.feedback?.status === 'requested') return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  if (row.explanation && row.explanation.role !== 'competitor_gap') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.assignment && row.assignment.role !== 'raw_evidence') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  // Wave 3d-ii: classify "In Strategy" off the decoupled ownership flag, NOT the
  // source enum. row.tracking carries strategyOwned via mergeTrackedKeywordProvenance
  // (the table-bearing read); a client-approved keyword that is not strategy-owned is
  // no longer mis-labelled In Strategy.
  if (row.tracking?.strategyOwned === true) {
    return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  }
  if (row.tracking && (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return KEYWORD_COMMAND_CENTER_STATUS.TRACKED;
  }
  if (row.explanation?.rawEvidenceOnly || row.rawEvidenceOnly) return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
  if (row.rank) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  if (row.localCandidate) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
}

export function statusLabel(status: KeywordCommandCenterStatus): string {
  switch (status) {
    case KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY: return 'In Strategy';
    case KEYWORD_COMMAND_CENTER_STATUS.TRACKED: return 'Tracked';
    case KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW: return 'Needs Review';
    case KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE: return 'Raw Evidence';
    case KEYWORD_COMMAND_CENTER_STATUS.DECLINED: return 'Declined';
    case KEYWORD_COMMAND_CENTER_STATUS.RETIRED: return 'Retired';
  }
}

export function localPriority(
  visibility: LocalSeoKeywordVisibilitySummary | undefined,
  activeMarketCount: number,
): Pick<KeywordCommandCenterLocalSeoState, 'priority' | 'priorityLabel'> {
  if (activeMarketCount === 0) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP, priorityLabel: 'Needs setup' };
  }
  if (!visibility) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE, priorityLabel: 'Ready to check' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND, priorityLabel: 'Defend' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH || visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE, priorityLabel: 'Investigate' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY, priorityLabel: 'High opportunity' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE && visibility.localPackPresent) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY, priorityLabel: 'High opportunity' };
  }
  return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.LOW_PRIORITY, priorityLabel: 'Low priority' };
}

function buildLocalSeoState(
  row: DraftRow,
  status: KeywordCommandCenterStatus,
  visibility: LocalSeoKeywordVisibilitySummary | undefined,
  activeMarketCount: number,
): KeywordCommandCenterLocalSeoState | undefined {
  if (!row.localCandidate && !visibility) return undefined;
  const selected = status === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY
    || status === KEYWORD_COMMAND_CENTER_STATUS.TRACKED
    || row.localCandidate?.selected === true;
  const checked = Boolean(visibility);
  const lifecycle = selected
    ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED
    : checked
      ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED
      : row.rawEvidenceOnly
        ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.RAW_EVIDENCE
        : row.localCandidate
          ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE
          : KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.NOT_CHECKED;
  const { priority, priorityLabel } = localPriority(visibility, activeMarketCount);
  const lifecycleLabel = lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED
    ? checked ? 'Selected · checked' : 'Selected · not checked'
    : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED
      ? 'Checked locally'
      : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.RAW_EVIDENCE
        ? 'Raw local evidence'
        : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE
          ? 'Local candidate'
          : 'Not checked';
  const detail = activeMarketCount === 0
    ? 'Configure a local market before checking this keyword.'
    : visibility?.detail
      ?? row.localCandidate?.detail
      ?? 'Candidate is ready for local-pack visibility checking.';
  return {
    lifecycle,
    lifecycleLabel,
    priority,
    priorityLabel,
    detail,
    checked,
    marketLabel: visibility?.marketLabel,
    sourceLabels: row.localCandidate ? [row.localCandidate.sourceLabel] : ['Stored local visibility'],
    localPackPresent: visibility?.localPackPresent,
    businessMatchConfidence: visibility?.businessMatchConfidence,
    visibility,
  };
}

function buildNextActions(
  row: DraftRow,
  status: KeywordCommandCenterStatus,
  isProtected: boolean,
  protection?: string,
  localSeoState?: KeywordCommandCenterLocalSeoState,
): KeywordCommandCenterNextAction[] {
  const keyword = row.keyword;
  const actions: KeywordCommandCenterNextAction[] = [];
  if (status === KEYWORD_COMMAND_CENTER_STATUS.DECLINED || status === KEYWORD_COMMAND_CENTER_STATUS.RETIRED) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
      label: 'Restore',
      detail: 'Reactivate this keyword in the operating loop without deleting history.',
      tone: 'teal',
      keyword,
    });
    return actions;
  }

  if (localSeoState) {
    actions.push({
      type: 'check_local_visibility',
      label: localSeoState.checked ? 'Refresh local' : 'Check locally',
      detail: 'Run a local-pack visibility refresh for this keyword through the background job system.',
      tone: 'teal',
      keyword,
      disabled: localSeoState.priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP,
      disabledReason: localSeoState.priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP
        ? 'Configure a local market before checking local visibility.'
        : undefined,
    });
  }

  if (row.feedback?.status === 'requested' || status === KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      label: 'Add to strategy',
      detail: 'Approve this keyword into the strategy operating loop without publishing anything.',
      tone: 'teal',
      keyword,
    });
  }

  if (!row.tracking || (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
    actions.push({
      type: row.rawEvidenceOnly || row.explanation?.rawEvidenceOnly
        ? KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
        : KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
      label: row.rawEvidenceOnly || row.explanation?.rawEvidenceOnly ? 'Promote evidence' : 'Track keyword',
      detail: 'Add this keyword to active rank tracking so it can be measured intentionally.',
      tone: 'teal',
      keyword,
    });
  } else {
    actions.push({
      type: 'view_rankings',
      label: 'View rankings',
      detail: 'Open Rank Tracker as the measurement surface for this keyword.',
      tone: 'blue',
      keyword,
      targetTab: 'seo-ranks',
    });
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      label: 'Pause tracking',
      detail: 'Hide this keyword from active tracking while preserving rank history.',
      tone: 'amber',
      keyword,
      disabledReason: isProtected ? `${protection} requires confirmation before pausing.` : undefined,
    });
  }

  if (row.explanation?.role === 'content_gap' || row.assignment?.role === 'content_gap') {
    actions.push({
      type: 'generate_brief',
      label: 'Generate brief',
      detail: 'Open the content planning flow with this keyword as context. Nothing is published automatically.',
      tone: 'teal',
      keyword,
      targetTab: 'content-pipeline',
    });
  }
  const pagePath = row.explanation?.role === 'page_keyword' ? row.explanation.pagePath : row.assignment?.role === 'page_keyword' ? row.assignment.pagePath : undefined;
  if (pagePath) {
    actions.push({
      type: 'review_page',
      label: 'Review page',
      detail: 'Open Page Intelligence for the mapped page before making changes.',
      tone: 'teal',
      keyword,
      pagePath,
      targetTab: 'page-intelligence',
    });
  }

  actions.push({
    type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
    label: 'Decline',
    detail: 'Suppress this keyword from future strategy and recommendation consideration.',
    tone: 'red',
    keyword,
    disabledReason: isProtected ? `${protection} requires confirmation before decline.` : undefined,
  });

  if (row.tracking) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      label: 'Retire',
      detail: 'Remove from active strategy-owned tracking without deleting rank history.',
      tone: 'red',
      keyword,
      disabledReason: isProtected ? `${protection} requires confirmation before retirement.` : undefined,
    });
  }
  return actions;
}

export function sortRows(a: KeywordCommandCenterRow, b: KeywordCommandCenterRow): number {
  const statusOrder: Record<KeywordCommandCenterStatus, number> = {
    [KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY]: 0,
    [KEYWORD_COMMAND_CENTER_STATUS.TRACKED]: 1,
    [KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW]: 2,
    [KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE]: 3,
    [KEYWORD_COMMAND_CENTER_STATUS.DECLINED]: 4,
    [KEYWORD_COMMAND_CENTER_STATUS.RETIRED]: 5,
  };
  const byStatus = statusOrder[a.lifecycleStatus] - statusOrder[b.lifecycleStatus];
  if (byStatus !== 0) return byStatus;
  const aVolume = a.metrics.volume ?? a.metrics.impressions ?? 0;
  const bVolume = b.metrics.volume ?? b.metrics.impressions ?? 0;
  if (aVolume !== bVolume) return bVolume - aVolume;
  return a.keyword.localeCompare(b.keyword);
}

// ---------------------------------------------------------------------------
// Unified sort comparator (single source of truth for BOTH stages)
//
// The page-bounded pipeline sorts cheap candidate keys pre-pagination
// (`candidateSortForQuery`) and full rows post-evaluation (`sortRowsForQuery`).
// If the two comparators disagree, page-1 ≠ global-top-N. To make drift
// impossible, both consume the SAME `keywordSortComparator` via type-specific
// field accessors. Only the accessors differ between the two stages.
// ---------------------------------------------------------------------------

/** The explicit, directioned sorts handled by the shared comparator core. */
type ExplicitSort = 'keyword' | 'demand' | 'rank' | 'clicks' | 'difficulty' | 'opportunity';

/** Per-type field readers. `null`/`undefined` numeric values mean "missing". */
interface SortFieldAccessors<T> {
  keyword: (item: T) => string;
  demand: (item: T) => number | null | undefined;
  rank: (item: T) => number | null | undefined;
  clicks: (item: T) => number | null | undefined;
  difficulty: (item: T) => number | null | undefined;
  /** Opportunity score (0–100): volume-weighted × ease. The DEFAULT Hub sort. */
  opportunity: (item: T) => number | null | undefined;
}

/**
 * Natural sort directions when `direction` is absent. `keyword`/`rank` ascend
 * (A→Z, position 1 first); `demand`/`clicks`/`difficulty` descend (biggest
 * first). An explicit `direction` always overrides these.
 */
const NATURAL_SORT_DIRECTION: Record<ExplicitSort, 'asc' | 'desc'> = {
  keyword: 'asc',
  rank: 'asc',
  demand: 'desc',
  clicks: 'desc',
  difficulty: 'desc',
  opportunity: 'desc',
};

/**
 * Compare two possibly-missing numeric metric values such that missing values
 * ALWAYS sort last regardless of direction. Returns a directioned comparison
 * for two present values, and a sign that pushes the missing one last.
 */
function compareMetric(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: 'asc' | 'desc',
): number {
  const aMissing = a == null || Number.isNaN(a);
  const bMissing = b == null || Number.isNaN(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // a goes after b
  if (bMissing) return -1; // b goes after a
  return direction === 'asc' ? a - b : b - a;
}

/**
 * The shared comparator for the explicit, directioned sorts. Tiebreak is ALWAYS
 * `keyword.localeCompare` (ascending) in both stages — identical tiebreak →
 * identical order → page-1 == global-top-N.
 */
function keywordSortComparator<T>(
  sort: ExplicitSort,
  direction: 'asc' | 'desc' | undefined,
  accessors: SortFieldAccessors<T>,
): (a: T, b: T) => number {
  const dir = direction ?? NATURAL_SORT_DIRECTION[sort];
  const tiebreak = (a: T, b: T) => accessors.keyword(a).localeCompare(accessors.keyword(b));
  if (sort === 'keyword') {
    return (a, b) => {
      const cmp = accessors.keyword(a).localeCompare(accessors.keyword(b));
      return dir === 'asc' ? cmp : -cmp;
    };
  }
  const read: (item: T) => number | null | undefined =
    sort === 'demand' ? accessors.demand
      : sort === 'rank' ? accessors.rank
        : sort === 'clicks' ? accessors.clicks
          : sort === 'opportunity' ? accessors.opportunity
            : accessors.difficulty;
  return (a, b) => {
    const cmp = compareMetric(read(a), read(b), dir);
    if (cmp !== 0) return cmp;
    return tiebreak(a, b);
  };
}

const ROW_SORT_ACCESSORS: SortFieldAccessors<KeywordCommandCenterRow> = {
  keyword: (row) => row.keyword,
  demand: (row) => row.metrics.volume ?? row.metrics.impressions,
  rank: (row) => row.metrics.currentPosition,
  clicks: (row) => row.metrics.clicks,
  difficulty: (row) => row.metrics.difficulty,
  // Opportunity from demand + difficulty ONLY (the exact fields the Task-1
  // resolver keeps identical between candidate and row) so the two sort stages
  // cannot drift. computeOpportunityScore returns undefined with no signal →
  // those keywords sort last (compareMetric missing-last).
  opportunity: (row) => computeOpportunityScore({ volume: row.metrics.volume ?? row.metrics.impressions, difficulty: row.metrics.difficulty }),
};

export function sortRowsForQuery(
  sort: KeywordCommandCenterSort | undefined,
  direction?: 'asc' | 'desc',
): (a: KeywordCommandCenterRow, b: KeywordCommandCenterRow) => number {
  if (sort === undefined || sort === 'priority') return sortRows;
  return keywordSortComparator(sort, direction, ROW_SORT_ACCESSORS);
}

export function matchesFilter(row: KeywordCommandCenterRow, filter: KeywordCommandCenterFilter): boolean {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return true;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) return row.assignment?.role === 'content_gap';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) return row.assignment?.role === 'page_keyword';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return Boolean(row.localSeoState);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) {
    return row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED) return Boolean(row.localSeoState && !row.localSeoState.checked);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) return row.feedback?.status === 'requested';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) return row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY) return row.isLostVisibility === true;
  return row.lifecycleStatus === filter;
}

export function matchesSearch(row: KeywordCommandCenterRow, search: string | undefined): boolean {
  const query = keywordComparisonKey(search ?? '');
  if (!query) return true;
  return row.normalizedKeyword.includes(query)
    || row.assignment?.pagePath?.toLowerCase().includes(query) === true
    || row.assignment?.pageTitle?.toLowerCase().includes(query) === true;
}

export function stripLocalSeoVisibility<T extends LocalSeoKeywordVisibilitySummary | undefined>(visibility: T): T {
  if (!visibility) return visibility;
  return {
    ...visibility,
    topCompetitors: undefined,
    markets: visibility.markets.map(market => ({ ...market, topCompetitors: undefined })),
  } as T;
}

function stripRowForList(row: KeywordCommandCenterRow): KeywordCommandCenterRow {
  const localSeo = stripLocalSeoVisibility(row.localSeo);
  return {
    ...row,
    explanation: undefined,
    localSeo,
    localSeoState: row.localSeoState ? {
      ...row.localSeoState,
      visibility: stripLocalSeoVisibility(row.localSeoState.visibility),
    } : undefined,
  };
}

export function paginateRows(rows: KeywordCommandCenterRow[], query: KeywordCommandCenterRowsQuery): KeywordCommandCenterRowsResponse['pageInfo'] & { rows: KeywordCommandCenterRow[] } {
  const pageSize = Math.min(Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(Math.max(Number(query.page) || 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    pageSize,
    totalRows,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

export function filterCount(rows: KeywordCommandCenterRow[], filter: KeywordCommandCenterFilter): number {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return rows.length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) return rows.filter(row => row.assignment?.role === 'content_gap').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) return rows.filter(row => row.assignment?.role === 'page_keyword').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return rows.filter(row => row.localSeoState).length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) {
    return rows.filter(row => row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) {
    return rows.filter(row => row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) {
    return rows.filter(row => row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return rows.filter(row =>
      row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED) return rows.filter(row => row.localSeoState && !row.localSeoState.checked).length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) {
    return rows.filter(row => row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) return rows.filter(row => row.feedback?.status === 'requested').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) {
    return rows.filter(row => row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY) {
    return rows.filter(row => row.isLostVisibility === true).length;
  }
  return rows.filter(row => row.lifecycleStatus === filter).length;
}

export function filterNeedsLocalCandidates(filter: KeywordCommandCenterFilter | undefined): boolean {
  return filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES;
}

export function buildCounts(rows: KeywordCommandCenterRow[]): KeywordCommandCenterCounts {
  return {
    total: rows.length,
    inStrategy: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY).length,
    tracked: rows.filter(row => row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE).length,
    needsReview: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW).length,
    evidence: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE).length,
    local: rows.filter(row => row.localSeoState).length,
    localCandidates: rows.filter(row => row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE).length,
    retired: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.RETIRED).length,
    declined: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.DECLINED).length,
    lostVisibility: rows.filter(row => row.isLostVisibility === true).length,
    // Sentinel-masked volumes have already been dropped to undefined by mergeMetrics,
    // so any null/undefined here is genuinely missing (not a planner-bucket masquerade).
    missingVolume: rows.filter(row => row.metrics.volume == null || row.metrics.volume <= 0).length,
  };
}

function buildFilters(rows: KeywordCommandCenterRow[]): KeywordCommandCenterFilterMeta[] {
  const filters: Array<{ id: KeywordCommandCenterFilter; label: string }> = [
    { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In Strategy' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs Review' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.CONTENT, label: 'Content' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED, label: 'Page Assigned' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, label: 'Raw Evidence' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, label: 'Local Candidates' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY, label: 'Visible Locally' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH, label: 'Possible Match' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE, label: 'Not Visible' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED, label: 'Not Checked' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED, label: 'Provider Degraded' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY, label: 'Lost Visibility' },
  ];
  return filters.map(filter => ({ ...filter, count: filterCount(rows, filter.id) }));
}

interface SkinnyFilterCounts {
  all: number;
  inStrategy: number;
  tracked: number;
  needsReview: number;
  content: number;
  pageAssigned: number;
  rawEvidence: number;
  local: number;
  localCandidates: number;
  visibleLocally: number;
  possibleMatch: number;
  notVisible: number;
  notChecked: number;
  providerDegraded: number;
  requested: number;
  declined: number;
  retired: number;
  lostVisibility: number;
}

export function buildFilterFacetsFromCounts(counts: SkinnyFilterCounts): KeywordCommandCenterFilterMeta[] {
  return [
    { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All', count: counts.all },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In Strategy', count: counts.inStrategy },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked', count: counts.tracked },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs Review', count: counts.needsReview },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.CONTENT, label: 'Content', count: counts.content },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED, label: 'Page Assigned', count: counts.pageAssigned },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, label: 'Raw Evidence', count: counts.rawEvidence },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local', count: counts.local },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, label: 'Local Candidates', count: counts.localCandidates },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY, label: 'Visible Locally', count: counts.visibleLocally },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH, label: 'Possible Match', count: counts.possibleMatch },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE, label: 'Not Visible', count: counts.notVisible },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED, label: 'Not Checked', count: counts.notChecked },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED, label: 'Provider Degraded', count: counts.providerDegraded },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested', count: counts.requested },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined', count: counts.declined },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired', count: counts.retired },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY, label: 'Lost Visibility', count: counts.lostVisibility },
  ];
}

async function populateDraftRows(rows: Map<string, DraftRow>, bundle: CommandCenterSourceBundle): Promise<void> {
  const strategy = bundle.strategy;

  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const row = ensureRow(rows, metric.keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
    mergeMetrics(row, { volume: metric.volume, difficulty: metric.difficulty });
  }

  for (const keyword of strategy?.siteKeywords ?? []) {
    const row = ensureRow(rows, keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
  }

  for (const page of bundle.pageMap) {
    const pageKeywords = [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].filter(Boolean);
    for (const keyword of pageKeywords) {
      const row = ensureRow(rows, keyword);
      if (!row) continue;
      setAssignment(row, {
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        role: 'page_keyword',
      });
      addSource(row, { kind: 'page_assignment', label: 'Page assignment', detail: page.pageTitle ?? page.pagePath });
      mergeMetrics(row, {
        volume: page.volume,
        difficulty: page.difficulty,
        intent: page.searchIntent, // NOTE field name: pageMap carries intent as `searchIntent`
      });
    }
  }

  for (const gap of bundle.contentGaps) {
    const row = ensureRow(rows, gap.targetKeyword);
    if (!row) continue;
    setAssignment(row, {
      pageTitle: gap.topic,
      role: 'content_gap',
    });
    addSource(row, { kind: 'content_gap', label: 'Content opportunity', detail: gap.topic });
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
      intent: gap.intent,
    });
  }

  const strategyUx = bundle.includeStrategyUx === false
    ? null
    : await buildKeywordStrategyUxPayload({
      workspaceId: bundle.workspaceId,
      workspaceName: bundle.workspaceName,
      strategy: strategy ?? null,
      pageMap: bundle.pageMap,
      contentGaps: bundle.contentGaps,
      keywordGaps: bundle.keywordGaps,
      surface: 'admin',
      trackedKeywords: bundle.trackedKeywords,
      includeWorkspaceIntelligence: bundle.includeWorkspaceIntelligence,
    });

  for (const explanation of strategyUx?.explanations ?? []) {
    const row = ensureRow(rows, explanation.keyword);
    if (!row) continue;
    row.explanation = explanation;
    row.rawEvidenceOnly = Boolean(explanation.rawEvidenceOnly);
    addSource(row, sourceFromExplanation(explanation));
    mergeMetrics(row, {
      volume: explanation.role === 'content_gap'
        ? bundle.contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.volume
        : undefined,
      difficulty: explanation.role === 'content_gap'
        ? bundle.contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.difficulty
        : undefined,
    });
  }

  for (const gap of bundle.keywordGaps) {
    const row = ensureRow(rows, gap.keyword);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? !row.explanation;
    addSource(row, sourceFromKeywordGap(gap));
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
    });
  }

  for (const keyword of bundle.trackedKeywords) {
    const row = ensureRow(rows, keyword.query);
    if (!row) continue;
    row.tracking = keyword;
    addSource(row, {
      kind: keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL ? 'manual' : 'tracking',
      label: 'Rank tracking',
      detail: trackingSourceDetail(keyword.source),
    });
    mergeMetrics(row, {
      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,
      intent: keyword.intent,
      currentPosition: keyword.baselinePosition,
      clicks: keyword.baselineClicks,
      impressions: keyword.baselineImpressions,
    });
  }

  for (const [normalized, row] of bundle.feedback) {
    const draft = ensureRow(rows, row.keyword);
    if (!draft) continue;
    draft.feedback = feedbackState(row);
    addSource(draft, {
      kind: row.status === 'requested' ? 'client_request' : 'feedback',
      label: row.status === 'requested' ? 'Requested keyword' : 'Keyword feedback',
      detail: row.status,
    });
    if (draft.normalizedKeyword !== normalized) rows.set(normalized, draft);
  }

  for (const lost of bundle.lostVisibilityRows ?? []) {
    const row = ensureRow(rows, lost.query);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? true;
    addSource(row, {
      kind: 'rank_data',
      label: 'Lost Search Console visibility',
      detail: `Last seen ${lost.lastSeen}`,
    });
    mergeMetrics(row, {
      currentPosition: lost.lastPosition ?? undefined,
      impressions: lost.totalImpressions,
    });
  }

  const strategyKeys = [...rows.entries()]
    .filter(([, row]) => row.rawEvidenceOnly !== true)
    .map(([key]) => key);
  const metricsMap = new Map(
    strategyKeys.map(key => [key, rows.get(key)?.metrics.impressions ?? 0]),
  );
  const variantParentMap = new Map<string, string>();
  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    if (!normalizedQuery || rows.has(normalizedQuery)) continue;
    const parent = findBestParent(normalizedQuery, strategyKeys, metricsMap);
    if (parent) variantParentMap.set(normalizedQuery, parent);
  }

  const rankedUntrackedFiltered = bundle.latestRanks
    .filter(rank => !rows.has(keywordComparisonKey(rank.query)))
    .filter(rank => !variantParentMap.has(keywordComparisonKey(rank.query)));
  const { selected: rankedUntracked } = selectRankEvidence(rankedUntrackedFiltered, bundle.workspaceId);
  for (const rank of rankedUntracked) {
    const row = ensureRow(rows, rank.query);
    if (!row) continue;
    row.rank = rank;
    addSource(row, { kind: 'rank_data', label: 'Search Console evidence', detail: 'Ranking query not currently selected' });
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  for (const rank of bundle.latestRanks) {
    const row = rows.get(keywordComparisonKey(rank.query));
    if (!row) continue;
    row.rank = rank;
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    const parentKey = variantParentMap.get(normalizedQuery);
    if (!parentKey) continue;
    const parentRow = rows.get(parentKey);
    if (!parentRow) continue;
    parentRow.variants = parentRow.variants ?? [];
    parentRow.variants.push(rank);
    parentRow.metrics.impressions = (parentRow.metrics.impressions ?? 0) + rank.impressions;
    parentRow.metrics.clicks = (parentRow.metrics.clicks ?? 0) + rank.clicks;
    if (
      parentRow.metrics.currentPosition == null
      || rank.position < parentRow.metrics.currentPosition
    ) {
      parentRow.metrics.currentPosition = rank.position;
    }
  }

  for (const candidate of bundle.localCandidates ?? []) {
    // F2: local candidates are built by buildLocalSeoKeywordCandidates (a separate
    // source from the gated gaps), so apply Tier-1 here too — a malformed gap
    // keyword with a local twin must not leak into the local_candidates filter.
    // Tier-1 only (matches the localVisibility candidate-boundary gate); local
    // candidates are a curated/local surface and are never relevance-gated.
    if (isTier1JunkKeyword(candidate.keyword)) continue;
    const row = ensureRow(rows, candidate.keyword);
    if (!row) continue;
    row.localCandidate = candidate;
    addSource(row, {
      kind: 'local_candidate',
      label: candidate.sourceLabel,
      detail: candidate.detail,
    });
    mergeMetrics(row, {
      volume: candidate.volume,
      difficulty: candidate.difficulty,
    });
  }
}

function finalizeDraftRow(row: DraftRow, context: RowFinalizeContext): KeywordCommandCenterRow {
  const status = lifecycleStatus(row);
  const protection = protectedReason(row.tracking);
  const explanationRole = row.explanation?.role;
  const isProtected = Boolean(protection);
  const localSeo = context.localVisibilityByKeyword.get(row.normalizedKeyword);
  const localSeoState = buildLocalSeoState(row, status, localSeo, context.activeLocalMarketCount);
  const finalized: KeywordCommandCenterRow = {
    keyword: row.keyword,
    normalizedKeyword: row.normalizedKeyword,
    lifecycleStatus: status,
    statusLabel: statusLabel(status),
    sourceLabels: row.sourceLabels,
    metrics: row.metrics,
    assignment: row.explanation ? {
      pagePath: row.explanation.pagePath,
      pageTitle: row.explanation.pageTitle,
      role: explanationRole === 'competitor_gap' ? 'raw_evidence' : explanationRole,
    } : row.assignment ?? (row.localCandidate?.pagePath || row.localCandidate?.pageTitle ? {
      pagePath: row.localCandidate.pagePath,
      pageTitle: row.localCandidate.pageTitle,
      role: row.localCandidate.source === 'content_gap' ? 'content_gap' : 'page_keyword',
    } : undefined),
    feedback: row.feedback,
    tracking: row.tracking ? {
      status: row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      source: row.tracking.source,
      pinned: row.tracking.pinned,
      addedAt: row.tracking.addedAt,
      pagePath: row.tracking.pagePath,
      pageTitle: row.tracking.pageTitle,
      replacedBy: row.tracking.replacedBy,
      deprecatedAt: row.tracking.deprecatedAt,
      // Wave 3d-i ADDITIVE provenance (admin-only). Merged onto bundle.trackedKeywords
      // from the provenance-bearing table read (mergeTrackedKeywordProvenance).
      sourceGapKey: row.tracking.sourceGapKey,
      // Wave 4 P0 ADDITIVE ownership (admin-only, three-state). Merged onto row.tracking
      // by mergeTrackedKeywordProvenance from the provenance-bearing read. Project the
      // raw value — NEVER Boolean()/?? false (undefined = ownership unknown, a real state).
      // Stripped from getTrackedKeywords / the public endpoint, so it never leaks.
      strategyOwned: row.tracking.strategyOwned,
      // True when any rank/GSC signal has materialized for the row. Distinguishes
      // active-with-data ("Active") from active-but-empty ("Awaiting data") in the UI.
      // Audit on Swish found ~75% of active-tracked rows had no rank/clicks/impressions —
      // they were tracked in name only until a snapshot showed up.
      hasSignal: row.metrics.currentPosition != null
        || row.metrics.clicks != null
        || row.metrics.impressions != null,
    } : { status: 'not_tracked' },
    explanation: row.explanation,
    localSeo,
    localSeoState,
    nextActions: buildNextActions(row, status, isProtected, protection, localSeoState),
    isProtected,
    protectionReason: protection,
    rawEvidenceOnly: row.rawEvidenceOnly,
    variantCount: row.variants?.length ?? 0,
    variants: row.variants?.map(variant => ({
      query: variant.query,
      position: variant.position,
      clicks: variant.clicks,
      impressions: variant.impressions,
      ctr: variant.ctr,
    })),
    isLostVisibility: context.lostVisibilityKeys?.has(row.normalizedKeyword) ?? false,
  };
  // Phase 1: precompute the row value score ONCE per key (flag ON only) from the
  // fully-merged row.metrics, using the SAME computeKeywordValueScore + SAME
  // per-request ScoringContext as the candidate merge-back — so candidate and row
  // scores are identical by construction. Stored on the WeakMap (never serialized).
  if (context.valueScoring?.on && context.valueScoring.ctx) {
    const score = computeKeywordValueScore(
      {
        keyword: finalized.keyword,
        volume: finalized.metrics.volume,
        impressions: finalized.metrics.impressions,
        difficulty: finalized.metrics.difficulty,
        cpc: finalized.metrics.cpc,
        intent: finalized.metrics.intent,
      },
      context.valueScoring.ctx,
    );
    if (score !== undefined) rowValueScore.set(finalized, score);
  }
  return finalized;
}

function finalizeDraftRows(rows: Map<string, DraftRow>, context: RowFinalizeContext): FinalizedRows {
  const rawEvidenceRows = [...rows.values()].filter(row => row.rawEvidenceOnly && !row.tracking && !row.feedback && !row.localCandidate);
  // Flag-derived raw-evidence cap: 75 (flag OFF, byte-identical) → the universe
  // safety ceiling (flag ON). Still value-ordered (volume desc) so the cap keeps
  // the high-value head — the row stage's equivalent of selectRankEvidence.
  const rawEvidenceLimit = isFeatureEnabled(KEYWORD_UNIVERSE_FULL_FLAG, context.workspaceId)
    ? UNIVERSE_SAFETY_CEILING
    : RAW_EVIDENCE_ROW_LIMIT;
  const allowedRawEvidence = new Set(
    rawEvidenceRows
      .sort((a, b) => (b.metrics.volume ?? 0) - (a.metrics.volume ?? 0))
      .slice(0, rawEvidenceLimit)
      .map(row => row.normalizedKeyword),
  );

  const finalRows = [...rows.values()]
    .filter(row => !row.rawEvidenceOnly || row.tracking || row.feedback || row.localCandidate || allowedRawEvidence.has(row.normalizedKeyword))
    .map(row => finalizeDraftRow(row, context))
    .sort(sortRows);

  return {
    rows: finalRows,
    rawEvidenceTotal: rawEvidenceRows.length,
    rawEvidenceReturned: allowedRawEvidence.size,
  };
}

function ensureLocalVisibilityRows(
  rows: Map<string, DraftRow>,
  localVisibilityByKeyword: Map<string, LocalSeoKeywordVisibilitySummary>,
): void {
  for (const [normalizedKeyword, visibility] of localVisibilityByKeyword) {
    const row = ensureRow(rows, visibility.keyword);
    if (!row) continue;
    if (row.normalizedKeyword !== normalizedKeyword) rows.set(normalizedKeyword, row);
    addSource(row, {
      kind: 'local_visibility',
      label: 'Local visibility',
      detail: visibility.label,
    });
  }
}

async function buildKeywordCommandCenterModel(
  workspaceId: string,
  options: {
    includeLocalSeo?: boolean;
    includeLocalSeoDetails?: boolean;
    includeLocalCandidates?: boolean;
    includeStrategyUx?: boolean;
    timingLabel?: string;
  } = {},
): Promise<KeywordCommandCenterResponse | null> {
  const startedAt = Date.now();
  const marks: Record<string, number> = {};
  const heap: Record<string, number> = {};
  const mark = (stage: string) => {
    marks[stage] = Date.now() - startedAt;
    heap[stage.replace(/Ms$/, 'HeapMb')] = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  };
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  // #19b: siteKeywordMetrics resolved table-first (blob fallback). siteKeywords/
  // generatedAt stay blob-sourced.
  const strategy = withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy);
  const pageMap = options.includeStrategyUx === false
    ? listPageKeywordsLite(workspace.id)
    : listPageKeywords(workspace.id);
  // contentGaps + keywordGaps via the single assembler (#2). strategy stays the
  // raw blob (siteKeywords/generatedAt) with siteKeywordMetrics table-resolved
  // above, and pageMap keeps the Lite/full page_keywords path above — KCC only
  // needs the two gap arrays here.
  const assembled = assembleStoredKeywordStrategy(workspace.id);
  // Tier-1 + Tier-2 junk gate applied ONCE at the discovery source so the read
  // model (incl. the LOCAL_CANDIDATES filter) never surfaces a junk gap keyword.
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: assembled?.contentGaps ?? [],
    keywordGaps: assembled?.keywordGaps ?? [],
  });
  // Wave 3d-i: getTrackedKeywords strips provenance; merge sourceGapKey back from
  // the provenance-bearing table read (KCC is admin-authed) so the tracking row can
  // expose it.
  // Wave 3d-ii: read the table-bearing shape (sourceGapKey + strategyOwned merged
  // back). Ownership/classification now reads strategyOwned directly — the read-time
  // inferTrackedKeywordSources call was RETIRED (the boot backfill still stamps legacy
  // UNKNOWN sources one-time). sourceKeysForRows + trackedKeywordMatchesFilter +
  // protectedReason all agree on this merged shape.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  );
  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const feedback = readFeedback(workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  const lostVisibilityKeys = new Set(lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  mark('sourceLoadingMs');
  const localVisibilityByKeyword = options.includeLocalSeo
    ? options.includeLocalSeoDetails
      ? buildLocalSeoKeywordVisibilityByKey(workspace.id)
      : buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id)
    : new Map();
  // KCC row enrichment uses sourceLabel/detail/pagePath/pageTitle/volume/difficulty.
  // `reasons` and the evaluator's suppression are not needed — cheap default is correct.
  const localCandidates = options.includeLocalSeo && options.includeLocalCandidates === true
    ? (() => {
        // Sort unselected candidates first so the slice doesn't exhaust its budget on
        // strategy/tracking-sourced entries (which are already IN_STRATEGY or TRACKED and
        // therefore get lifecycle=SELECTED).  The "Local Candidates" filter only matches
        // lifecycle=CANDIDATE, so without this reorder the filter returns 0 rows even
        // when hundreds of local_variant / content_gap candidates exist further down the
        // score-sorted list.  Within each group the original score order is preserved.
        const all = buildLocalSeoKeywordCandidates(workspace.id);
        const sorted = [
          ...all.filter(c => !c.selected),
          ...all.filter(c => c.selected),
        ];
        // Task 3 OOM EXCEPTION: the universe-full flag does NOT lift this cap.
        // localCandidates feed the LOCAL_CANDIDATES filter, which takes the MODEL
        // path (buildKeywordCommandCenterModel → full per-row evaluation, not the
        // page-bounded skinny path). Lifting this to UNIVERSE_SAFETY_CEILING would
        // force thousands of full row evaluations into memory at once (the exact
        // OOM regression docs/rules/keyword-command-center.md guards against), so it
        // stays at LOCAL_CANDIDATE_ROW_LIMIT regardless of the flag.
        return sorted.slice(0, LOCAL_CANDIDATE_ROW_LIMIT);
      })()
    : [];
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  mark('localSeoMs');
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks,
    feedback,
    localCandidates,
    lostVisibilityRows,
    includeStrategyUx: options.includeStrategyUx,
  });
  ensureLocalVisibilityRows(rows, localVisibilityByKeyword);
  mark('strategyUxMs');
  const finalized = finalizeDraftRows(rows, {
    workspaceId: workspace.id,
    localVisibilityByKeyword,
    activeLocalMarketCount,
    lostVisibilityKeys,
    // Phase 1: precompute row valueScore in finalize when the flag is ON (no DB
    // reads when OFF). The model path's row sort selects the accessor by the same flag.
    valueScoring: buildValueScoringConfig(workspace),
  });
  const finalRows = finalized.rows;
  mark('rowIndexMs');

  log.info({
    workspaceId,
    mode: options.timingLabel ?? 'full',
    rowCount: finalRows.length,
    rawEvidenceTotal: finalized.rawEvidenceTotal,
    rawEvidenceReturned: finalized.rawEvidenceReturned,
    ...marks,
    ...heap,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center read model built');

  return {
    rows: finalRows,
    counts: buildCounts(finalRows),
    filters: buildFilters(finalRows),
    rawEvidenceTotal: finalized.rawEvidenceTotal,
    rawEvidenceReturned: finalized.rawEvidenceReturned,
    generatedAt: strategy?.generatedAt ?? null,
  };
}

export async function buildKeywordCommandCenterSummary(
  workspaceId: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterSummaryResponse | null> {
  const startedAt = Date.now();
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const allKeys = new Set<string>();
  const inStrategyKeys = new Set<string>();
  const pageAssignedKeys = new Set<string>();
  const contentKeys = new Set<string>();
  const rawEvidenceKeys = new Set<string>();
  // Track which keys have at least one source contributing a positive volume
  // value. Used to surface "{X} keywords missing demand data" diagnostic.
  const keysWithVolume = new Set<string>();
  const addKey = (target: Set<string>, keyword: string | undefined) => {
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    target.add(key);
    allKeys.add(key);
  };
  const markVolume = (keyword: string | undefined, volume: number | undefined | null) => {
    if (volume == null || volume <= 0) return;
    // Mirror the planner-bucket mask from mergeMetrics — a 1M+ planner sentinel
    // is NOT real demand data, so it must not count toward the volume diagnostic.
    if (isSuspiciousPlannerGroupedVolume(keyword, volume)) return;
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    keysWithVolume.add(key);
  };

  // #19b: siteKeywordMetrics resolved table-first (blob fallback).
  const summaryStrategy = withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy);
  for (const metric of summaryStrategy?.siteKeywordMetrics ?? []) {
    addKey(inStrategyKeys, metric.keyword);
    markVolume(metric.keyword, metric.volume);
  }
  for (const keyword of summaryStrategy?.siteKeywords ?? []) addKey(inStrategyKeys, keyword);

  for (const page of listPageKeywordsLite(workspace.id)) {
    addKey(pageAssignedKeys, page.primaryKeyword);
    addKey(inStrategyKeys, page.primaryKeyword);
    markVolume(page.primaryKeyword, page.volume);
    for (const secondary of page.secondaryKeywords ?? []) {
      addKey(pageAssignedKeys, secondary);
      addKey(inStrategyKeys, secondary);
      // Page secondaries don't carry their own volume — the page's volume is
      // associated with the primary keyword only.
    }
  }

  // contentGaps + keywordGaps via the single assembler (#2); siteKeywords/
  // siteKeywordMetrics above stay blob-sourced (workspace.keywordStrategy).
  // F1 fix: gate the discovery gaps through the SAME Tier-1 + Tier-2 junk gate the
  // rows path uses, so the summary `counts`/`filterCounts` and `/rows?filter=all`
  // `totalRows` agree on the gated universe (numerator/denominator share a source).
  const summaryAssembled = assembleStoredKeywordStrategy(workspace.id);
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: summaryAssembled?.contentGaps ?? [],
    keywordGaps: summaryAssembled?.keywordGaps ?? [],
  });
  for (const gap of contentGaps) {
    addKey(contentKeys, gap.targetKeyword);
    addKey(inStrategyKeys, gap.targetKeyword);
    markVolume(gap.targetKeyword, gap.volume);
  }

  for (const gap of keywordGaps) {
    addKey(rawEvidenceKeys, gap.keyword);
    markVolume(gap.keyword, gap.volume);
  }

  const feedback = readFeedback(workspace.id);
  // Wave 3d-ii: merge the table-bearing shape so trackedKeywordMatchesFilter (used
  // below) sees strategyOwned — getTrackedKeywords STRIPS it, so without this merge
  // the IN_STRATEGY summary count would read undefined → false → zero. Read-time
  // inferTrackedKeywordSources was retired here too.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  );
  for (const tracked of trackedKeywords) {
    addKey(allKeys, tracked.query);
    markVolume(tracked.query, tracked.volume);
  }
  const trackedKeys = new Set(trackedKeywords.map(keyword => keywordComparisonKey(keyword.query)).filter(Boolean));

  // Align with sourceKeysForRows(IN_STRATEGY): tracked keywords promoted from the
  // strategy (active + STRATEGY_PRIMARY/STRATEGY_SITE_KEYWORD source) count toward
  // In Strategy. Without this, the summary badge under-counts vs the rows table.
  for (const tracked of trackedKeywords) {
    if (trackedKeywordMatchesFilter(tracked, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)) {
      addKey(inStrategyKeys, tracked.query);
    }
  }

  for (const row of feedback.values()) addKey(allKeys, row.keyword);
  const feedbackKeys = new Set([...feedback.keys()]);

  // Align with sourceKeysForRows(IN_STRATEGY): approved feedback keywords count toward
  // In Strategy; declined/requested feedback keys must NOT (they live under other tabs).
  for (const row of feedback.values()) {
    if (row.status === 'approved') addKey(inStrategyKeys, row.keyword);
  }
  for (const row of feedback.values()) {
    if (row.status === 'declined' || row.status === 'requested') {
      const key = keywordComparisonKey(row.keyword);
      if (key) inStrategyKeys.delete(key);
    }
  }

  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  const lostVisibilityCount = lostVisibilityRows.length;
  const lostVisibilityKeys = new Set(lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  for (const key of lostVisibilityKeys) allKeys.add(key);
  const rankEvidenceKeys = new Set<string>();
  // The pre-ceiling count of selected rank-evidence queries — drives honest
  // truncation disclosure (rawEvidenceTotal) when the safety ceiling bites.
  const rankEvidenceFiltered = latestRanks.filter(
    rank => !allKeys.has(keywordComparisonKey(rank.query)),
  );
  const rankEvidence = selectRankEvidence(rankEvidenceFiltered, workspace.id);
  for (const rank of rankEvidence.selected) {
    addKey(rankEvidenceKeys, rank.query);
  }
  const rankEvidenceTotal = rankEvidence.total;

  const activeTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
  const inactiveTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE);
  const requested = [...feedback.values()].filter(row => row.status === 'requested');
  const declined = [...feedback.values()].filter(row => row.status === 'declined');
  const rawEvidenceOnlyKeys = new Set(
    [...rawEvidenceKeys].filter(key =>
      !inStrategyKeys.has(key)
      && !trackedKeys.has(key)
      && !feedbackKeys.has(key)
    ),
  );
  const localVisibility = options.includeLocalSeo ? buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id) : new Map();
  for (const key of localVisibility.keys()) allKeys.add(key);
  const localVisibilityValues = [...localVisibility.values()];

  // Local Candidates badge: cheap count-only path that skips evaluateKeywordCandidate
  // (the per-candidate scan that caused the 35-second regression in PR #876).
  // `countLocalSeoKeywordCandidates` mirrors the candidate generator's outer iteration
  // and source filters (declined/inactive/intent/market) but never builds row objects
  // or runs eligibility evaluation. Sub-100ms even on Swish-scale workspaces.
  // Slight overcount possible — the displayable list still comes from the full
  // generator when the user clicks into the Local Candidates filter.
  let localCandidatesCount = 0;
  if (options.includeLocalSeo) {
    try {
      // local-candidates-unconditional-ok: countLocalSeoKeywordCandidates is the cheap-count helper, not the full generator; capped at LOCAL_CANDIDATE_HARD_CAP
      localCandidatesCount = countLocalSeoKeywordCandidates(workspace.id);
    } catch (err) {
      log.warn({ err, workspaceId }, 'localCandidates count failed; reporting 0');
    }
  }

  // Keywords across the universe with no real provider volume attached.
  // Planner-bucket sentinels (1M+) are intentionally excluded from "has volume"
  // so they count as missing — consistent with the mergeMetrics mask in rows.
  const missingVolume = Math.max(0, allKeys.size - keysWithVolume.size);

  const counts: KeywordCommandCenterCounts = {
    total: allKeys.size,
    inStrategy: inStrategyKeys.size,
    tracked: activeTracked.length,
    needsReview: requested.length + rankEvidenceKeys.size,
    evidence: rawEvidenceOnlyKeys.size,
    local: localVisibility.size,
    localCandidates: localCandidatesCount,
    retired: inactiveTracked.length,
    declined: declined.length,
    missingVolume,
    lostVisibility: lostVisibilityCount,
  };
  const filterCounts: SkinnyFilterCounts = {
    all: counts.total,
    inStrategy: counts.inStrategy,
    tracked: counts.tracked,
    needsReview: counts.needsReview,
    content: contentKeys.size,
    pageAssigned: pageAssignedKeys.size,
    rawEvidence: counts.evidence,
    local: counts.local,
    localCandidates: localCandidatesCount,
    visibleLocally: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length,
    possibleMatch: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length,
    notVisible: localVisibilityValues.filter(item =>
      item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ).length,
    notChecked: 0,
    providerDegraded: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length,
    requested: requested.length,
    declined: declined.length,
    retired: inactiveTracked.length,
    lostVisibility: lostVisibilityCount,
  };

  log.info({
    workspaceId,
    mode: 'summary-skinny',
    totalKeys: counts.total,
    trackedCount: trackedKeywords.length,
    contentGapCount: contentGaps.length,
    keywordGapCount: keywordGaps.length,
    localVisibilityCount: localVisibility.size,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center summary built');

  let geoLabel: string | undefined;
  try {
    geoLabel = getPrimaryMarketLocationCode(workspace.id)?.label;
  } catch (err) {
    log.debug({ err, workspaceId }, 'KCC summary geo label lookup failed; omitting');
  }

  // Honest truncation disclosure (Task 3). The rank-evidence selection above is
  // already ceiling-capped (post-ceiling) and feeds rawEvidenceOnlyKeys, so
  // rawEvidenceOnlyKeys.size is the RETURNED universe. The TRUE pre-ceiling size
  // adds back the value-ordered tail the ceiling dropped, so when the ceiling bites
  // rawEvidenceTotal > rawEvidenceReturned and the Task-4 banner fires. Flag OFF:
  // droppedRankEvidenceTail is 0 (the 50-cap leaves no tail) and the raw cap stays
  // RAW_EVIDENCE_ROW_LIMIT (75) — byte-identical to today.
  const droppedRankEvidenceTail = Math.max(0, rankEvidenceTotal - rankEvidence.selected.length);
  const rawEvidenceReturnedCap = isFeatureEnabled(KEYWORD_UNIVERSE_FULL_FLAG, workspace.id)
    ? UNIVERSE_SAFETY_CEILING
    : RAW_EVIDENCE_ROW_LIMIT;

  return {
    counts,
    filters: buildFilterFacetsFromCounts(filterCounts),
    rawEvidenceTotal: rawEvidenceOnlyKeys.size + droppedRankEvidenceTail,
    rawEvidenceReturned: Math.min(counts.evidence, rawEvidenceReturnedCap),
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
    summarizedAt: new Date().toISOString(),
    geoLabel,
  };
}

export function trackedKeywordMatchesFilter(keyword: TrackedKeyword, filter: KeywordCommandCenterFilter): boolean {
  const status = keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) return status === TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.RETIRED) return status !== TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY) {
    // Wave 3d-ii: In Strategy = active + reconcile-owned (strategyOwned===true),
    // decoupled from the source enum. The caller must pass the table-bearing shape
    // (mergeTrackedKeywordProvenance) — the stripped getTrackedKeywords output would
    // see strategyOwned===undefined and count zero.
    return status === TRACKED_KEYWORD_STATUS.ACTIVE && keyword.strategyOwned === true;
  }
  return true;
}

function addStrategyKeys(target: Set<string>, strategy: KeywordStrategy | null | undefined): void {
  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const key = keywordComparisonKey(metric.keyword);
    if (key) target.add(key);
  }
  for (const keyword of strategy?.siteKeywords ?? []) {
    const key = keywordComparisonKey(keyword);
    if (key) target.add(key);
  }
}

function addPageKeys(target: Set<string>, pageMap: PageKeywordMap[]): void {
  for (const page of pageMap) {
    for (const keyword of [page.primaryKeyword, ...(page.secondaryKeywords ?? [])]) {
      const key = keywordComparisonKey(keyword);
      if (key) target.add(key);
    }
  }
}

function parentableVariantKeys(input: {
  strategy?: KeywordStrategy | null | undefined;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  trackedKeywords: TrackedKeyword[];
  feedback: Map<string, FeedbackRow>;
}): string[] {
  const keys = new Set<string>();
  addStrategyKeys(keys, input.strategy);
  addPageKeys(keys, input.pageMap);
  for (const gap of input.contentGaps) {
    const key = keywordComparisonKey(gap.targetKeyword);
    if (key) keys.add(key);
  }
  for (const keyword of input.trackedKeywords) {
    const key = keywordComparisonKey(keyword.query);
    if (key) keys.add(key);
  }
  for (const row of input.feedback.values()) {
    if (row.status === 'declined') continue;
    const key = keywordComparisonKey(row.keyword);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Per-array memoized parent index. `findVariantParentKey` is called once per GSC
 * rank across several full-universe passes, always against the SAME `parentKeys`
 * array (the one `parentableVariantKeys` returned for that bundle). Building a
 * token-inverted index once per array — instead of an O(parents) brute-force
 * scan per query — turns the dominant O(ranks × parents) variant-matching cost
 * into O(ranks × tokens). Keyed on array IDENTITY via a WeakMap, so callers that
 * already share one `parentKeys` array (every per-rank loop in a request) share
 * one index for free; the entry is GC'd with the array, so there is no lifetime
 * management. The index is byte-identical to the brute-force result (see
 * createVariantParentIndex + its fuzz parity test).
 */
const variantParentIndexCache = new WeakMap<string[], VariantParentIndex>();

function findVariantParentKey(query: string, parentKeys: string[]): string | null {
  if (parentKeys.length === 0) return null;
  let index = variantParentIndexCache.get(parentKeys);
  if (!index) {
    index = createVariantParentIndex(parentKeys);
    variantParentIndexCache.set(parentKeys, index);
  }
  return index.lookup(query);
}

function filterStrategyForKeys(strategy: KeywordStrategy | null | undefined, keys: Set<string> | null): KeywordStrategy | null | undefined {
  if (!strategy || !keys) return strategy;
  return {
    ...strategy,
    siteKeywords: (strategy.siteKeywords ?? []).filter(keyword => keys.has(keywordComparisonKey(keyword))),
    siteKeywordMetrics: (strategy.siteKeywordMetrics ?? []).filter(metric => keys.has(keywordComparisonKey(metric.keyword))),
  };
}

/**
 * Restrict a page's primary/secondary keywords to only those in the selected key set.
 *
 * - If `keys` is null, returns the page unchanged.
 * - If neither the primary nor any secondary keyword is in `keys`, returns `null`
 *   (caller should drop the page).
 * - Otherwise returns a trimmed copy: primary preserved if in keys (else promoted
 *   from the first surviving secondary), secondaries filtered to in-keys entries.
 *
 * This is the row-creation boundary for skinny rows. populateDraftRows iterates
 * page.primaryKeyword + page.secondaryKeywords and creates a row per entry, so any
 * keyword left on the page object will produce a row whether or not it was selected.
 */
function restrictPageToKeys(page: PageKeywordMap, keys: Set<string> | null): PageKeywordMap | null {
  if (!keys) return page;
  const primaryKey = keywordComparisonKey(page.primaryKeyword);
  const primaryInKeys = primaryKey ? keys.has(primaryKey) : false;
  const secondaryFiltered = (page.secondaryKeywords ?? []).filter(keyword => {
    const key = keywordComparisonKey(keyword);
    return key ? keys.has(key) : false;
  });
  if (!primaryInKeys && secondaryFiltered.length === 0) return null;
  if (primaryInKeys) {
    return { ...page, secondaryKeywords: secondaryFiltered };
  }
  // Primary is not in keys but at least one secondary is — promote the first surviving
  // secondary so the page still produces a row, and drop primary metadata that wouldn't
  // belong to any selected row.
  const [newPrimary, ...rest] = secondaryFiltered;
  return {
    ...page,
    primaryKeyword: newPrimary,
    secondaryKeywords: rest,
  };
}

function filterMapByKeys<T>(map: Map<string, T>, keys: Set<string> | null): Map<string, T> {
  if (!keys) return map;
  return new Map([...map.entries()].filter(([key]) => keys.has(key)));
}

function localVisibilityByFilter(
  workspaceId: string,
  filter: KeywordCommandCenterFilter,
  includeLocalSeo: boolean | undefined,
): Map<string, LocalSeoKeywordVisibilitySummary> {
  if (!includeLocalSeo) return new Map();
  const visibility = buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return visibility;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) {
    return new Map([...visibility.entries()].filter(([, item]) => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) {
    return new Map([...visibility.entries()].filter(([, item]) => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return new Map([...visibility.entries()].filter(([, item]) =>
      item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) {
    return new Map([...visibility.entries()].filter(([, item]) => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return visibility;
  return new Map();
}

function filterUsesLocalVisibilityRows(filter: KeywordCommandCenterFilter): boolean {
  return filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED;
}

export interface RowCandidateKey {
  key: string;
  keyword: string;
  sourcePriority: number;
  demand: number;
  rank?: number;
  searchText?: string;
  /** GSC clicks (28-day) — populated for ranking candidates; enables the clicks sort + filter. */
  clicks?: number;
  /** Keyword difficulty (0–100) — populated where the source has it; enables the difficulty sort. */
  difficulty?: number;
  /** Cost-per-click resolved from trackedKeyword enrichment (Phase 1: precomputed for value scoring). */
  cpc?: number;
  /** Raw keyword intent string resolved from the bundle (Phase 1: precomputed for value scoring). */
  intent?: string;
  /** Precomputed value-first score (flag ON only); undefined when the signal gate returns no score. */
  valueScore?: number;
}

function addCandidateKey(
  candidates: Map<string, RowCandidateKey>,
  keyword: string | undefined | null,
  sourcePriority: number,
  demand = 0,
  rank?: number,
  searchText?: string,
  clicks?: number,
  difficulty?: number,
): void {
  const key = keywordComparisonKey(keyword ?? '');
  if (!key) return;
  const displayKeyword = keyword?.trim() || key;
  const existing = candidates.get(key);
  const mergeSearchText = (a: string | undefined, b: string | undefined): string | undefined => {
    const merged = [...new Set([...(a?.split(' ') ?? []), ...(b?.split(' ') ?? [])].filter(Boolean))].join(' ');
    return merged || undefined;
  };
  if (
    !existing
    || sourcePriority < existing.sourcePriority
    || (sourcePriority === existing.sourcePriority && demand > existing.demand)
  ) {
    // New entry wins the priority/demand contest and becomes the surviving
    // candidate identity. Metrics are SOURCE-AGNOSTIC: keep any clicks/difficulty/
    // rank the displaced candidate carried that the winner lacks, so a tracked
    // keyword (priority 1) that is ALSO a GSC ranking query (priority 2) still
    // surfaces its empirical clicks. This mirrors the row stage's mergeMetrics
    // and is what keeps the candidate sort from drifting from the row sort.
    candidates.set(key, {
      key,
      keyword: displayKeyword,
      sourcePriority,
      demand,
      rank: rank ?? existing?.rank,
      searchText: mergeSearchText(existing?.searchText, searchText),
      clicks: clicks ?? existing?.clicks,
      difficulty: difficulty ?? existing?.difficulty,
    });
  } else {
    // Existing entry keeps its identity; enrich it with any metric this lower-
    // priority source supplies that the winner is still missing.
    if (existing.rank === undefined && rank !== undefined) existing.rank = rank;
    if (existing.clicks === undefined && clicks !== undefined) existing.clicks = clicks;
    if (existing.difficulty === undefined && difficulty !== undefined) existing.difficulty = difficulty;
    if (searchText) existing.searchText = mergeSearchText(existing.searchText, searchText);
  }
}

/**
 * Tier-2 (relevance) evaluation context for the KCC discovery gate.
 *
 * DELIBERATELY EMPTY ({}). The strategy-synthesis path builds a rich ctx with
 * `strictBusinessFit: true` (server/keyword-strategy-ai-synthesis.ts) to
 * AGGRESSIVELY prune business-mismatched provider suggestions during strategy
 * GENERATION. The Keyword Command Center has a different goal: surface the
 * COMPLETE not-yet-ranking opportunity universe. Here we only want to strip the
 * low-actionability NOISE that `isStrategyPoolEligibleKeyword` suppresses
 * unconditionally — the `LOW_ACTIONABILITY_PHRASES` blocklist and blank keywords
 * (server/keyword-intelligence/rules.ts) — WITHOUT dropping a real competitor-gap
 * keyword just because the workspace has no business-context terms yet.
 *
 * With `{}`, `strictBusinessFit` defaults to false, so the `business_mismatch`
 * hard-suppress escalation never fires; only the source-agnostic noise/blank
 * suppression remains. This keeps the headline invariant ("invisalign cost",
 * 1900 vol, 0 clicks → RETAINED) true while still dropping "paper tiger"-class
 * noise. When unsure, we KEEP the keyword (a false-negative on junk is far
 * cheaper than dropping a real opportunity).
 */
const KCC_DISCOVERY_TIER2_CTX: Parameters<typeof isStrategyPoolEligibleKeyword>[1] = {};

/** Tier-1 malformed-string gate (ALL populations). True ⇒ drop the candidate. */
function isTier1JunkKeyword(keyword: string | null | undefined): boolean {
  return isJunkKeywordString(keyword).isJunk;
}

/**
 * Tier-2 relevance/low-actionability gate (DISCOVERY populations ONLY:
 * `contentGaps` + `keywordGaps`). True ⇒ drop the candidate. Never call this for
 * ranking/curated/strategy/tracked/feedback/GSC/local/lost sources — a
 * clicked/tracked/client-chosen keyword is never relevance-dropped.
 */
function isTier2SuppressedDiscovery(keyword: string, volume: number, difficulty: number): boolean {
  return isStrategyPoolEligibleKeyword(
    { keyword, volume, difficulty, sourceKind: 'keyword_gap' },
    KCC_DISCOVERY_TIER2_CTX,
  ).suppressed;
}

/**
 * SINGLE source-of-truth junk gate for the DISCOVERY populations (contentGaps +
 * keywordGaps). Applied ONCE, immediately after `assembleStoredKeywordStrategy`,
 * by every KCC consumer (rows-skinny bundle, read-model, summary, detail) so all
 * four paths read the SAME gated gaps by construction — the rows table, the
 * summary badges, the `local_candidates` filter, and `/detail` can no longer
 * diverge on the discovery universe.
 *
 * Both tiers from the candidate boundary apply: Tier-1 (`isTier1JunkKeyword` —
 * malformed strings) drops every population; Tier-2 (`isTier2SuppressedDiscovery`
 * — low-actionability noise) is DISCOVERY-only and never touches ranking/curated
 * sources, so the headline invariant holds (a real not-yet-ranking competitor
 * gap with volume + 0 clicks survives; a clicked GSC ranking query is never
 * relevance-gated because ranks are not gaps).
 *
 * The candidate loops in `addCandidateKeysFromBundle` keep their own Tier-1/Tier-2
 * gap checks; with pre-gated bundles those checks are redundant-but-harmless
 * (they still gate the OTHER populations — strategy/page/rank/tracked/local/lost —
 * for the rare garbage string, and they keep `__candidateKeysForTest` honest when
 * fed a raw bundle directly).
 */
function gateDiscoveryGaps<T extends { contentGaps: ContentGap[]; keywordGaps: KeywordGapItem[] }>(
  source: T,
): { contentGaps: ContentGap[]; keywordGaps: KeywordGapItem[] } {
  return {
    contentGaps: source.contentGaps.filter(gap =>
      !isTier1JunkKeyword(gap.targetKeyword)
      && !isTier2SuppressedDiscovery(gap.targetKeyword, gap.volume ?? 0, gap.difficulty ?? 0)),
    keywordGaps: source.keywordGaps.filter(gap =>
      !isTier1JunkKeyword(gap.keyword)
      && !isTier2SuppressedDiscovery(gap.keyword, gap.volume ?? 0, gap.difficulty ?? 0)),
  };
}

function addCandidateKeysFromBundle(
  candidates: Map<string, RowCandidateKey>,
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>,
  valueScoring: ValueScoringConfig = { on: false },
): void {
  const variantParentKeys = parentableVariantKeys({
    strategy: bundle.strategy,
    pageMap: bundle.pageMap,
    contentGaps: bundle.contentGaps,
    trackedKeywords: bundle.trackedKeywords,
    feedback: bundle.feedback,
  });
  // Per-tier dropped COUNTS for observability (no keyword PII beyond counts).
  let tier1Dropped = 0;
  let tier2Dropped = 0;
  for (const metric of bundle.strategy?.siteKeywordMetrics ?? []) {
    if (isTier1JunkKeyword(metric.keyword)) { tier1Dropped++; continue; }
    // siteKeywordMetrics carry provider difficulty (SiteKeywordMetric.difficulty).
    addCandidateKey(candidates, metric.keyword, 0, metric.volume ?? 0, undefined, undefined, undefined, metric.difficulty);
  }
  for (const keyword of bundle.strategy?.siteKeywords ?? []) {
    if (isTier1JunkKeyword(keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, keyword, 0);
  }
  for (const page of bundle.pageMap) {
    const pageSearchText = `${page.pageTitle ?? ''} ${page.pagePath ?? ''}`.toLowerCase();
    if (isTier1JunkKeyword(page.primaryKeyword)) tier1Dropped++;
    else addCandidateKey(candidates, page.primaryKeyword, 0, page.volume ?? 0, undefined, pageSearchText);
    for (const secondary of page.secondaryKeywords ?? []) {
      if (isTier1JunkKeyword(secondary)) { tier1Dropped++; continue; }
      addCandidateKey(candidates, secondary, 1, page.volume ?? 0, undefined, pageSearchText);
    }
  }
  for (const gap of bundle.contentGaps) {
    // DISCOVERY (Population C): Tier-1 AND Tier-2.
    if (isTier1JunkKeyword(gap.targetKeyword)) { tier1Dropped++; continue; }
    if (isTier2SuppressedDiscovery(gap.targetKeyword, gap.volume ?? 0, gap.difficulty ?? 0)) { tier2Dropped++; continue; }
    // ContentGap.difficulty (0–100) is optional provider enrichment.
    addCandidateKey(candidates, gap.targetKeyword, 1, gap.volume ?? 0, undefined, undefined, undefined, gap.difficulty);
  }
  for (const keyword of bundle.trackedKeywords) {
    if (isTier1JunkKeyword(keyword.query)) { tier1Dropped++; continue; }
    // TrackedKeyword.difficulty is optional provider enrichment.
    addCandidateKey(candidates, keyword.query, keyword.status === TRACKED_KEYWORD_STATUS.ACTIVE ? 1 : 5, keyword.volume ?? keyword.baselineImpressions ?? 0, undefined, undefined, undefined, keyword.difficulty);
  }
  for (const row of bundle.feedback.values()) {
    if (isTier1JunkKeyword(row.keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, row.keyword, row.status === 'requested' ? 2 : row.status === 'declined' ? 6 : 1);
  }
  for (const rank of bundle.latestRanks) {
    if (findVariantParentKey(keywordComparisonKey(rank.query), variantParentKeys)) continue;
    // RANKING (Population A): Tier-1 only — empirical ranking data is never
    // relevance-gated (a clicked/impression-only query must still appear).
    if (isTier1JunkKeyword(rank.query)) { tier1Dropped++; continue; }
    // LatestRank carries empirical GSC clicks (28-day) — feeds the clicks sort.
    addCandidateKey(candidates, rank.query, 2, rank.impressions ?? 0, rank.position, undefined, rank.clicks);
  }
  for (const gap of bundle.keywordGaps) {
    // DISCOVERY (Population C): Tier-1 AND Tier-2.
    if (isTier1JunkKeyword(gap.keyword)) { tier1Dropped++; continue; }
    if (isTier2SuppressedDiscovery(gap.keyword, gap.volume ?? 0, gap.difficulty ?? 0)) { tier2Dropped++; continue; }
    // KeywordGapItem.difficulty (competitor-gap KD) is required on the type.
    addCandidateKey(candidates, gap.keyword, 4, gap.volume ?? 0, undefined, undefined, undefined, gap.difficulty);
  }
  for (const visibility of localVisibility.values()) {
    if (isTier1JunkKeyword(visibility.keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, visibility.keyword, 2);
  }
  for (const lost of bundle.lostVisibilityRows ?? []) {
    if (isTier1JunkKeyword(lost.query)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, lost.query, 2, lost.totalImpressions, lost.lastPosition ?? undefined);
  }

  if (tier1Dropped > 0 || tier2Dropped > 0) {
    log.debug(
      { workspaceId: bundle.workspaceId, tier1Dropped, tier2Dropped },
      'keyword-command-center junk gate dropped candidates',
    );
  }

  // DRIFT FIX (Task 1): the loops above seed candidate IDENTITY (sourcePriority /
  // demand contest) and search text, but their per-source metric carryover is
  // FIRST-writer-wins and skips self-ranks + variant aggregation — so it diverges
  // from the row stage's LAST-writer-wins `mergeMetrics` + variant rollup. Replay
  // the EXACT row-stage metric assembly (`resolveBundleMetrics`) and overwrite each
  // surviving candidate's SORT metrics with the row-accurate values, so
  // candidate {demand,clicks,rank,difficulty} == row {volume??impressions,clicks,
  // currentPosition,difficulty} for every key. Identity/replacement is untouched.
  const resolved = resolveBundleMetrics(bundle, localVisibility);
  for (const candidate of candidates.values()) {
    const metrics = resolved.get(candidate.key);
    if (!metrics) continue;
    candidate.demand = metrics.volume ?? metrics.impressions ?? 0;
    candidate.clicks = metrics.clicks;
    candidate.rank = metrics.currentPosition;
    candidate.difficulty = metrics.difficulty;
    // Phase 1: cpc + intent are resolver-parity-guaranteed (resolveBundleMetrics
    // merges them in the SAME source order as populateDraftRows), so copying them
    // here keeps the candidate value-score inputs identical to the row stage.
    candidate.cpc = metrics.cpc;
    candidate.intent = metrics.intent;
    // Precompute the value score ONCE per key (flag ON only), with the SAME
    // function + SAME per-request ScoringContext as the row finalize — so
    // candidate.valueScore === row valueScore for every key by construction.
    if (valueScoring.on && valueScoring.ctx) {
      candidate.valueScore = computeKeywordValueScore(
        {
          keyword: candidate.keyword,
          volume: metrics.volume,
          impressions: metrics.impressions,
          difficulty: metrics.difficulty,
          cpc: metrics.cpc,
          intent: metrics.intent,
        },
        valueScoring.ctx,
      );
    }
  }
}

/**
 * Compute the SORT-relevant metrics each evaluated row will carry, per
 * normalized key, WITHOUT building full rows. This is a numbers-only mirror of
 * `populateDraftRows`: it replays the same `mergeMetricsInto` passes in the same
 * source order (last-writer-wins), the same `rows.has(...)`-guarded self-rank
 * application, and the same variant aggregation (sum clicks/impressions, MIN
 * position) — guaranteeing the candidate stage and the row stage agree.
 *
 * It intentionally omits the strategyUx explanation pass: the candidate stage
 * always runs with `includeStrategyUx: false`, so that pass contributes no
 * row-stage metrics either. Difficulty added by the explanation loop only
 * re-applies content-gap difficulty already merged here.
 */
function resolveBundleMetrics(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>,
): Map<string, KeywordCommandCenterMetrics> {
  const strategy = bundle.strategy;
  // key -> { keyword (raw display, for the sentinel guard), metrics, rawEvidenceOnly }
  const rows = new Map<string, { keyword: string; metrics: KeywordCommandCenterMetrics; rawEvidenceOnly: boolean }>();
  const ensure = (keyword: string | null | undefined): { keyword: string; metrics: KeywordCommandCenterMetrics; rawEvidenceOnly: boolean } | null => {
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return null;
    const existing = rows.get(key);
    if (existing) return existing;
    const created = { keyword: (keyword ?? '').trim() || key, metrics: {} as KeywordCommandCenterMetrics, rawEvidenceOnly: false };
    rows.set(key, created);
    return created;
  };
  const merge = (target: { keyword: string; metrics: KeywordCommandCenterMetrics }, metrics: KeywordCommandCenterMetrics): void => {
    target.metrics = mergeMetricsInto(target.keyword, target.metrics, metrics);
  };

  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const row = ensure(metric.keyword);
    if (!row) continue;
    merge(row, { volume: metric.volume, difficulty: metric.difficulty });
  }
  for (const keyword of strategy?.siteKeywords ?? []) {
    ensure(keyword); // identity-only in the row stage; carries no numeric metrics
  }
  for (const page of bundle.pageMap) {
    for (const keyword of [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].filter(Boolean)) {
      const row = ensure(keyword);
      if (!row) continue;
      merge(row, { volume: page.volume, difficulty: page.difficulty, intent: page.searchIntent });
    }
  }
  for (const gap of bundle.contentGaps) {
    const row = ensure(gap.targetKeyword);
    if (!row) continue;
    merge(row, { volume: gap.volume, difficulty: gap.difficulty, intent: gap.intent });
  }
  for (const gap of bundle.keywordGaps) {
    const row = ensure(gap.keyword);
    if (!row) continue;
    row.rawEvidenceOnly = true; // matches populateDraftRows: keywordGaps are raw evidence
    merge(row, { volume: gap.volume, difficulty: gap.difficulty });
  }
  for (const keyword of bundle.trackedKeywords) {
    const row = ensure(keyword.query);
    if (!row) continue;
    merge(row, {
      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,
      intent: keyword.intent,
      currentPosition: keyword.baselinePosition,
      clicks: keyword.baselineClicks,
      impressions: keyword.baselineImpressions,
    });
  }
  for (const row of bundle.feedback.values()) {
    ensure(row.keyword); // identity-only in the row stage; carries no numeric metrics
  }
  for (const lost of bundle.lostVisibilityRows ?? []) {
    const row = ensure(lost.query);
    if (!row) continue;
    row.rawEvidenceOnly = true;
    merge(row, { currentPosition: lost.lastPosition ?? undefined, impressions: lost.totalImpressions });
  }

  // Variant parenting — identical to populateDraftRows: only ranks that are NOT
  // already a row and CAN be parented by a non-raw-evidence strategy key become
  // variants; the rest are eligible GSC-only filler rows (capped at
  // RANK_EVIDENCE_ROW_LIMIT by impressions, matching the row stage).
  const strategyKeys = [...rows.entries()]
    .filter(([, row]) => row.rawEvidenceOnly !== true)
    .map(([key]) => key);
  const metricsMap = new Map(strategyKeys.map(key => [key, rows.get(key)?.metrics.impressions ?? 0]));
  const variantParentMap = new Map<string, string>();
  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    if (!normalizedQuery || rows.has(normalizedQuery)) continue;
    const parent = findBestParent(normalizedQuery, strategyKeys, metricsMap);
    if (parent) variantParentMap.set(normalizedQuery, parent);
  }

  const rankedUntrackedFiltered = bundle.latestRanks
    .filter(rank => !rows.has(keywordComparisonKey(rank.query)))
    .filter(rank => !variantParentMap.has(keywordComparisonKey(rank.query)));
  const { selected: rankedUntracked } = selectRankEvidence(rankedUntrackedFiltered, bundle.workspaceId);
  for (const rank of rankedUntracked) {
    const row = ensure(rank.query);
    if (!row) continue;
    merge(row, { currentPosition: rank.position, clicks: rank.clicks, impressions: rank.impressions, ctr: rank.ctr });
  }

  // Self-rank: a GSC rank whose own key IS a row applies its metrics to ITS OWN
  // row (the defect was the candidate loop `continue`-ing these as false variants).
  for (const rank of bundle.latestRanks) {
    const row = rows.get(keywordComparisonKey(rank.query));
    if (!row) continue;
    merge(row, { currentPosition: rank.position, clicks: rank.clicks, impressions: rank.impressions, ctr: rank.ctr });
  }

  // True-variant aggregation: SUM clicks/impressions, take MIN position onto parent.
  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    const parentKey = variantParentMap.get(normalizedQuery);
    if (!parentKey) continue;
    const parentRow = rows.get(parentKey);
    if (!parentRow) continue;
    parentRow.metrics.impressions = (parentRow.metrics.impressions ?? 0) + rank.impressions;
    parentRow.metrics.clicks = (parentRow.metrics.clicks ?? 0) + rank.clicks;
    if (parentRow.metrics.currentPosition == null || rank.position < parentRow.metrics.currentPosition) {
      parentRow.metrics.currentPosition = rank.position;
    }
  }

  for (const candidate of localVisibility.values()) {
    ensure(candidate.keyword); // visibility rows carry no sort metrics in the candidate path
  }
  for (const candidate of bundle.localCandidates ?? []) {
    const row = ensure(candidate.keyword);
    if (!row) continue;
    merge(row, { volume: candidate.volume, difficulty: candidate.difficulty });
  }

  const result = new Map<string, KeywordCommandCenterMetrics>();
  for (const [key, row] of rows) result.set(key, row.metrics);
  return result;
}

const CANDIDATE_SORT_ACCESSORS: SortFieldAccessors<RowCandidateKey> = {
  keyword: (c) => c.keyword,
  demand: (c) => c.demand,
  rank: (c) => c.rank,
  clicks: (c) => c.clicks,
  difficulty: (c) => c.difficulty,
  // Same fields + same formula as ROW_SORT_ACCESSORS.opportunity → identical
  // score per key → no candidate↔row drift.
  opportunity: (c) => computeOpportunityScore({ volume: c.demand, difficulty: c.difficulty }),
};

/**
 * Candidate-stage sorter. The `priority`/default branch keeps its original,
 * candidate-specific behavior (sourcePriority then demand then keyword) — it is
 * byte-identical to before this task. The explicit, directioned sorts delegate
 * to the SAME `keywordSortComparator` the row stage uses (via
 * `CANDIDATE_SORT_ACCESSORS`) so the two stages cannot drift.
 */
export function candidateSortForQuery(
  sort: KeywordCommandCenterSort | undefined,
  direction?: 'asc' | 'desc',
): (a: RowCandidateKey, b: RowCandidateKey) => number {
  if (sort === undefined || sort === 'priority') {
    return (a, b) => {
      if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
      if (a.demand !== b.demand) return b.demand - a.demand;
      return a.keyword.localeCompare(b.keyword);
    };
  }
  return keywordSortComparator(sort, direction, CANDIDATE_SORT_ACCESSORS);
}

/**
 * Test-only DATA-parity probe. Builds, for the SAME bundle, both the candidate
 * sort-metric map (post `addCandidateKeysFromBundle`) and the evaluated-row
 * sort-metric map (post `populateDraftRows` + finalize), keyed by normalized
 * keyword. The drift guard in the unit test asserts these agree per key for
 * clicks/rank/difficulty/demand — catching DATA divergence the comparator-only
 * guard cannot. Exported for tests; not used by the request path.
 */
interface CandidateRowMetricProjection {
  demand: number;
  clicks?: number;
  rank?: number;
  difficulty?: number;
  cpc?: number;
  intent?: string;
}

export interface CandidateRowMetricParity {
  candidate: Map<string, CandidateRowMetricProjection>;
  row: Map<string, CandidateRowMetricProjection>;
}

/**
 * Test-only: return the set of normalized candidate keys that SURVIVE the
 * two-tier junk gate in `addCandidateKeysFromBundle`. Exactly the keys that can
 * become rows on the skinny path. Pure (no DB, no HTTP) — used by the per-source
 * gating unit spec. Not used by the request path.
 */
export function __candidateKeysForTest(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary> = new Map(),
): Set<string> {
  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, { ...bundle, includeStrategyUx: false }, localVisibility);
  return new Set(candidates.keys());
}

export async function __candidateRowMetricParityForTest(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary> = new Map(),
): Promise<CandidateRowMetricParity> {
  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, { ...bundle, includeStrategyUx: false }, localVisibility);
  const candidate = new Map<string, CandidateRowMetricProjection>();
  for (const c of candidates.values()) {
    candidate.set(c.key, { demand: c.demand, clicks: c.clicks, rank: c.rank, difficulty: c.difficulty, cpc: c.cpc, intent: c.intent });
  }

  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, { ...bundle, includeStrategyUx: false });
  const row = new Map<string, CandidateRowMetricProjection>();
  for (const r of rows.values()) {
    row.set(r.normalizedKeyword, {
      demand: r.metrics.volume ?? r.metrics.impressions ?? 0,
      clicks: r.metrics.clicks,
      rank: r.metrics.currentPosition,
      difficulty: r.metrics.difficulty,
      cpc: r.metrics.cpc,
      intent: r.metrics.intent,
    });
  }
  return { candidate, row };
}

function rowCandidateKeysForQuery(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>,
  query: KeywordCommandCenterRowsQuery,
  valueScoring: ValueScoringConfig = { on: false },
): { keys: Set<string>; page: number; pageSize: number; totalRows: number; totalPages: number } {
  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, bundle, localVisibility, valueScoring);
  const rawSearch = query.search?.trim().toLowerCase();
  const normalizedSearch = keywordComparisonKey(query.search ?? '');
  const filtered = [...candidates.values()]
    .filter(candidate =>
      !rawSearch
      || candidate.keyword.toLowerCase().includes(rawSearch)
      || (normalizedSearch ? candidate.key.includes(normalizedSearch) : false)
      || candidate.searchText?.includes(rawSearch)
    )
    .sort(candidateSortForQuery(query.sort, query.direction));
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const requestedPage = Math.max(query.page ?? 1, 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    keys: new Set(filtered.slice(start, start + pageSize).map(candidate => candidate.key)),
    page,
    pageSize,
    totalRows: filtered.length,
    totalPages,
  };
}

function sourceKeysForRows(input: {
  workspaceId: string;
  filter: KeywordCommandCenterFilter;
  strategy: KeywordStrategy | null | undefined;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  keywordGaps: KeywordGapItem[];
  trackedKeywords: TrackedKeyword[];
  latestRanks: LatestRank[];
  feedback: Map<string, FeedbackRow>;
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>;
  lostVisibilityRows: LostVisibilityQuery[];
}): Set<string> | null {
  const keys = new Set<string>();
  const add = (keyword: string | undefined | null) => {
    const key = keywordComparisonKey(keyword ?? '');
    if (key) keys.add(key);
  };
  const pageKeys = new Set<string>();
  addPageKeys(pageKeys, input.pageMap);
  const selectedOrTrackedOrFeedbackKeys = new Set<string>();
  addStrategyKeys(selectedOrTrackedOrFeedbackKeys, input.strategy);
  addPageKeys(selectedOrTrackedOrFeedbackKeys, input.pageMap);
  for (const gap of input.contentGaps) {
    const key = keywordComparisonKey(gap.targetKeyword);
    if (key) selectedOrTrackedOrFeedbackKeys.add(key);
  }
  for (const keyword of input.trackedKeywords) {
    const key = keywordComparisonKey(keyword.query);
    if (key) selectedOrTrackedOrFeedbackKeys.add(key);
  }
  for (const key of input.feedback.keys()) selectedOrTrackedOrFeedbackKeys.add(key);
  const rawEvidenceKeys = new Set(input.keywordGaps.map(gap => keywordComparisonKey(gap.keyword)).filter(Boolean));
  const lostVisibilityKeys = new Set(input.lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  const declinedKeys = new Set(
    [...input.feedback.values()]
      .filter(row => row.status === 'declined')
      .map(row => keywordComparisonKey(row.keyword))
      .filter(Boolean),
  );
  const nonStrategyFeedbackKeys = new Set(
    [...input.feedback.values()]
      .filter(row => row.status === 'declined' || row.status === 'requested')
      .map(row => keywordComparisonKey(row.keyword))
      .filter(Boolean),
  );
  const variantParentKeys = parentableVariantKeys(input);

  switch (input.filter) {
    case KEYWORD_COMMAND_CENTER_FILTERS.ALL:
      addStrategyKeys(keys, input.strategy);
      addPageKeys(keys, input.pageMap);
      for (const gap of input.contentGaps) add(gap.targetKeyword);
      for (const gap of input.keywordGaps) add(gap.keyword);
      for (const keyword of input.trackedKeywords) add(keyword.query);
      for (const row of input.feedback.values()) add(row.keyword);
      for (const key of input.localVisibility.keys()) keys.add(key);
      for (const key of lostVisibilityKeys) keys.add(key);
      {
        const filtered = input.latestRanks.filter(rank => {
          const key = keywordComparisonKey(rank.query);
          if (findVariantParentKey(key, variantParentKeys)) return false;
          return key && !keys.has(key) && !rawEvidenceKeys.has(key);
        });
        for (const rank of selectRankEvidence(filtered, input.workspaceId).selected) add(rank.query);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY:
      addStrategyKeys(keys, input.strategy);
      addPageKeys(keys, input.pageMap);
      for (const gap of input.contentGaps) add(gap.targetKeyword);
      for (const keyword of input.trackedKeywords.filter(entry => trackedKeywordMatchesFilter(entry, input.filter))) add(keyword.query);
      for (const row of input.feedback.values()) if (row.status === 'approved') add(row.keyword);
      for (const key of nonStrategyFeedbackKeys) keys.delete(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.TRACKED:
      for (const keyword of input.trackedKeywords.filter(entry => trackedKeywordMatchesFilter(entry, input.filter))) add(keyword.query);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.RETIRED:
      for (const keyword of input.trackedKeywords.filter(entry => trackedKeywordMatchesFilter(entry, input.filter))) add(keyword.query);
      for (const key of declinedKeys) keys.delete(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW:
      for (const row of input.feedback.values()) if (row.status === 'requested') add(row.keyword);
      {
        const filtered = input.latestRanks.filter(rank => {
          const key = keywordComparisonKey(rank.query);
          if (findVariantParentKey(key, variantParentKeys)) return false;
          return key && !selectedOrTrackedOrFeedbackKeys.has(key) && !rawEvidenceKeys.has(key);
        });
        for (const rank of selectRankEvidence(filtered, input.workspaceId).selected) add(rank.query);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.CONTENT:
      for (const gap of input.contentGaps) {
        const key = keywordComparisonKey(gap.targetKeyword);
        if (key && !pageKeys.has(key)) keys.add(key);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED:
      addPageKeys(keys, input.pageMap);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE:
      for (const gap of input.keywordGaps) {
        const key = keywordComparisonKey(gap.keyword);
        if (key && !selectedOrTrackedOrFeedbackKeys.has(key)) keys.add(key);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED:
      for (const row of input.feedback.values()) if (row.status === 'requested') add(row.keyword);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.DECLINED:
      for (const row of input.feedback.values()) if (row.status === 'declined') add(row.keyword);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY:
      for (const key of lostVisibilityKeys) keys.add(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.LOCAL:
    case KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY:
    case KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH:
    case KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE:
    case KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED:
      for (const key of input.localVisibility.keys()) keys.add(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED:
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES:
      return null;
  }
}

function buildFilteredBundle(input: {
  workspace: Workspace;
  filter: KeywordCommandCenterFilter;
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>;
}): CommandCenterSourceBundle & { keys: Set<string> | null } {
  // #19b: siteKeywordMetrics resolved table-first (blob fallback).
  const strategy = withResolvedSiteKeywordMetrics(input.workspace.id, input.workspace.keywordStrategy);
  const pageMap = listPageKeywordsLite(input.workspace.id);
  // contentGaps + keywordGaps via the single assembler (#2); strategy stays the
  // raw blob (with siteKeywordMetrics table-resolved) and pageMap keeps the Lite
  // page_keywords path.
  const filteredAssembled = assembleStoredKeywordStrategy(input.workspace.id);
  // Gate discovery gaps once at the source (Tier-1 + Tier-2) so the skinny rows
  // path's candidate gathering, populateDraftRows, and key derivation all read the
  // same gated gaps — identical to the read-model / summary / detail paths.
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: filteredAssembled?.contentGaps ?? [],
    keywordGaps: filteredAssembled?.keywordGaps ?? [],
  });
  // Wave 3d-i: merge sourceGapKey back from the provenance-bearing table read
  // (getTrackedKeywords strips it; KCC is admin-authed so it may surface it).
  const trackedKeywords = mergeTrackedKeywordProvenance(
    input.workspace.id,
    getTrackedKeywords(input.workspace.id, { includeInactive: true }),
  );
  const latestRanks = getLatestSnapshotRanks(input.workspace.id);
  const feedback = readFeedback(input.workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(input.workspace.id);
  const variantParentKeys = parentableVariantKeys({
    strategy,
    pageMap,
    contentGaps,
    trackedKeywords,
    feedback,
  });
  const keys = sourceKeysForRows({
    workspaceId: input.workspace.id,
    filter: input.filter,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks,
    feedback,
    localVisibility: input.localVisibility,
    lostVisibilityRows,
  });

  return {
    keys,
    workspaceId: input.workspace.id,
    workspaceName: input.workspace.name,
    strategy: filterStrategyForKeys(strategy, keys),
    pageMap: pageMap
      .map(page => restrictPageToKeys(page, keys))
      .filter((page): page is PageKeywordMap => page !== null),
    contentGaps: keys ? contentGaps.filter(gap => keys.has(keywordComparisonKey(gap.targetKeyword))) : contentGaps,
    keywordGaps: keys ? keywordGaps.filter(gap => keys.has(keywordComparisonKey(gap.keyword))) : keywordGaps,
    trackedKeywords: keys ? trackedKeywords.filter(keyword => keys.has(keywordComparisonKey(keyword.query))) : trackedKeywords,
    latestRanks: keys
      ? latestRanks.filter(rank => {
        const key = keywordComparisonKey(rank.query);
        const parent = findVariantParentKey(key, variantParentKeys);
        return keys.has(key) || Boolean(parent && keys.has(parent));
      })
      : latestRanks,
    feedback: filterMapByKeys(feedback, keys),
    lostVisibilityRows: keys
      ? lostVisibilityRows.filter(row => keys.has(keywordComparisonKey(row.query)))
      : lostVisibilityRows,
    includeStrategyUx: false,
  };
}

function filterBundleToKeys(
  bundle: CommandCenterSourceBundle & { keys: Set<string> | null },
  keys: Set<string>,
): CommandCenterSourceBundle & { keys: Set<string> } {
  const variantParentKeys = parentableVariantKeys(bundle);
  return {
    ...bundle,
    keys,
    strategy: filterStrategyForKeys(bundle.strategy, keys),
    pageMap: bundle.pageMap
      .map(page => restrictPageToKeys(page, keys))
      .filter((page): page is PageKeywordMap => page !== null),
    contentGaps: bundle.contentGaps.filter(gap => keys.has(keywordComparisonKey(gap.targetKeyword))),
    keywordGaps: bundle.keywordGaps.filter(gap => keys.has(keywordComparisonKey(gap.keyword))),
    trackedKeywords: bundle.trackedKeywords.filter(keyword => keys.has(keywordComparisonKey(keyword.query))),
    latestRanks: bundle.latestRanks.filter(rank => {
      const key = keywordComparisonKey(rank.query);
      const parent = findVariantParentKey(key, variantParentKeys);
      return keys.has(key) || Boolean(parent && keys.has(parent));
    }),
    feedback: filterMapByKeys(bundle.feedback, keys),
    lostVisibilityRows: (bundle.lostVisibilityRows ?? []).filter(row => keys.has(keywordComparisonKey(row.query))),
  };
}

async function buildKeywordCommandCenterRowsViaModel(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery,
  options: { includeLocalSeo?: boolean },
): Promise<KeywordCommandCenterRowsResponse | null> {
  const payload = await buildKeywordCommandCenterModel(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeLocalSeoDetails: false,
    includeLocalCandidates: true,
    includeStrategyUx: false,
    timingLabel: 'rows-local-candidate',
  });
  if (!payload) return null;
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const filtered = payload.rows
    .filter(row => matchesFilter(row, filter))
    .filter(row => matchesSearch(row, query.search))
    .sort(sortRowsForQuery(query.sort, query.direction));
  const page = paginateRows(filtered.map(stripRowForList), query);
  return {
    rows: page.rows,
    pageInfo: {
      page: page.page,
      pageSize: page.pageSize,
      totalRows: page.totalRows,
      totalPages: page.totalPages,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    },
    generatedAt: payload.generatedAt,
  };
}

async function buildKeywordCommandCenterRowsSkinny(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery,
  options: { includeLocalSeo?: boolean },
): Promise<KeywordCommandCenterRowsResponse | null> {
  const startedAt = Date.now();
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  // Phase 1: read the flag + build the ScoringContext ONCE per request (no DB
  // reads when the flag is OFF). The SAME config is threaded into the candidate
  // merge-back and the row finalize so both stages score identically per key.
  const valueScoring = buildValueScoringConfig(workspace);
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const localVisibilityByKeyword = localVisibilityByFilter(workspace.id, filter, options.includeLocalSeo);
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  const bundle = buildFilteredBundle({ workspace, filter, localVisibility: localVisibilityByKeyword });
  const candidateBundle = filterUsesLocalVisibilityRows(filter)
    ? {
      ...bundle,
      strategy: null,
      pageMap: [],
      contentGaps: [],
      keywordGaps: [],
      trackedKeywords: [],
      latestRanks: [],
      feedback: new Map<string, FeedbackRow>(),
    }
    : bundle;
  const pageSelection = rowCandidateKeysForQuery(candidateBundle, localVisibilityByKeyword, query, valueScoring);
  const pagedBundle = filterBundleToKeys(bundle, pageSelection.keys);
  const pagedLocalVisibility = filterMapByKeys(localVisibilityByKeyword, pageSelection.keys);
  const lostVisibilityKeys = safeLostVisibilityKeys(workspace.id);
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, pagedBundle);
  ensureLocalVisibilityRows(rows, pagedLocalVisibility);
  const finalized = finalizeDraftRows(rows, {
    workspaceId: workspace.id,
    localVisibilityByKeyword: pagedLocalVisibility,
    activeLocalMarketCount,
    lostVisibilityKeys,
    valueScoring,
  });
  const filtered = finalized.rows
    .filter(row => matchesFilter(row, filter))
    .filter(row => matchesSearch(row, query.search))
    .sort(sortRowsForQuery(query.sort, query.direction));

  log.info({
    workspaceId,
    mode: 'rows-skinny',
    filter,
    sourceKeys: bundle.keys?.size ?? null,
    pagedKeys: pageSelection.keys.size,
    rowCount: filtered.length,
    rowsBeforeFilter: finalized.rows.length,
    rowsDropped: finalized.rows.length - filtered.length,
    totalRows: pageSelection.totalRows,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center rows built');

  return {
    rows: filtered.map(stripRowForList),
    pageInfo: {
      page: pageSelection.page,
      pageSize: pageSelection.pageSize,
      totalRows: pageSelection.totalRows,
      totalPages: pageSelection.totalPages,
      hasNextPage: pageSelection.page < pageSelection.totalPages,
      hasPreviousPage: pageSelection.page > 1,
    },
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
  };
}

function filterStrategyForSingleKeyword(strategy: KeywordStrategy | null | undefined, normalized: string): KeywordStrategy | null | undefined {
  if (!strategy) return strategy;
  return {
    ...strategy,
    siteKeywords: (strategy.siteKeywords ?? []).filter(keyword => keywordComparisonKey(keyword) === normalized),
    siteKeywordMetrics: (strategy.siteKeywordMetrics ?? []).filter(metric => keywordComparisonKey(metric.keyword) === normalized),
  };
}

function pageMatchesKeyword(page: PageKeywordMap, normalized: string): boolean {
  return keywordComparisonKey(page.primaryKeyword) === normalized
    || (page.secondaryKeywords ?? []).some(keyword => keywordComparisonKey(keyword) === normalized);
}

export async function buildKeywordCommandCenterRows(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery = {},
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterRowsResponse | null> {
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  if (filterNeedsLocalCandidates(filter)) {
    return buildKeywordCommandCenterRowsViaModel(workspaceId, query, options);
  }
  return buildKeywordCommandCenterRowsSkinny(workspaceId, query, options);
}

export async function buildKeywordCommandCenterDetail(
  workspaceId: string,
  keyword: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterDetailResponse | null> {
  const startedAt = Date.now();
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return null;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const pageMap = listPageKeywordsLite(workspace.id).filter(page => pageMatchesKeyword(page, normalized));
  // contentGaps + keywordGaps via the single assembler (#2), filtered to the
  // requested keyword; pageMap keeps the Lite page_keywords path above.
  const detailAssembled = assembleStoredKeywordStrategy(workspace.id);
  // F2 fix: gate the discovery gaps (Tier-1 + Tier-2) BEFORE narrowing to the
  // requested keyword, so /detail on a junk gap keyword finds no base source and
  // returns null — consistent with the gated rows/summary universe.
  const gatedDetailGaps = gateDiscoveryGaps({
    contentGaps: detailAssembled?.contentGaps ?? [],
    keywordGaps: detailAssembled?.keywordGaps ?? [],
  });
  const contentGaps = gatedDetailGaps.contentGaps.filter(gap => keywordComparisonKey(gap.targetKeyword) === normalized);
  const keywordGaps = gatedDetailGaps.keywordGaps.filter(gap => keywordComparisonKey(gap.keyword) === normalized);
  // Wave 3d-i/3d-ii: merge sourceGapKey + strategyOwned back from the table read
  // (getTrackedKeywords strips them) so the admin detail drawer exposes accurate
  // provenance, ownership, and protected-state UI. Read-time inference retired.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  ).filter(entry => keywordComparisonKey(entry.query) === normalized);
  // Load all ranks for variant aggregation — populateDraftRows uses variantParentMap to
  // cluster GSC query variants (e.g. "teeth whitening san antonio") under their canonical
  // keyword. Filtering to exact matches here would prevent variant metrics from rolling up.
  // Use the filtered set only for the hasBaseSource check below.
  const allLatestRanks = getLatestSnapshotRanks(workspace.id);
  const latestRanks = allLatestRanks.filter(rank => keywordComparisonKey(rank.query) === normalized);
  const feedback = filterMapByKeys(readFeedback(workspace.id), new Set([normalized]));
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id).filter(row => keywordComparisonKey(row.query) === normalized);
  // #19b: resolve siteKeywordMetrics table-first (blob fallback) before filtering.
  const strategy = filterStrategyForSingleKeyword(
    withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy),
    normalized,
  );
  const localVisibility = options.includeLocalSeo
    ? buildLocalSeoKeywordVisibilityForKeyword(workspace.id, normalized)
    : undefined;
  const localVisibilityByKeyword = localVisibility
    ? new Map([[normalized, localVisibility]])
    : new Map<string, LocalSeoKeywordVisibilitySummary>();
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  const hasStrategyKeyword = Boolean((strategy?.siteKeywords?.length ?? 0) > 0 || (strategy?.siteKeywordMetrics?.length ?? 0) > 0);
  const hasLocalVisibility = localVisibilityByKeyword.has(normalized);
  const hasBaseSource = hasStrategyKeyword
    || pageMap.length > 0
    || contentGaps.length > 0
    || keywordGaps.length > 0
    || trackedKeywords.length > 0
    || latestRanks.length > 0
    || feedback.size > 0
    || lostVisibilityRows.length > 0
    || hasLocalVisibility;
  if (
    !hasBaseSource
  ) {
    return null;
  }
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks: allLatestRanks,
    feedback,
    lostVisibilityRows,
    includeStrategyUx: true,
    includeWorkspaceIntelligence: false,
  });
  ensureLocalVisibilityRows(rows, localVisibilityByKeyword);
  const row = rows.get(normalized)
    ? finalizeDraftRow(rows.get(normalized)!, {
      workspaceId: workspace.id,
      localVisibilityByKeyword,
      activeLocalMarketCount,
      lostVisibilityKeys: safeLostVisibilityKeys(workspace.id),
    })
    : null;
  if (!row) return null;
  log.info({
    workspaceId,
    mode: 'detail-skinny',
    keyword: normalized,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center detail built');
  return {
    row,
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
  };
}

function canModifyProtected(keyword: TrackedKeyword | undefined, force?: boolean): { ok: true } | { ok: false; reason: string } {
  const reason = protectedReason(keyword);
  if (!reason || force) return { ok: true };
  return { ok: false, reason: `${reason} requires explicit confirmation before this action.` };
}

function findTracked(workspaceId: string, keyword: string): TrackedKeyword | undefined {
  const normalized = keywordComparisonKey(keyword);
  return getTrackedKeywords(workspaceId, { includeInactive: true }).find(entry => keywordComparisonKey(entry.query) === normalized);
}

function deleteFeedbackByKeywordKey(workspaceId: string, keyword: string): number {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return 0;
  let changes = 0;
  for (const row of readFeedbackRows(workspaceId)) {
    if (keywordComparisonKey(row.keyword) !== normalized) continue;
    changes += stmts().deleteFeedback.run(workspaceId, row.keyword).changes;
  }
  return changes;
}

function upsertFeedback(workspaceId: string, keyword: string, status: 'approved' | 'declined' | 'requested', reason?: string): void {
  const normalized = keywordComparisonKey(keyword);
  deleteFeedbackByKeywordKey(workspaceId, normalized);
  stmts().upsertFeedback.run({
    workspace_id: workspaceId,
    keyword: normalized,
    status,
    reason: reason ?? null,
    source: 'command_center',
    declined_by: status === 'declined' ? 'admin' : null,
  });
}

function trackedSourceForMerge(existing: TrackedKeyword, options: AddTrackedKeywordOptions, preferSource: boolean): TrackedKeyword['source'] {
  const existingSource = existing.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
  const existingStatus = existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
  const nextStatus = options.status ?? existingStatus;
  if (protectedReason(existing) && !preferSource) return existingSource;
  if (preferSource && options.source && !protectedReason(existing)) return options.source;
  if (existingStatus !== TRACKED_KEYWORD_STATUS.ACTIVE && nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return options.source ?? existingSource;
  }
  if (existingSource === TRACKED_KEYWORD_SOURCE.UNKNOWN) return options.source ?? existingSource;
  return existingSource;
}

function upsertTrackedKeywordByKey(
  workspaceId: string,
  keyword: string,
  options: AddTrackedKeywordOptions,
  opts: { preferSource?: boolean } = {},
): TrackedKeyword[] {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return getTrackedKeywords(workspaceId, { includeInactive: true });

  return updateTrackedKeywords(workspaceId, keywords => {
    const equivalents = keywords.filter(entry => keywordComparisonKey(entry.query) === normalized);
    const existing = equivalents[0];
    const now = new Date().toISOString();
    const next = keywords.filter(entry => keywordComparisonKey(entry.query) !== normalized);

    if (existing) {
      const nextStatus = options.status ?? existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
      const definedOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ) as AddTrackedKeywordOptions;
      next.push({
        ...existing,
        ...definedOptions,
        query: existing.query,
        pinned: equivalents.some(entry => entry.pinned) || Boolean(options.pinned),
        addedAt: existing.addedAt || now,
        status: nextStatus,
        source: trackedSourceForMerge(existing, options, Boolean(opts.preferSource)),
        replacedBy: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.replacedBy ?? existing.replacedBy,
        deprecatedAt: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.deprecatedAt ?? existing.deprecatedAt,
      });
      return next;
    }

    next.push({
      query: keyword.trim(),
      pinned: Boolean(options.pinned),
      addedAt: now,
      source: options.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
      status: options.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      pagePath: options.pagePath,
      pageTitle: options.pageTitle,
      strategyGeneratedAt: options.strategyGeneratedAt,
      lastStrategySeenAt: options.lastStrategySeenAt,
      intent: options.intent,
      volume: options.volume,
      difficulty: options.difficulty,
      cpc: options.cpc,
      authorityPosture: options.authorityPosture,
      baselinePosition: options.baselinePosition,
      baselineClicks: options.baselineClicks,
      baselineImpressions: options.baselineImpressions,
      replacedBy: options.replacedBy,
      deprecatedAt: options.deprecatedAt,
    });
    return next;
  });
}

function retireTrackedKeyword(workspaceId: string, keyword: string, status: typeof TRACKED_KEYWORD_STATUS.PAUSED | typeof TRACKED_KEYWORD_STATUS.DEPRECATED): TrackedKeyword[] {
  const normalized = keywordComparisonKey(keyword);
  const now = new Date().toISOString();
  return updateTrackedKeywords(workspaceId, keywords => keywords.map(entry => {
    if (keywordComparisonKey(entry.query) !== normalized) return entry;
    return {
      ...entry,
      status,
      deprecatedAt: status === TRACKED_KEYWORD_STATUS.DEPRECATED ? now : entry.deprecatedAt,
    };
  }));
}

interface ApplyKeywordCommandCenterActionOptions {
  skipBroadcast?: boolean;
  skipActivity?: boolean;
}

function broadcastKeywordCommandCenterAction(
  workspaceId: string,
  request: Pick<KeywordCommandCenterActionRequest, 'action'>,
  payload: Record<string, unknown>,
): void {
  if (
    request.action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE
  ) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, payload);
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, {
      workspaceId,
      reason: 'keyword_command_center',
      updatedAt: payload.updatedAt,
    });
  }
  broadcastToWorkspace(workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, payload);
}

function applyKeywordCommandCenterActionInternal(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
  options: ApplyKeywordCommandCenterActionOptions = {},
): KeywordCommandCenterActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const keyword = keywordComparisonKey(request.keyword);
  if (!keyword) throw new Error('keyword required');
  const displayKeyword = request.keyword.trim();

  const existing = findTracked(workspace.id, keyword);
  const protectedCheck = canModifyProtected(existing, request.force);
  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] | undefined;
  let message = '';

  const run = db.transaction(() => {
    switch (request.action) {
      case KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY:
        upsertFeedback(workspace.id, keyword, 'approved', request.reason ?? 'Added to strategy from Keyword Command Center');
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        }, { preferSource: true });
        message = `"${keyword}" was added to the strategy operating loop.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE:
      case KEYWORD_COMMAND_CENTER_ACTIONS.TRACK:
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
            ? TRACKED_KEYWORD_SOURCE.RECOMMENDATION
            : TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        });
        message = `"${keyword}" is now active in keyword tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        // protection guard → transition guard → write. `existing.status` (read pre-txn
        // via findTracked) is the authoritative `from`; an illegal move throws inside the
        // txn so retireTrackedKeyword never runs (no partial write, no broadcast).
        validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.PAUSED);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.PAUSED);
        message = `"${keyword}" was paused from active tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.DEPRECATED);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        message = `"${keyword}" was retired from active strategy-owned tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE:
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        upsertFeedback(workspace.id, keyword, 'declined', request.reason ?? 'Declined from Keyword Command Center');
        // Only the tracked-branch of DECLINE changes an existing row's status; guard it.
        if (existing && !protectedReason(existing)) {
          validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.DEPRECATED);
          trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        }
        message = `"${keyword}" was declined for future strategy consideration.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE:
        // RESTORE revives a paused/deprecated row to active (an insert-style upsert when
        // not tracked). Guard the transition only when restoring an EXISTING inactive row.
        if (existing && (existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
          validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.ACTIVE);
        }
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: existing?.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          deprecatedAt: undefined,
          replacedBy: undefined,
        });
        message = `"${keyword}" was restored to the active keyword loop.`;
        break;
    }
  });
  run();

  invalidateIntelligenceCache(workspace.id);
  const payload = { keyword, action: request.action, source: 'keyword_command_center', updatedAt: now };
  if (!options.skipBroadcast) {
    broadcastKeywordCommandCenterAction(workspace.id, request, payload);
  }
  if (!options.skipActivity) {
    addActivity(workspace.id, 'rank_tracking_updated', 'Keyword lifecycle updated', message, {
      keyword,
      action: request.action,
      source: 'keyword_command_center',
    });
  }

  return {
    ok: true,
    action: request.action,
    keyword,
    protectedKeyword: Boolean(protectedReason(existing)),
    message,
    trackedKeywords,
  };
}

export function applyKeywordCommandCenterAction(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
): KeywordCommandCenterActionResult {
  return applyKeywordCommandCenterActionInternal(workspaceId, request);
}

/**
 * Narrow hard-delete eligibility predicate (P3-3c). DELIBERATELY NOT a blind
 * `protectedReason` reuse: `protectedReason` flags MANUAL as protected, but MANUAL is
 * the design's delete-eligible class (genuine mistakes the operator wants gone). Hard
 * delete drops rank history too and is irreversible, so it is ONLY allowed for a MANUAL,
 * UNPINNED keyword with NO strategy/client provenance. Everything else (pinned /
 * CLIENT_REQUESTED / a gap-provenanced row via sourceGapKey) must be RETIRED (soft,
 * restorable), never deleted — `force` overrides for the dedicated route.
 */
export function isHardDeleteEligible(existing: TrackedKeyword | undefined): boolean {
  if (!existing) return false;
  if (existing.pinned) return false;
  if (existing.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return false;
  if (existing.sourceGapKey) return false;
  return existing.source === TRACKED_KEYWORD_SOURCE.MANUAL;
}

/**
 * Hard-delete a tracked keyword (P3-3c) — the THIRD, Hub-specific wrapper over
 * `removeTrackedKeyword`. Unlike the bare rank-tracking function (which broadcasts/logs
 * nothing — the rank route wraps it) this wrapper owns BOTH halves of the data-flow
 * contract: RANK_TRACKING_UPDATED action='deleted' broadcast + an activity row. This is a
 * SEPARATE channel from the lifecycle action enum — it is never a default/bulk action and
 * never lands in `KEYWORD_COMMAND_CENTER_ACTIONS`. Ineligible rows (see
 * `isHardDeleteEligible`) throw without `force`. Delete also drops rank history.
 */
export function deleteKeywordHard(
  workspaceId: string,
  keyword: string,
  options: { force?: boolean } = {},
): { ok: true; keyword: string; trackedKeywords: TrackedKeyword[] } {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) throw new Error('keyword required');

  // Resolve from the PROVENANCE-BEARING table read (listTrackedKeywordRows), NOT
  // getTrackedKeywords/findTracked — the latter STRIPS sourceGapKey, which would make
  // a gap-provenanced keyword look eligible and silently bypass the retire-not-delete rule.
  const existing = listTrackedKeywordRows(workspace.id).find(
    entry => keywordComparisonKey(entry.query) === normalized,
  );
  if (!existing) throw new Error('Keyword is not tracked');

  if (!options.force && !isHardDeleteEligible(existing)) {
    throw new Error('Keyword is not eligible for permanent deletion — retire it instead.');
  }

  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] = [];
  const run = db.transaction(() => {
    removeTrackedKeyword(workspace.id, normalized);
    trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  });
  run();

  invalidateIntelligenceCache(workspace.id);
  broadcastToWorkspace(workspace.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
    keyword: normalized,
    action: 'deleted',
    source: 'keyword_hub',
    updatedAt: now,
  });
  addActivity(workspace.id, 'rank_tracking_updated', 'Keyword permanently deleted', `"${normalized}" was permanently deleted (rank history dropped).`, {
    keyword: normalized,
    action: 'deleted',
    source: 'keyword_hub',
  });

  return { ok: true, keyword: normalized, trackedKeywords };
}

function bulkActionLabel(action: KeywordCommandCenterBulkActionRequest['action']): string {
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY) return 'added to strategy';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.TRACK) return 'activated in tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING) return 'paused from active tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE) return 'retired from active tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE) return 'declined from future strategy consideration';
  return String(action).replace(/_/g, ' ');
}

export function applyKeywordCommandCenterBulkAction(
  workspaceId: string,
  request: KeywordCommandCenterBulkActionRequest,
): KeywordCommandCenterBulkActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  if (!Array.isArray(request.keywords) || request.keywords.length === 0) {
    throw new Error('keywords required');
  }

  const uniqueKeywords = Array.from(
    request.keywords.reduce((deduped, rawKeyword) => {
      const keyword = rawKeyword.trim();
      const key = keywordComparisonKey(keyword);
      if (keyword && key && !deduped.has(key)) deduped.set(key, keyword);
      return deduped;
    }, new Map<string, string>()).values(),
  );
  if (uniqueKeywords.length === 0) throw new Error('keywords required');

  const items: KeywordCommandCenterBulkActionItem[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const keyword of uniqueKeywords) {
    try {
      applyKeywordCommandCenterActionInternal(workspace.id, {
        action: request.action,
        keyword,
        reason: request.reason,
        force: request.force,
      }, { skipBroadcast: true, skipActivity: true });
      items.push({ keyword, status: 'applied' });
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof InvalidTransitionError) {
        // The keyword is already in — or cannot legally leave — the target state
        // (e.g. RETIRE/PAUSE/DECLINE over a selection that already contains a
        // retired keyword: deprecated→deprecated). A bulk action over a mixed
        // selection routinely includes such no-ops; pre-P3 they were silent
        // idempotent successes. The P3 state-machine guard turned them into a
        // spurious "N failed". Classify as a benign skip, never a failure.
        items.push({ keyword, status: 'skipped_noop', error: message });
        skipped++;
      } else if (message.includes('requires explicit confirmation')) {
        items.push({ keyword, status: 'skipped_protected', error: message });
        skipped++;
      } else if (message === 'Keyword is not tracked') {
        items.push({ keyword, status: 'skipped_not_tracked', error: message });
        skipped++;
      } else {
        items.push({ keyword, status: 'error', error: message });
        failed++;
      }
    }
  }

  const actionLabel = bulkActionLabel(request.action);
  const message = `${applied} keyword${applied === 1 ? '' : 's'} ${actionLabel}${skipped > 0 ? `, ${skipped} skipped` : ''}${failed > 0 ? `, ${failed} failed` : ''}`;

  if (applied > 0) {
    addActivity(
      workspace.id,
      'rank_tracking_updated',
      'Keyword lifecycle updated (bulk)',
      message,
      {
        action: request.action,
        applied,
        skipped,
        failed,
        source: 'keyword_command_center_bulk',
      },
    );

    broadcastKeywordCommandCenterAction(workspace.id, request, {
      action: request.action,
      keywords: uniqueKeywords,
      applied,
      skipped,
      failed,
      source: 'keyword_command_center_bulk',
      updatedAt: now,
    });
  }

  return { action: request.action, applied, skipped, failed, items, message };
}
