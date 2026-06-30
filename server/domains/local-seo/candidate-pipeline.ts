import { isNearDuplicateKeyword, isStrategyPoolEligibleKeyword } from '../../keyword-intelligence/rules.js';
import type { KeywordEvaluationContext } from '../../keyword-intelligence/types.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  LOCAL_SEO_POSTURE,
  type LocalSeoKeywordIntent,
  type LocalSeoMarket,
  type LocalSeoPosture,
} from '../../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS, type TrackedKeyword } from '../../../shared/types/rank-tracking.js';
import type { ContentGap, PageKeywordMap, Workspace } from '../../../shared/types/workspace.js';
import {
  candidateSourceScore,
  classifyLocalKeywordIntent,
  cleanKeywordDisplay,
  hasMarketModifier,
  localVariantKeywordsByMarket,
  titleLooksLikeServiceKeyword,
  normalizeText,
} from './keyword-intent.js';
import { buildWorkspaceServiceTermRegex } from './workspace-classifiers.js';
import type { LocalSeoKeywordCandidate } from './types.js';

const LOCAL_INTENT_PREFIXES = [
  'emergency', 'open now', 'best',
  'same day', 'affordable', 'cheap',
  'top rated', 'accepting new patients', '24 hour',
] as const;

const LOCAL_INTENT_PREFIX_CAP_PER_BASE = 3;

export interface CandidateIterationContext {
  workspace: Workspace;
  markets: LocalSeoMarket[];
  declined: Set<string>;
  inactiveTracked: Set<string>;
  trackedKeywords: TrackedKeyword[];
  contentGaps: ContentGap[];
  pageMap: PageKeywordMap[];
  explicitKeywords: string[];
  settingsPosture?: LocalSeoPosture;
  evaluationContext?: KeywordEvaluationContext;
  classifiers: {
    geoTermRegex: RegExp;
    serviceTermRegex: RegExp;
  };
}

export interface CandidateSourceSignal {
  keyword: string | undefined;
  source: LocalSeoKeywordCandidate['source'];
  force?: boolean;
  selected?: boolean;
  sourceLabel?: string;
  detail?: string;
  pagePath?: string;
  pageTitle?: string;
  marketId?: string | null;
  volume?: number;
  difficulty?: number;
  scoreBoost?: number;
  intent?: LocalSeoKeywordIntent;
}

export interface CandidateBuildOptions {
  hardCap: number;
  onHardCapReached?: () => void;
}

export function hasLocalIntentForWorkspace(
  keyword: string,
  workspace: Workspace,
  settingsPosture: LocalSeoPosture,
  precomputedServiceTermRegex?: RegExp,
): boolean {
  const normalized = normalizeText(keyword);
  const address = workspace.businessProfile?.address;
  const city = normalizeText(address?.city);
  const state = normalizeText(address?.state);
  if (/\bnear me\b|\blocal\b|\bdowntown\b|\bmidtown\b|\bheights\b|\bservice area\b/.test(normalized)) return true;
  if (city && normalized.includes(city)) return true;
  if (state && normalized.includes(state)) return true;
  const serviceTermRegex = precomputedServiceTermRegex ?? buildWorkspaceServiceTermRegex(workspace);
  if (serviceTermRegex.test(normalized)) {
    return settingsPosture !== LOCAL_SEO_POSTURE.NON_LOCAL;
  }
  return false;
}

