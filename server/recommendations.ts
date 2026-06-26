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
import { getWorkspace, updatePageState, getPageIdBySlug } from './workspaces.js';
import { getPageState } from './page-edit-states.js';
import type { Workspace } from './workspaces.js';
import { getLatestSnapshot } from './reports.js';
import type { AuditSnapshot } from './reports.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { buildStrategyKeywordEvaluationContext } from './keyword-strategy-context.js';
import { listPageKeywords } from './page-keywords.js';
import { getLocalSeoPosture } from './local-seo.js';
import { workspaceProviderGeo } from './seo-target-geo.js';
import { getInsights } from './analytics-insights-store.js';
import { buildStrategySignals } from './insight-feedback.js';
import { isFeatureEnabled } from './feature-flags.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { buildRecommendationGenerationContext } from './intelligence/generation-context-builders.js';
import { getAuditTrafficForWorkspace } from './audit-traffic.js';
import { computeTimingBoosts } from './scoring/opportunity-timing.js';
import { triggerOpportunityRegen } from './scoring/opportunity-regen.js';
import { buildCtrCurve, type GscKeywordObservation } from './scoring/ctr-curve.js';
import { resolveOvAuthorityStrength } from './workspace-authority.js';
import { getOrCreateWorkspaceWeights } from './opportunity-weights.js';
import { computeOvCalibration } from './scoring/ov-calibration.js';
import { applyOutcomeAdjustmentScore, buildOutcomeAdjustment } from './outcome-learning-default-path.js';
import {
  RecSource,
  applyLifecycleCarryOver,
  buildMergeKey,
  computeRecommendationSummary,
  deriveCanonicalRecommendationFields,
  getRecSourceCategory,
  getTrafficScore,
  isExemptFromAutoResolve,
  isOperatorMintedRec,
  resolveEstimatedGain,
  sortRecommendations,
  toPageSlug,
  type RecSourceCategory,
} from './domains/recommendations/rules.js';
import {
  appendAuditRecommendations,
  appendContentDecayRecommendations,
  appendCtrOpportunityRecommendations,
  appendDiagnosticRecommendations,
  appendFreshnessRecommendations,
  appendLocalVisibilityRecommendations,
  appendStrategyRecommendations,
} from './domains/recommendations/generation-producers.js';
import {
  loadRecommendationSet,
  replaceRecommendationItems,
  saveRecommendationSet,
  setRecommendationItemStatus,
} from './recommendation-storage.js';

// ─── Types ────────────────────────────────────────────────────────

export type { RecPriority, RecType, RecStatus, RecActionType, Recommendation, RecommendationSet } from '../shared/types/recommendations.ts';
import type { RecPriority, RecType, RecStatus, Recommendation, RecommendationSet } from '../shared/types/recommendations.ts';
import type { ConversionAttributionData } from '../shared/types/analytics.js';
import type { StrategySignal } from '../shared/types/insights.js';
import type { ActionType } from '../shared/types/outcome-tracking.js';
import { getEffortPriorDays } from './outcome-emv-calibration.js';
import { LOCAL_SEO_POSTURE } from '../shared/types/local-seo.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { RECOMMENDATION_TRANSITIONS, validateTransition } from './state-machines.js';
import { createLogger } from './logger.js';

const log = createLogger('recommendations');


export {
  INTENT_STOPWORDS,
  RecSource,
  applyLifecycleCarryOver,
  auditInsight,
  buildMergeKey,
  buildOvGainString,
  cannibalizationUrlSetKey,
  checkToRecType,
  computeRecommendationSummary,
  deriveOvTier,
  getRecSourceCategory,
  getRecoveryRate,
  getTrafficScore,
  inferPageType,
  inferSchemaTypes,
  isExemptFromAutoResolve,
  isIntentMismatch,
  isActiveRec,
  isCuratedForClient,
  isOperatorMintedRec,
  isRecIntentAligned,
  mapToProduct,
  migrateSourceKey,
  pageImportanceMultiplier,
  resolveEstimatedGain,
  sortRecommendations,
  toPageSlug,
  type RecSourceCategory,
  type RecoveryRate,
} from './domains/recommendations/rules.js';

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
    // P4 competitor send (Lane C) extends the RecType union with `competitor`; a competitor rec
    // succeeds when the competitor gap is closed — the same outcome as keyword_gap. Mapped here
    // (in recommendations.ts, the owner of this exhaustive switch) so the union stays exhaustive.
    case 'competitor':
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


