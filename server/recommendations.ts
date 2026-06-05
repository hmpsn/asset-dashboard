/**
 * Recommendation Engine
 * 
 * Analyzes audit data, traffic, and keyword strategy to produce
 * prioritized, actionable recommendations for each workspace.
 * 
 * Priority tiers:
 *   fix_now   — Critical issues on high-traffic pages (errors, broken redirects, missing titles)
 *   fix_soon  — Important issues that affect rankings (warnings on key pages, missing schema)
 *   fix_later — Minor issues on low-traffic pages, cosmetic improvements
 *   ongoing   — Content gaps, keyword opportunities, continuous optimization
 */

import crypto from 'crypto';
import db from './db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { recommendationSchema, recommendationSummarySchema } from './schemas/workspace-schemas.js';
import { getWorkspace, updatePageState, getPageIdBySlug } from './workspaces.js';
import { getPageState } from './page-edit-states.js';
import type { Workspace, QuickWin, ContentGap } from './workspaces.js';
import { getLatestSnapshot } from './reports.js';
import type { AuditSnapshot } from './reports.js';
import { loadDecayAnalysis } from './content-decay.js';
import { getDeclinedKeywords } from './keyword-feedback.js';
import { listPageKeywords } from './page-keywords.js';
import { listContentGaps } from './content-gaps.js';
import { listQuickWins } from './quick-wins.js';
import { listKeywordGaps } from './keyword-gaps.js';
import { listTopicClusters } from './topic-clusters.js';
import { listCannibalizationIssues } from './cannibalization-issues.js';
import {
  getLocalSeoPosture,
  getLocalSeoServiceGaps,
  getLocalSeoCompetitorBrands,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  getLocalSeoReadModel,
  listLocalSeoMarkets,
} from './local-seo.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { getInsights } from './analytics-insights-store.js';
import { listDiagnosticReports } from './diagnostic-store.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { normalizePageUrl } from './helpers.js';
import { buildRecommendationStory } from './signal-story-registry.js';
import { buildRecommendationGenerationContext } from './intelligence/generation-context-builders.js';
import { getAuditTrafficForWorkspace } from './audit-traffic.js';
import {
  assessAuthorityFromBacklinks,
  kdClassificationNote,
} from './authority-context.js';
import { computeOpportunityValue } from './scoring/opportunity-value.js';
import { computeTimingBoosts, maxBoostForPages } from './scoring/opportunity-timing.js';
import { triggerOpportunityRegen } from './scoring/opportunity-regen.js';
import { buildCtrCurve, type GscKeywordObservation } from './scoring/ctr-curve.js';
import { resolveOvAuthorityStrength } from './workspace-authority.js';
import { getOrCreateWorkspaceWeights } from './opportunity-weights.js';
import { computeOvCalibration } from './scoring/ov-calibration.js';

// ─── Types ────────────────────────────────────────────────────────

export type { RecPriority, RecType, RecStatus, RecActionType, Recommendation, RecommendationSet } from '../shared/types/recommendations.ts';
import type { RecPriority, RecType, RecStatus, Recommendation, RecommendationSet, OpportunityScore } from '../shared/types/recommendations.ts';
import type { ConversionAttributionData, CtrOpportunityData } from '../shared/types/analytics.js';
import type { ActionType } from '../shared/types/outcome-tracking.js';
import {
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_VISIBILITY_POSTURE,
} from '../shared/types/local-seo.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { RECOMMENDATION_TRANSITIONS, validateTransition } from './state-machines.js';
import { createLogger } from './logger.js';

const log = createLogger('recommendations');

interface TrafficMap {
  [path: string]: { clicks: number; impressions: number; sessions: number; pageviews: number };
}

/** Issue-type-specific recovery rates for traffic estimation.
 * `perRec` is a user-facing percent range shown in estimatedGain text.
 * `summary` is the decimal multiplier applied to trafficAtRisk for the aggregate summary.
 * @internal exported for unit testing
 */
export interface RecoveryRate { perRec: string; summary: number }

const DEFAULT_RECOVERY: RecoveryRate = { perRec: '5-15%', summary: 0.12 };

const RECOVERY_RATES: Record<string, RecoveryRate> = {
  // High-impact content issues
  'title':                { perRec: '10-25%', summary: 0.18 },
  'meta-description':     { perRec: '5-15%',  summary: 0.10 },
  'h1':                   { perRec: '8-20%',  summary: 0.14 },
  'content-length':       { perRec: '10-30%', summary: 0.20 },
  'duplicate-title':      { perRec: '10-20%', summary: 0.15 },
  'duplicate-description':{ perRec: '5-10%',  summary: 0.08 },
  // Technical issues
  'canonical':            { perRec: '15-30%', summary: 0.22 },
  'indexability':         { perRec: '20-50%', summary: 0.35 },
  'robots':               { perRec: '15-40%', summary: 0.28 },
  'redirect-chains':      { perRec: '5-15%',  summary: 0.10 },
  'redirects':            { perRec: '10-25%', summary: 0.18 },
  'sitemap':              { perRec: '5-10%',  summary: 0.08 },
  'robots-txt':           { perRec: '5-15%',  summary: 0.10 },
  'response-time':        { perRec: '5-15%',  summary: 0.10 },
  'ssl':                  { perRec: '10-20%', summary: 0.15 },
  // Performance issues
  'cwv':                  { perRec: '5-15%',  summary: 0.10 },
  'cwv-lcp':              { perRec: '5-15%',  summary: 0.10 },
  'cwv-cls':              { perRec: '3-10%',  summary: 0.07 },
  'cwv-tbt':              { perRec: '3-10%',  summary: 0.07 },
  'render-blocking':      { perRec: '3-8%',   summary: 0.05 },
  // Low-impact issues
  'og-tags':              { perRec: '1-3%',   summary: 0.02 },
  'og-image':             { perRec: '1-3%',   summary: 0.02 },
  'img-alt':              { perRec: '2-5%',   summary: 0.03 },
  'structured-data':      { perRec: '5-15%',  summary: 0.10 },
  // Internal linking
  'internal-links':       { perRec: '5-15%',  summary: 0.10 },
  'link-text':            { perRec: '3-8%',   summary: 0.05 },
  'orphan-pages':         { perRec: '10-25%', summary: 0.18 },
};

export function getRecoveryRate(checkName: string): RecoveryRate {
  return RECOVERY_RATES[checkName] || DEFAULT_RECOVERY;
}

// ─── SEO Gen-Quality P4 · one gain basis (Contract 3) ───────────────────────
//
// The legacy `estimatedGain` strings are static per-check constants (getRecoveryRate),
// identical for every workspace/page, while ranking reads the OV value — a live
// client-facing incoherence. The canonical gain string is derived from the SAME OV figure
// (predictedEmv, the horizon-projected EMV that also feeds the served tier and
// content_gaps.opportunity_score), so the client's stated gain, the queue order, and the
// upsell badge all share ONE basis.
//
// CLIENT-SAFE FORM = NON-DOLLARIZED (owner constraint: clients never see a raw $/wk). We
// render an outcome-oriented RELATIVE-MAGNITUDE phrase, NOT a dollar figure. The public
// route additionally sanitizes any dollar exposure (stripEmvFromPublicRecs) as defense-
// in-depth, and the public-read test asserts no dollarized estimatedGain ever leaks.
//
// Bands map the horizon EMV proxy to a magnitude word. Owner-tunable (documented in the
// guardrail doc + PR); deliberately coarse so the proxy's imprecision is never overstated.
const OV_GAIN_BANDS = { high: 600, medium: 150, low: 1 } as const;

/** Non-dollarized, client-safe gain string derived from the OV horizon EMV proxy.
 *  Same basis as the served tier + content_gaps.opportunity_score (Contract 3). Returns
 *  null when no OV is attached (caller keeps the legacy string). @internal exported for testing */
export function buildOvGainString(opportunity: OpportunityScore | undefined): string | null {
  if (!opportunity) return null;
  const emv = opportunity.predictedEmv;
  if (!Number.isFinite(emv) || emv <= 0) {
    return 'Modest but real opportunity to recover organic visibility';
  }
  if (emv >= OV_GAIN_BANDS.high) {
    return 'High-value opportunity — among the strongest expected organic gains on the site right now';
  }
  if (emv >= OV_GAIN_BANDS.medium) {
    return 'Solid opportunity — meaningful expected organic gain relative to your other actions';
  }
  return 'Worthwhile opportunity — a steady expected organic gain once addressed';
}

/** Resolve the gain string for a rec. Canonical callers pass `true`; tests still exercise
 *  the historical fallback contract by passing `false`. @internal exported for testing */
export function resolveEstimatedGain(
  legacyGain: string,
  opportunity: OpportunityScore | undefined,
  useGenQual: boolean,
): string {
  if (!useGenQual) return legacyGain;
  return buildOvGainString(opportunity) ?? legacyGain;
}

export {
  adjustKdImpactScore,
  classifyKdGap,
  kdClassificationNote,
} from './authority-context.js';

/**
 * @internal exported for unit testing
 *
 * Maps a recommendation's `type` (+ `source`) to the {@link ActionType} its outcome is
 * tracked under. This mapping feeds `winRateByActionType` calibration, so a NEW `RecType`
 * that silently fell through to `audit_fix_applied` would distort calibration (G2). The
 * `switch` is therefore EXHAUSTIVE over `RecType`: the `never` assignment in `default`
 * makes adding a `RecType` to the union a COMPILE error until the author either gives it an
 * explicit outcome case here or consciously adds it to the audit-fix family below. This
 * compile-time guarantee is stronger than a pr-check rule and is the enforcement the
 * `docs/rules/seo-generation-quality.md` "new rec types" contract refers to for the
 * RecType→ActionType half (the source-category lockstep half is the pr-check rule).
 */
export function recommendationOutcomeActionType(type: RecType, source: string): ActionType {
  switch (type) {
    case 'content_refresh':
      return 'content_refreshed';
    case 'metadata':
      return 'meta_updated';
    case 'schema':
      return 'schema_deployed';
    case 'content':
      return 'content_published';
    case 'strategy':
      return source.startsWith('strategy:content-gap') ? 'content_published' : 'insight_acted_on';
    // ── SEO Gen-Quality P5 · first-class orphan-subsystem recs ──
    // Distinct ActionTypes (NOT the audit_fix_applied family) so winRateByActionType stays
    // honestly calibrated for each subsystem (the contract's "honest calibration" requirement).
    case 'keyword_gap':
      return 'competitor_gap_closed';
    case 'topic_cluster':
      return 'cluster_published';
    case 'cannibalization':
      return 'cannibalization_resolved';
    // ── SEO Gen-Quality P7.1 · first-class local-visibility recs ──
    // Distinct ActionTypes (NOT audit_fix_applied) so winRateByActionType stays honestly
    // calibrated for the local subsystem. local_visibility (competitor-brand + not-visible)
    // wins when the business starts appearing in the pack; local_service_gap is "added" when
    // the previously-untargeted service term begins ranking.
    case 'local_visibility':
      return 'local_visibility_won';
    case 'local_service_gap':
      return 'local_service_added';
    case 'technical':
    case 'performance':
    case 'accessibility':
    case 'aeo':
      // Audit-fix family — these map to the generic audit_fix_applied outcome by design.
      // A new RecType must NOT silently join this family: add an explicit case above unless
      // it is genuinely an audit fix, in which case add it to this list deliberately.
      return 'audit_fix_applied';
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return 'audit_fix_applied';
    }
  }
}

/** Coerce a free-form search-intent string (PageKeywordMap.searchIntent) to the
 *  strict OpportunityInput.intent union, or null when it isn't one of the four
 *  recognised intents. Keeps the OV scorer's intent map total. */
function toOpportunityIntent(
  intent: string | null | undefined,
): 'transactional' | 'commercial' | 'informational' | 'navigational' | null {
  return intent === 'transactional' || intent === 'commercial' || intent === 'informational' || intent === 'navigational'
    ? intent
    : null;
}

// ─── Recommendation source keys ────────────────────────────────────
// Every rec carries a `source` string that uniquely identifies the
// underlying signal. The merge logic relies on these strings being:
//   (a) stable across runs for the same logical issue, so status carries
//       over, and
//   (b) distinct per-page for per-page categories, so fixing one page
//       doesn't auto-resolve another.
// Centralizing construction here prevents future code from accidentally
// sharing a source key across unrelated issues (the #1 cause of the
// "auto-resolved too eagerly" reviewer flag).

/** Top-level category of a recommendation source. The category prefix
 * determines how the merge logic matches the rec against its previous run.
 * Keep this union in lockstep with `REC_SOURCE_CATEGORIES` below.
 */
export type RecSourceCategory =
  | 'audit'
  | 'strategy'
  | 'decay'
  | 'insight:ctr_opportunity'
  | 'insight:freshness_alert'
  | 'diagnostic'
  | 'keyword_gap'
  | 'topic_cluster'
  | 'cannibalization'
  | 'local_visibility'
  | 'local_service_gap';

const REC_SOURCE_CATEGORIES: RecSourceCategory[] = [
  'audit',
  'strategy',
  'decay',
  'insight:ctr_opportunity',
  'insight:freshness_alert',
  'diagnostic',
  'keyword_gap',
  'topic_cluster',
  'cannibalization',
  'local_visibility',
  'local_service_gap',
];

