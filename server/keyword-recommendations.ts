/**
 * Smart Keyword Recommendations — fetches SEMRush related keywords,
 * scores them by opportunity (volume-to-difficulty ratio), and optionally
 * uses AI to rank by business relevance.
 *
 * Used by content matrices to recommend the best target keyword for each cell.
 */
import { getConfiguredProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import { callOpenAI, parseAIJson } from './openai-helpers.js';
import { buildWorkspaceIntelligence, formatForPrompt } from './workspace-intelligence.js';
import { createLogger } from './logger.js';
import type { KeywordCandidate } from '../shared/types/content.ts';
import { isProgrammingError } from './errors.js';
import type * as WorkspaceLearnings from './workspace-learnings.js';

const log = createLogger('keyword-recommendations');

type ScoredCandidate = KeywordCandidate & { _score: number };

function stripScore(c: ScoredCandidate): KeywordCandidate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _score, ...rest } = c;
  return rest;
}

// ── Opportunity scoring ──

/**
 * Score a keyword on a 0-100 scale based on volume and difficulty.
 * Higher volume + lower difficulty = higher score.
 */
function opportunityScore(volume: number, difficulty: number): number {
  // Normalize volume: log scale (0 = 0, 10 = 33, 100 = 50, 1000 = 67, 10000 = 83, 100000 = 100)
  const volScore = volume <= 0 ? 0 : Math.min(100, (Math.log10(volume) / 5) * 100);
  // Invert difficulty: 0 difficulty = 100 score, 100 difficulty = 0 score
  const diffScore = 100 - difficulty;
  // Weighted: 40% volume, 60% difficulty (prefer achievable keywords)
  return Math.round(volScore * 0.4 + diffScore * 0.6);
}

// ── Core recommendation function ──

export interface KeywordRecommendationResult {
  seedKeyword: string;
  candidates: KeywordCandidate[];
  recommended: string | null;
  message?: string;
}

/**
 * Get keyword recommendations for a seed keyword.
 *
 * Flow:
 * 1. Fetch SEMRush overview for the seed keyword
 * 2. Fetch SEMRush related keywords
 * 3. Score all candidates by opportunity
 * 4. Optionally use AI to rank by business relevance
 * 5. Return sorted candidates with a recommended pick
 */
