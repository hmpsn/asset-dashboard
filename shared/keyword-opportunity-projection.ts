import { keywordComparisonKey } from './keyword-normalization.js';

export interface KeywordOpportunityProjectionInput {
  keyword?: string | null;
  targetKeyword?: string | null;
  topic?: string | null;
  valueScore?: number | null;
  opportunityScore?: number | null;
  displayScore?: number | null;
  sortScore?: number | null;
  valueReasons?: readonly string[] | null;
  reasons?: readonly string[] | null;
  currentMonthly?: number | null;
  upsideMonthly?: number | null;
  clientSafeExplanation?: string | null;
  rationale?: string | null;
  volume?: number | null;
  impressions?: number | null;
  priority?: string | null;
  backfilled?: boolean | null;
}

export interface KeywordOpportunityProjection {
  keyword: string;
  normalizedKeyword: string;
  displayScore?: number;
  sortScore: number;
  reasons: string[];
  currentMonthly?: number;
  upsideMonthly?: number;
  clientSafeExplanation?: string;
  demandBucket: 0 | 1 | 2;
  demandSortValue: number;
  priorityWeight: number;
  backfilled: boolean;
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.find(value => value != null && value.trim().length > 0)?.trim() ?? '';
}

function firstScore(...values: Array<number | null | undefined>): number | undefined {
  return values.find(value => value != null);
}

function scoreForSort(value: number | null | undefined): number {
  return value ?? 0;
}

function demandBundle(input: KeywordOpportunityProjectionInput): Pick<KeywordOpportunityProjection, 'demandBucket' | 'demandSortValue'> {
  if (input.volume == null) return { demandBucket: 1, demandSortValue: 0 };
  if (input.volume > 0) return { demandBucket: 2, demandSortValue: input.volume };
  if ((input.impressions ?? 0) > 0) return { demandBucket: 2, demandSortValue: input.impressions! };
  return { demandBucket: 0, demandSortValue: 0 };
}

export function keywordOpportunityPriorityWeight(priority: string | null | undefined): number {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
}

export function projectKeywordOpportunity(input: KeywordOpportunityProjectionInput): KeywordOpportunityProjection {
  const displayScore = firstScore(input.displayScore, input.opportunityScore);
  const sortScore = scoreForSort(firstScore(input.sortScore, input.displayScore, input.opportunityScore));
  const keyword = firstText(input.keyword, input.targetKeyword, input.topic);
  const demand = demandBundle(input);
  return {
    keyword,
    normalizedKeyword: keywordComparisonKey(keyword),
    displayScore,
    sortScore,
    reasons: [...(input.valueReasons ?? input.reasons ?? [])],
    currentMonthly: input.currentMonthly ?? undefined,
    upsideMonthly: input.upsideMonthly ?? undefined,
    clientSafeExplanation: firstText(input.clientSafeExplanation, input.rationale) || undefined,
    demandBucket: demand.demandBucket,
    demandSortValue: demand.demandSortValue,
    priorityWeight: keywordOpportunityPriorityWeight(input.priority),
    backfilled: input.backfilled === true,
  };
}

export function compareKeywordOpportunityScoreDesc(
  a: KeywordOpportunityProjectionInput,
  b: KeywordOpportunityProjectionInput,
): number {
  return projectKeywordOpportunity(b).sortScore - projectKeywordOpportunity(a).sortScore;
}

export function compareContentGapDisplayOrder(
  a: KeywordOpportunityProjectionInput,
  b: KeywordOpportunityProjectionInput,
): number {
  const projectedA = projectKeywordOpportunity(a);
  const projectedB = projectKeywordOpportunity(b);
  return projectedB.sortScore - projectedA.sortScore
    || ((b.volume || 0) - (a.volume || 0))
    || projectedB.priorityWeight - projectedA.priorityWeight;
}

export function compareOrganicContentGapDisplayOrder(
  a: KeywordOpportunityProjectionInput,
  b: KeywordOpportunityProjectionInput,
): number {
  const projectedA = projectKeywordOpportunity(a);
  const projectedB = projectKeywordOpportunity(b);
  return (projectedA.backfilled ? 1 : 0) - (projectedB.backfilled ? 1 : 0)
    || projectedB.sortScore - projectedA.sortScore;
}

export function compareBriefingContentGapDisplayOrder(
  a: KeywordOpportunityProjectionInput,
  b: KeywordOpportunityProjectionInput,
): number {
  const projectedA = projectKeywordOpportunity(a);
  const projectedB = projectKeywordOpportunity(b);
  return projectedB.sortScore - projectedA.sortScore
    || projectedB.demandBucket - projectedA.demandBucket
    || projectedB.demandSortValue - projectedA.demandSortValue
    || projectedB.priorityWeight - projectedA.priorityWeight;
}

export function compareContentGapDemandDisplayOrder(
  a: KeywordOpportunityProjectionInput,
  b: KeywordOpportunityProjectionInput,
): number {
  const projectedA = projectKeywordOpportunity(a);
  const projectedB = projectKeywordOpportunity(b);
  return projectedB.demandBucket - projectedA.demandBucket
    || projectedB.demandSortValue - projectedA.demandSortValue
    || projectedB.priorityWeight - projectedA.priorityWeight;
}