/** Returns the category prefix for a given source string, or `null` when
 * the source doesn't match a known category (defensive — should never
 * happen in practice but prevents a rogue source string from bypassing
 * the auto-resolve safety check).
 */
export function getRecSourceCategory(source: string): RecSourceCategory | null {
  for (const category of REC_SOURCE_CATEGORIES) {
    if (source === category || source.startsWith(`${category}:`)) return category;
  }
  return null;
}

/** Typed builders for rec source strings. Every source in `generateRecommendations`
 * MUST flow through one of these so the category prefix and scoping are
 * impossible to get wrong. Adding a new category is a deliberate, four-line
 * change: add to the union, the array, the builder, and the caller.
 */
export const RecSource = {
  audit:                  (check: string): string => `audit:${check}`,
  auditSiteWide:          (check: string): string => `audit:site-wide:${check}`,
  strategyContentGap:     (): string => 'strategy:content-gap',
  strategyQuickWin:       (): string => 'strategy:quick-win',
  strategyRankingOpp:     (): string => 'strategy:ranking-opportunity',
  strategyIntentMismatch: (pageSlug: string): string => `strategy:intent-mismatch:${pageSlug}`,
  decay:                  (pageSlug: string): string => `decay:${pageSlug}`,
  ctrOpportunity:         (pageSlug: string): string => `insight:ctr_opportunity:${pageSlug}`,
  freshnessAlert:         (pageSlug: string): string => `insight:freshness_alert:${pageSlug}`,
  diagnostic:             (reportId: string, actionIdx: number, actionTitle: string): string =>
    `diagnostic:${reportId}:${actionIdx}:${actionTitle.slice(0, 20)}`,
  // ── SEO Gen-Quality P5 · first-class orphan-subsystem recs ──
  // Each key is stable per logical issue (keyword / cluster topic / cannibalization URL-set)
  // so status carries over between runs and one fix doesn't auto-resolve another. These
  // categories are NOT `strategy:`-prefixed, so buildMergeKey keys on the source alone.
  keywordGap:             (keyword: string): string => `keyword_gap:${keyword}`,
  topicCluster:           (topic: string): string => `topic_cluster:${topic}`,
  cannibalization:        (urlSetKey: string): string => `cannibalization:${urlSetKey}`,
  // ── SEO Gen-Quality P7.1 · first-class local-visibility recs ──
  // localVisibility keys on a market+keyword (not-visible) or market identity (competitor
  // brand); localServiceGap keys on the taxonomy serviceId. Stable per logical issue so
  // status carries over and one fix doesn't auto-resolve another. Not `strategy:`-prefixed,
  // so buildMergeKey keys on the source alone.
  localVisibility:        (marketKey: string): string => `local_visibility:${marketKey}`,
  localServiceGap:        (serviceId: string): string => `local_service_gap:${serviceId}`,
};

/** Infer page type from slug path.
 * @internal exported for unit testing
 */
export function inferPageType(slug: string): 'blog' | 'service' | 'landing' | 'product' | 'other' {
  const s = slug.toLowerCase();
  if (/(?:^|\/)(?:blog|articles?|news|posts?|guides?)/.test(s)) return 'blog';
  if (/(?:^|\/)(?:services?|solutions?|offerings?)/.test(s)) return 'service';
  if (/(?:^|\/)(?:products?|shop|store)/.test(s)) return 'product';
  if (/(?:^|\/)(?:landing|lp[-_])/.test(s)) return 'landing';
  return 'other';
}

/** Detect search intent mismatch between page type and targeted keyword intent.
 * @internal exported for unit testing
 */
export function isIntentMismatch(pageType: string, searchIntent: string): { mismatch: boolean; reason: string } {
  if ((pageType === 'service' || pageType === 'product') && searchIntent === 'informational') {
    return { mismatch: true, reason: `This ${pageType} page targets an informational keyword — consider creating a blog post for the informational query and retargeting this page to a commercial/transactional keyword.` };
  }
  if (pageType === 'blog' && searchIntent === 'transactional') {
    return { mismatch: true, reason: `This blog post targets a transactional keyword — consider creating a dedicated service/product page for this keyword instead.` };
  }
  return { mismatch: false, reason: '' };
}

// ─── Storage ──────────────────────────────────────────────────────

interface RecSetRow {
  workspace_id: string;
  generated_at: string;
  recommendations: string;
  summary: string;
}

interface RecStmts {
  select: ReturnType<typeof db.prepare>;
  upsert: ReturnType<typeof db.prepare>;
}

let _recStmts: RecStmts | null = null;
function recStmts(): RecStmts {
  if (!_recStmts) {
    _recStmts = {
      select: db.prepare(
        `SELECT * FROM recommendation_sets WHERE workspace_id = ?`,
      ),
      upsert: db.prepare(
        `INSERT INTO recommendation_sets (workspace_id, generated_at, recommendations, summary)
         VALUES (@workspace_id, @generated_at, @recommendations, @summary)
         ON CONFLICT(workspace_id) DO UPDATE SET
           generated_at = @generated_at, recommendations = @recommendations, summary = @summary`,
      ),
    };
  }
  return _recStmts;
}

export function loadRecommendations(workspaceId: string): RecommendationSet | null {
  const row = recStmts().select.get(workspaceId) as RecSetRow | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    recommendations: parseJsonSafeArray(row.recommendations, recommendationSchema, {
      table: 'recommendation_sets', field: 'recommendations', workspaceId,
    }) as Recommendation[],
    summary: parseJsonSafe(row.summary, recommendationSummarySchema, {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: 0, trafficAtRisk: 0,
      estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0,
      topRecommendationId: null,
    }, { table: 'recommendation_sets', field: 'summary', workspaceId }) as RecommendationSet['summary'],
  };
}

export function saveRecommendations(set: RecommendationSet): void {
  recStmts().upsert.run({
    workspace_id: set.workspaceId,
    generated_at: set.generatedAt,
    recommendations: JSON.stringify(set.recommendations),
    summary: JSON.stringify(set.summary),
  });
}

export function updateRecommendationStatus(
  workspaceId: string,
  recId: string,
  status: RecStatus
): Recommendation | null {
  const set = loadRecommendations(workspaceId);
  if (!set) return null;
  const rec = set.recommendations.find(r => r.id === recId);
  if (!rec) return null;
  rec.status = status;
  rec.updatedAt = new Date().toISOString();
  // Recompute the summary so topRecommendationId stays consistent after a
  // status flip — completing or dismissing a rec must not leave the pointer
  // referencing that now-inactive rec. computeRecommendationSummary already
  // excludes completed/dismissed recs when picking activeRecs[0].
  set.summary = computeRecommendationSummary(set.recommendations);
  saveRecommendations(set);
  return rec;
}

export function dismissRecommendation(workspaceId: string, recId: string): boolean {
  return updateRecommendationStatus(workspaceId, recId, 'dismissed') !== null;
}

/**
 * Resolve (complete) recommendations in-place when a workspace change touches
 * the pages they cover. Called from write sites that fix SEO issues directly
 * (approval apply, per-item approve/reject, work-order completion) so the
 * priority list reflects the change immediately — without waiting for the next
 * full audit-driven `generateRecommendations` regen (which is GSC-lag-gated).
 *
 * Behaviour:
 *  - Loads the existing rec set (no-op if none exists).
 *  - Marks every non-completed, non-dismissed rec whose `affectedPages`
 *    intersect `affectedPages` (slug-normalised via toPageSlug, matching the
 *    auto-resolve branch in generateRecommendations) as `completed`, guarded by
 *    validateTransition() (CLAUDE.md: status changes go through state machines).
 *  - When `source` is provided, only recs in that source category are touched
 *    (uses getRecSourceCategory so a `source` of `'audit'` matches `audit:title`
 *    etc. — the same category prefixes the auto-resolve safety check uses).
 *  - Saves, invalidates the intelligence cache, and broadcasts
 *    RECOMMENDATIONS_UPDATED — only when at least one rec actually changed.
 *
 * @returns the number of recommendations transitioned to `completed`.
 */
export function resolveRecommendationsForChange(
  workspaceId: string,
  opts: { affectedPages: string[]; source?: string },
): number {
  const changedPages = new Set(
    (opts.affectedPages ?? [])
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .map(toPageSlug),
  );
  if (changedPages.size === 0) return 0;

  const set = loadRecommendations(workspaceId);
  if (!set) return 0;

  // When a source filter is supplied, resolve it to its category so callers can
  // pass either a full source string ('audit:title') or a bare category ('audit').
  const sourceCategory = opts.source ? getRecSourceCategory(opts.source) : null;

  let resolved = 0;
  const now = new Date().toISOString();
  for (const rec of set.recommendations) {
    if (rec.status === 'completed' || rec.status === 'dismissed') continue;
    if (sourceCategory && getRecSourceCategory(rec.source) !== sourceCategory) continue;
    const intersects = rec.affectedPages.some(p => changedPages.has(toPageSlug(p)));
    if (!intersects) continue;
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, rec.status, 'completed');
    rec.status = 'completed';
    rec.updatedAt = now;
    resolved++;
  }

  if (resolved === 0) return 0;

  // Recompute the summary so client-facing headline counts (fixNow/fixSoon/
  // trafficAtRisk/estimatedRecoverable*) reflect the resolved recs — otherwise
  // the rendered list drops the item but the numbers stay inflated until the
  // next full regen.
  set.summary = computeRecommendationSummary(set.recommendations);
  saveRecommendations(set);
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { resolved });
  log.info(`Resolved ${resolved} recommendation(s) in-place for ${workspaceId} (${changedPages.size} changed page(s))`);

  // ── PR7 · Spine B — reprioritize-on-apply tail (try/catch). ──
  // Completing a rec (e.g. the #1) frees its page; a debounced regen re-ranks the
  // queue so the next-best opportunity is promoted with fresh timing boosts.
  // Never let the regen trigger break the apply.
  try {
    triggerOpportunityRegen(workspaceId);
  } catch (err) {
    log.warn({ workspaceId, err: err instanceof Error ? err.message : String(err) }, 'opportunity regen trigger failed on apply (non-fatal)');
  }

  return resolved;
}

/**
 * Resolve recommendations covering a set of Webflow/CMS PAGE IDs (the
 * page_edit_states key). recommendation.affectedPages are SLUGS, so each id is
 * mapped to its slug via getPageState() before matching — the recurring pattern
 * shared by SEO-write apply paths (work orders, bulk SEO fix). Returns the number
 * of recommendations resolved (0 when no id maps to a slug, or no rec matches).
 *
 * `opts.source` is forwarded to resolveRecommendationsForChange so callers can
 * scope resolution to a single rec category (e.g. 'audit').
 */
export function resolveRecommendationsForPageIds(
  workspaceId: string,
  pageIds: string[],
  opts: { source?: string } = {},
): number {
  const affectedSlugs = (pageIds ?? [])
    .map(id => getPageState(workspaceId, id)?.slug)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (affectedSlugs.length === 0) return 0;
  return resolveRecommendationsForChange(workspaceId, { affectedPages: affectedSlugs, source: opts.source });
}

/**
 * Compute the RecommendationSet summary (active counts + weighted recoverable
 * traffic) from a rec list. Shared by the full regen (generateRecommendations)
 * and the in-place resolver (resolveRecommendationsForChange) so client-facing
 * headline numbers never drift from the rendered active list.
 */
export function computeRecommendationSummary(recs: Recommendation[]): RecommendationSet['summary'] {
  const activeRecs = recs.filter(r => r.status !== 'completed' && r.status !== 'dismissed');
  const actionableRecs = activeRecs.filter(r => r.priority === 'fix_now' || r.priority === 'fix_soon');

  // Weighted recovery: each rec contributes traffic × its issue-specific recovery rate.
  let weightedRecoverableClicks = 0;
  let weightedRecoverableImpressions = 0;
  for (const r of actionableRecs) {
    const checkName = r.source?.startsWith('audit:site-wide:')
      ? r.source.replace('audit:site-wide:', '')
      : r.source?.startsWith('audit:')
        ? r.source.replace('audit:', '')
        : '';
    const rate = checkName ? getRecoveryRate(checkName) : DEFAULT_RECOVERY;
    weightedRecoverableClicks += r.trafficAtRisk * rate.summary;
    weightedRecoverableImpressions += r.impressionsAtRisk * rate.summary;
  }

  // recs are already sorted by sortRecommendations (tier → impactScore → intent
  // alignment) before computeRecommendationSummary is called, so activeRecs[0]
  // is the true highest-ranked active recommendation.
  const topRec = activeRecs.length > 0 ? activeRecs[0] : null;
  const topRecommendationId = topRec?.id ?? null;
  const topOpportunityRationale = topRec ? buildTopOpportunityRationale(topRec) : undefined;

  return {
    fixNow: activeRecs.filter(r => r.priority === 'fix_now').length,
    fixSoon: activeRecs.filter(r => r.priority === 'fix_soon').length,
    fixLater: activeRecs.filter(r => r.priority === 'fix_later').length,
    ongoing: activeRecs.filter(r => r.priority === 'ongoing').length,
    totalImpactScore: activeRecs.reduce((s, r) => s + r.impactScore, 0),
    trafficAtRisk: activeRecs.reduce((s, r) => s + r.trafficAtRisk, 0),
    estimatedRecoverableClicks: Math.round(weightedRecoverableClicks),
    estimatedRecoverableImpressions: Math.round(weightedRecoverableImpressions),
    topRecommendationId,
    ...(topOpportunityRationale ? { topOpportunityRationale } : {}),
  };
}

