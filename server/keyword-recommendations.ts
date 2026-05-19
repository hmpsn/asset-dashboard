/**
 * Smart Keyword Recommendations — fetches SEO provider related keywords,
 * scores them by opportunity + strategic fit, and optionally uses AI to
 * re-rank by business relevance when enough workspace context exists.
 *
 * Used by content matrices to recommend the best target keyword for each cell.
 */
import { getConfiguredProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { getQueryPageData } from './search-console.js';
import { callAI } from './ai.js';
import { parseAIJson } from './openai-helpers.js';
import { buildRecommendationGenerationContext } from './intelligence/generation-context-builders.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { checkKeywordCannibalization, type CannibalizationConflict } from './cannibalization-detection.js';
import { createLogger } from './logger.js';
import type {
  KeywordCandidate,
  KeywordRecommendationReasoning,
  KeywordRecommendationResult,
} from '../shared/types/content.ts';
import type { ClientSignalsSlice, LearningsSlice, SeoContextSlice } from '../shared/types/intelligence.ts';
import type { PageKeywordMap } from '../shared/types/workspace.ts';
import { sanitizeQueryForPrompt } from './helpers.js';

const log = createLogger('keyword-recommendations');

const recommendationSlices = ['seoContext', 'learnings', 'clientSignals'] as const;
const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'near', 'of', 'on', 'or', 'the', 'to', 'with']);

type ConflictSeverity = CannibalizationConflict['severity'];

type ScoredCandidate = KeywordCandidate & {
  _score: number;
  _reasons: string[];
  _penaltyReasons: string[];
  _fitSignals: string[];
  _conflictSeverity: ConflictSeverity | null;
};

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
  kdRangeWinRates: Record<string, number>;
  backlinkProfile: SeoContextSlice['backlinkProfile'];
  excludedConflictIdentifiers: string[];
  workspaceId: string;
}