export function loadRecommendations(workspaceId: string): RecommendationSet | null {
  return loadRecommendationSet(workspaceId);
}

export function saveRecommendations(set: RecommendationSet): void {
  saveRecommendationSet(set);
}

function saveRecommendationMutation(set: RecommendationSet): void {
  replaceRecommendationItems(set, set.recommendations, set.summary);
}

export function updateRecommendationStatus(
  workspaceId: string,
  recId: string,
  status: RecStatus
): Recommendation | null {
  // Recompute the summary so topRecommendationId stays consistent after a
  // status flip — completing or dismissing a rec must not leave the pointer
  // referencing that now-inactive rec. computeRecommendationSummary already
  // excludes completed/dismissed recs when picking activeRecs[0].
  return setRecommendationItemStatus(
    workspaceId,
    recId,
    status,
    computeRecommendationSummary,
    (current, next) => validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, current, next),
  );
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

  // Recompute the summary so client-facing headline counts and Opportunity
  // Value totals reflect the resolved recs — otherwise the rendered list drops
  // the item but the numbers stay inflated until the next full regen.
  set.summary = computeRecommendationSummary(set.recommendations);
  saveRecommendationMutation(set);
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
 * D2 (audit #11) — resolve (complete) active content recommendations whose target keyword
 * matches a just-published post. Called best-effort from the C3 publish domain service
 * (`server/domains/content/publish-post-to-webflow.ts`) AFTER a successful publish, so the
 * "create content for X" rec disappears the moment the content for X goes live — without
 * waiting for the next full regen (which is GSC-lag-gated).
 *
 * Content-gap recs have `affectedPages: []` (the page doesn't exist until publish), so the
 * page-intersection resolver (`resolveRecommendationsForChange`) can never match them —
 * matching is by `rec.targetKeyword` via `keywordComparisonKey` (the same normalization the
 * generation-time suppression and the contentPipeline slice use).
 *
 * Mirrors `resolveRecommendationsForChange`: validateTransition per rec, summary recompute,
 * save, intelligence-cache invalidation, and a RECOMMENDATIONS_UPDATED broadcast — only when
 * at least one rec changed. Deliberately does NOT call `triggerOpportunityRegen`: the publish
 * service already enqueues `queueKeywordStrategyPostUpdateFollowOns`, which re-ranks the queue.
 *
 * @returns the number of recommendations transitioned to `completed`.
 */
export function resolveContentRecommendationsForPublishedPost(
  workspaceId: string,
  targetKeyword: string | null | undefined,
): number {
  const key = targetKeyword ? keywordComparisonKey(targetKeyword) : '';
  if (!key) return 0;

  const set = loadRecommendations(workspaceId);
  if (!set) return 0;

  let resolved = 0;
  const now = new Date().toISOString();
  for (const rec of set.recommendations) {
    if (rec.status === 'completed' || rec.status === 'dismissed') continue;
    if (rec.type !== 'content') continue;
    if (!rec.targetKeyword || keywordComparisonKey(rec.targetKeyword) !== key) continue;
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, rec.status, 'completed');
    rec.status = 'completed';
    rec.updatedAt = now;
    resolved++;
  }

  if (resolved === 0) return 0;

  // Recompute the summary so headline counts / OV totals drop the resolved recs
  // immediately (same contract as resolveRecommendationsForChange).
  set.summary = computeRecommendationSummary(set.recommendations);
  saveRecommendationMutation(set);
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { resolved });
  log.info(`Resolved ${resolved} content recommendation(s) for ${workspaceId} after publishing "${targetKeyword}"`);
  return resolved;
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
    const geo = workspaceProviderGeo(workspaceId);
    const overview = await provider.getDomainOverview(ws.liveDomain, workspaceId, undefined, geo.locationCode, geo.languageCode);
    if (!overview) return 0;
    if (overview.organicKeywords >= 1000) return 80;
    if (overview.organicKeywords >= 100)  return 50;
    return 20;
  } catch { // catch-ok: non-critical — failure degrades to "authority unknown" and the KD classifier treats 0 as unknown
    return 0;
  }
}