/** Render a one-line, CLIENT-SAFE rationale for the #1 recommendation from its
 *  opportunity.components (top 2 contributors' evidence). Contains NO dollar
 *  figure (emvPerWeek/roiPerEffortDay are admin/AI-only per owner decision).
 *  Returns undefined for legacy recs with no opportunity — additive and safe. */
function buildTopOpportunityRationale(rec: Recommendation): string | undefined {
  const components = rec.opportunity?.components;
  if (!components || components.length === 0) return undefined;
  const top = [...components]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map(c => c.evidence.trim())
    .filter(Boolean);
  if (top.length === 0) return undefined;
  return top.join('; ');
}

// ─── Business-intent ranking ──────────────────────────────────────
//
// Recs whose topic matches a stated business priority (the authority-resolved
// `effectiveBusinessPriorities` — client store + admin store reconciled in
// business-priorities-source.ts) get a ranking boost. The boost is deliberately
// bounded to a *within-tier tiebreaker*: it can reorder two recs that share the
// same priority tier AND the same impactScore, but it can never move a rec
// across tiers (fix_now > fix_soon > …) or beat a higher impactScore in the same
// tier. This keeps the ranking explainable — tier and traffic-driven impact stay
// the dominant signals; intent only settles ties the engine would otherwise
// break arbitrarily.

/** Generic tokens that carry no business-intent signal — matching on these alone
 * would make almost every rec "aligned", defeating the purpose. Kept small and
 * SEO/priority-domain specific so genuinely distinctive topic words still match.
 * Min token length is 3 so short but distinctive terms ('spa', 'law') still match,
 * while structural/page-type nouns in this set prevent false positives.
 * @internal exported for unit testing */
export const INTENT_STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'our', 'your', 'more', 'get', 'getting', 'grow',
  'growth', 'increase', 'improve', 'improving', 'boost', 'win', 'winning', 'page',
  'pages', 'site', 'website', 'seo', 'add', 'fix', 'fixing', 'new', 'better',
  'overall', 'experience', 'revenue', 'leads', 'lead', 'jobs', 'job', 'sales',
  'traffic', 'rankings', 'ranking', 'from', 'into', 'this', 'that', 'them',
  // Structural/page-type nouns — matching on these alone produces false positives
  // because nearly every rec touches some kind of "services page" or "product page".
  'services', 'products', 'product', 'about', 'contact', 'home', 'homepage',
  'blog', 'content', 'schema', 'metadata', 'title', 'description', 'meta',
]);

/** Tokenise a free-text string into lowercased, de-noised intent words.
 * Strips a leading `[category]` prefix (client priorities are stored as
 * `[category] text`), splits on non-alphanumerics, drops short/stopword tokens.
 */
function intentTokens(text: string): Set<string> {
  const withoutCategory = text.replace(/^\s*\[[^\]]*\]\s*/, '');
  const tokens = withoutCategory
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !INTENT_STOPWORDS.has(t));
  return new Set(tokens);
}

/** True when a recommendation's topic (its title + affectedPages slugs) shares a
 * meaningful (non-stopword) token with any stated business priority.
 *
 * Intentionally conservative: matches on distinctive nouns (e.g. "plumbing",
 * "roofing", "emergency") so a priority like "Grow plumbing services revenue"
 * aligns with a rec touching the plumbing pages, but a generic priority like
 * "Improve the overall site experience" aligns with nothing in particular.
 * @internal exported for unit testing */
export function isRecIntentAligned(
  rec: Pick<Recommendation, 'title' | 'affectedPages'>,
  effectiveBusinessPriorities: string[],
): boolean {
  if (!effectiveBusinessPriorities.length) return false;
  const recTokens = intentTokens([rec.title, ...rec.affectedPages].join(' '));
  if (recTokens.size === 0) return false;
  for (const priority of effectiveBusinessPriorities) {
    for (const token of intentTokens(priority)) {
      if (recTokens.has(token)) return true;
    }
  }
  return false;
}

/** Canonical recommendation ranking. Sorts `recs` in place:
 *   1. priority tier (fix_now > fix_soon > fix_later > ongoing) — PRIMARY
 *   2. impactScore (highest first) — SECONDARY
 *   3. business-intent alignment (aligned first) — within-tier TIEBREAKER only
 *
 * Because intent is the LAST comparator, an intent-aligned rec can only outrank
 * another rec that is otherwise equal (same tier, same impactScore). A higher
 * tier or a higher impactScore always wins regardless of intent.
 * @internal exported for unit testing */
export function sortRecommendations(
  recs: Recommendation[],
  effectiveBusinessPriorities: string[],
): void {
  const priorityOrder: Record<RecPriority, number> = { fix_now: 0, fix_soon: 1, fix_later: 2, ongoing: 3 };
  // Memoise alignment so we don't re-tokenise per comparison.
  const aligned = new Map<string, boolean>();
  const isAligned = (rec: Recommendation): boolean => {
    let v = aligned.get(rec.id);
    if (v === undefined) {
      v = isRecIntentAligned(rec, effectiveBusinessPriorities);
      aligned.set(rec.id, v);
    }
    return v;
  };
  recs.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    const scoreDiff = b.impactScore - a.impactScore;
    if (scoreDiff !== 0) return scoreDiff;
    // Equal tier and impact — let stated business intent break the tie.
    return Number(isAligned(b)) - Number(isAligned(a));
  });
}

// ─── Scoring Helpers ──────────────────────────────────────────────

/** Critical SEO checks that warrant "Fix Now" when on high-traffic pages */
const CRITICAL_CHECKS = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
  'redirect-chains', 'redirects',
  'aeo-author', 'aeo-answer-first', 'aeo-trust-pages',
]);

function isCriticalCheck(check: string): boolean {
  return CRITICAL_CHECKS.has(check);
}

/** Extract the audit check name from a rec `source` string (`audit:title`,
 *  `audit:site-wide:canonical` → `title` / `canonical`). Returns '' for non-audit
 *  sources. Mirrors the checkName extraction in computeRecommendationSummary so the
 *  two stay in lockstep. */
function checkNameFromSource(source: string | undefined): string {
  if (!source) return '';
  if (source.startsWith('audit:site-wide:')) return source.replace('audit:site-wide:', '');
  if (source.startsWith('audit:')) return source.replace('audit:', '');
  return '';
}

// ─── SEO Gen-Quality P4 · OV-derived priority tier (Contract 2) ─────────────
//
// The served priority TIER is derived from the OV value (which is a normalized read of the
// EMV/ROI economic quantity) via the bands below, EXCEPT genuine CRITICAL_CHECKS which keep
// `fix_now` (a broken canonical/robots is urgent regardless of modelled EMV).
//
// ⚠️ OWNER-TUNABLE THRESHOLDS (NOT approved for a per-workspace flip in this PR).
// The bands map the 0..100 OV `value` to a tier. They are deliberately conservative
// defaults; the owner approves the final thresholds AND the canary cohort before any
// per-workspace flip. Documented in docs/rules/seo-generation-quality.md (Contract 2)
// and the PR body. `value` is the OV-pipeline output of normalizeToScore(roiPerEffortDay),
// itself downstream of emvPerWeek — so the tier shares the one OV/EMV basis (Contract 3).
const OV_TIER_BANDS = {
  /** value ≥ this → fix_now (top-of-queue economic opportunity). */
  fixNow: 70,
  /** value ≥ this → fix_soon. */
  fixSoon: 45,
  /** value ≥ this → fix_later; below → ongoing. */
  fixLater: 20,
} as const;

/** Derive the served priority tier from a rec's OV value. CRITICAL_CHECKS short-circuit
 *  to `fix_now`. Pure: same rec → same tier. @internal exported for unit testing */
export function deriveOvTier(rec: Pick<Recommendation, 'priority' | 'source' | 'opportunity'>): RecPriority {
  // Genuine critical audit checks stay urgent regardless of modelled EMV.
  if (isCriticalCheck(checkNameFromSource(rec.source))) return 'fix_now';
  // No OV attached (legacy rec) → keep the existing tier untouched.
  const value = rec.opportunity?.value;
  if (value == null) return rec.priority;
  if (value >= OV_TIER_BANDS.fixNow) return 'fix_now';
  if (value >= OV_TIER_BANDS.fixSoon) return 'fix_soon';
  if (value >= OV_TIER_BANDS.fixLater) return 'fix_later';
  return 'ongoing';
}

function deriveCanonicalRecommendationFields(
  source: string,
  opportunity: OpportunityScore,
): Pick<Recommendation, 'impactScore' | 'priority'> {
  return {
    impactScore: opportunity.value,
    priority: deriveOvTier({ priority: 'ongoing', source, opportunity }),
  };
}

export function getTrafficScore(traffic: TrafficMap, slug: string, conversionRate?: number): number {
  const pagePath = normalizePageUrl(slug);
  const t = traffic[pagePath] || traffic[slug];
  if (!t) return 0;
  const base = t.clicks * 2 + t.impressions * 0.1 + t.pageviews;
  const convMultiplier = conversionRate && conversionRate > 2
    ? Math.min(1.5, 1 + conversionRate / 20)
    : 1;
  return base * convMultiplier;
}

function getTrafficForSlug(traffic: TrafficMap, slug: string): { clicks: number; impressions: number } {
  const pagePath = normalizePageUrl(slug);
  const t = traffic[pagePath] || traffic[slug] || { clicks: 0, impressions: 0 };
  return { clicks: t.clicks, impressions: t.impressions };
}

/**
 * Normalise any URL or path value to a bare slug (no leading slash, no domain).
 * GSC and GA4 both store pages as absolute URLs (https://domain.com/path).
 * Decay analysis also stores absolute URLs in some code paths.
 * All other callers pass relative paths (/foo or foo) — those work unchanged.
 */