function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywordTokens(keyword: string): string[] {
  return normalizeKeyword(keyword)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

function wordOverlapRatio(a: string, b: string): number {
  const aTokens = new Set(keywordTokens(a));
  const bTokens = new Set(keywordTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function isNearDuplicateKeyword(a: string, b: string): boolean {
  const normalizedA = normalizeKeyword(a);
  const normalizedB = normalizeKeyword(b);
  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;

  const aTokens = keywordTokens(a);
  const bTokens = keywordTokens(b);
  if (aTokens.length === 0 || bTokens.length === 0) return false;

  const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const longer = aTokens.length <= bTokens.length ? bTokens : aTokens;
  const matches = shorter.filter(token => longer.includes(token)).length;
  return matches / shorter.length >= 0.8;
}

function getDifficultyRangeLabel(difficulty: number): string {
  if (difficulty <= 20) return '0-20';
  if (difficulty <= 40) return '21-40';
  if (difficulty <= 60) return '41-60';
  if (difficulty <= 80) return '61-80';
  return '81-100';
}

function findKeywordMatches(keyword: string, phrases: string[], maxMatches: number = 2): string[] {
  const matches: string[] = [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    if (isNearDuplicateKeyword(keyword, phrase) || wordOverlapRatio(keyword, phrase) >= 0.6) {
      matches.push(phrase);
    }
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

function describeMatches(label: string, matches: string[]): string {
  if (matches.length === 0) return '';
  if (matches.length === 1) return `${label}: ${matches[0]}`;
  return `${label}: ${matches[0]} + ${matches.length - 1} more`;
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

function inferBroadMismatchPenalty(seedKeyword: string, candidateKeyword: string): number {
  const seedTokens = keywordTokens(seedKeyword);
  const candidateTokens = keywordTokens(candidateKeyword);
  if (seedTokens.length < 2 || candidateTokens.length === 0) return 0;

  const overlap = wordOverlapRatio(seedKeyword, candidateKeyword);
  const candidateShorter = candidateTokens.length + 1 < seedTokens.length;
  const missingSeedSpecificity = candidateShorter && overlap >= 0.34;
  if (missingSeedSpecificity) return 12;
  if (candidateTokens.length <= 2 && overlap < 0.34) return 10;
  return 0;
}

function inferAuthorityMismatchPenalty(candidate: KeywordCandidate, backlinkProfile: SeoContextSlice['backlinkProfile']): number {
  if (!backlinkProfile) return 0;
  if (backlinkProfile.referringDomains < 15 && candidate.difficulty >= 75) return 12;
  if (backlinkProfile.referringDomains < 40 && candidate.difficulty >= 85) return 8;
  return 0;
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
    || clientSignals?.businessPriorities?.length
    || clientSignals?.keywordFeedback?.approved?.length
    || clientSignals?.keywordFeedback?.rejected?.length
    || clientSignals?.recentChatTopics?.length
  );
  return hasMeaningfulContext;
}

function buildScoringContext(
  workspaceId: string,
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
    businessPriorities: clientSignals?.businessPriorities ?? [],
    contentGapTopics: (clientSignals?.contentGapVotes ?? []).map(vote => vote.topic),
    recentChatTopics: clientSignals?.recentChatTopics ?? [],
    rejectionReasons: clientSignals?.keywordFeedback.patterns.topRejectionReasons ?? [],
    kdRangeWinRates: learnings?.summary?.strategy?.winRateByDifficultyRange ?? {},
    backlinkProfile: seoContext?.backlinkProfile,
    excludedConflictIdentifiers,
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

  const requestedMatches = findKeywordMatches(candidate.keyword, ctx.requestedKeywords);
  const approvedMatches = findKeywordMatches(candidate.keyword, ctx.approvedKeywords);
  const declinedMatches = findKeywordMatches(candidate.keyword, ctx.declinedKeywords);
  const priorityMatches = findKeywordMatches(candidate.keyword, ctx.businessPriorities);
  const contentGapMatches = findKeywordMatches(candidate.keyword, ctx.contentGapTopics, 1);
  const recentChatMatches = findKeywordMatches(candidate.keyword, ctx.recentChatTopics, 1);
  const seedOverlap = wordOverlapRatio(ctx.seedKeyword, candidate.keyword);

  if (candidate.source === 'pattern') {
    score += 4;
    fitSignals.push('seed-keyword');
    reasons.push('Keeps the original target keyword in the option set');
  }

  if (candidate.source === 'gsc') {
    score += 8;
    fitSignals.push('gsc-proven');
    reasons.push('Already earns impressions in Search Console, so demand is proven');
  }

  if (requestedMatches.length > 0) {
    score += 18;
    fitSignals.push('client-requested');
    reasons.push(`Client explicitly requested a similar keyword (${describeMatches('matches', requestedMatches)})`);
  }

  if (approvedMatches.length > 0) {
    score += 12;
    fitSignals.push('client-approved');
    reasons.push(`Aligns with previously approved keyword feedback (${describeMatches('approved', approvedMatches)})`);
  }

  if (priorityMatches.length > 0) {
    score += 10;
    fitSignals.push('business-priority');
    reasons.push(`Tracks with current business priorities (${describeMatches('priority', priorityMatches)})`);
  }

  if (contentGapMatches.length > 0) {
    score += 8;
    fitSignals.push('content-gap-demand');
    reasons.push(`Matches a client-voted content need (${contentGapMatches[0]})`);
  }

  if (recentChatMatches.length > 0) {
    score += 6;
    fitSignals.push('recent-client-interest');
    reasons.push(`Connects to a recent client conversation topic (${recentChatMatches[0]})`);
  }

  const kdRangeLabel = getDifficultyRangeLabel(candidate.difficulty ?? 0);
  const kdWinRate = ctx.kdRangeWinRates[kdRangeLabel];
  if (kdWinRate != null) {
    if (kdWinRate > 0.5) {
      score = Math.round(score * 1.2);
      reasons.push(`Difficulty range ${kdRangeLabel} has performed well for this workspace historically`);
    } else if (kdWinRate < 0.3) {
      score = Math.round(score * 0.8);
      penaltyReasons.push(`Difficulty range ${kdRangeLabel} has underperformed historically`);
    }
  }

  if (declinedMatches.length > 0) {
    score -= 40;
    penaltyReasons.push(`Similar to a previously declined keyword (${describeMatches('declined', declinedMatches)})`);
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

  const pageMapMatches = ctx.pageMap.filter(page =>
    isNearDuplicateKeyword(page.primaryKeyword, candidate.keyword)
    || page.secondaryKeywords.some(secondary => isNearDuplicateKeyword(secondary, candidate.keyword)),
  );
  if (pageMapMatches.length > 0) {
    score -= 20;
    penaltyReasons.push(`Already mapped to an existing strategy page (${pageMapMatches[0].pagePath})`);
  }

  const broadMismatchPenalty = inferBroadMismatchPenalty(ctx.seedKeyword, candidate.keyword);
  if (broadMismatchPenalty > 0 && requestedMatches.length === 0 && priorityMatches.length === 0) {
    score -= broadMismatchPenalty;
    penaltyReasons.push('Broader or less specific than the original seed topic');
  }

  if (seedOverlap < 0.34 && requestedMatches.length === 0 && priorityMatches.length === 0 && contentGapMatches.length === 0) {
    score -= 10;
    penaltyReasons.push('Weak topical overlap with the original seed keyword');
  }

  if (candidate.source === 'semrush_related' && candidate.volume < 25) {
    score -= 6;
    penaltyReasons.push('Very low provider volume for a related-keyword suggestion');
  }

  if (ctx.rejectionReasons.length > 0 && declinedMatches.length === 0 && candidate.source === 'semrush_related') {
    const genericRejectionPatterns = ['irrelevant', 'too broad', 'not a fit'];
    if (ctx.rejectionReasons.some(reason => genericRejectionPatterns.some(pattern => reason.toLowerCase().includes(pattern)))) {
      score -= 4;
      penaltyReasons.push('Workspace feedback patterns favor more specific, business-fit terms');
    }
  }

  const authorityMismatchPenalty = inferAuthorityMismatchPenalty(candidate, ctx.backlinkProfile);
  if (authorityMismatchPenalty > 0) {
    score -= authorityMismatchPenalty;
    penaltyReasons.push('Difficulty looks high relative to the current backlink footprint');
  }

  const uniqueReasons = [...new Set([...reasons, ...penaltyReasons])].slice(0, 5);
  if (declinedMatches.length > 0 && requestedMatches.length === 0 && approvedMatches.length === 0) {
    return null;
  }

  return {
    ...candidate,
    _score: score,
    _reasons: uniqueReasons,
    _penaltyReasons: [...new Set(penaltyReasons)],
    _fitSignals: [...new Set(fitSignals)],
    _conflictSeverity: conflictSeverity,
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

  return {
    recommendedReason: recommendedReasons.join(' '),
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

// ── Opportunity scoring ────────────────────────────────────────────────────

/**
 * Score a keyword on a 0–110 scale based on volume, difficulty, and commercial intent.
 * Base score is 0–100 (55% volume + 45% difficulty inversion); CPC adds up to 10 bonus points.
 * Higher volume + lower difficulty + higher CPC = higher score.
 * @internal exported for unit testing
 */
export function opportunityScore(volume: number, difficulty: number, cpc: number = 0): number {
  if (volume <= 0) return 0;
  const volScore = Math.min(100, (Math.log10(volume) / 5) * 100);
  const diffScore = 100 - difficulty;
  const cpcBonus = Math.min(10, cpc * 2);
  return Math.round(volScore * 0.55 + diffScore * 0.45 + cpcBonus);
}

/**
 * Returns true if a keyword candidate should be included in scoring.
 * Seed keywords (source === 'pattern') are always kept; related keywords require
 * at least 10 monthly searches to avoid noise.
 * @internal exported for unit testing
 */
export function shouldIncludeKeywordCandidate(source: string, volume: number): boolean {
  return source === 'pattern' || source === 'gsc' || volume >= 10;
}

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

  const [seedMetrics, related, recommendationContext] = await Promise.all([
    provider.getKeywordMetrics([seedKeyword], workspaceId).catch(() => []),
    provider.getRelatedKeywords(seedKeyword, workspaceId, maxCandidates).catch(() => []),
    buildRecommendationGenerationContext(workspaceId, {
      slices: recommendationSlices,
      learningsDomain: 'strategy',
      verbosity: 'detailed',
      tokenBudget: 2400,
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
    seedKeyword,
    seoContext,
    learnings,
    clientSignals,
    [...(options.excludeConflictIdentifiers ?? [])],
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
      }
    : {
        keyword: seedKeyword,
        volume: 0,
        difficulty: 0,
        cpc: 0,
        source: 'pattern',
        isRecommended: false,
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
        if (!candidates.some(candidate => candidate.keyword.toLowerCase() === sanitizedQuery.toLowerCase())) {
          candidates.push({
            keyword: sanitizedQuery,
            volume: Math.max(1, Math.round(row.impressions / 3)),
            difficulty: 50,
            cpc: 0,
            source: 'gsc',
            isRecommended: false,
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
      const aiRanked = await aiRankKeywords(scored, recommendationContext.promptContext, workspaceId);
      const candidateMap = new Map(scored.map(candidate => [candidate.keyword.toLowerCase(), candidate])); // map-dup-ok — candidates are deduped by normalized keyword earlier in this function
      const reordered = aiRanked
        .map(candidate => candidateMap.get(candidate.keyword.toLowerCase()))
        .filter((candidate): candidate is ScoredCandidate => !!candidate);
      const remaining = scored.filter(candidate => !reordered.some(item => item.keyword.toLowerCase() === candidate.keyword.toLowerCase()));
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

Return a JSON array of the keywords in ranked order (best first). Only return the keyword strings:
["best keyword", "second best", ...]`;

  const result = await callAI({
    model: 'gpt-5.4-mini',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.2,
    feature: 'keyword-recommendations',
    workspaceId,
  });

  const ranked = parseAIJson<string[]>(result.text);
  if (!Array.isArray(ranked)) throw new Error('AI did not return an array');

  const candidateMap = new Map(candidates.map(candidate => [candidate.keyword.toLowerCase(), candidate])); // map-dup-ok — ranked input is already deduped before AI reordering
  const reordered: KeywordCandidate[] = [];

  for (const keyword of ranked) {
    const match = candidateMap.get(keyword.toLowerCase());
    if (match) {
      reordered.push(stripScore(match));
      candidateMap.delete(keyword.toLowerCase());
    }
  }

  for (const [, candidate] of candidateMap) {
    reordered.push(stripScore(candidate));
  }

  return reordered;
}