// ─── Strategy redesign P4 · signal-fold ───────────────────────────
//
// Maps the standalone IntelligenceSignals feed (the `buildStrategySignals` read the
// dedicated `…/signals` card consumed) into first-class Recommendation rows minted at
// generation time. The card is being deleted; signals-as-recs ride the existing
// RECOMMENDATIONS_UPDATED broadcast (signals ARE recs — no new WS event). Gated behind
// `strategy-signal-fold`, checked server-side per-workspace; flag-OFF mints nothing so the
// rec set stays byte-identical.

/** Map a StrategySignal's `type` to a RecType. `momentum` (a keyword that gained positions —
 *  "consider adding to strategy") maps to `keyword_gap`; `content_gap` (competitor coverage we
 *  lack) maps to `topic_cluster`; everything else (`misalignment`) maps to the generic
 *  `strategy`. NEVER `competitor` — that RecType is Lane C's and signals don't map to it. */
function signalToRecType(signalType: StrategySignal['type']): RecType {
  switch (signalType) {
    case 'momentum':    return 'keyword_gap';
    case 'content_gap': return 'topic_cluster';
    case 'misalignment':
    default:            return 'strategy';
  }
}

/** Band a signal's score into a RecPriority (the minted signal rec carries no OV
 *  `opportunity` — it is a pure map of the feed, so the canonical OV post-pass skips it and
 *  the score flows straight from the signal). Thresholds mirror the impact bands used
 *  by the keyword_gap / topic_cluster producers above. */
function signalPriority(score: number): RecPriority {
  if (score >= 70) return 'fix_now';
  if (score >= 40) return 'fix_soon';
  return 'fix_later';
}

/**
 * Mint StrategySignals as Recommendation rows, appending to `recs` in place.
 *
 * Dedup contract: a signal is skipped when its `signal:<insightId>` merge key already exists
 * in `recs` (covers BOTH a different producer that already minted the same source AND a
 * carried-over signal rec re-pushed by the merge phase). buildMergeKey is the single keying
 * authority — `signal:` sources are not `strategy:`-prefixed, so the key is the source string,
 * exactly the per-`insightId` dedup the spec requires. Carry-over semantics are respected:
 * mintSignalRecs runs AFTER applyLifecycleCarryOver, so a previously-minted signal rec that
 * survived regen is already in `recs` with its preserved id/status/lifecycle, and this dedup
 * prevents a second copy — no re-mint, no duplication.
 *
 * Pure map (no AI, no DB write): the caller persists the assembled set.
 */
