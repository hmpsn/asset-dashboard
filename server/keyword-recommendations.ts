/**
 * Smart Keyword Recommendations — fetches SEO provider related keywords,
 * scores them by opportunity + strategic fit, and optionally uses AI to
 * re-rank by business relevance when enough workspace context exists.
 *
 * Used by content matrices to recommend the best target keyword for each cell.
 */
import { getConfiguredProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { resolveWorkspaceLocationCode } from './local-seo.js';
import { getQueryPageData } from './search-console.js';
import { callAI } from './ai.js';
import { parseJsonFallback } from './db/json-validation.js';
import { buildRecommendationGenerationContext } from './intelligence/generation-context-builders.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { checkKeywordCannibalization, type CannibalizationConflict } from './cannibalization-detection.js';
import { createLogger } from './logger.js';
import { applyOutcomeAdjustmentScore, buildOutcomeAdjustment, buildOutcomeLearningStatusNote } from './outcome-learning-default-path.js';
import { assessAuthorityFromBacklinks } from './authority-context.js';
import type {
  KeywordCandidate,
  KeywordRecommendationReasoning,
  KeywordRecommendationResult,
} from '../shared/types/content.ts';
import type { ClientSignalsSlice, LearningsSlice, SeoContextSlice } from '../shared/types/intelligence.ts';
import type { PageKeywordMap } from '../shared/types/workspace.ts';
import { sanitizeQueryForPrompt, stripCodeFences } from './helpers.js';
import {
  evaluateKeywordCandidate,
  normalizeKeyword,
  opportunityScore,
  shouldIncludeKeywordCandidate,
} from './keyword-intelligence/index.js';
import { z } from 'zod';

const log = createLogger('keyword-recommendations');

const recommendationSlices = ['seoContext', 'learnings', 'clientSignals'] as const;
const keywordRankingOutputSchema = z.object({
  keywords: z.array(z.string().trim().min(1)).min(1),
});

type ConflictSeverity = CannibalizationConflict['severity'];

type ScoredCandidate = KeywordCandidate & {
  _score: number;
  _reasons: string[];
  _penaltyReasons: string[];
  _fitSignals: string[];
  _conflictSeverity: ConflictSeverity | null;
};

export function parseKeywordRankingOutput(raw: string): string[] {
  const parsed = parseJsonFallback<unknown>(stripCodeFences(raw).trim(), null);
  const result = keywordRankingOutputSchema.safeParse(parsed);
  if (!result.success) throw new Error('AI keyword ranking output failed schema validation');
  return result.data.keywords;
}

interface CandidateScoringContext {
  seedKeyword: string;
  pageMap: PageKeywordMap[];
  declinedKeywords: string[];
  requestedKeywords: string[];
  approvedKeywords: string[];
  businessPriorities: string[];
  contentGapTopics: string[];
  recentChatTopics: string[];
  rejectionReasons: string[];
  learnings?: LearningsSlice;
  backlinkProfile: SeoContextSlice['backlinkProfile'];
  excludedConflictIdentifiers: string[];
  workspaceId: string;
  businessTerms: string[];
}

function getStrongestConflictSeverity(conflicts: CannibalizationConflict[]): ConflictSeverity | null {
  if (conflicts.some(conflict => conflict.severity === 'high')) return 'high';
  if (conflicts.some(conflict => conflict.severity === 'medium')) return 'medium';
  if (conflicts.some(conflict => conflict.severity === 'low')) return 'low';
  return null;
}

function buildConflictReason(conflicts: CannibalizationConflict[]): string | null {
  const strongest = conflicts[0];
  if (!strongest) return null;
  if (strongest.conflictsWith.type === 'existing_page') {
    return `Competes with an existing page target (${strongest.conflictsWith.identifier})`;
  }
  return strongest.reason;
}

function shouldUseSmartRanking(
  useAI: boolean,
  seoContext: SeoContextSlice | undefined,
  clientSignals: ClientSignalsSlice | undefined,
): boolean {
  if (!useAI) return false;
  const hasMeaningfulContext = !!(
    seoContext?.businessContext
    || seoContext?.knowledgeBase
    || seoContext?.brandVoice
    || seoContext?.personas?.length
    || seoContext?.strategy
    || clientSignals?.effectiveBusinessPriorities?.length
    || clientSignals?.keywordFeedback?.approved?.length
    || clientSignals?.keywordFeedback?.rejected?.length
    || clientSignals?.recentChatTopics?.length
  );
  return hasMeaningfulContext;
}

function buildScoringContext(
  workspaceId: string,
  workspaceName: string | undefined,
  seedKeyword: string,
  seoContext: SeoContextSlice | undefined,
  learnings: LearningsSlice | undefined,
  clientSignals: ClientSignalsSlice | undefined,
  excludedConflictIdentifiers: string[],
): CandidateScoringContext {
  return {
    workspaceId,
    seedKeyword,
    pageMap: seoContext?.strategy?.pageMap ?? [],
    declinedKeywords: getDeclinedKeywords(workspaceId),
    requestedKeywords: getRequestedKeywords(workspaceId),
    approvedKeywords: clientSignals?.keywordFeedback.approved ?? [],
    businessPriorities: clientSignals?.effectiveBusinessPriorities ?? [],
    contentGapTopics: (clientSignals?.contentGapVotes ?? []).map(vote => vote.topic),
    recentChatTopics: clientSignals?.recentChatTopics ?? [],
    rejectionReasons: clientSignals?.keywordFeedback.patterns.topRejectionReasons ?? [],
    learnings: learnings ?? undefined,
    backlinkProfile: seoContext?.backlinkProfile,
    excludedConflictIdentifiers,
    businessTerms: [
      workspaceName ?? '',
      seoContext?.businessContext ?? '',
      seoContext?.knowledgeBase ?? '',
      seoContext?.brandVoice ?? '',
      ...(seoContext?.personas ?? []).map(persona => `${persona.name} ${persona.painPoints?.join(' ') ?? ''} ${persona.goals?.join(' ') ?? ''}`),
      ...(clientSignals?.effectiveBusinessPriorities ?? []),
      ...(clientSignals?.recentChatTopics ?? []),
    ],
  };
}

function dedupeCandidates(candidates: KeywordCandidate[]): KeywordCandidate[] {
  return candidates.reduce<KeywordCandidate[]>((deduped, candidate) => {
    const existingIndex = deduped.findIndex(existing => normalizeKeyword(existing.keyword) === normalizeKeyword(candidate.keyword));
    if (existingIndex === -1) {
      deduped.push(candidate);
      return deduped;
    }

    const existing = deduped[existingIndex];
    const keepExisting = existing.source === 'pattern'
      || (existing.source === 'gsc' && candidate.source !== 'pattern')
      || existing.volume >= candidate.volume;
    if (!keepExisting) {
      deduped[existingIndex] = candidate;
    }
    return deduped;
  }, []);
}

function scoreKeywordCandidate(candidate: KeywordCandidate, ctx: CandidateScoringContext): ScoredCandidate | null {
  if (!shouldIncludeKeywordCandidate(candidate.source, candidate.volume)) return null;

  let score = opportunityScore(candidate.volume, candidate.difficulty, candidate.cpc);
  const reasons: string[] = [];
  const penaltyReasons: string[] = [];
  const fitSignals: string[] = [];

  const sharedEvaluation = evaluateKeywordCandidate(candidate, {
    workspaceId: ctx.workspaceId,
    seedKeyword: ctx.seedKeyword,
    pageMap: ctx.pageMap,
    declinedKeywords: ctx.declinedKeywords,
    requestedKeywords: ctx.requestedKeywords,
    approvedKeywords: ctx.approvedKeywords,
    businessPriorities: ctx.businessPriorities, // businesspriorities-ok — ctx.businessPriorities is CandidateScoringContext, not clientSignals
    businessTerms: ctx.businessTerms,
    contentGapTopics: ctx.contentGapTopics,
    recentChatTopics: ctx.recentChatTopics,
    rejectionReasons: ctx.rejectionReasons,
    backlinkProfile: ctx.backlinkProfile,
    strictBusinessFit: true,
  });
  score += sharedEvaluation.scoreDelta;
  fitSignals.push(...sharedEvaluation.fitSignals);
  for (const reason of sharedEvaluation.reasons) {
    if (reason.weight < 0) {
      penaltyReasons.push(reason.message);
    } else {
      reasons.push(reason.message);
    }
  }

  const outcomeAdjustment = buildOutcomeAdjustment({
    actionType: 'strategy_keyword_added',
    learnings: ctx.learnings,
    difficulty: candidate.difficulty,
  });
  if (outcomeAdjustment.multiplier !== 1) {
    score = applyOutcomeAdjustmentScore(score, outcomeAdjustment);
    for (const reason of outcomeAdjustment.reasons) {
      if (reason.toLowerCase().includes('underperformed')) {
        penaltyReasons.push(reason);
      } else {
        reasons.push(reason);
      }
    }
  }

  const conflictCandidates = checkKeywordCannibalization(ctx.workspaceId, candidate.keyword)
    .filter(conflict => !ctx.excludedConflictIdentifiers.includes(conflict.conflictsWith.identifier));
  const conflictSeverity = getStrongestConflictSeverity(conflictCandidates);
  const conflictReason = buildConflictReason(conflictCandidates);
  if (conflictSeverity === 'high') {
    score -= 35;
    penaltyReasons.push(conflictReason ?? 'High cannibalization risk with an existing page');
  } else if (conflictSeverity === 'medium') {
    score -= 18;
    penaltyReasons.push(conflictReason ?? 'Medium cannibalization risk with existing targets');
  } else if (conflictSeverity === 'low') {
    score -= 8;
    penaltyReasons.push(conflictReason ?? 'Low cannibalization risk');
  }

  const authorityAssessment = candidate.authorityAssessment ?? assessAuthorityFromBacklinks(candidate.difficulty, ctx.backlinkProfile);

  const uniqueReasons = [...new Set([...reasons, ...penaltyReasons])].slice(0, 5);
  if (sharedEvaluation.suppressed) {
    return null;
  }

  return {
    ...candidate,
    _score: score,
    _reasons: uniqueReasons,
    _penaltyReasons: [...new Set(penaltyReasons)],
    _fitSignals: [...new Set(fitSignals)],
    _conflictSeverity: conflictSeverity,
    authorityAssessment,
  };
}

function stripScore(candidate: ScoredCandidate): KeywordCandidate {
  const {
    _score,
    _reasons,
    _penaltyReasons,
    _fitSignals,
    _conflictSeverity,
    ...rest
  } = candidate;
  return rest;
}

function buildReasoning(candidates: ScoredCandidate[]): KeywordRecommendationReasoning | undefined {
  const recommended = candidates[0];
  if (!recommended) return undefined;

  const recommendedReasons = recommended._reasons.length > 0
    ? recommended._reasons.slice(0, 2)
    : ['Best blend of opportunity, strategic fit, and execution risk'];
  const authorityLead = recommended.authorityAssessment?.posture !== 'within_current_authority_range'
    ? recommended.authorityAssessment?.note
    : undefined;

  return {
    recommendedReason: [authorityLead, ...recommendedReasons].filter(Boolean).join(' '),
    alternatives: candidates
      .slice(1, 4)
      .map(candidate => ({
        keyword: candidate.keyword,
        reasons: candidate._reasons.length > 0
          ? candidate._reasons.slice(0, 3)
          : ['Lower-ranked after strategic-fit and risk checks'],
      })),
  };
}

function formatCandidateForAi(candidate: ScoredCandidate): string {
  const signals = [
    ...candidate._fitSignals,
    candidate._conflictSeverity ? `cannibalization:${candidate._conflictSeverity}` : '',
  ].filter(Boolean).join(', ') || 'none';
  const reasons = candidate._reasons.slice(0, 3).join('; ') || 'opportunity-led fallback';
  return `- "${candidate.keyword}" (vol: ${candidate.volume}, KD: ${candidate.difficulty}, CPC: $${candidate.cpc.toFixed(2)}, score: ${candidate._score}, signals: ${signals}, notes: ${reasons})`;
}

export { opportunityScore, shouldIncludeKeywordCandidate } from './keyword-intelligence/index.js';

// ── Core recommendation function ───────────────────────────────────────────

/**
 * Get keyword recommendations for a seed keyword.
 *
 * Flow:
 * 1. Fetch provider metrics for the seed keyword
 * 2. Fetch provider related keywords
 * 3. Enrich with GSC queries when available
 * 4. Score all candidates by opportunity + strategic fit + execution risk
 * 5. Optionally use AI to re-rank when meaningful workspace context exists
 * 6. Return sorted candidates with an optional reasoning payload
 */
export async function getKeywordRecommendations(
  workspaceId: string,
  seedKeyword: string,
  options: {
    useAI?: boolean;
    maxCandidates?: number;
    includeReasoning?: boolean;
    excludeConflictIdentifiers?: readonly string[];
  } = {},
): Promise<KeywordRecommendationResult> {
  const { useAI = false, maxCandidates = 15, includeReasoning = false } = options;

  const ws = getWorkspace(workspaceId);
  const provider = getConfiguredProvider(ws?.seoDataProvider);
  if (!provider) {
    const candidates: KeywordCandidate[] = [{
      keyword: seedKeyword,
      volume: 0,
      difficulty: 0,
      cpc: 0,
      source: 'pattern',
      isRecommended: true,
      authorityAssessment: {
        posture: 'authority_unknown',
        note: 'Authority unknown — backlink data is unavailable, so treat keyword difficulty cautiously.',
      },
    }];
    return {
      seedKeyword,
      candidates,
      recommended: seedKeyword,
      message: 'No SEO data provider configured — seed keyword used as-is',
      reasoning: includeReasoning ? {
        recommendedReason: 'No SEO provider is configured, so the seed keyword stays as the safest fallback.',
        alternatives: [],
      } : undefined,
    };
  }

  const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
  const [seedMetrics, related, recommendationContext] = await Promise.all([
    provider.getKeywordMetrics([seedKeyword], workspaceId, undefined, locationCode).catch(() => []),
    provider.getRelatedKeywords(seedKeyword, workspaceId, maxCandidates).catch(() => []),
    buildRecommendationGenerationContext(workspaceId, {
      slices: recommendationSlices,
      learningsDomain: 'strategy',
      verbosity: 'detailed',
      tokenBudget: 2400,
      enrichWithBacklinks: true,
    }).catch(err => {
      log.warn({ err, workspaceId }, 'Keyword recommendation context build failed — continuing with provider-only fallback');
      return null;
    }),
  ]);

  const seoContext = recommendationContext?.intelligence.seoContext;
  const learnings = recommendationContext?.intelligence.learnings;
  const clientSignals = recommendationContext?.intelligence.clientSignals;
  const scoringContext = buildScoringContext(
    workspaceId,
    ws?.name,
    seedKeyword,
    seoContext,
    learnings,
    clientSignals,
    [...(options.excludeConflictIdentifiers ?? [])],
  );
  const outcomeLearningStatusNote = buildOutcomeLearningStatusNote(
    recommendationContext?.learningsAvailability,
    'strategy',
    // A6: on the no_data/degraded fallback tiers this appends the clearly-labeled
    // cross-workspace benchmark; on ready/disabled it is a no-op inside the helper.
    learnings?.platformPriors,
  );

  const seed = seedMetrics[0];
  const candidates: KeywordCandidate[] = [];

  candidates.push(seed
    ? {
        keyword: seed.keyword,
        volume: seed.volume,
        difficulty: seed.difficulty,
        cpc: seed.cpc,
        source: 'pattern',
        isRecommended: false,
        authorityAssessment: undefined,
      }
    : {
        keyword: seedKeyword,
        volume: 0,
        difficulty: 0,
        cpc: 0,
        source: 'pattern',
        isRecommended: false,
        authorityAssessment: {
          posture: 'authority_unknown',
          note: 'Authority unknown — backlink data is unavailable, so treat keyword difficulty cautiously.',
        },
      });

  for (const relatedKeyword of related.slice(0, maxCandidates - 1)) {
    candidates.push({
      keyword: relatedKeyword.keyword,
      volume: relatedKeyword.volume,
      difficulty: relatedKeyword.difficulty,
      cpc: relatedKeyword.cpc,
      source: 'semrush_related',
      isRecommended: false,
    });
  }

  if (ws?.gscPropertyUrl && ws?.webflowSiteId) {
    try {
      const gscRows = await getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90, { maxRows: 200 });
      const seedWords = new Set(
        seedKeyword.toLowerCase().split(/\s+/).filter(word => word.length >= 2),
      );
      const relevantQueries = gscRows
        .filter(row => {
          const qWords = row.query.toLowerCase().split(/\s+/);
          const hasOverlap = seedWords.size > 0
            ? qWords.some(word => seedWords.has(word))
            : row.query.toLowerCase().includes(seedKeyword.toLowerCase());
          return hasOverlap && row.impressions >= 10 && row.query.split(' ').length >= 2;
        })
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10);

      for (const row of relevantQueries) {
        const sanitizedQuery = sanitizeQueryForPrompt(row.query);
        if (!candidates.some(candidate => normalizeKeyword(candidate.keyword) === normalizeKeyword(sanitizedQuery))) {
          candidates.push({
            keyword: sanitizedQuery,
            volume: Math.max(1, Math.round(row.impressions / 3)),
            difficulty: 50,
            cpc: 0,
            source: 'gsc',
            isRecommended: false,
            authorityAssessment: undefined,
          });
        }
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'GSC query enrichment failed — continuing without it');
    }
  }

  const dedupedCandidates = dedupeCandidates(candidates);

  const scored = dedupedCandidates
    .map(candidate => scoreKeywordCandidate(candidate, scoringContext))
    .filter((candidate): candidate is ScoredCandidate => !!candidate)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxCandidates);

  const shouldSmartRank = shouldUseSmartRanking(useAI, seoContext, clientSignals);
  if (shouldSmartRank && scored.length > 1 && recommendationContext?.promptContext) {
    try {
      const aiContext = outcomeLearningStatusNote
        ? `${recommendationContext.promptContext}\n\nOUTCOME LEARNING STATUS:\n${outcomeLearningStatusNote}`
        : recommendationContext.promptContext;
      const aiRanked = await aiRankKeywords(scored, aiContext, workspaceId);
      const candidateMap = new Map(scored.map(candidate => [normalizeKeyword(candidate.keyword), candidate])); // map-dup-ok — candidates are deduped by normalized keyword earlier in this function
      const reordered = aiRanked
        .map(candidate => candidateMap.get(normalizeKeyword(candidate.keyword)))
        .filter((candidate): candidate is ScoredCandidate => !!candidate);
      const reorderedKeys = new Set(reordered.map(candidate => normalizeKeyword(candidate.keyword)));
      const remaining = scored.filter(candidate => !reorderedKeys.has(normalizeKeyword(candidate.keyword)));
      const finalScored = [...reordered, ...remaining].slice(0, maxCandidates);
      for (const candidate of finalScored) candidate.isRecommended = false;
      if (finalScored[0]) finalScored[0].isRecommended = true;

      return {
        seedKeyword,
        candidates: finalScored.map(stripScore),
        recommended: finalScored[0]?.keyword ?? seedKeyword,
        reasoning: includeReasoning ? buildReasoning(finalScored) : undefined,
      };
    } catch (err) {
      log.warn({ err, workspaceId }, 'AI keyword ranking failed — falling back to deterministic smart scoring');
    }
  }

  for (const candidate of scored) candidate.isRecommended = false;
  if (scored[0]) scored[0].isRecommended = true;

  return {
    seedKeyword,
    candidates: scored.map(stripScore),
    recommended: scored[0]?.keyword ?? seedKeyword,
    reasoning: includeReasoning ? buildReasoning(scored) : undefined,
  };
}

