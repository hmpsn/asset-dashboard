import type { KeywordCandidate } from '../../shared/types/keyword-universe.js';
import { filterBrandedContentGaps } from '../competitor-brand-filter.js';
import {
  backfillContentGapsToFloor,
  type BackfillContentGapCandidate,
} from '../keyword-strategy-helpers.js';
import { normalizeKeyword } from '../keyword-intelligence/index.js';
import type { MasterStrategyData, PageMapping, StrategyContentGap, StrategyKeywordFix } from './types.js';

export function applyKeywordConflictFixes(
  pageMappings: PageMapping[],
  fixes: StrategyKeywordFix[] | undefined,
  isEligibleGeneratedKeyword: (keyword: string) => boolean,
): { appliedFixes: number; suppressedFixes: number } {
  if (!fixes?.length) return { appliedFixes: 0, suppressedFixes: 0 };
  const fixMap = new Map(fixes.map(f => [f.pagePath, f.newPrimaryKeyword]));
  let appliedFixes = 0;
  let suppressedFixes = 0;
  for (const pm of pageMappings) {
    const fix = fixMap.get(pm.pagePath);
    if (fix && isEligibleGeneratedKeyword(fix)) {
      pm.primaryKeyword = fix;
      appliedFixes++;
    } else if (fix) {
      suppressedFixes++;
    }
  }
  return { appliedFixes, suppressedFixes };
}

export function filterMasterSiteKeywords(
  siteKeywords: string[] | undefined,
  declinedSet: Set<string>,
  isEligibleGeneratedKeyword: (keyword: string) => boolean,
): { siteKeywords: string[] | undefined; declinedRemoved: number; sharedRemoved: number } {
  if (!siteKeywords?.length) return { siteKeywords, declinedRemoved: 0, sharedRemoved: 0 };
  const declinedFiltered = siteKeywords.filter(kw => !declinedSet.has(normalizeKeyword(kw)));
  const declinedRemoved = siteKeywords.length - declinedFiltered.length;
  const sharedFiltered = declinedFiltered.filter(kw => isEligibleGeneratedKeyword(kw));
  return {
    siteKeywords: sharedFiltered,
    declinedRemoved,
    sharedRemoved: declinedFiltered.length - sharedFiltered.length,
  };
}

export function filterMasterContentGaps(
  contentGaps: MasterStrategyData['contentGaps'] | undefined,
  competitorDomains: string[],
  declinedSet: Set<string>,
  isEligibleGeneratedKeyword: (keyword: string) => boolean,
): {
  finalContentGaps: Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
  brandedRemoved: Array<{ targetKeyword: string }>;
  declinedRemoved: number;
  sharedRemoved: number;
} {
  const rawContentGaps = contentGaps || [];
  const { filtered: cleanContentGaps, removed: brandedRemoved } = filterBrandedContentGaps(rawContentGaps, competitorDomains);
  const declinedFiltered = cleanContentGaps.filter(
    (cg: { targetKeyword?: string }) =>
      !cg.targetKeyword || !declinedSet.has(normalizeKeyword(cg.targetKeyword)),
  ) as Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
  const sharedFiltered = declinedFiltered.filter((cg: { targetKeyword?: string }) =>
    !cg.targetKeyword || isEligibleGeneratedKeyword(cg.targetKeyword),
  ) as Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
  return {
    finalContentGaps: sharedFiltered,
    brandedRemoved,
    declinedRemoved: cleanContentGaps.length - declinedFiltered.length,
    sharedRemoved: declinedFiltered.length - sharedFiltered.length,
  };
}

export function applyRequestedGapsAndBackfill(opts: {
  contentGaps: Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
  pageMappings: PageMapping[];
  universeCandidates: KeywordCandidate[];
  floor: number;
}): {
  contentGaps: Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
  requestedReadded: number;
  backfilledCount: number;
} {
  let contentGaps = opts.contentGaps;
  const pageMapKeys = new Set(
    opts.pageMappings
      .flatMap(pm => [pm.primaryKeyword, ...(pm.secondaryKeywords ?? [])])
      .map(k => normalizeKeyword(k))
      .filter(Boolean),
  );
  const gapKeys = new Set(
    contentGaps.map(cg => normalizeKeyword(cg.targetKeyword ?? '')).filter(Boolean),
  );

  let requestedReadded = 0;
  for (const candidate of opts.universeCandidates) {
    if (!candidate.requested || candidate.declined) continue;
    const key = normalizeKeyword(candidate.keyword);
    if (!key || pageMapKeys.has(key) || gapKeys.has(key)) continue;
    contentGaps = [
      ...contentGaps,
      {
        topic: candidate.keyword,
        targetKeyword: candidate.keyword,
        intent: 'commercial',
        priority: 'high',
        rationale: 'Client-requested keyword with no existing page coverage — surfaced as a content gap.',
        volume: candidate.volume,
        difficulty: candidate.difficulty,
        requested: true,
      } as StrategyContentGap & { targetKeyword: string; topic: string },
    ];
    gapKeys.add(key);
    requestedReadded++;
  }

  let backfilledCount = 0;
  if (contentGaps.length < opts.floor) {
    const selectedKeys = new Set([...pageMapKeys, ...gapKeys]);
    const prunedFromUniverse: BackfillContentGapCandidate[] = [];
    for (const candidate of opts.universeCandidates) {
      const key = normalizeKeyword(candidate.keyword);
      if (!key || candidate.declined || selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      prunedFromUniverse.push({
        targetKeyword: candidate.keyword,
        volume: candidate.volume,
        difficulty: candidate.difficulty,
      });
    }
    if (prunedFromUniverse.length > 0) {
      const backfill = backfillContentGapsToFloor(
        contentGaps,
        prunedFromUniverse.map(c => ({
          ...c,
          topic: c.targetKeyword,
          intent: 'informational',
          priority: 'medium',
          rationale: 'Re-admitted from the keyword universe to meet the content-gap floor.',
        })) as Array<StrategyContentGap & { targetKeyword: string; topic: string }>,
        opts.floor,
      );
      contentGaps = backfill.gaps;
      backfilledCount = backfill.backfilledCount;
    }
  }

  return { contentGaps, requestedReadded, backfilledCount };
}

export function applyDeclinedPageMapFilter(pageMappings: PageMapping[], declinedSet: Set<string>): void {
  for (const pm of pageMappings) {
    if (pm.primaryKeyword && declinedSet.has(normalizeKeyword(pm.primaryKeyword))) {
      pm.primaryKeyword = '';
    }
    if (pm.secondaryKeywords?.length) {
      pm.secondaryKeywords = pm.secondaryKeywords.filter(k => !declinedSet.has(normalizeKeyword(k)));
    }
  }
}