function mintSignalRecs(
  signals: StrategySignal[],
  recs: Recommendation[],
  ctx: { workspaceId: string; now: string; assignedTo: 'team' | 'client' },
): number {
  // O(n) dedup: one Set of existing merge keys, then a single pass over signals. No nested
  // scan over `recs` per signal (the carry-over O(n²) hazard the plan flags) — the lookup is
  // Set-backed.
  const existingKeys = new Set<string>();
  for (const rec of recs) existingKeys.add(buildMergeKey(rec));

  let minted = 0;
  for (const signal of signals) {
    const source = RecSource.signal(signal.insightId);
    // buildMergeKey on a `signal:`-prefixed source returns the source unchanged (not
    // strategy-prefixed) → per-insightId dedup.
    const key = buildMergeKey({ source, affectedPages: [], title: '' });
    if (existingKeys.has(key)) continue; // already minted (this run or carried over) — don't double-mint
    existingKeys.add(key);

    const type = signalToRecType(signal.type);
    // Signal recs are a pure map of the IntelligenceSignals feed — the feed already carries the
    // insight's score and there are no OV inputs (volume/KD/position) to ground a
    // computeOpportunityValue() call. This mirrors the standalone card, which rendered the
    // signal score verbatim. No `opportunity` attached → the canonical OV post-pass leaves this
    // rec alone (it guards on `if (r.opportunity)`).
    const impactScore = signal.impactScore; // rec-impactscore-ok: pure feed map, no OV inputs to ground a scorer call (see comment above)
    const pageSlug = signal.pageUrl ? toPageSlug(signal.pageUrl) : undefined;
    recs.push({
      id: `rec_${crypto.randomBytes(6).toString('hex')}`,
      workspaceId: ctx.workspaceId,
      priority: signalPriority(impactScore),
      type,
      title: `${signal.keyword ? `"${signal.keyword}"` : 'Intelligence signal'}: ${signal.detail}`,
      description: signal.detail,
      insight: signal.detail,
      impact: impactScore >= 70 ? 'high' : impactScore >= 40 ? 'medium' : 'low',
      effort: 'medium',
      impactScore,
      // No `opportunity` — the mint is a pure map of the feed (no OV inputs to ground it),
      // so the canonical OV post-pass (which guards on `if (r.opportunity)`) leaves it alone
      // and impactScore flows straight from the signal.
      source,
      affectedPages: pageSlug ? [pageSlug] : [],
      targetKeyword: signal.keyword || undefined,
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: signal.detail,
      actionType: 'manual',
      status: 'pending',
      assignedTo: ctx.assignedTo,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    minted++;
  }
  return minted;
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
    // `contentPipeline` (D2, audit #11) carries `inFlightTargetKeywords` — the
    // comparison-keyed brief/post keywords used to suppress content-gap recs the
    // pipeline is already producing.
    slices: ['seoContext', 'clientSignals', 'learnings', 'contentPipeline'],
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
  const outcomeLearnings = recommendationContext?.intelligence.learnings ?? null;
  // D2 (audit #11): keywords the content pipeline is already producing (briefs +
  // non-error posts), comparison-keyed at slice-assembly time. Suppression fails OPEN:
  // when the slice/context is unavailable this set is empty and gaps mint as before —
  // the safe direction (an extra rec, never a false resolution).
  const inFlightContentKeywords = new Set(
    recommendationContext?.intelligence.contentPipeline?.inFlightTargetKeywords ?? [],
  );

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

  // ── SEO Decision Engine P2 · effort priors ──
  // Replace the per-branch DEFAULT_EFFORT_DAYS guess with the workspace's MEASURED
  // median time-to-complete per action type (getEffortPriorDays), resolved ONCE per
  // cycle. Absent (no prior, or < MIN_EFFORT_SAMPLES) → null → the scorer falls back
  // to DEFAULT_EFFORT_DAYS[branch], byte-identical to today. Inert until outcomes accrue.
  const ovEffortPriors = getEffortPriorDays(workspaceId);
  const effortDaysFor = (type: RecType, source: string): number | null =>
    ovEffortPriors[recommendationOutcomeActionType(type, source)] ?? null;

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

  const producerContext = {
    workspaceId,
    now,
    assignedTo,
    effortDaysFor,
    authorityStrength: ovAuthority ?? null,
    timingBoosts,
    opportunityOptions: { calibration: ovCalibration, weights: ovWeights },
  };

  // ── 1. Audit-based recommendations ──
  if (audit) {
    appendAuditRecommendations(recs, {
      ...producerContext,
      audit,
      traffic,
      conversionMap,
    });
  }

  // ── 2. Strategy-based recommendations ──
  // Load declined keywords so we can skip suggestions the client has rejected (2C).
  // The set is also reused by the signal-fold tail below.
  const declinedKeywords = new Set(
    getDeclinedKeywords(workspaceId).map(k => keywordComparisonKey(k)).filter(Boolean)
  );

  if (strategy) {
    appendStrategyRecommendations(recs, {
      ...producerContext,
      failedCategories,
      traffic,
      declinedKeywords,
      inFlightContentKeywords,
      domainStrength,
      backlinkProfile,
      ctrCurve: ovCtrCurve,
    });
  }

  // ── 2c. First-class local-visibility recs (posture-gated). ──
  // The local stage owns provider/snapshot reads and its FM-2 failed-category guards;
  // this facade keeps only the canonical local/non-local posture gate.
  if (useLocalGenQual) {
    appendLocalVisibilityRecommendations(recs, {
      ...producerContext,
      failedCategories,
      ctrCurve: ovCtrCurve,
      localGbpEnabled: isFeatureEnabled('local-gbp', ws.id),
    });
  }

  // ── 3. Content decay recommendations ──
  appendContentDecayRecommendations(recs, {
    ...producerContext,
    failedCategories,
  });

  // ── 4. CTR opportunity recommendations ──────────────────────────────────────
  appendCtrOpportunityRecommendations(recs, {
    ...producerContext,
    failedCategories,
    ctrCurve: ovCtrCurve,
  });

  // ── 5. Diagnostic remediation recommendations ───────────────────────────────
  appendDiagnosticRecommendations(recs, {
    ...producerContext,
    failedCategories,
  });

  // ── 6. Content freshness recommendations ────────────────────────────────────
  // Must run BEFORE the merge block so status carry-over, auto-resolution,
  // and deduplication apply equally to freshness recs.
  appendFreshnessRecommendations(recs, {
    ...producerContext,
    failedCategories,
  });

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
        if (oldRec.status === 'in_progress') {
          newRec.status = oldRec.status;
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'completed') {
          validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, oldRec.status, 'pending');
          newRec.status = 'pending';
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'dismissed') {
          newRec.status = 'dismissed';
          newRec.id = oldRec.id;
          newRec.createdAt = oldRec.createdAt;
        }
      }
    }

    // Strategy v3 — carry the client-facing lifecycle axis across regen for EVERY matched rec
    // (the RecStatus branch above only ran on in_progress/completed/dismissed). buildMergeKey
    // re-matches old↔new; applyLifecycleCarryOver also re-applies id+createdAt continuity (idempotent
    // with the branch above). This is the trust-critical graft: a sent rec stays sent through regen.
    applyLifecycleCarryOver(recs, Array.from(existingByKey.values()));

    // Auto-resolve: old pending/in_progress recs whose source is gone (issue fixed!)
    // Safety: if the data source for a category failed this run (e.g. provider
    // outage, diagnostic store unavailable), skip auto-resolving recs in that
    // category — their absence from `newSources` is a fetch artifact, not a
    // genuine fix. This prevents silent bulk-completion of real issues during
    // transient failures.
    const autoResolvedRecs: typeof existing.recommendations = [];
    for (const oldRec of existing.recommendations) {
      if (oldRec.status === 'completed' || oldRec.status === 'dismissed') continue;
      // Strategy v3 (§6.5): a rec the client has already seen (sent/discussing/approved) must
      // never be auto-swept to 'completed' (it would read as "✓ done" — the trust-critical graft).
      // It must ALSO not silently vanish when its source is no longer detected: a sent rec the
      // client is mid-decision on has to survive regen. If its source is still detected, the matching
      // new rec already carries its lifecycle (applyLifecycleCarryOver above) — skip to avoid a dup.
      // If the source is gone, RETAIN the old rec as-is (preserve its sent/discussing/approved state);
      // the positive "we handled this" terminal is a later phase (P2/P3) — here we only preserve.
      if (isExemptFromAutoResolve(oldRec)) {
        if (!newSources.has(buildMergeKey(oldRec))) recs.push({ ...oldRec });
        continue;
      }
      // The Issue (operator-steering) — operator-minted recs (manual:/competitor:) have NO producer
      // in the merge phase, so their merge key is NEVER in newSources. Without this they auto-resolve
      // to 'completed' on the next regen. RETAIN as-is when the source is absent — the operator owns
      // their lifecycle; only an explicit strike removes them. (Also fixes the live competitor-rec
      // auto-resolve bug: an un-sent competitor mint silently flipped to "✓ done" on the next regen.)
      if (isOperatorMintedRec(oldRec)) {
        if (!newSources.has(buildMergeKey(oldRec))) recs.push({ ...oldRec });
        continue;
      }
      const category = getRecSourceCategory(oldRec.source);
      // Strategy redesign P4 · signal-fold — signal recs have NO producer in the merge phase:
      // mintSignalRecs runs AFTER this loop, so a `signal:<insightId>` key is never added to
      // `newSources`. Its absence is therefore ALWAYS a false positive, not a genuine "no longer
      // detected" fix. Without this exemption every un-actioned folded signal flips to a false
      // "✓ Auto-resolved — completed" on the next regen, and the post-loop mintSignalRecs then
      // dedups against that now-completed rec and never re-mints it. RETAIN the old signal rec
      // as-is (preserve status/lifecycle) when its mint key is absent so the subsequent
      // mintSignalRecs dedup sees it and skips the re-mint (no duplicate). Struck/sent signal
      // recs are already handled by the isExemptFromAutoResolve branch above.
      if (category === 'signal') {
        if (!newSources.has(buildMergeKey(oldRec))) recs.push({ ...oldRec });
        continue;
      }
      if (category && failedCategories.has(category)) continue;
      if (!newSources.has(buildMergeKey(oldRec))) {
        // D2: a content-gap rec suppressed because the pipeline already has an in-flight
        // brief/post for its keyword is NOT "no longer detected" — the gap still exists,
        // we're just already working on it. Use truthful copy so the client doesn't read
        // "done" as "my content is live". (Pre-D2 recs without targetKeyword fall through
        // to the generic copy — forward-looking only.)
        const suppressedByPipeline = Boolean(
          oldRec.targetKeyword
          && inFlightContentKeywords.has(keywordComparisonKey(oldRec.targetKeyword)),
        );
        recs.push({
          ...oldRec,
          status: 'completed',
          updatedAt: now,
          insight: suppressedByPipeline
            ? `✓ Content for this is already in progress — it will be marked done when it publishes. ${oldRec.insight}`
            : `✓ Auto-resolved — this issue is no longer detected in the latest audit. ${oldRec.insight}`,
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

  // ── Strategy redesign P4 · signal-fold (flag-gated, runs AFTER carry-over) ──
  // Mint the IntelligenceSignals feed as real recs. Placed here, after the entire merge/
  // carry-over block, so dedup sees BOTH this run's producer recs AND any carried-over
  // signal rec that survived regen (applyLifecycleCarryOver re-applied its id/lifecycle into
  // `recs` already) — buildMergeKey on `signal:<insightId>` keeps the dedup per-insight, so a
  // sent/struck signal rec is respected and never re-minted. Flag-OFF: mints nothing → the
  // rec set is byte-identical. Reuses the exact read path the standalone card used
  // (getInsights → buildStrategySignals).
  if (isFeatureEnabled('strategy-signal-fold', workspaceId)) {
    try {
      // Parity with the standalone IntelligenceSignals card (server/routes/keyword-strategy.ts):
      // it threaded a keywordEvaluationContext into buildStrategySignals to suppress
      // declined/business-misfit keywords. Reuse the SAME read path here so the mint never emits
      // recs for keywords the card would have suppressed. The seoContext + clientSignals slices
      // were already assembled into `recommendationContext` above (slices: [...'seoContext',
      // 'clientSignals'...]) — no extra intelligence build. If that context was unavailable
      // (build failed → null), fall back to the unfiltered feed (same fail-open direction the
      // route uses in its catch).
      const intel = recommendationContext?.intelligence;
      const keywordEvaluationContext = intel
        ? buildStrategyKeywordEvaluationContext({
            workspaceId,
            workspaceName: ws.name,
            businessContext: ws.keywordStrategy?.businessContext,
            seoContext: intel.seoContext,
            clientSignals: intel.clientSignals,
            declinedKeywords: [...new Set([
              ...(intel.clientSignals?.keywordFeedback.rejected ?? []),
              ...getDeclinedKeywords(workspaceId),
            ])],
            requestedKeywords: getRequestedKeywords(workspaceId),
            approvedKeywords: intel.clientSignals?.keywordFeedback.approved ?? [],
            strictBusinessFit: true,
          })
        : undefined;
      const signals = buildStrategySignals(getInsights(workspaceId), { keywordEvaluationContext });
      const mintedSignalRecs = mintSignalRecs(signals, recs, { workspaceId, now, assignedTo });
      if (mintedSignalRecs > 0) {
        log.info({ workspaceId, mintedSignalRecs }, 'signal-fold: minted intelligence signals as recommendations');
      }
    } catch (err) { // non-fatal — a signal-fold failure must never block the rest of the rec set
      log.warn({ err, workspaceId }, 'signal-fold: failed to mint signal recs — continuing without them');
    }
  }

  // ── Canonical OV scoring + one gain basis chokepoint. ──
  // Keep one post-pass so every producer converges on the same final authority even if a
  // future branch accidentally provides a placeholder priority/score during construction.
  const outcomeRankScores = new Map<string, number>();
  for (const r of recs) {
    if (r.opportunity) {
      const scoring = deriveCanonicalRecommendationFields(r.source, r.opportunity);
      r.impactScore = scoring.impactScore;
      r.priority = scoring.priority;
    }
    const outcomeAdjustment = buildOutcomeAdjustment({
      actionType: recommendationOutcomeActionType(r.type, r.source),
      learnings: outcomeLearnings,
    });
    if (outcomeAdjustment.multiplier !== 1) {
      outcomeRankScores.set(r.id, applyOutcomeAdjustmentScore(r.impactScore, outcomeAdjustment));
    }
    r.estimatedGain = resolveEstimatedGain(r.estimatedGain, r.opportunity, true);
  }

  // ── Sort: tier PRIMARY, learned rank score / impactScore SECONDARY, business-intent
  // alignment as the final within-tier tiebreaker. Learning scores are rank-only so
  // the public `impactScore === opportunity.value` contract stays intact.
  sortRecommendations(recs, effectiveBusinessPriorities, { rankScores: outcomeRankScores });

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