// ── AI relevance ranking ────────────────────────────────────────────────────

async function aiRankKeywords(
  candidates: ScoredCandidate[],
  businessContext: string,
  workspaceId: string,
): Promise<KeywordCandidate[]> {
  const kwList = candidates.map(formatCandidateForAi).join('\n');

  const prompt = `You are an SEO strategist. Given the workspace context and keyword candidates below, rank them from BEST to WORST target keyword for a new content page.

Prioritize, in order:
1. Business fit and client demand signals
2. Avoiding obvious cannibalization or duplicate page targets
3. Achievable ranking potential for this workspace
4. Search volume and commercial value
5. Specificity over broad, noisy adjacent terms when both are plausible

WORKSPACE CONTEXT:
${businessContext.slice(0, 2500)}

KEYWORD CANDIDATES:
${kwList}

Return ONLY a JSON object with this shape, ranking keywords best first:
{ "keywords": ["best keyword", "second best"] }`;

  const result = await callAI({
    operation: 'keyword-recommendation-rank',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.2,
    workspaceId,
  });

  const ranked = parseKeywordRankingOutput(result.text);

  const candidateMap = new Map(candidates.map(candidate => [normalizeKeyword(candidate.keyword), candidate])); // map-dup-ok — ranked input is already deduped before AI reordering
  const reordered: KeywordCandidate[] = [];

  for (const keyword of ranked) {
    const normalizedKeyword = normalizeKeyword(keyword);
    const match = candidateMap.get(normalizedKeyword);
    if (match) {
      reordered.push(stripScore(match));
      candidateMap.delete(normalizedKeyword);
    }
  }

  for (const [, candidate] of candidateMap) {
    reordered.push(stripScore(candidate));
  }

  return reordered;
}