export async function getKeywordRecommendations(
  workspaceId: string,
  seedKeyword: string,
  options: {
    useAI?: boolean;
    maxCandidates?: number;
  } = {},
): Promise<KeywordRecommendationResult> {
  const { useAI = false, maxCandidates = 15 } = options;

  const ws = getWorkspace(workspaceId);
  const provider = getConfiguredProvider(ws?.seoDataProvider);
  if (!provider) {
    return {
      seedKeyword,
      candidates: [{
        keyword: seedKeyword,
        volume: 0,
        difficulty: 0,
        cpc: 0,
        source: 'pattern',
        isRecommended: true,
      }],
      recommended: seedKeyword,
      message: 'No SEO data provider configured — seed keyword used as-is',
    };
  }

  // Fetch seed metrics + related keywords in parallel
  const [seedMetrics, related] = await Promise.all([
    provider.getKeywordMetrics([seedKeyword], workspaceId).catch(() => []),
    provider.getRelatedKeywords(seedKeyword, workspaceId, maxCandidates).catch(() => []),
  ]);

  const seed = seedMetrics[0];
  const candidates: KeywordCandidate[] = [];

  // Add seed keyword as a candidate
  if (seed) {
    candidates.push({
      keyword: seed.keyword,
      volume: seed.volume,
      difficulty: seed.difficulty,
      cpc: seed.cpc,
      source: 'pattern',
      isRecommended: false,
    });
  } else {
    candidates.push({
      keyword: seedKeyword,
      volume: 0,
      difficulty: 0,
      cpc: 0,
      source: 'pattern',
      isRecommended: false,
    });
  }

  // Add related keywords as candidates
  for (const r of related.slice(0, maxCandidates - 1)) {
    candidates.push({
      keyword: r.keyword,
      volume: r.volume,
      difficulty: r.difficulty,
      cpc: r.cpc,
      source: 'semrush_related',
      isRecommended: false,
    });
  }

  // Score and sort by opportunity
  const scored = candidates
    .map(c => ({ ...c, _score: opportunityScore(c.volume, c.difficulty) }))
    .sort((a, b) => b._score - a._score);

  // ── Bridge #9: Weight by empirical win rate per KD range ──────────
  try {
    const { getWorkspaceLearnings }: typeof WorkspaceLearnings = await import('./workspace-learnings.js'); // dynamic-import-ok
    const learnings = getWorkspaceLearnings(workspaceId, 'strategy');
    const kdRangeWinRates = learnings?.strategy?.winRateByDifficultyRange;
    if (kdRangeWinRates && Object.keys(kdRangeWinRates).length > 0) {
      for (const candidate of scored) {
        const kd = candidate.difficulty ?? 0;
        // Match KD to the range buckets used by workspace-learnings: 0-20, 21-40, 41-60, 61-80, 81-100
        const range = kd <= 20 ? '0-20' : kd <= 40 ? '21-40' : kd <= 60 ? '41-60' : kd <= 80 ? '61-80' : '81-100';
        const winRate = kdRangeWinRates[range];
        if (winRate != null && winRate > 0.5) {
          candidate._score = Math.round((candidate._score ?? 0) * 1.2);
        } else if (winRate != null && winRate < 0.3) {
          candidate._score = Math.round((candidate._score ?? 0) * 0.8);
        }
      }
      // Re-sort after score adjustments
      scored.sort((a, b) => b._score - a._score);
    }
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId }, 'keyword-recommendations: programming error in workspace-learnings — check export names');
    } else {
      log.debug({ err, workspaceId }, 'keyword-recommendations: learnings enrichment optional, degrading gracefully');
    }
  }

  // If AI scoring is enabled and we have business context, re-rank
  if (useAI && candidates.length > 1) {
    try {
      const slices = ['seoContext', 'learnings'] as const;
      const kwIntel = await buildWorkspaceIntelligence(workspaceId, { slices });
      const seoCtx = kwIntel.seoContext;
      // Only call AI ranking when meaningful workspace context exists (formatForPrompt always returns non-empty).
      // Include strategy check — workspaces with only a keyword strategy still benefit from AI ranking.
      const hasMeaningfulContext = !!(seoCtx?.businessContext || seoCtx?.knowledgeBase || seoCtx?.brandVoice || seoCtx?.personas?.length || seoCtx?.strategy);
      // Use full context (business context + brand voice + personas + knowledge + learnings) for richer ranking
      const bizContext = hasMeaningfulContext ? formatForPrompt(kwIntel, { verbosity: 'detailed', sections: slices }) : '';
      if (bizContext) {
        const aiRanked = await aiRankKeywords(scored, bizContext, workspaceId);
        // Mark the AI-recommended keyword
        for (const c of aiRanked) {
          c.isRecommended = false;
        }
        if (aiRanked.length > 0) {
          aiRanked[0].isRecommended = true;
        }
        return {
          seedKeyword,
          candidates: aiRanked,
          recommended: aiRanked[0]?.keyword ?? seedKeyword,
        };
      }
    } catch (err) {
      log.warn({ err }, 'AI keyword ranking failed — falling back to opportunity score');
    }
  }

  // Mark the top-scored keyword as recommended
  const final = scored.map(stripScore);
  if (final.length > 0) {
    final[0].isRecommended = true;
  }

  return {
    seedKeyword,
    candidates: final,
    recommended: final[0]?.keyword ?? seedKeyword,
  };
}

// ── AI relevance ranking ──

async function aiRankKeywords(
  candidates: ScoredCandidate[],
  businessContext: string,
  workspaceId: string,
): Promise<KeywordCandidate[]> {
  const kwList = candidates
    .map(c => `- "${c.keyword}" (vol: ${c.volume}, KD: ${c.difficulty}, CPC: $${c.cpc.toFixed(2)}, opp_score: ${c._score})`)
    .join('\n');

  const prompt = `You are an SEO strategist. Given the business context and keyword candidates below, rank them from BEST to WORST target keyword for a new content page.

Consider:
1. Relevance to the business (most important)
2. Search volume (higher is better)
3. Keyword difficulty (lower is better for achievable ranking)
4. Commercial intent (higher CPC suggests buyer intent)
5. Specificity (long-tail often converts better than generic)

BUSINESS CONTEXT:
${businessContext.slice(0, 1000)}

KEYWORD CANDIDATES:
${kwList}

Return a JSON array of the keywords in ranked order (best first). Only return the keyword strings:
["best keyword", "second best", ...]`;

  const result = await callOpenAI({
    model: 'gpt-4.1-nano',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.2,
    feature: 'keyword-recommendations',
    workspaceId,
  });

  const ranked = parseAIJson<string[]>(result.text);
  if (!Array.isArray(ranked)) throw new Error('AI did not return an array');

  // Reorder candidates by AI ranking
  const candidateMap = new Map(candidates.map(c => [c.keyword.toLowerCase(), c]));
  const reordered: KeywordCandidate[] = [];

  for (const kw of ranked) {
    const match = candidateMap.get(kw.toLowerCase());
    if (match) {
      reordered.push(stripScore(match));
      candidateMap.delete(kw.toLowerCase());
    }
  }

  // Append any candidates the AI missed
  for (const [, c] of candidateMap) {
    reordered.push(stripScore(c));
  }

  return reordered;
}
