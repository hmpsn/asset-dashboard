import crypto from 'crypto';

import { getInsights } from '../../analytics-insights-store.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { buildStrategySignals } from '../../insight-feedback.js';
import { getDeclinedKeywords, getRequestedKeywords } from '../../keyword-feedback.js';
import { buildStrategyKeywordEvaluationContext } from '../../keyword-strategy-context.js';
import { createLogger } from '../../logger.js';
import { applyOutcomeAdjustmentScore, buildOutcomeAdjustment } from '../../outcome-learning-default-path.js';
import { RECOMMENDATION_TRANSITIONS, validateTransition } from '../../state-machines.js';
import { getPageIdBySlug, updatePageState } from '../../workspaces.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type { LearningsSlice, WorkspaceIntelligence } from '../../../shared/types/intelligence.js';
import type { StrategySignal } from '../../../shared/types/insights.js';
import type { ActionType } from '../../../shared/types/outcome-tracking.js';
import type {
  Recommendation,
  RecommendationSet,
  RecPriority,
  RecType,
} from '../../../shared/types/recommendations.js';
import {
  RecSource,
  applyLifecycleCarryOver,
  buildMergeKey,
  computeRecommendationSummary,
  deriveCanonicalRecommendationFields,
  getRecSourceCategory,
  isExemptFromAutoResolve,
  isOperatorMintedRec,
  resolveEstimatedGain,
  sortRecommendations,
  toPageSlug,
  type RecSourceCategory,
} from './rules.js';

const log = createLogger('recommendations');

export type RecommendationActionTypeResolver = (type: RecType, source: string) => ActionType;

export interface RecommendationFinalizationContext {
  workspaceId: string;
  workspaceName: string;
  workspaceBusinessContext?: string;
  now: string;
  assignedTo: 'team' | 'client';
  existing: RecommendationSet | null;
  failedCategories: Set<RecSourceCategory>;
  inFlightContentKeywords: Set<string>;
  slugToPageId: Map<string, string>;
  effectiveBusinessPriorities: string[];
  outcomeLearnings: LearningsSlice | null;
  intelligence: WorkspaceIntelligence | null;
  /** Frozen before the first commit attempt so a CAS retry refreshes lifecycle only. */
  strategySignals: StrategySignal[];
  actionTypeForRecommendation: RecommendationActionTypeResolver;
}

export interface FinalizedRecommendationSet {
  set: RecommendationSet;
  autoResolved: number;
  autoResolvedPageStateIds: string[];
}

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

export function captureRecommendationFinalizationSignals(ctx: {
  workspaceId: string;
  workspaceName: string;
  workspaceBusinessContext?: string;
  intelligence: WorkspaceIntelligence | null;
}): StrategySignal[] {
  if (!isFeatureEnabled('strategy-signal-fold', ctx.workspaceId)) return [];
  try {
    const keywordEvaluationContext = ctx.intelligence
      ? buildStrategyKeywordEvaluationContext({
          workspaceId: ctx.workspaceId,
          workspaceName: ctx.workspaceName,
          businessContext: ctx.workspaceBusinessContext,
          seoContext: ctx.intelligence.seoContext,
          clientSignals: ctx.intelligence.clientSignals,
          declinedKeywords: [...new Set([
            ...(ctx.intelligence.clientSignals?.keywordFeedback.rejected ?? []),
            ...getDeclinedKeywords(ctx.workspaceId),
          ])],
          requestedKeywords: getRequestedKeywords(ctx.workspaceId),
          approvedKeywords: ctx.intelligence.clientSignals?.keywordFeedback.approved ?? [],
          strictBusinessFit: true,
        })
      : undefined;
    return buildStrategySignals(getInsights(ctx.workspaceId), { keywordEvaluationContext });
  } catch (err) {
    log.warn({ err, workspaceId: ctx.workspaceId }, 'signal-fold: failed to capture recommendation signals — continuing without them');
    return [];
  }
}

export function finalizeRecommendations(
  recs: Recommendation[],
  ctx: RecommendationFinalizationContext,
): FinalizedRecommendationSet {
  const {
    actionTypeForRecommendation,
    assignedTo,
    effectiveBusinessPriorities,
    existing,
    failedCategories,
    inFlightContentKeywords,
    now,
    outcomeLearnings,
    slugToPageId,
    strategySignals,
    workspaceId,
  } = ctx;

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
      if (category && failedCategories.has(category)) {
        if (!newSources.has(buildMergeKey(oldRec))) recs.push({ ...oldRec });
        continue;
      }
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
  if (strategySignals.length > 0) {
    const mintedSignalRecs = mintSignalRecs(strategySignals, recs, { workspaceId, now, assignedTo });
    log.info({ workspaceId, mintedSignalRecs }, 'signal-fold: minted intelligence signals as recommendations');
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
      actionType: actionTypeForRecommendation(r.type, r.source),
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

  const set: RecommendationSet = {
    workspaceId,
    generatedAt: now,
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };

  return { set, autoResolved, autoResolvedPageStateIds };
}