/** @internal exported for unit testing */
export function toPageSlug(url: string): string {
  let path = url;
  if (url.startsWith('http')) {
    try { path = new URL(url).pathname; } catch { /* fall through */ }
  }
  return normalizePageUrl(path).replace(/^\//, '');
}

/** SEO Gen-Quality P5 — build a stable, order-independent key for a cannibalization
 *  URL set. Normalizes each path to its slug, dedupes, and sorts so the SAME set of
 *  competing pages always produces the SAME key — used both as the rec source suffix
 *  (status carries over between runs) and to dedupe a cannibalization rec against an
 *  active cannibalization insight covering the same pages. Pure / deterministic.
 *  @internal exported for unit testing */
export function cannibalizationUrlSetKey(paths: string[]): string {
  return Array.from(new Set(paths.map(p => toPageSlug(p)))).sort().join('|');
}

// Source prefixes whose slug portion may have been stored as an absolute URL
// in recs generated before the toPageSlug normalisation was introduced.
// Every source prefix that embeds a page slug must appear here.
// If the slug computation for a prefix uses toPageSlug(), add it to this list
// so migrateSourceKey() can normalise old recs that pre-date the change.
const URL_SLUG_PREFIXES = ['insight:ctr_opportunity:', 'insight:freshness_alert:', 'decay:', 'strategy:intent-mismatch:'] as const;

/**
 * Migrate a stored source key that may embed a full URL slug to its normalised
 * form. Safe to call on already-normalised keys — returns them unchanged.
 * Used only during the merge phase to match old recs against new ones.
 *
 * Operates on the raw `source` field only — never on composite merge keys
 * (e.g. `strategy:foo::affectedPage`). For composite keys, use buildMergeKey,
 * which applies this function to the source portion and toPageSlug() to the
 * suffix portion separately.
 */
/** @internal exported for unit testing */
export function migrateSourceKey(source: string): string {
  for (const prefix of URL_SLUG_PREFIXES) {
    if (source.startsWith(prefix)) {
      const slug = source.slice(prefix.length);
      const normalized = toPageSlug(slug);
      return normalized !== slug ? `${prefix}${normalized}` : source;
    }
  }
  return source;
}

/**
 * Build the merge-lookup key for a rec. For strategy recs the key is a
 * composite of `source::affectedPages[0]` (or title); for all others it's just
 * the source. Both halves are normalised so old recs (pre-toPageSlug) and new
 * recs produce matching keys, preserving in_progress/dismissed status across
 * the one-time migration.
 */
/** @internal exported for unit testing */
export function buildMergeKey(rec: { source: string; affectedPages: string[]; title: string }): string {
  const source = migrateSourceKey(rec.source);
  if (!source.startsWith('strategy:')) return source;
  const page = rec.affectedPages[0] ? toPageSlug(rec.affectedPages[0]) : rec.title;
  return `${source}::${page}`;
}

/** Weight impact score based on page type (homepage/service pages matter more)
 * @internal exported for unit testing
 */
export function pageImportanceMultiplier(slug: string): number {
  const s = slug.toLowerCase().replace(/^\//, '');
  if (s === '' || s === 'index' || s === 'home') return 1.5;
  if (/(?:^|\/)services?|solutions?|products?|pricing|packages/.test(s)) return 1.2;
  if (/(?:^|\/)thank[-_]?you|confirmation|success|members?|password|unsubscribe/.test(s)) return 0.8;
  return 1.0;
}

/** Map check name to recommendation type
 * @internal exported for unit testing
 */
export function checkToRecType(check: string, category?: string): RecType {
  const chk = check.toLowerCase();
  if (chk.startsWith('aeo-')) return 'aeo';
  if (chk.includes('meta') || chk.includes('title') || chk.includes('description')) return 'metadata';
  if (chk.includes('schema') || chk.includes('structured')) return 'schema';
  if (chk.includes('img-alt') || chk.includes('alt')) return 'accessibility';
  if (chk.includes('cwv') || chk.includes('performance') || chk.includes('speed')) return 'performance';
  if (category === 'content') return 'content';
  return 'technical';
}

/** Map issue type to purchasable product
 * @internal exported for unit testing
 */
export function mapToProduct(recType: RecType, pageCount: number): { productType?: string; productPrice?: number } {
  switch (recType) {
    case 'metadata':
      return pageCount >= 10
        ? { productType: 'fix_meta_10', productPrice: 179 }
        : { productType: 'fix_meta', productPrice: 20 };
    case 'schema':
      return pageCount >= 10
        ? { productType: 'schema_10', productPrice: 299 }
        : { productType: 'schema_page', productPrice: 39 };
    case 'accessibility':
      return { productType: 'fix_alt', productPrice: 50 };
    case 'aeo':
      return pageCount >= 5
        ? { productType: 'aeo_site_review', productPrice: 499 }
        : { productType: 'aeo_page_review', productPrice: 99 };
    case 'content_refresh':
      return pageCount >= 5
        ? { productType: 'content_refresh_5', productPrice: 799 }
        : { productType: 'content_refresh', productPrice: 199 };
    default:
      return {};
  }
}

// ─── Insight Text Generators ──────────────────────────────────────

/** Infer the most appropriate schema type(s) from a list of page slugs
 * @internal exported for unit testing
 */
export function inferSchemaTypes(slugs: string[]): string {
  const types = new Set<string>();
  for (const slug of slugs) {
    const s = slug.toLowerCase();
    if (/(?:^|\/)blog|articles?|news|posts?|guides?|insights?/.test(s)) types.add('Article');
    if (/(?:^|\/)faq|frequently[-_]asked/.test(s)) types.add('FAQPage');
    if (/(?:^|\/)contact|reach[-_]us|get[-_]in[-_]touch/.test(s)) types.add('ContactPoint');
    if (/(?:^|\/)services?|solutions?|offerings?|what[-_]we[-_]do/.test(s)) types.add('Service');
    if (/(?:^|\/)products?|shop|store/.test(s)) types.add('Product');
    if (/(?:^|\/)about|team|our[-_]story|who[-_]we[-_]are/.test(s)) types.add('Organization');
    if (/(?:^|\/)review|testimonials?|case[-_]stud/.test(s)) types.add('Review');
  }
  if (types.size === 0) types.add('WebPage');
  return Array.from(types).join(', ');
}

export function auditInsight(
  check: string,
  _severity: string,
  affectedCount: number,
  trafficAtRisk: number,
  affectedSlugs?: string[],
): string {
  const chk = check.toLowerCase();
  const hasTraffic = trafficAtRisk > 0;
  const trafficStr = trafficAtRisk >= 1000
    ? `${(trafficAtRisk / 1000).toFixed(1)}k`
    : trafficAtRisk.toString();

  if (chk.includes('title')) {
    return hasTraffic
      ? `${affectedCount} pages with title issues are receiving ${trafficStr} organic clicks/mo. The title tag is the #1 factor in whether someone clicks your result in Google — fixing these will directly improve CTR.`
      : `${affectedCount} pages have title tag issues. This is the single most visible element in search results and directly controls click-through rates.`;
  }
  if (chk.includes('meta-description') || chk.includes('meta')) {
    return hasTraffic
      ? `${affectedCount} pages with metadata issues drive ${trafficStr} clicks/mo. Well-crafted meta descriptions can increase CTR by 5-10% — that's significant traffic you're leaving on the table.`
      : `${affectedCount} pages need metadata optimization. Google displays your meta description in search results — generic or missing descriptions mean lower click-through rates.`;
  }
  if (chk.includes('h1')) {
    return `${affectedCount} pages have H1 heading issues. The H1 is a strong ranking signal that tells Google what your page is about — missing or duplicate H1s confuse search engines.`;
  }
  if (chk.includes('canonical')) {
    return `${affectedCount} pages have canonical tag issues. Without proper canonicals, Google may see duplicate content and dilute your rankings across multiple URLs.`;
  }
  if ((chk.includes('structured') || chk.includes('schema')) && !chk.startsWith('aeo-')) {
    const schemaTypes = affectedSlugs && affectedSlugs.length > 0
      ? inferSchemaTypes(affectedSlugs)
      : null;
    const schemaHint = schemaTypes ? ` Recommended types for these pages: ${schemaTypes}.` : '';
    return hasTraffic
      ? `${affectedCount} pages getting ${trafficStr} clicks/mo lack structured data. Adding schema markup can unlock rich snippets (stars, FAQs, breadcrumbs) which typically boost CTR by 20-30%.${schemaHint}`
      : `${affectedCount} pages are missing structured data. Schema markup enables rich snippets in Google — the enhanced listings that stand out and get significantly more clicks.${schemaHint}`;
  }
  if (chk.includes('img-alt') || chk.includes('alt')) {
    return `${affectedCount} pages have images missing alt text. This affects both Google Image Search visibility and accessibility compliance — two quick wins from a single fix.`;
  }
  if (chk.includes('redirect')) {
    return `Redirect chains slow page loads and dilute link equity — each hop loses ~10-15% of the SEO value being passed through. Cleaning these up is a quick technical win.`;
  }
  if (chk.includes('ssl') || chk.includes('mixed-content')) {
    return `Security issues directly affect rankings — Google uses HTTPS as a ranking signal. Mixed content warnings also erode user trust and can trigger browser warnings.`;
  }
  if (chk.includes('og-tags') || chk.includes('og-image')) {
    return `${affectedCount} pages are missing Open Graph tags. When shared on social media, these pages won't display a proper preview — reducing click-through from social channels.`;
  }
  // AEO-specific insights
  if (chk === 'aeo-author') {
    return hasTraffic
      ? `${affectedCount} pages receiving ${trafficStr} clicks/mo lack author attribution. AI answer engines (ChatGPT, Perplexity, Google AI Overviews) strongly prefer citing content with named, credentialed authors — especially for health, finance, and legal topics.`
      : `${affectedCount} pages are missing author bylines or reviewer attribution. AI systems treat anonymous content as less trustworthy and are less likely to cite it in generated answers.`;
  }
  if (chk === 'aeo-date') {
    return hasTraffic
      ? `${affectedCount} pages with ${trafficStr} clicks/mo have no visible "last updated" date. AI systems deprioritize undated content because they can't verify freshness — adding dates is a quick trust signal.`
      : `${affectedCount} pages are missing visible dates. LLMs and AI answer engines use recency as a ranking signal — undated content gets deprioritized in AI-generated answers.`;
  }
  if (chk === 'aeo-answer-first') {
    return hasTraffic
      ? `${affectedCount} pages driving ${trafficStr} clicks/mo open with generic intros instead of direct answers. AI systems extract the first substantive paragraph as the cited snippet — burying the answer below fluff means you won't get cited.`
      : `${affectedCount} pages start with "Welcome to…" or similar generic intros instead of directly answering the search query. Restructuring to answer-first layout makes content extractable by LLM retrievers.`;
  }
  if (chk === 'aeo-faq-no-schema') {
    return `${affectedCount} pages have FAQ-style content but no FAQPage schema markup. This is a low-hanging win — adding FAQPage JSON-LD enables rich snippets in Google AND makes Q&A pairs directly extractable by AI answer engines.`;
  }
  if (chk === 'aeo-hidden-content') {
    return `${affectedCount} pages hide significant content behind accordions, tabs, or collapsed sections. LLMs typically read only what's visible in the initial HTML — critical information in hidden elements won't get cited.`;
  }
  if (chk === 'aeo-citations') {
    return hasTraffic
      ? `${affectedCount} pages receiving ${trafficStr} clicks/mo lack external citations to authoritative sources. AI systems prefer citing pages that themselves cite primary sources (.gov, .edu, journals, professional associations) — it's a chain-of-trust signal.`
      : `${affectedCount} pages have no outbound links to authoritative sources. Content without citations appears less credible to AI systems — adding references to journals, .gov, .edu, or industry associations increases citation likelihood.`;
  }
  if (chk === 'aeo-dark-patterns') {
    return `${affectedCount} pages contain aggressive popups, autoplay media, or interstitials. AI retrieval systems downrank pages with dark patterns because they signal low-quality user experience.`;
  }
  if (chk === 'aeo-trust-pages') {
    return `Your site is missing essential trust pages (/about, /contact). AI systems use the presence of trust pages as a site-level credibility signal — especially for YMYL (Your Money or Your Life) topics like health, finance, and legal.`;
  }
  if (chk.includes('cwv') || chk.includes('performance')) {
    return hasTraffic
      ? `Core Web Vitals issues on pages driving ${trafficStr} clicks/mo. Google uses page experience as a ranking factor — slow pages lose both rankings and visitors.`
      : `Core Web Vitals issues detected. Page speed is a direct Google ranking factor and impacts user experience — slow pages have higher bounce rates.`;
  }
  return `${affectedCount} page${affectedCount !== 1 ? 's' : ''} affected. Fixing this will improve your site's overall SEO health score and search engine compatibility.`;
}

function strategyInsight(type: 'content_gap' | 'quick_win' | 'keyword_gap', item: ContentGap | QuickWin): string {
  if (type === 'quick_win') {
    const qw = item as QuickWin;
    return `Quick win on ${qw.pagePath}: ${qw.action}. ${qw.rationale}`;
  }
  if (type === 'content_gap') {
    const cg = item as ContentGap;
    return `Content opportunity: "${cg.topic}" targeting "${cg.targetKeyword}". ${cg.rationale}`;
  }
  return '';
}

/** Resolves a workspace's domain-authority bucket once per rec-generation cycle.
 *
 * Returns an 80/50/20 bucket based on the provider's organic-keyword count, or
 * `0` when the domain is unknown, the provider is unconfigured, the call
 * throws, or the provider returns no data. `0` signals "authority unknown" to
 * the KD classifier — callers fall back to the classification-free impact
 * score, not a zero multiplier.
 *
 * API-credit note: the underlying `provider.getDomainOverview` call is cached
 * at the provider layer (SQLite with TTL in the active SEO provider). First
 * call per domain per TTL window costs provider credits;
 * subsequent calls within the window cost 0. Isolating the call in this helper
 * means there is exactly one call site per rec-gen cycle, regardless of how
 * many individual recs consult `domainStrength`.
 */
async function resolveDomainStrength(ws: Workspace, workspaceId: string): Promise<number> {
  if (!ws.liveDomain) return 0;
  try {
    const provider = getConfiguredProvider(ws.seoDataProvider);
    if (!provider) return 0;
    const overview = await provider.getDomainOverview(ws.liveDomain, workspaceId);
    if (!overview) return 0;
    if (overview.organicKeywords >= 1000) return 80;
    if (overview.organicKeywords >= 100)  return 50;
    return 20;
  } catch { // catch-ok: non-critical — failure degrades to "authority unknown" and the KD classifier treats 0 as unknown
    return 0;
  }
}

// ─── Main Engine ──────────────────────────────────────────────────

export async function generateRecommendations(workspaceId: string): Promise<RecommendationSet> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const now = new Date().toISOString();
  const recs: Recommendation[] = [];
  // Opportunity Value scoring is canonical. Local recommendation minting remains
  // posture-gated so non-local workspaces keep the existing non-local source set.
  const localPosture = getLocalSeoPosture(ws.id);
  const useLocalGenQual = localPosture === LOCAL_SEO_POSTURE.LOCAL || localPosture === LOCAL_SEO_POSTURE.HYBRID;
  const tier = ws.tier || 'free';
  const assignedTo: 'team' | 'client' = tier === 'premium' ? 'team' : 'client';

  // Track categories whose data fetch failed this run so the merge logic can
  // skip auto-resolving existing recs in those categories. Without this guard,
  // a transient provider/store failure would silently mark every rec in the
  // affected category as "completed" — the recurring "auto-resolved too
  // eagerly" reviewer flag. Adding a category here requires the corresponding
  // try/catch below to call `failedCategories.add(...)` on the catch path.
  const failedCategories = new Set<RecSourceCategory>();

  // ── Fetch data sources ──
  const audit: AuditSnapshot | null = ws.webflowSiteId ? getLatestSnapshot(ws.webflowSiteId) : null;
  const traffic = await getAuditTrafficForWorkspace(ws);
  const strategy = ws.keywordStrategy;
  const recommendationContext = await buildRecommendationGenerationContext(workspaceId, {
    // `clientSignals` carries the authority-resolved `effectiveBusinessPriorities`
    // (client store + admin store reconciled — see business-priorities-source.ts).
    // We consume it through the shared builder rather than a hand-rolled read so
    // intent stays sourced from the one blessed representation (CLAUDE.md
    // "AI/recommendation generation consumers must use shared intelligence context builders").
    slices: ['seoContext', 'clientSignals'],
    verbosity: 'standard',
    tokenBudget: 800,
    enrichWithBacklinks: true,
  }).catch(err => {
    log.warn({ err, workspaceId }, 'Recommendation context unavailable — continuing without backlinks and business-priority tie-breakers');
    return null;
  });
  const backlinkProfile = recommendationContext?.intelligence.seoContext?.backlinkProfile;
  // Resolved business priorities (client-entered first, admin-set as supplement).
  // Used only as a within-tier ranking tiebreaker below — never to change tiers.
  const effectiveBusinessPriorities = recommendationContext?.intelligence.clientSignals?.effectiveBusinessPriorities ?? [];

  // Fetch domain strength once per rec-gen cycle (cached at provider layer; see resolveDomainStrength).
  // It now feeds recommendation copy/context only (KD notes / authority framing), while
  // the canonical score itself comes solely from computeOpportunityValue().
  const domainStrength = await resolveDomainStrength(ws, workspaceId);

  // ── PR5 · Spine C — self-calibrating OV inputs (OV path ONLY, dark/shadow). ──
  // Resolved ONCE per rec-gen cycle and threaded into every computeOpportunityValue
  // call so the attached `opportunity` object uses better, self-correcting signals:
  //   • ovAuthority   — REAL referring-domains authority (not the organic-keyword proxy)
  //   • ovCalibration — per-workspace realized-$ multiplier (1.0 identity until enabled+outcomes)
  //   • ovWeights     — per-workspace calibrated display weights (platform defaults today)
  // None of these touch the legacy impactScore; they only improve the shadow OV value.
  const ovWeights = getOrCreateWorkspaceWeights(workspaceId);
  const ovCalibration = computeOvCalibration(workspaceId);
  // Reuse the backlinkProfile already resolved above via the cached/rate-limited
  // intelligence SEO-context path (enrichWithBacklinks) — no duplicate API call.
  const ovAuthority = resolveOvAuthorityStrength(workspaceId, backlinkProfile);

  // ── PR7 · Spine B — decaying Timing boosts (OV path). ──
  // Resolved ONCE per rec-gen cycle: Map<pageSlug, decaying boost> aggregated from the
  // active opportunity-event ledger. When the ledger is empty this is an EMPTY map
  // → maxBoostForPages() is 0 → timingBoost 0 → timing multiplier 1.
  const nowDate = new Date(now);
  const timingBoosts = computeTimingBoosts(workspaceId, nowDate);

  // Build a per-workspace position→CTR curve once from the workspace's own GSC
  // observations (the `gscKeywords` persisted on page_keywords). Falls back to the
  // documented industry curve when there is too little signal. Best-effort: only
  // feeds the Opportunity Value scorer (shadow until the flag flips); a failure
  // degrades to the industry fallback and never blocks rec generation.
  let ovCtrCurve: Record<number, number> | null = null;
  try {
    const gscObservations: GscKeywordObservation[] = [];
    for (const pk of listPageKeywords(workspaceId)) {
      if (!pk.gscKeywords) continue;
      for (const g of pk.gscKeywords) gscObservations.push(g);
    }
    ovCtrCurve = buildCtrCurve(gscObservations).curve;
  } catch (err) {
    log.warn({ err, workspaceId }, 'CTR curve build failed for Opportunity Value — using industry fallback');
  }

  // Build conversion rate map: slug → conversionRate (%)
  // pageId for conversion_attribution insights is the landing page URL (e.g. "/plumbing")
  const conversionMap = new Map<string, number>();
  try {
    for (const insight of getInsights(workspaceId, 'conversion_attribution')) {
      const data = insight.data as ConversionAttributionData;
      if (data?.conversionRate != null && insight.pageId) {
        const slug = toPageSlug(insight.pageId);
        conversionMap.set(slug, data.conversionRate);
      }
    }
  } catch (err) {
    log.warn({ err }, 'Conversion attribution insights unavailable — skipping CVR boost');
  }

  // Compute max traffic score for normalization
  let maxTrafficScore = 1;
  if (audit) {
    for (const page of audit.audit.pages) {
      const ts = getTrafficScore(traffic, page.slug, conversionMap.get(page.slug));
      if (ts > maxTrafficScore) maxTrafficScore = ts;
    }
  }

  // ── 1. Audit-based recommendations ──
  if (audit) {
    // Group issues by check type across pages
    const issueGroups: Map<string, {
      check: string;
      severity: 'error' | 'warning' | 'info';
      category?: string;
      pages: { slug: string; pageTitle: string; message: string; recommendation: string }[];
      totalTrafficScore: number;
      totalClicks: number;
      totalImpressions: number;
    }> = new Map();

    for (const page of audit.audit.pages) {
      for (const issue of page.issues) {
        const key = issue.check;
        if (!issueGroups.has(key)) {
          issueGroups.set(key, {
            check: issue.check,
            severity: issue.severity,
            category: issue.category,
            pages: [] as { slug: string; pageTitle: string; message: string; recommendation: string }[],
            totalTrafficScore: 0,
            totalClicks: 0,
            totalImpressions: 0,
          });
        }
        const group = issueGroups.get(key)!;
        const ts = getTrafficScore(traffic, page.slug, conversionMap.get(page.slug));
        const t = getTrafficForSlug(traffic, page.slug);
        group.pages.push({ slug: page.slug, pageTitle: page.slug, message: issue.message, recommendation: issue.recommendation });
        group.totalTrafficScore += ts;
        group.totalClicks += t.clicks;
        group.totalImpressions += t.impressions;
      }
    }

    // Create one recommendation per issue group
    for (const [, group] of issueGroups) {
      const isCrit = isCriticalCheck(group.check);
      const recType = checkToRecType(group.check, group.category);
      const product = mapToProduct(recType, group.pages.length);

      // Sort affected pages by traffic (highest first)
      const sortedPages = group.pages
        .map(p => ({ ...p, ts: getTrafficScore(traffic, p.slug, conversionMap.get(p.slug)) }))
        .sort((a, b) => b.ts - a.ts);

      const impact: 'high' | 'medium' | 'low' =
        group.severity === 'error' ? 'high' : group.severity === 'warning' ? 'medium' : 'low';
      const effort: 'low' | 'medium' | 'high' =
        recType === 'metadata' || recType === 'accessibility' ? 'low'
        : recType === 'schema' ? 'medium'
        : 'medium';

      const rate = getRecoveryRate(group.check);
      const estimatedGain =
        group.totalClicks > 0
          ? `Fixing this could increase organic clicks by ${rate.perRec} on ${group.pages.length} affected page${group.pages.length !== 1 ? 's' : ''}`
          : `Improves SEO health score and search engine compatibility across ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`;

      const source = RecSource.audit(group.check);
      const opportunity = computeOpportunityValue({
        branch: 'technical',
        severity: group.severity,
        isCritical: isCrit,
        currentClicks: group.totalClicks,
        authorityStrength: ovAuthority ?? null,
        timingBoost: maxBoostForPages(timingBoosts, sortedPages.map(p => p.slug)),
      }, { calibration: ovCalibration, weights: ovWeights });
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: recType,
        title: `${group.check.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`,
        description: sortedPages[0].recommendation,
        insight: auditInsight(group.check, group.severity, group.pages.length, group.totalClicks, sortedPages.map(p => p.slug)),
        impact,
        effort,
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: sortedPages.map(p => p.slug),
        trafficAtRisk: group.totalClicks,
        impressionsAtRisk: group.totalImpressions,
        estimatedGain,
        actionType: product.productType ? 'purchase' : 'manual',
        productType: product.productType,
        productPrice: product.productPrice,
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Site-wide issues as individual recommendations
    for (const issue of audit.audit.siteWideIssues) {
      const isCrit = isCriticalCheck(issue.check);

      const pages = issue.affectedPages || [];
      const pageTraffic = pages.reduce((sum, slug) => {
        const t = getTrafficForSlug(traffic, slug.replace(/^\//, ''));
        return sum + t.clicks;
      }, 0);
      const pageImpressions = pages.reduce((sum, slug) => {
        const t = getTrafficForSlug(traffic, slug.replace(/^\//, ''));
        return sum + t.impressions;
      }, 0);

      const estimatedGain = pages.length > 0
        ? `Affects ${pages.length} page${pages.length !== 1 ? 's' : ''} on the site`
        : 'Affects the entire site';

      const source = RecSource.auditSiteWide(issue.check);
      const opportunity = computeOpportunityValue({
        branch: 'technical',
        severity: isCrit ? 'error' : 'warning',
        isCritical: isCrit,
        currentClicks: pageTraffic,
        authorityStrength: ovAuthority ?? null,
        timingBoost: maxBoostForPages(timingBoosts, pages.map(p => p.replace(/^\//, ''))),
      }, { calibration: ovCalibration, weights: ovWeights });
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'technical',
        title: `Site-Wide: ${issue.check.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
        description: issue.recommendation,
        insight: issue.message,
        impact: isCrit ? 'high' : 'medium',
        effort: 'low',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: pages.map(p => p.replace(/^\//, '')),
        trafficAtRisk: pageTraffic,
        impressionsAtRisk: pageImpressions,
        estimatedGain,
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // ── 2. Strategy-based recommendations ──
  // Load declined keywords so we can skip suggestions the client has rejected (2C)
  const declinedKeywords = new Set(
    getDeclinedKeywords(workspaceId).map(k => keywordComparisonKey(k)).filter(Boolean)
  );

  if (strategy) {
    // Quick wins → fix_now or fix_soon (table-only; blob field stripped on every write + boot-migrated out)
    const quickWins = listQuickWins(workspaceId);
    if (quickWins.length > 0) {
      for (const qw of quickWins) {
        // 2C: skip if the current keyword was declined
        if (qw.currentKeyword && declinedKeywords.has(keywordComparisonKey(qw.currentKeyword))) continue;

        const t = getTrafficForSlug(traffic, qw.pagePath.replace(/^\//, ''));
        // 2E: demote zero-traffic quick wins — fixing meta on unvisited pages is not a "quick win"
        const hasTraffic = t.clicks > 0 || t.impressions > 0;
        const priority: RecPriority = !hasTraffic
          ? 'fix_later'
          : qw.estimatedImpact === 'high' ? 'fix_now' : 'fix_soon';
        const source = RecSource.strategyQuickWin();
        const opportunity = computeOpportunityValue({
          branch: 'quick_win',
          roiScore: qw.roiScore ?? null,
          llmLabel: qw.estimatedImpact,
          authorityStrength: ovAuthority ?? null,
          timingBoost: maxBoostForPages(timingBoosts, [qw.pagePath.replace(/^\//, '')]),
        }, { calibration: ovCalibration, weights: ovWeights });
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: hasTraffic ? scoring.priority : priority,
          type: 'strategy',
          title: `Quick Win: ${qw.action}`,
          description: qw.rationale,
          insight: strategyInsight('quick_win', qw),
          impact: qw.estimatedImpact as 'high' | 'medium' | 'low',
          effort: 'low',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [qw.pagePath.replace(/^\//, '')],
          trafficAtRisk: t.clicks,
          impressionsAtRisk: t.impressions,
          estimatedGain: `${qw.estimatedImpact} impact potential based on current traffic and keyword position`,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Content gaps → ongoing
    // Sourced from the content_gaps table (post-#365 normalization), not the
    // strategy blob — the blob no longer carries contentGaps after generation.
    const strategyContentGaps = listContentGaps(workspaceId);
    if (strategyContentGaps.length > 0) {
      for (const cg of strategyContentGaps) {
        // 2C: skip if the target keyword was declined by the client
        if (cg.targetKeyword && declinedKeywords.has(keywordComparisonKey(cg.targetKeyword))) continue;

        // Use `!= null` (not truthy) so difficulty=0 (trivial keyword) is classified as
        // "within-reach" by kdClassificationNote.
        const kdNote = cg.difficulty != null ? kdClassificationNote(cg.difficulty, domainStrength) : '';
        const authorityAssessment = assessAuthorityFromBacklinks(cg.difficulty ?? null, backlinkProfile);
        const story = buildRecommendationStory('content_gap', {
          topic: cg.topic,
          targetKeyword: cg.targetKeyword,
          rationale: cg.rationale,
          suggestedPageType: cg.suggestedPageType,
          intent: cg.intent,
          kdNote,
          authorityContext: authorityAssessment.note,
        });
        const source = RecSource.strategyContentGap();
        const opportunity = computeOpportunityValue({
          branch: 'content_gap',
          opportunityScore: cg.opportunityScore ?? null,
          volume: cg.volume ?? null,
          difficulty: cg.difficulty ?? null,
          trendDirection: cg.trendDirection ?? null,
          llmLabel: cg.priority,
          intent: cg.intent ?? null,
          authorityStrength: ovAuthority ?? null,
          ctrCurve: ovCtrCurve,
          timingBoost: maxBoostForPages(timingBoosts, []),
        }, { calibration: ovCalibration, weights: ovWeights });
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: 'content',
          title: story.title,
          description: story.description,
          insight: story.insight,
          impact: cg.priority as 'high' | 'medium' | 'low',
          effort: 'high',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: story.estimatedGain,
          actionType: 'content_creation',
          status: 'pending',
          assignedTo,
          // Carry the gap's deterministic-backfill provenance onto the rec (only when
          // true, so flag-OFF recs are byte-identical) — lets the headline count / email
          // exclude marginal backfill without a fragile rec→gap key remap.
          ...(cg.backfilled ? { backfilled: true as const } : {}),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Pages with ranking opportunities (from page_keywords table — pageMap is stripped
    // from the strategy blob before saving, so always read from the dedicated table).
    const pageKeywords = listPageKeywords(workspaceId);
    if (pageKeywords.length > 0) {
      for (const pm of pageKeywords) {
        // 2C: skip if the primary keyword was declined
        if (pm.primaryKeyword && declinedKeywords.has(keywordComparisonKey(pm.primaryKeyword))) continue;

        if (pm.currentPosition && pm.currentPosition > 3 && pm.currentPosition <= 20 && pm.impressions && pm.impressions > 100) {
          // Page ranking 4-20 with decent impressions — opportunity to push up
          const authorityAssessment = assessAuthorityFromBacklinks(pm.difficulty ?? null, backlinkProfile);
          const story = buildRecommendationStory('ranking_opportunity', {
            keyword: pm.primaryKeyword,
            pagePath: pm.pagePath,
            currentPosition: pm.currentPosition,
            impressions: pm.impressions,
            authorityContext: authorityAssessment.note,
          });
          const source = RecSource.strategyRankingOpp();
          const opportunity = computeOpportunityValue({
            branch: 'ranking_opp',
            volume: pm.volume ?? null,
            currentPosition: pm.currentPosition ?? null,
            difficulty: pm.difficulty ?? null,
            impressions: pm.impressions ?? null,
            cpc: pm.cpc ?? null,
            intent: toOpportunityIntent(pm.searchIntent),
            authorityStrength: ovAuthority ?? null,
            ctrCurve: ovCtrCurve,
            timingBoost: maxBoostForPages(timingBoosts, [pm.pagePath.replace(/^\//, '')]),
          }, { calibration: ovCalibration, weights: ovWeights });
          const scoring = deriveCanonicalRecommendationFields(source, opportunity);
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: scoring.priority,
            type: 'strategy',
            title: story.title,
            description: story.description,
            insight: story.insight,
            impact: pm.currentPosition <= 10 ? 'high' : 'medium',
            effort: 'medium',
            impactScore: scoring.impactScore,
            opportunity,
            source,
            affectedPages: [pm.pagePath.replace(/^\//, '')],
            trafficAtRisk: pm.clicks || 0,
            impressionsAtRisk: pm.impressions || 0,
            estimatedGain: story.estimatedGain,
            actionType: 'manual',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    // ── Intent mismatch detection ──────────────────────────────────────────────
    // Intentionally nested inside `if (strategy)`: intent mismatches are only
    // meaningful when the workspace has a keyword strategy that has populated
    // `page_keywords` with `searchIntent`. Without a strategy, `pageKeywords`
    // is empty and the loop is a no-op — but keeping this inside the strategy
    // guard documents the dependency and avoids recurring reviewer flags.
    const intentPageKws = pageKeywords;
    let intentMismatchCount = 0;
    for (const pk of intentPageKws) {
      if (intentMismatchCount >= 10) break;
      if (!pk.searchIntent) continue;
      const pageType = inferPageType(pk.pagePath);
      const { mismatch, reason } = isIntentMismatch(pageType, pk.searchIntent);
      if (!mismatch) continue;
      intentMismatchCount++;
      const pageSlug = toPageSlug(pk.pagePath);
      const source = RecSource.strategyIntentMismatch(pageSlug);
      const opportunity = computeOpportunityValue({
        branch: 'ranking_opp',
        volume: pk.volume ?? null,
        currentPosition: pk.currentPosition ?? null,
        difficulty: pk.difficulty ?? null,
        impressions: pk.impressions ?? null,
        cpc: pk.cpc ?? null,
        intent: toOpportunityIntent(pk.searchIntent),
        authorityStrength: ovAuthority ?? null,
        ctrCurve: ovCtrCurve,
        timingBoost: maxBoostForPages(timingBoosts, [pageSlug]),
      }, { calibration: ovCalibration, weights: ovWeights });
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'strategy',
        title: `Intent Mismatch: /${pageSlug} (${pageType} page targeting ${pk.searchIntent} keyword)`,
        description: reason,
        insight: `Pages rank better when page type matches search intent. ${reason}`,
        impact: 'medium',
        effort: 'medium',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [pageSlug],
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: 'Aligning page type with intent typically improves CTR and conversion rate',
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ── 2b. First-class orphan-subsystem recs. ──
    // keyword_gaps / topic_clusters / cannibalization_issues are normalized tables that
    // until recently only surfaced in the intelligence slice + strategy UI, never as recs.
    // They are now canonical recommendation producers. Each orphan read is in its OWN try/catch
    // calling failedCategories.add(<category>) on catch — a transient empty read must NOT
    // drop the source from newSources and falsely bulk-auto-resolve prior recs (FM-2/G2).
      // keyword_gap → ranking_opp branch (competitor outranks us; close the gap).
      try {
        const keywordGaps = listKeywordGaps(workspaceId).slice(0, 10);
        for (const kg of keywordGaps) {
          if (declinedKeywords.has(keywordComparisonKey(kg.keyword))) continue;
          const source = RecSource.keywordGap(kg.keyword);
          const opportunity = computeOpportunityValue({
            branch: 'ranking_opp',
            volume: kg.volume,
            difficulty: kg.difficulty,
            currentPosition: kg.competitorPosition,
            authorityStrength: ovAuthority ?? null,
            ctrCurve: ovCtrCurve,
            timingBoost: maxBoostForPages(timingBoosts, []),
          }, { calibration: ovCalibration, weights: ovWeights });
          const scoring = deriveCanonicalRecommendationFields(source, opportunity);
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: scoring.priority,
            type: 'keyword_gap',
            title: `Keyword Gap: "${kg.keyword}"`,
            description: `${kg.competitorDomain} ranks #${kg.competitorPosition} for "${kg.keyword}" (volume ${kg.volume.toLocaleString()}, difficulty ${kg.difficulty}) — you don't. Targeting this term captures demand a competitor already owns.`,
            insight: `Competitors ranking for high-demand keywords you ignore is lost organic traffic. Building content or optimizing a page for "${kg.keyword}" lets you compete for a term with proven search demand.`,
            impact: kg.volume > 1000 ? 'high' : kg.volume > 200 ? 'medium' : 'low',
            effort: 'high',
            impactScore: scoring.impactScore,
            opportunity,
            source,
            affectedPages: [],
            trafficAtRisk: 0,
            impressionsAtRisk: 0,
            estimatedGain: `Capturing "${kg.keyword}" targets a term with ${kg.volume.toLocaleString()} monthly searches a competitor already ranks for`,
            actionType: 'content_creation',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (err) {
        failedCategories.add('keyword_gap');
        log.warn({ err, workspaceId }, 'Keyword gaps unavailable for recommendations');
      }

      // topic_cluster → content_gap branch. listTopicClusters is coverage-ASC sorted, so
      // clusters[0] is the WEAKEST cluster. Mint exactly ONE cluster-head rec (the weakest
      // gap), NOT one per cluster — a single high-leverage "fill this cluster" directive.
      try {
        const clusters = listTopicClusters(workspaceId);
        const cluster = clusters[0];
        if (cluster) {
          const opportunityScore = Math.max(0, Math.min(100, 100 - cluster.coveragePercent));
          const source = RecSource.topicCluster(cluster.topic);
          const opportunity = computeOpportunityValue({
            branch: 'content_gap',
            opportunityScore,
            authorityStrength: ovAuthority ?? null,
            ctrCurve: ovCtrCurve,
            timingBoost: maxBoostForPages(timingBoosts, []),
          }, { calibration: ovCalibration, weights: ovWeights });
          const scoring = deriveCanonicalRecommendationFields(source, opportunity);
          const gapPreview = cluster.gap.slice(0, 5).join(', ');
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: scoring.priority,
            type: 'topic_cluster',
            title: `Build Topical Authority: "${cluster.topic}"`,
            description: `You cover ${Math.round(cluster.coveragePercent)}% of the "${cluster.topic}" cluster (${cluster.ownedCount}/${cluster.totalCount} keywords). Filling the gaps${gapPreview ? ` (${gapPreview})` : ''} builds the topical depth search engines reward.`,
            insight: `Topical authority compounds — covering a cluster comprehensively signals expertise and lifts every page in it. "${cluster.topic}" is your weakest cluster, so it has the most room to grow.`,
            impact: opportunityScore > 60 ? 'high' : opportunityScore > 30 ? 'medium' : 'low',
            effort: 'high',
            impactScore: scoring.impactScore,
            opportunity,
            source,
            affectedPages: [],
            trafficAtRisk: 0,
            impressionsAtRisk: 0,
            estimatedGain: `Filling the "${cluster.topic}" cluster (currently ${Math.round(cluster.coveragePercent)}% covered) builds topical authority across related pages`,
            actionType: 'content_creation',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (err) {
        failedCategories.add('topic_cluster');
        log.warn({ err, workspaceId }, 'Topic clusters unavailable for recommendations');
      }

      // cannibalization → technical branch. Cannibalization is ALSO an InsightType, so we
      // dedupe-vs-insight: an ACTIVE (unresolved) cannibalization insight covering the same
      // URL set already surfaces the issue — we cross-link rather than mint a duplicate rec.
      try {
        const issues = listCannibalizationIssues(workspaceId);
        // Build the set of URL-set keys already covered by an active cannibalization insight.
        const insightUrlSets = new Set<string>();
        try {
          for (const ins of getInsights(workspaceId, 'cannibalization')) {
            if (ins.resolutionStatus === 'resolved') continue;
            const data = ins.data as import('../shared/types/analytics.js').CannibalizationData;
            const pages = Array.isArray(data?.pages) ? data.pages : [];
            if (pages.length > 0) insightUrlSets.add(cannibalizationUrlSetKey(pages));
          }
        } catch (err) {
          // Insight read failure → degrade to "no insight coverage" (mint recs). This is the
          // safe direction: a missed dedupe shows a (linkable) duplicate; a false dedupe would
          // hide a real issue.
          log.debug({ err, workspaceId }, 'Cannibalization insight dedupe unavailable — minting recs without cross-link');
        }
        for (const item of issues) {
          const urlSetKey = cannibalizationUrlSetKey(item.pages.map(p => p.path));
          // Skip minting if an active insight already covers the same URL set (cross-link instead).
          // C1: the issue STILL EXISTS (it's in cannibalization_issues) — it merely migrated to the
          // insight surface. Adding 'cannibalization' to failedCategories protects the category from
          // the auto-resolve loop this run (same transient-read semantics as the FM-2 catch paths), so
          // a prior cannibalization:<key> rec for this URL set is carried forward (stays pending) and
          // its pages are NOT falsely flipped to `live`. Only runs where a dedupe-skip actually
          // occurs are protected; runs with no insight-covered issue auto-resolve genuinely-fixed
          // recs normally (a fixed issue lingers at most one extra cycle — errs safe).
          if (insightUrlSets.has(urlSetKey)) {
            failedCategories.add('cannibalization');
            continue;
          }
          const severity: 'error' | 'warning' | 'info' =
            item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warning' : 'info';
          const currentClicks = item.pages.reduce((sum, p) => sum + (p.clicks ?? 0), 0);
          const source = RecSource.cannibalization(urlSetKey);
          const opportunity = computeOpportunityValue({
            branch: 'technical',
            severity,
            currentClicks,
            authorityStrength: ovAuthority ?? null,
            ctrCurve: ovCtrCurve,
            timingBoost: maxBoostForPages(timingBoosts, item.pages.map(p => toPageSlug(p.path))),
          }, { calibration: ovCalibration, weights: ovWeights });
          const scoring = deriveCanonicalRecommendationFields(source, opportunity);
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: scoring.priority,
            type: 'cannibalization',
            title: `Keyword Cannibalization: "${item.keyword}"`,
            description: `${item.pages.length} pages compete for "${item.keyword}", splitting ranking signals. ${item.recommendation}`,
            insight: `When multiple pages target the same keyword, search engines struggle to pick a winner — diluting authority and capping rankings. Consolidating to one canonical page recovers the combined strength.`,
            impact: item.severity === 'high' ? 'high' : item.severity === 'medium' ? 'medium' : 'low',
            effort: 'medium',
            impactScore: scoring.impactScore,
            opportunity,
            source,
            affectedPages: item.pages.map(p => p.path),
            trafficAtRisk: currentClicks,
            impressionsAtRisk: item.pages.reduce((sum, p) => sum + (p.impressions ?? 0), 0),
            estimatedGain: `Consolidating ${item.pages.length} competing pages for "${item.keyword}" recovers split ranking signals`,
            actionType: 'manual',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (err) {
        failedCategories.add('cannibalization');
        log.warn({ err, workspaceId }, 'Cannibalization issues unavailable for recommendations');
      }
  }

  // ── 2c. First-class local-visibility recs (posture-gated). ──
  // Minted only when the canonical local-SEO posture gate is on. When OFF
  // (non-local posture) this whole block is skipped → zero local recs/sources, so
  // the merge/auto-resolve loop below sees the non-local source set.
  // NOT nested in `if (audit)` — local visibility is provider-snapshot-sourced, independent of the
  // Webflow audit. Each reader is in its OWN try/catch calling failedCategories.add(<category>)
  // on catch — a transient empty/throwing read must NOT drop the source from newSources and
  // falsely bulk-auto-resolve prior local recs (FM-2). The local OV term (localVisibilitySignal)
  // is fed ONLY from inside these branches — the scorer never reads local state itself.
  if (useLocalGenQual) {
    // Read the admin LocalSeoVisibilityPanel's read-model ONCE for dedupe-vs-panel. The panel
    // renders `competitorBrands` + `serviceGaps`; when it is actively surfacing an item to the
    // admin we cross-link rather than mint a duplicate client rec. A panel read failure degrades
    // to "no panel coverage" (mint recs) — the safe direction (a missed dedupe shows a linkable
    // duplicate; a false dedupe would hide a real opportunity).
    let panelServiceGapIds = new Set<string>();
    let panelCompetitorTitles = new Set<string>();
    let panelActive = false;
    try {
      const panel = getLocalSeoReadModel(ws.id, true);
      // The panel renders competitor brands + service gaps only in an active-data report state
      // (has_data / ready_no_data) — matching LocalSeoVisibilityPanel's render predicate. When the
      // panel is dark (needs_market / non_local / feature_disabled) the local recs are the only
      // surface, so we do NOT dedupe.
      panelActive = panel?.report.setupState === 'has_data' || panel?.report.setupState === 'ready_no_data';
      if (panelActive && panel) {
        panelServiceGapIds = new Set(panel.serviceGaps.map(g => g.serviceId));
        panelCompetitorTitles = new Set(panel.competitorBrands.map(c => c.title.toLowerCase().trim()));
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'Local SEO panel read-model unavailable for dedupe — minting local recs without cross-link');
    }

    // Build a volume map from the tracked-keyword pool so B1 can synthesize OV from a service's
    // starterKeywords when one is already tracked with provider volume; else it falls back like
    // P5's topic_cluster (composite-only, no provider volume).
    const localVolumeByKeyword = new Map<string, number>();
    try {
      for (const k of getTrackedKeywords(workspaceId)) {
        if (typeof k.volume === 'number' && k.volume > 0) {
          localVolumeByKeyword.set(keywordComparisonKey(k.query), k.volume);
        }
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'Tracked keyword pool unavailable for local OV synthesis — using composite fallback');
    }

    // ── B1. Local service gap → local_service_gap rec. ──
    // A service in the workspace's industry taxonomy has no active tracking keyword. There is no
    // native volume, so we synthesize OV: look the starterKeywords up in the tracked pool for
    // real volume (content_gap-grade demand), else fall back to a grounded composite proxy like
    // topic_cluster (opportunityScore-only).
    try {
      const serviceGaps = getLocalSeoServiceGaps(workspaceId);
      const activeMarkets = listLocalSeoMarkets(workspaceId).filter(m => m.status === 'active');
      const primaryMarketLabel = (activeMarkets[0] ?? listLocalSeoMarkets(workspaceId)[0])?.label;
      const marketPhrase = primaryMarketLabel ? `in ${primaryMarketLabel}` : 'in your market';
      for (const gap of serviceGaps) {
        // Dedupe-vs-panel: the setup drawer already nudges this service gap to the admin.
        // Adding the whole category to failedCategories on a successful dedupe-skip intentionally
        // protects EVERY local_service_gap rec from auto-resolve this run (the FM-2 safe direction,
        // mirroring P5 cannibalization) — a genuinely-resolved sibling lingers at most one extra
        // cycle, which is safe; the alternative (false auto-resolve) is not.
        if (panelActive && panelServiceGapIds.has(gap.serviceId)) {
          failedCategories.add('local_service_gap');
          continue;
        }
        // This starterKeyword→tracked-pool volume lookup rarely yields a positive volume: gap
        // services by definition have no tracked queries, so their starterKeywords are almost
        // never already in the tracked pool. The `opportunityScore:60` composite fallback below
        // normally drives B1's OV — don't treat this volume branch as load-bearing.
        const pooledVolume = gap.starterKeywords
          .map(kw => localVolumeByKeyword.get(keywordComparisonKey(kw)) ?? 0)
          .reduce((max, v) => Math.max(max, v), 0);
        const opportunityScore = 60; // grounded composite proxy for an untargeted local service
        const source = RecSource.localServiceGap(gap.serviceId);
        const opportunity = computeOpportunityValue({
          branch: 'local',
          volume: pooledVolume > 0 ? pooledVolume : null,
          opportunityScore: pooledVolume > 0 ? null : opportunityScore,
          intent: 'commercial',
          authorityStrength: ovAuthority ?? null,
          ctrCurve: ovCtrCurve,
          timingBoost: maxBoostForPages(timingBoosts, []),
        }, { calibration: ovCalibration, weights: ovWeights });
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        const starterPreview = gap.starterKeywords.slice(0, 3).join(', ');
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: 'local_service_gap',
          title: `You're not targeting ${gap.serviceLabel} ${marketPhrase}`,
          description: `You're not targeting ${gap.serviceLabel} locally yet — you have no tracking keywords for it. A focused page plus local-intent terms${starterPreview ? ` (e.g. ${starterPreview})` : ''} captures local demand you're currently missing.`,
          insight: `Local customers search by service and city. When you don't target a service you actually offer, competitors capture those local searches by default. Claiming ${gap.serviceLabel} ${marketPhrase} puts you in front of ready-to-buy local intent.`,
          impact: pooledVolume > 200 ? 'high' : 'medium',
          effort: 'medium',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: `Targeting ${gap.serviceLabel} ${marketPhrase} opens up local searches you currently capture none of`,
          actionType: 'content_creation',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (err) {
      failedCategories.add('local_service_gap');
      log.warn({ err, workspaceId }, 'Local service gaps unavailable for recommendations');
    }

    // ── B2. Competitor brand → local_visibility rec. ──
    // A competitor repeatedly appears in the local pack for markets where the client is ABSENT
    // (winsAgainstClient = pack appeared, client not found — the ranking signal). Surface the
    // worst offender so the client knows who is eating their local share.
    try {
      const competitors = getLocalSeoCompetitorBrands(ws.id);
      for (const comp of competitors) {
        if (comp.winsAgainstClient <= 0) continue; // only those that beat the client in the pack
        const marketKey = keywordComparisonKey(comp.title);
        // Dedupe-vs-panel: the RepeatCompetitorList already surfaces this brand to the admin.
        // Adding the whole category to failedCategories on a successful dedupe-skip intentionally
        // protects EVERY local_visibility rec from auto-resolve this run (the FM-2 safe direction,
        // mirroring P5 cannibalization) — a genuinely-resolved sibling lingers at most one extra
        // cycle, which is safe; the alternative (false auto-resolve) is not.
        if (panelActive && panelCompetitorTitles.has(comp.title.toLowerCase().trim())) {
          failedCategories.add('local_visibility');
          continue;
        }
        const marketList = comp.markets.slice(0, 3).join(', ');
        const source = RecSource.localVisibility(marketKey);
        const opportunity = computeOpportunityValue({
          branch: 'local',
          intent: 'transactional',
          localVisibilitySignal: Math.min(1, comp.winsAgainstClient / 5),
          authorityStrength: ovAuthority ?? null,
          ctrCurve: ovCtrCurve,
          timingBoost: maxBoostForPages(timingBoosts, []),
        }, { calibration: ovCalibration, weights: ovWeights });
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: 'local_visibility',
          title: `${comp.title} keeps winning the local pack you're absent from`,
          description: `${comp.title} appeared in the local pack ${comp.totalAppearances} time${comp.totalAppearances === 1 ? '' : 's'}${marketList ? ` across ${marketList}` : ''}, and in ${comp.winsAgainstClient} of those your business wasn't showing at all. Each time, that local customer saw them instead of you.`,
          insight: `When a competitor consistently shows in the local pack and you don't, you're invisible for exactly the searches that drive local calls and visits. Getting into the pack for these markets is the highest-leverage local move you can make.`,
          impact: comp.winsAgainstClient > 3 ? 'high' : 'medium',
          effort: 'high',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: `Appearing in the local pack where ${comp.title} currently wins puts you in front of nearby ready-to-act customers`,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (err) {
      failedCategories.add('local_visibility');
      log.warn({ err, workspaceId }, 'Local competitor brands unavailable for recommendations');
    }

    // ── B3. Not-visible / local-pack-present / possible-match local pack → local_visibility rec. ──
    // For each checked local-intent keyword whose derived posture is not_visible, local_pack_present,
    // or possible_match in a market, the client isn't (confidently) in the pack. Mint one rec per
    // market+keyword. Keyed on the market id so status carries over and one market's fix doesn't
    // auto-resolve another.
    //
    // The three not-visible-class postures (see `postureFromSummaryRow` / `localSeoKeywordVisibilityFromSnapshot`):
    //   - NOT_VISIBLE        — no pack and no match (or a pack we couldn't confirm).
    //   - LOCAL_PACK_PRESENT — a pack DEFINITELY showed and the business was not even a possible match.
    //                          This is the STRONGEST "absent from a present pack" signal, so it takes
    //                          the strong/not-visible copy variant (possible=false), NOT the softer
    //                          possible-match one. The report's `notVisibleCount` and the admin panel's
    //                          "Not Found" StatCard already fold LOCAL_PACK_PRESENT into NOT_VISIBLE
    //                          (server/local-seo.ts:buildLocalSeoReportSummary) — including it here makes
    //                          the B3 rec count reconcile with that panel/report "not found" count.
    //   - POSSIBLE_MATCH     — a maybe-match showed; softer copy variant (possible=true).
    try {
      const summaries = buildLocalSeoKeywordVisibilitySummaryByKey(ws.id);
      for (const summary of summaries.values()) {
        for (const entry of summary.markets) {
          if (
            entry.posture !== LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
            && entry.posture !== LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT
            && entry.posture !== LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH
          ) continue;
          const marketKey = `${entry.marketId}:${entry.normalizedKeyword}`;
          // LOCAL_PACK_PRESENT is a not-visible-class signal → strong (possible=false) variant.
          const possible = entry.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
          const source = RecSource.localVisibility(marketKey);
          const opportunity = computeOpportunityValue({
            branch: 'local',
            intent: 'transactional',
            // A not_visible posture is a present, high-intent local miss → max urgency; a
            // possible_match is partially covered → lower urgency.
            localVisibilitySignal: possible ? 0.4 : 1,
            authorityStrength: ovAuthority ?? null,
            ctrCurve: ovCtrCurve,
            timingBoost: maxBoostForPages(timingBoosts, []),
          }, { calibration: ovCalibration, weights: ovWeights });
          const scoring = deriveCanonicalRecommendationFields(source, opportunity);
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: scoring.priority,
            type: 'local_visibility',
            title: possible
              ? `You might be in the local pack for "${entry.keyword}" in ${entry.marketLabel} — but it's not confirmed`
              : `You're not showing in the local pack for "${entry.keyword}" in ${entry.marketLabel}`,
            description: possible
              ? `A local result that could be your business appeared for "${entry.keyword}" in ${entry.marketLabel}, but the match isn't verified. Confirming and strengthening your local presence here turns a maybe into a reliable local-pack spot.`
              : `When someone in ${entry.marketLabel} searches "${entry.keyword}", a local pack shows — but your business isn't in it. Those are nearby customers actively looking for what you offer, going to competitors instead.`,
            insight: possible
              ? `A "possible match" means the local signals aren't strong enough to be sure it's you. Tightening your local profile, citations, and on-page location signals for ${entry.marketLabel} makes your presence unambiguous.`
              : `The local pack is the top of local search results. Not appearing there for a relevant local term means missing the customers most likely to call or visit. This is a direct, addressable local-visibility gap.`,
            impact: possible ? 'medium' : 'high',
            effort: 'high',
            impactScore: scoring.impactScore,
            opportunity,
            source,
            affectedPages: [],
            trafficAtRisk: 0,
            impressionsAtRisk: 0,
            estimatedGain: possible
              ? `Confirming your local presence for "${entry.keyword}" in ${entry.marketLabel} locks in a local-pack spot`
              : `Getting into the local pack for "${entry.keyword}" in ${entry.marketLabel} reaches nearby customers ready to act`,
            actionType: 'manual',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    } catch (err) {
      failedCategories.add('local_visibility');
      log.warn({ err, workspaceId }, 'Local keyword visibility unavailable for recommendations');
    }
  }

  // ── 3. Content decay recommendations ──
  try {
    const decayAnalysis = loadDecayAnalysis(workspaceId);
    if (decayAnalysis && decayAnalysis.decayingPages.length > 0) {
      // Only create recs for critical and warning pages (skip "watch")
      const actionableDecay = decayAnalysis.decayingPages.filter(p => p.severity === 'critical' || p.severity === 'warning');

      for (const dp of actionableDecay) {
        const pageSlug = toPageSlug(dp.page);

        const product = mapToProduct('content_refresh', 1);
        const story = buildRecommendationStory('content_decay', {
          pagePath: dp.page,
          title: dp.title,
          clickDeclinePct: dp.clickDeclinePct,
          refreshRecommendation: dp.refreshRecommendation,
          severity: dp.severity,
          previousClicks: dp.previousClicks,
          currentClicks: dp.currentClicks,
          previousPosition: dp.previousPosition,
          currentPosition: dp.currentPosition,
        });
        const source = RecSource.decay(pageSlug);
        const opportunity = computeOpportunityValue({
          branch: 'decay',
          previousClicks: dp.previousClicks,
          currentClicks: dp.currentClicks,
          currentPosition: dp.currentPosition,
          isRepeatDecay: dp.isRepeatDecay ?? null,
          authorityStrength: ovAuthority ?? null,
          timingBoost: maxBoostForPages(timingBoosts, [pageSlug]),
        }, { calibration: ovCalibration, weights: ovWeights });
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: 'content_refresh',
          title: story.title,
          description: story.description,
          insight: story.insight,
          impact: dp.severity === 'critical' ? 'high' : 'medium',
          effort: 'medium',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [pageSlug],
          trafficAtRisk: dp.previousClicks,
          impressionsAtRisk: dp.previousImpressions,
          estimatedGain: story.estimatedGain,
          actionType: product.productType ? 'purchase' : 'manual',
          productType: product.productType,
          productPrice: product.productPrice,
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (actionableDecay.length > 0) {
        log.info(`Added ${actionableDecay.length} content refresh recommendations for ${workspaceId}`);
      }
    }
  } catch (err) {
    failedCategories.add('decay');
    log.warn({ err }, 'Content decay data unavailable for recommendations');
  }

  // ── 4. CTR opportunity recommendations ──────────────────────────────────────
  try {
    const ctrInsights = getInsights(workspaceId, 'ctr_opportunity');
    const topCtr = [...ctrInsights]
      .sort((a, b) => {
        const aGap = (a.data as CtrOpportunityData).estimatedClickGap ?? 0;
        const bGap = (b.data as CtrOpportunityData).estimatedClickGap ?? 0;
        return bGap - aGap;
      })
      .slice(0, 10);

    for (const insight of topCtr) {
      const d = insight.data as CtrOpportunityData;
      const pageSlug = toPageSlug(d.pageUrl ?? insight.pageId ?? '');
      const gap = d.estimatedClickGap ?? 0;
      if (gap <= 0) continue;
      const product = mapToProduct('metadata', 1);
      const story = buildRecommendationStory('ctr_opportunity', {
        pageSlug,
        actualCtr: d.actualCtr,
        expectedCtr: d.expectedCtr,
        impressions: d.impressions ?? 0,
        position: d.position ?? 0,
        gap,
      });
      const source = RecSource.ctrOpportunity(pageSlug);
      const opportunity = computeOpportunityValue({
        branch: 'ranking_opp',
        expectedClickGap: d.estimatedClickGap ?? null,
        impressions: d.impressions ?? null,
        currentPosition: d.position ?? null,
        authorityStrength: ovAuthority ?? null,
        ctrCurve: ovCtrCurve,
        timingBoost: maxBoostForPages(timingBoosts, [pageSlug]),
      }, { calibration: ovCalibration, weights: ovWeights });
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'metadata',
        title: story.title,
        description: story.description,
        insight: story.insight,
        impact: gap > 100 ? 'high' : gap > 30 ? 'medium' : 'low',
        effort: 'low',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [pageSlug],
        trafficAtRisk: gap,
        impressionsAtRisk: d.impressions ?? 0,
        estimatedGain: story.estimatedGain,
        actionType: product.productType ? 'purchase' : 'manual',
        productType: product.productType,
        productPrice: product.productPrice,
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    failedCategories.add('insight:ctr_opportunity');
    log.warn({ err }, 'CTR opportunity insights unavailable for recommendations');
  }

  // ── 5. Diagnostic remediation recommendations ───────────────────────────────
  try {
    const reports = listDiagnosticReports(workspaceId);
    const completedReports = reports
      .filter(r => r.status === 'completed' && r.remediationActions?.length > 0)
      .slice(0, 3);

    for (const report of completedReports) {
      for (let actionIdx = 0; actionIdx < Math.min(report.remediationActions.length, 5); actionIdx++) {
        const action = report.remediationActions[actionIdx];
        const recType: RecType = action.owner === 'content' ? 'content' : 'technical';
        const source = RecSource.diagnostic(report.id, actionIdx, action.title);
        const opportunity = computeOpportunityValue({
          branch: 'diagnostic',
          llmLabel: action.impact,
          authorityStrength: ovAuthority ?? null,
          timingBoost: maxBoostForPages(timingBoosts, action.pageUrls?.map(toPageSlug) ?? []),
        }, { calibration: ovCalibration, weights: ovWeights });
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: recType,
          title: `Diagnostic: ${action.title}`,
          description: action.description,
          insight: `Identified by deep diagnostic investigation (report ${report.id.slice(0, 8)}). ${action.description}`,
          impact: action.impact,
          effort: action.effort,
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: action.pageUrls?.map(toPageSlug) ?? [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: `Diagnostic-identified fix (${action.priority} priority, ${action.effort} effort)`,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  } catch (err) {
    failedCategories.add('diagnostic');
    log.warn({ err }, 'Diagnostic reports unavailable for recommendations');
  }

  // ── 6. Content freshness recommendations ────────────────────────────────────
  // Must run BEFORE the merge block so status carry-over, auto-resolution,
  // and deduplication apply equally to freshness recs.
  try {
    const freshnessInsights = getInsights(workspaceId, 'freshness_alert') as Array<import('../shared/types/analytics.js').AnalyticsInsight<'freshness_alert'>>;
    const topFreshness = [...freshnessInsights]
      .sort((a, b) => b.data.daysSinceLastAnalysis - a.data.daysSinceLastAnalysis)
      .slice(0, 10);
    for (const insight of topFreshness) {
      const d = insight.data;
      const trafficAtRisk = d.impressions ?? 0;
      const product = mapToProduct('content_refresh', 1);
      const story = buildRecommendationStory('freshness_alert', {
        pagePath: d.pagePath,
        daysSinceLastAnalysis: d.daysSinceLastAnalysis,
        trafficAtRisk,
      });
      const pageSlug = toPageSlug(d.pagePath);
      const source = RecSource.freshnessAlert(pageSlug);
      const opportunity = computeOpportunityValue({
        branch: 'freshness',
        impressions: trafficAtRisk,
        authorityStrength: ovAuthority ?? null,
        timingBoost: maxBoostForPages(timingBoosts, [pageSlug]),
      }, { calibration: ovCalibration, weights: ovWeights });
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'content_refresh',
        title: story.title,
        description: story.description,
        insight: story.insight,
        impact: d.daysSinceLastAnalysis > 180 ? 'high' : 'medium',
        effort: 'medium',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [pageSlug],
        trafficAtRisk,
        impressionsAtRisk: trafficAtRisk,
        estimatedGain: story.estimatedGain,
        actionType: product.productType ? 'purchase' : 'manual',
        productType: product.productType,
        productPrice: product.productPrice,
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (topFreshness.length > 0) {
      log.info(`Added ${topFreshness.length} content freshness recommendations for ${workspaceId}`);
    }
  } catch (err) {
    failedCategories.add('insight:freshness_alert');
    log.warn({ err }, 'Content freshness insights unavailable for recommendations');
  }

  // ── Build slug→pageId map from audit for resolving affectedPages ──
  const slugToPageId = new Map<string, string>();
  if (audit) {
    for (const page of audit.audit.pages) {
      const slug = page.slug.replace(/^\//, '');
      slugToPageId.set(slug, page.pageId);
      // Also store with leading slash for lookups
      slugToPageId.set(`/${slug}`, page.pageId); // page-slug-url-ok — legacy lookup key, not a new persisted path
    }
  }

  // ── Merge with existing recommendations ──
  // Preserve statuses from previous run and auto-resolve issues no longer detected
  const existing = loadRecommendations(workspaceId);
  let autoResolved = 0;
  const autoResolvedPageStateIds: string[] = [];

  if (existing) {
    // Build lookup: source → existing rec (for audit-based and site-wide recs)
    // For strategy recs, use source + first affected page as key
    const existingByKey = new Map<string, Recommendation>();
    for (const oldRec of existing.recommendations) {
      // buildMergeKey migrates old recs whose source embeds a full URL slug
      // (pre-toPageSlug) so they match newly-generated normalised keys and
      // in_progress/dismissed statuses are preserved.
      existingByKey.set(buildMergeKey(oldRec), oldRec);
    }

    const newSources = new Set<string>();
    for (const newRec of recs) {
      const key = buildMergeKey(newRec);
      newSources.add(key);

      // Preserve status from existing rec if it was in_progress or completed
      const oldRec = existingByKey.get(key);
      if (oldRec) {
        if (oldRec.status === 'in_progress' || oldRec.status === 'completed') {
          newRec.status = oldRec.status;
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'dismissed') {
          newRec.status = 'dismissed';
          newRec.id = oldRec.id;
          newRec.createdAt = oldRec.createdAt;
        }
      }
    }

    // Auto-resolve: old pending/in_progress recs whose source is gone (issue fixed!)
    // Safety: if the data source for a category failed this run (e.g. provider
    // outage, diagnostic store unavailable), skip auto-resolving recs in that
    // category — their absence from `newSources` is a fetch artifact, not a
    // genuine fix. This prevents silent bulk-completion of real issues during
    // transient failures.
    const autoResolvedRecs: typeof existing.recommendations = [];
    for (const oldRec of existing.recommendations) {
      if (oldRec.status === 'completed' || oldRec.status === 'dismissed') continue;
      const category = getRecSourceCategory(oldRec.source);
      if (category && failedCategories.has(category)) continue;
      if (!newSources.has(buildMergeKey(oldRec))) {
        // Issue no longer detected — auto-resolve
        recs.push({
          ...oldRec,
          status: 'completed',
          updatedAt: now,
          insight: `✓ Auto-resolved — this issue is no longer detected in the latest audit. ${oldRec.insight}`,
        });
        autoResolved++;
        autoResolvedRecs.push(oldRec);
      }
    }

    // Build set of pages that still have active (non-completed, non-dismissed) recs
    const pagesWithActiveRecs = new Set<string>();
    for (const r of recs) {
      if (r.status !== 'completed' && r.status !== 'dismissed') {
        for (const p of r.affectedPages) pagesWithActiveRecs.add(toPageSlug(p));
      }
    }

    // Only mark pages as live if they have no other active recommendations
    for (const oldRec of autoResolvedRecs) {
      if (oldRec.affectedPages && oldRec.affectedPages.length > 0) {
        for (const pageSlug of oldRec.affectedPages) {
          if (pagesWithActiveRecs.has(toPageSlug(pageSlug))) continue;
          const resolvedPageId = slugToPageId.get(pageSlug)
            ?? getPageIdBySlug(workspaceId, pageSlug)
            ?? pageSlug;
          updatePageState(workspaceId, resolvedPageId, {
            status: 'live',
            source: 'recommendation',
            recommendationId: oldRec.id,
          });
          autoResolvedPageStateIds.push(resolvedPageId);
        }
      }
    }
  }

  // ── Canonical OV scoring + one gain basis chokepoint. ──
  // Keep one post-pass so every producer converges on the same final authority even if a
  // future branch accidentally provides a placeholder priority/score during construction.
  for (const r of recs) {
    if (r.opportunity) {
      const scoring = deriveCanonicalRecommendationFields(r.source, r.opportunity);
      r.impactScore = scoring.impactScore;
      r.priority = scoring.priority;
    }
    r.estimatedGain = resolveEstimatedGain(r.estimatedGain, r.opportunity, true);
  }

  // ── Sort: tier PRIMARY, impactScore SECONDARY, business-intent alignment as
  // the final within-tier tiebreaker (see sortRecommendations). ──
  sortRecommendations(recs, effectiveBusinessPriorities);

  // ── Build summary (exclude auto-resolved from active counts) ──
  const summary = computeRecommendationSummary(recs);

  const set: RecommendationSet = {
    workspaceId,
    generatedAt: now,
    recommendations: recs,
    summary,
  };

  saveRecommendations(set);
  invalidateIntelligenceCache(workspaceId);
  log.info(`Generated ${recs.length} recommendations for ${workspaceId}: ${summary.fixNow} fix-now, ${summary.fixSoon} fix-soon, ${summary.fixLater} fix-later, ${summary.ongoing} ongoing${autoResolved > 0 ? `, ${autoResolved} auto-resolved` : ''}`);

  if (autoResolvedPageStateIds.length > 0) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds: autoResolvedPageStateIds,
      source: 'recommendation',
    });
  }
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { count: recs.length });

  return set;
}
