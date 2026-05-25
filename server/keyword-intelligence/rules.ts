import type { KeywordSourceEvidence } from '../../shared/types/keywords.js';
import { normalizeKeywordForComparison } from '../../shared/keyword-normalization.js';
import { assessAuthorityFromBacklinks } from '../authority-context.js';
import type { KeywordBusinessContext, KeywordDecisionReason, KeywordEvaluationContext, KeywordEvaluationResult } from './types.js';

export const KEYWORD_STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'near', 'of', 'on', 'or', 'the', 'to', 'with']);

const LOW_ACTIONABILITY_PHRASES = [
  'paper tiger',
  'typing tiger',
  'tiger typing',
  'tiger type',
  'all domain name extensions list',
  'list of all domain name extensions',
];

export function normalizeKeyword(keyword: string): string {
  return normalizeKeywordForComparison(keyword);
}

export function keywordTokens(keyword: string): string[] {
  return normalizeKeyword(keyword)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !KEYWORD_STOP_WORDS.has(token));
}

export function wordOverlapRatio(a: string, b: string): number {
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

export function isNearDuplicateKeyword(a: string, b: string): boolean {
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

export function findKeywordMatches(keyword: string, phrases: string[] = [], maxMatches = 2): string[] {
  const matches: string[] = [];
  const normalizedKeyword = normalizeKeyword(keyword);
  const keywordTokenCount = keywordTokens(keyword).length;
  for (const phrase of phrases) {
    if (!phrase) continue;
    const normalizedPhrase = normalizeKeyword(phrase);
    const phraseTokenCount = keywordTokens(phrase).length;
    const singleTokenMatch = keywordTokenCount <= 1 || phraseTokenCount <= 1;
    if (
      normalizedKeyword === normalizedPhrase
      || (!singleTokenMatch && (isNearDuplicateKeyword(keyword, phrase) || wordOverlapRatio(keyword, phrase) >= 0.6))
    ) {
      matches.push(phrase);
    }
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

function findPositiveKeywordMatches(keyword: string, phrases: string[] = [], maxMatches = 2): string[] {
  const matches: string[] = [];
  const normalizedKeyword = normalizeKeyword(keyword);
  const keywordTokenSet = new Set(keywordTokens(keyword));
  for (const phrase of phrases) {
    if (!phrase) continue;
    const normalizedPhrase = normalizeKeyword(phrase);
    const phraseTokens = keywordTokens(phrase);
    const singleTokenPositiveMatch = phraseTokens.length === 1 && keywordTokenSet.has(phraseTokens[0]);
    if (
      normalizedKeyword === normalizedPhrase
      || singleTokenPositiveMatch
      || (phraseTokens.length > 1 && (isNearDuplicateKeyword(keyword, phrase) || wordOverlapRatio(keyword, phrase) >= 0.6))
    ) {
      matches.push(phrase);
    }
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

export function describeMatches(label: string, matches: string[]): string {
  if (matches.length === 0) return '';
  if (matches.length === 1) return `${label}: ${matches[0]}`;
  return `${label}: ${matches[0]} + ${matches.length - 1} more`;
}

export function opportunityScore(volume: number, difficulty: number, cpc = 0): number {
  if (volume <= 0) return 0;
  const volScore = Math.min(100, (Math.log10(volume) / 5) * 100);
  const diffScore = 100 - difficulty;
  const cpcBonus = Math.min(10, cpc * 2);
  return Math.round(volScore * 0.55 + diffScore * 0.45 + cpcBonus);
}

export function shouldIncludeKeywordCandidate(source: string, volume: number): boolean {
  return source === 'pattern' || source === 'gsc' || volume >= 10;
}

export function inferBroadMismatchPenalty(seedKeyword: string | undefined, candidateKeyword: string): number {
  if (!seedKeyword) return 0;
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

function isHumanOwnedSource(source: string | undefined): boolean {
  return source === 'pattern' || source === 'gsc' || source === 'client' || source === 'client_requested';
}

function hasLowActionabilityPattern(keyword: string): boolean {
  const normalized = normalizeKeyword(keyword);
  return LOW_ACTIONABILITY_PHRASES.some(phrase => normalized.includes(phrase));
}

function hasStrongBusinessPhraseMatch(keyword: string, ctx: KeywordBusinessContext): boolean {
  const keywordTerms = keywordTokens(keyword);
  if (keywordTerms.length === 0) return false;

  const phrases = [
    ...(ctx.businessTerms ?? []),
    ...(ctx.businessPhrases ?? []),
    ...(ctx.businessPriorities ?? []),
    ...(ctx.contentGapTopics ?? []),
    ...(ctx.recentChatTopics ?? []),
  ];
  return phrases.some(phrase => {
    const phraseTokenSet = new Set(keywordTokens(phrase));
    return keywordTerms.every(term => phraseTokenSet.has(term));
  });
}

export function buildBusinessTerms(ctx: KeywordBusinessContext): string[] {
  const terms = [
    ...(ctx.businessTerms ?? []),
    ...(ctx.businessPhrases ?? []),
    ...(ctx.businessPriorities ?? []),
    ...(ctx.contentGapTopics ?? []),
    ...(ctx.recentChatTopics ?? []),
  ];
  return [...new Set(terms.flatMap(term => keywordTokens(term)))];
}

export function inferBusinessFit(keyword: string, ctx: KeywordBusinessContext): { score: number; matches: string[] } {
  const businessTerms = buildBusinessTerms(ctx);
  if (businessTerms.length === 0) return { score: 0, matches: [] };

  const keywordTokenSet = new Set(keywordTokens(keyword));
  const matches = businessTerms.filter(term => keywordTokenSet.has(term));
  const score = businessTerms.length > 0 ? matches.length / Math.min(businessTerms.length, Math.max(keywordTokenSet.size, 1)) : 0;
  return { score: Math.min(1, score), matches: [...new Set(matches)].slice(0, 5) };
}

export function evaluateKeywordCandidate(
  candidate: { keyword: string; volume: number; difficulty: number; cpc: number; source?: string },
  ctx: KeywordEvaluationContext,
): KeywordEvaluationResult {
  const reasons: KeywordDecisionReason[] = [];
  const fitSignals: string[] = [];
  const normalizedKeyword = normalizeKeyword(candidate.keyword);
  let scoreDelta = 0;
  let suppressed = false;

  const requestedMatches = findPositiveKeywordMatches(candidate.keyword, ctx.requestedKeywords ?? []);
  const approvedMatches = findPositiveKeywordMatches(candidate.keyword, ctx.approvedKeywords ?? []);
  const declinedMatches = findKeywordMatches(candidate.keyword, ctx.declinedKeywords ?? []);
  const priorityMatches = findPositiveKeywordMatches(candidate.keyword, ctx.businessPriorities ?? []);
  const contentGapMatches = findPositiveKeywordMatches(candidate.keyword, ctx.contentGapTopics ?? [], 1);
  const recentChatMatches = findPositiveKeywordMatches(candidate.keyword, ctx.recentChatTopics ?? [], 1);

  if (candidate.source === 'pattern') {
    scoreDelta += 4;
    fitSignals.push('seed-keyword');
    reasons.push({ type: 'seed_keyword', message: 'Keeps the original target keyword in the option set', weight: 4 });
  }
  if (candidate.source === 'gsc') {
    scoreDelta += 8;
    fitSignals.push('gsc-proven');
    reasons.push({ type: 'gsc_proven', message: 'Already earns impressions in Search Console, so demand is proven', weight: 8 });
  }
  if (requestedMatches.length > 0) {
    scoreDelta += 18;
    fitSignals.push('client-requested');
    reasons.push({ type: 'client_requested', message: `Client explicitly requested a similar keyword (${describeMatches('matches', requestedMatches)})`, weight: 18 });
  }
  if (approvedMatches.length > 0) {
    scoreDelta += 12;
    fitSignals.push('client-approved');
    reasons.push({ type: 'client_approved', message: `Aligns with previously approved keyword feedback (${describeMatches('approved', approvedMatches)})`, weight: 12 });
  }
  if (priorityMatches.length > 0) {
    scoreDelta += 10;
    fitSignals.push('business-priority');
    reasons.push({ type: 'business_fit', message: `Tracks with current business priorities (${describeMatches('priority', priorityMatches)})`, weight: 10 });
  }
  if (contentGapMatches.length > 0) {
    scoreDelta += 8;
    fitSignals.push('content-gap-demand');
    reasons.push({ type: 'content_gap', message: `Matches a client-voted content need (${contentGapMatches[0]})`, weight: 8 });
  }
  if (recentChatMatches.length > 0) {
    scoreDelta += 6;
    fitSignals.push('recent-client-interest');
    reasons.push({ type: 'recent_client_interest', message: `Connects to a recent client conversation topic (${recentChatMatches[0]})`, weight: 6 });
  }

  if (declinedMatches.length > 0) {
    scoreDelta -= 40;
    reasons.push({ type: 'client_declined', message: `Similar to a previously declined keyword (${describeMatches('declined', declinedMatches)})`, weight: -40 });
    if (requestedMatches.length === 0 && approvedMatches.length === 0) suppressed = true;
  }

  const pageMapMatches = (ctx.pageMap ?? []).filter(page =>
    isNearDuplicateKeyword(page.primaryKeyword, candidate.keyword)
    || page.secondaryKeywords.some(secondary => isNearDuplicateKeyword(secondary, candidate.keyword)),
  );
  if (pageMapMatches.length > 0) {
    scoreDelta -= 20;
    reasons.push({ type: 'page_map_conflict', message: `Already mapped to an existing strategy page (${pageMapMatches[0].pagePath})`, weight: -20 });
  }

  const broadMismatchPenalty = inferBroadMismatchPenalty(ctx.seedKeyword, candidate.keyword);
  if (broadMismatchPenalty > 0 && requestedMatches.length === 0 && priorityMatches.length === 0) {
    scoreDelta -= broadMismatchPenalty;
    reasons.push({ type: 'broad_or_adjacent', message: 'Broader or less specific than the original seed topic', weight: -broadMismatchPenalty });
  }

  const seedOverlap = ctx.seedKeyword ? wordOverlapRatio(ctx.seedKeyword, candidate.keyword) : 0;
  if (ctx.seedKeyword && seedOverlap < 0.34 && requestedMatches.length === 0 && priorityMatches.length === 0 && contentGapMatches.length === 0) {
    scoreDelta -= 10;
    reasons.push({ type: 'weak_topical_overlap', message: 'Weak topical overlap with the original seed keyword', weight: -10 });
  }

  if (candidate.source === 'semrush_related' && candidate.volume < 25) {
    scoreDelta -= 6;
    reasons.push({ type: 'low_provider_demand', message: 'Very low provider volume for a related-keyword suggestion', weight: -6 });
  }

  if ((ctx.rejectionReasons ?? []).length > 0 && declinedMatches.length === 0 && candidate.source === 'semrush_related') {
    const genericRejectionPatterns = ['irrelevant', 'too broad', 'not a fit'];
    if ((ctx.rejectionReasons ?? []).some(reason => genericRejectionPatterns.some(pattern => reason.toLowerCase().includes(pattern)))) {
      scoreDelta -= 4;
      reasons.push({ type: 'business_mismatch', message: 'Workspace feedback patterns favor more specific, business-fit terms', weight: -4 });
    }
  }

  const authorityAssessment = assessAuthorityFromBacklinks(candidate.difficulty, ctx.backlinkProfile);
  if (ctx.backlinkProfile) {
    const authorityPenalty = ctx.backlinkProfile.referringDomains < 15 && candidate.difficulty >= 75
      ? 12
      : ctx.backlinkProfile.referringDomains < 40 && candidate.difficulty >= 85
        ? 8
        : 0;
    if (authorityPenalty > 0) {
      scoreDelta -= authorityPenalty;
      reasons.push({ type: 'authority_mismatch', message: authorityAssessment.note, weight: -authorityPenalty });
    }
  }

  const businessFit = inferBusinessFit(candidate.keyword, ctx);
  const hasBusinessFitContext = buildBusinessTerms(ctx).length > 0
    || requestedMatches.length > 0
    || approvedMatches.length > 0
    || priorityMatches.length > 0
    || contentGapMatches.length > 0
    || recentChatMatches.length > 0
    || (ctx.rejectionReasons ?? []).length > 0;
  if (businessFit.score > 0) {
    fitSignals.push('business-fit');
    reasons.push({ type: 'business_fit', message: `Matches business context terms (${businessFit.matches.join(', ')})`, weight: Math.round(businessFit.score * 8) });
    scoreDelta += Math.round(businessFit.score * 8);
  }

  const lowActionability = hasLowActionabilityPattern(candidate.keyword);
  const providerOwned = !isHumanOwnedSource(candidate.source);
  const strongBusinessPhraseMatch = hasStrongBusinessPhraseMatch(candidate.keyword, ctx);
  if (lowActionability && providerOwned && !strongBusinessPhraseMatch && requestedMatches.length === 0 && approvedMatches.length === 0) {
    suppressed = true;
    scoreDelta -= 50;
    reasons.push({ type: 'noise_pattern', message: 'Rejects a known low-actionability false-positive keyword pattern', weight: -50 });
  } else if (ctx.strictBusinessFit && hasBusinessFitContext && providerOwned && !strongBusinessPhraseMatch && businessFit.score === 0 && requestedMatches.length === 0 && approvedMatches.length === 0) {
    scoreDelta -= 18;
    reasons.push({ type: 'business_mismatch', message: 'No clear overlap with the workspace business context or approved/requested keywords', weight: -18 });
  }

  return {
    keyword: candidate.keyword,
    normalizedKeyword,
    scoreDelta,
    suppressed,
    reasons,
    fitSignals: [...new Set(fitSignals)],
  };
}

export function isStrategyPoolEligibleKeyword(
  keyword: KeywordSourceEvidence | { keyword: string; volume?: number; difficulty?: number; source?: string; sourceKind?: string },
  ctx: KeywordEvaluationContext = {},
): KeywordEvaluationResult {
  const candidate = {
    keyword: keyword.keyword,
    volume: keyword.volume ?? 0,
    difficulty: keyword.difficulty ?? 0,
    cpc: 'cpc' in keyword && typeof keyword.cpc === 'number' ? keyword.cpc : 0,
    source: ('source' in keyword ? keyword.source : undefined) ?? keyword.sourceKind ?? 'unknown',
  };
  const result = evaluateKeywordCandidate(candidate, { ...ctx, strictBusinessFit: ctx.strictBusinessFit ?? false });
  if (!normalizeKeyword(candidate.keyword)) {
    result.suppressed = true;
    result.reasons.push({ type: 'noise_pattern', message: 'Blank keyword candidate', weight: -100 });
  }
  if ((ctx.strictBusinessFit ?? false) && result.reasons.some(reason => reason.type === 'business_mismatch' && reason.weight <= -12)) {
    result.suppressed = true;
  }
  return result;
}