export function* iterateLocalCandidateSignals(
  ctx: CandidateIterationContext,
): Generator<CandidateSourceSignal> {
  const { workspace, markets, trackedKeywords, contentGaps, pageMap, explicitKeywords, classifiers } = ctx;
  const settingsPosture = ctx.settingsPosture ?? LOCAL_SEO_POSTURE.UNKNOWN;
  const { geoTermRegex, serviceTermRegex } = classifiers;

  for (const keyword of explicitKeywords) {
    yield {
      keyword,
      source: 'explicit',
      force: true,
      selected: true,
      sourceLabel: 'Selected for refresh',
      scoreBoost: 30,
    };
  }

  for (const keyword of workspace.keywordStrategy?.siteKeywords ?? []) {
    yield {
      keyword,
      source: 'strategy',
      selected: true,
      sourceLabel: 'Strategy keyword',
      scoreBoost: 12,
    };
  }

  for (const tracked of trackedKeywords) {
    if ((tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) continue;
    yield {
      keyword: tracked.query,
      source: 'tracking',
      selected: true,
      sourceLabel: 'Rank tracking',
      detail: tracked.source?.replace(/_/g, ' '),
      pagePath: tracked.pagePath,
      pageTitle: tracked.pageTitle,
      volume: tracked.volume,
      difficulty: tracked.difficulty,
      scoreBoost: tracked.pinned ? 20 : 8,
    };
  }

  for (const page of pageMap) {
    const pageLooksLocal = geoTermRegex.test(`${page.pagePath} ${page.pageTitle}`)
      || /appointment/i.test(`${page.pagePath} ${page.pageTitle}`)
      || page.serpFeatures?.includes('local_pack');
    yield {
      keyword: page.primaryKeyword,
      source: 'page_assignment',
      force: pageLooksLocal,
      selected: true,
      sourceLabel: 'Page assignment',
      detail: page.pageTitle ?? page.pagePath,
      pagePath: page.pagePath,
      pageTitle: page.pageTitle,
      volume: page.volume,
      difficulty: page.difficulty,
      scoreBoost: 10,
    };
    for (const secondary of page.secondaryKeywords ?? []) {
      yield {
        keyword: secondary,
        source: 'page_assignment',
        force: pageLooksLocal,
        selected: true,
        sourceLabel: 'Page assignment',
        detail: page.pageTitle ?? page.pagePath,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        scoreBoost: 4,
      };
    }
    if (titleLooksLikeServiceKeyword(page.pageTitle, serviceTermRegex)) {
      yield {
        keyword: page.pageTitle,
        source: 'page_assignment',
        force: pageLooksLocal,
        selected: true,
        sourceLabel: 'Service page',
        detail: page.pagePath,
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
      };
    }
    for (const base of [page.primaryKeyword, page.pageTitle, ...(page.secondaryKeywords ?? [])]) {
      if (!base || !titleLooksLikeServiceKeyword(base, serviceTermRegex) || isNearDuplicateKeyword(base, workspace.name)) continue;
      for (const variant of localVariantKeywordsByMarket(base, markets)) {
        yield {
          keyword: variant.keyword,
          source: 'local_variant',
          sourceLabel: 'Local candidate',
          detail: page.pageTitle ?? page.pagePath,
          pagePath: page.pagePath,
          pageTitle: page.pageTitle,
          marketId: variant.marketId,
          intent: classifyLocalKeywordIntent(variant.keyword),
        };
      }
    }
    if (titleLooksLikeServiceKeyword(page.pageTitle, serviceTermRegex) && markets.length > 0) {
      const primaryBase = cleanKeywordDisplay(page.pageTitle);
      const primaryMarket = markets[0];
      if (primaryBase && primaryMarket) {
        let intentCount = 0;
        for (const prefix of LOCAL_INTENT_PREFIXES) {
          if (intentCount >= LOCAL_INTENT_PREFIX_CAP_PER_BASE) break;
          const variant = `${prefix} ${primaryBase} ${primaryMarket.city}`.toLowerCase().trim();
          const variantIntent: LocalSeoKeywordIntent =
            prefix === 'emergency' || prefix === 'same day' || prefix === 'open now' || prefix === '24 hour' || prefix === 'accepting new patients'
              ? 'transactional'
              : 'commercial';
          yield {
            keyword: variant,
            source: 'local_variant',
            sourceLabel: 'Intent candidate',
            detail: page.pageTitle ?? page.pagePath,
            pagePath: page.pagePath,
            pageTitle: page.pageTitle,
            marketId: primaryMarket.id,
            intent: variantIntent,
          };
          intentCount++;
        }
      }
    }
  }

  for (const gap of contentGaps) {
    const localGap = gap.suggestedPageType === 'location'
      || gap.serpFeatures?.includes('local_pack')
      || hasLocalIntentForWorkspace(`${gap.topic} ${gap.targetKeyword}`, workspace, settingsPosture, serviceTermRegex);
    yield {
      keyword: gap.targetKeyword,
      source: 'content_gap',
      force: localGap,
      selected: false,
      sourceLabel: 'Content opportunity',
      detail: gap.topic,
      volume: gap.volume,
      difficulty: gap.difficulty,
      scoreBoost: gap.priority === 'high' ? 8 : 0,
    };
    for (const variant of localVariantKeywordsByMarket(gap.targetKeyword, markets)) {
      yield {
        keyword: variant.keyword,
        source: 'local_variant',
        sourceLabel: 'Local content candidate',
        detail: gap.topic,
        marketId: variant.marketId,
        volume: gap.volume,
        difficulty: gap.difficulty,
        intent: classifyLocalKeywordIntent(variant.keyword),
      };
    }
    if (titleLooksLikeServiceKeyword(gap.targetKeyword, serviceTermRegex) && markets.length > 0) {
      const primaryBase = cleanKeywordDisplay(gap.targetKeyword);
      const primaryMarket = markets[0];
      if (primaryBase && primaryMarket) {
        let intentCount = 0;
        for (const prefix of LOCAL_INTENT_PREFIXES) {
          if (intentCount >= LOCAL_INTENT_PREFIX_CAP_PER_BASE) break;
          const variant = `${prefix} ${primaryBase} ${primaryMarket.city}`.toLowerCase().trim();
          const variantIntent: LocalSeoKeywordIntent =
            prefix === 'emergency' || prefix === 'same day' || prefix === 'open now' || prefix === '24 hour' || prefix === 'accepting new patients'
              ? 'transactional'
              : 'commercial';
          yield {
            keyword: variant,
            source: 'local_variant',
            sourceLabel: 'Intent candidate',
            detail: gap.topic,
            marketId: primaryMarket.id,
            volume: gap.volume,
            difficulty: gap.difficulty,
            intent: variantIntent,
          };
          intentCount++;
        }
      }
    }
  }
}

function upsertCandidate(
  candidates: Map<string, LocalSeoKeywordCandidate>,
  key: string,
  display: string,
  signal: CandidateSourceSignal,
  score: number,
  reasons: string[],
): void {
  const existing = candidates.get(key);
  const next: LocalSeoKeywordCandidate = {
    keyword: display,
    normalizedKeyword: key,
    source: signal.source,
    sourceLabel: signal.sourceLabel ?? signal.source.replace(/_/g, ' '),
    detail: signal.detail,
    pagePath: signal.pagePath,
    pageTitle: signal.pageTitle,
    marketId: signal.marketId,
    volume: signal.volume,
    difficulty: signal.difficulty,
    selected: signal.selected
      ?? (signal.source === 'strategy' || signal.source === 'tracking' || signal.source === 'page_assignment'),
    score,
    reasons,
    intent: signal.intent ?? classifyLocalKeywordIntent(display),
  };
  if (!existing || next.score > existing.score || (next.selected && !existing.selected)) {
    candidates.set(key, next);
  }
}

export function buildLocalSeoKeywordCandidatesFromContext(
  ctx: CandidateIterationContext,
  options: CandidateBuildOptions,
): LocalSeoKeywordCandidate[] {
  const candidates = new Map<string, LocalSeoKeywordCandidate>();
  let candidateHardCapReached = false;

  for (const signal of iterateLocalCandidateSignals(ctx)) {
    const display = cleanKeywordDisplay(signal.keyword);
    if (!display) continue;
    const key = keywordComparisonKey(display);
    if (!key || ctx.declined.has(key) || ctx.inactiveTracked.has(key)) continue;
    if (candidates.size >= options.hardCap && !candidates.has(key)) {
      candidateHardCapReached = true;
      continue;
    }
    if (
      !signal.force
      && !hasLocalIntentForWorkspace(display, ctx.workspace, ctx.settingsPosture ?? LOCAL_SEO_POSTURE.UNKNOWN, ctx.classifiers.serviceTermRegex)
      && !hasMarketModifier(display, ctx.markets)
    ) continue;

    const localIntentScore = hasMarketModifier(display, ctx.markets)
      ? 12
      : hasLocalIntentForWorkspace(display, ctx.workspace, ctx.settingsPosture ?? LOCAL_SEO_POSTURE.UNKNOWN, ctx.classifiers.serviceTermRegex) ? 8 : 0;
    const score = candidateSourceScore(signal.source) + localIntentScore + (signal.scoreBoost ?? 0);
    upsertCandidate(candidates, key, display, signal, score, []);
  }

  if (candidateHardCapReached) options.onHardCapReached?.();
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

export function buildLocalSeoKeywordCandidatesEvaluatedFromContext(
  ctx: CandidateIterationContext,
  options: CandidateBuildOptions,
): LocalSeoKeywordCandidate[] {
  if (!ctx.evaluationContext) return [];
  const evaluationContext = ctx.evaluationContext;
  const candidates = new Map<string, LocalSeoKeywordCandidate>();
  let candidateHardCapReached = false;

  for (const signal of iterateLocalCandidateSignals(ctx)) {
    const display = cleanKeywordDisplay(signal.keyword);
    if (!display) continue;
    const key = keywordComparisonKey(display);
    if (!key || ctx.declined.has(key) || ctx.inactiveTracked.has(key)) continue;
    if (candidates.size >= options.hardCap && !candidates.has(key)) {
      candidateHardCapReached = true;
      continue;
    }
    if (
      !signal.force
      && !hasLocalIntentForWorkspace(display, ctx.workspace, ctx.settingsPosture ?? LOCAL_SEO_POSTURE.UNKNOWN, ctx.classifiers.serviceTermRegex)
      && !hasMarketModifier(display, ctx.markets)
    ) continue;

    const evaluationSource = signal.source === 'local_variant' ? 'local_generated' : signal.source === 'tracking' ? 'gsc' : 'client';
    const evaluation = isStrategyPoolEligibleKeyword({
      keyword: display,
      volume: signal.volume ?? 0,
      difficulty: signal.difficulty ?? 0,
      source: evaluationSource,
    }, evaluationContext);
    if (evaluation.suppressed) continue;

    const localIntentScore = hasMarketModifier(display, ctx.markets)
      ? 12
      : hasLocalIntentForWorkspace(display, ctx.workspace, ctx.settingsPosture ?? LOCAL_SEO_POSTURE.UNKNOWN, ctx.classifiers.serviceTermRegex) ? 8 : 0;
    const score = candidateSourceScore(signal.source) + localIntentScore + evaluation.scoreDelta + (signal.scoreBoost ?? 0);
    upsertCandidate(candidates, key, display, signal, score, evaluation.reasons.map(r => r.message).slice(0, 4));
  }

  if (candidateHardCapReached) options.onHardCapReached?.();
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

export function countLocalSeoKeywordCandidatesFromContext(
  ctx: CandidateIterationContext,
  options: Pick<CandidateBuildOptions, 'hardCap'>,
): number {
  const seen = new Set<string>();
  for (const signal of iterateLocalCandidateSignals(ctx)) {
    if (seen.size >= options.hardCap) break;
    const display = cleanKeywordDisplay(signal.keyword);
    if (!display) continue;
    const key = keywordComparisonKey(display);
    if (!key || ctx.declined.has(key) || ctx.inactiveTracked.has(key)) continue;
    if (
      !signal.force
      && !hasLocalIntentForWorkspace(display, ctx.workspace, ctx.settingsPosture ?? LOCAL_SEO_POSTURE.UNKNOWN, ctx.classifiers.serviceTermRegex)
      && !hasMarketModifier(display, ctx.markets)
    ) continue;
    seen.add(key);
  }
  return seen.size;
}
