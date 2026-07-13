import { createLogger } from '../../logger.js';
import { listContentGaps } from '../../content-gaps.js';
import { getDeclinedKeywords, getRequestedKeywords } from '../../keyword-feedback.js';
import { listPageKeywords } from '../../page-keywords.js';
import { getTrackedKeywords } from '../../rank-tracking.js';
import { getWorkspace } from '../../workspaces.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MARKET_STATUS,
  type LocalSeoDevice,
  type LocalSeoMarket,
  type LocalSeoPosture,
  type LocalSeoRefreshRequest,
} from '../../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS, type TrackedKeyword } from '../../../shared/types/rank-tracking.js';
import type { ContentGap, PageKeywordMap, Workspace } from '../../../shared/types/workspace.js';
import {
  buildLocalSeoKeywordCandidatesEvaluatedFromContext,
  buildLocalSeoKeywordCandidatesFromContext,
  countLocalSeoKeywordCandidatesFromContext,
  type CandidateIterationContext,
} from './candidate-pipeline.js';
import {
  LOCAL_SEO_DEFAULT_LANGUAGE_CODE,
  LOCAL_SEO_MAX_MARKETS,
  activeLocalSeoMarkets,
  getEffectiveKeywordsPerRefresh,
  localSeoMarketHasProviderLocationIdentity,
  readLocalSeoSettings,
} from './configuration-service.js';
import { applySourcePageCap, classifyLocalKeywordIntent, cleanKeywordDisplay } from './keyword-intent.js';
import { buildWorkspaceGeoRegex, buildWorkspaceServiceTermRegex } from './workspace-classifiers.js';
import type { LocalSeoKeywordCandidate } from './types.js';

const log = createLogger('local-seo/candidate-service');

const LOCAL_CANDIDATE_HARD_CAP = 1000;

function buildCandidateContext(workspace: Workspace) {
  const contentGaps = listContentGaps(workspace.id);
  const pageMap = listPageKeywords(workspace.id);
  const declinedKeywords = getDeclinedKeywords(workspace.id);
  const requestedKeywords = getRequestedKeywords(workspace.id);
  const strategy = workspace.keywordStrategy;
  const businessTerms = [
    workspace.name,
    strategy?.businessContext,
    workspace.intelligenceProfile?.industry,
    ...(workspace.businessPriorities ?? []), // businesspriorities-ok — Workspace.businessPriorities is admin workspace metadata, not ClientSignalsSlice.businessPriorities.
    ...(strategy?.siteKeywords ?? []),
    ...pageMap.flatMap(page => [page.pageTitle, page.primaryKeyword, ...(page.secondaryKeywords ?? [])]),
    ...contentGaps.flatMap(gap => [gap.topic, gap.targetKeyword]),
  ].filter((value): value is string => Boolean(value?.trim()));

  return {
    contentGaps,
    pageMap,
    declinedKeywords,
    requestedKeywords,
    evaluationContext: {
      workspaceId: workspace.id,
      pageMap,
      declinedKeywords,
      requestedKeywords,
      businessTerms,
      businessPhrases: [strategy?.businessContext ?? '', workspace.name].filter(Boolean),
      businessPriorities: workspace.businessPriorities ?? [], // businesspriorities-ok — Workspace.businessPriorities is admin workspace metadata, not ClientSignalsSlice.businessPriorities.
      contentGapTopics: contentGaps.map(gap => `${gap.topic} ${gap.targetKeyword}`),
      strictBusinessFit: true,
    },
  };
}

/**
 * Load the cheap data-fetch surface shared by both candidate builders.
 *
 * Returns null if the workspace cannot be found. Does not load markets-gated
 * behavior — callers decide whether an empty markets list short-circuits.
 */
export function loadCandidateIterationContext(
  workspaceId: string,
  explicitKeywords: string[] = [],
  options: { withEvaluationContext?: boolean } = {},
): CandidateIterationContext | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeLocalSeoMarkets(workspaceId);
  const built = buildCandidateContext(workspace);
  const declined = new Set(built.declinedKeywords.map(keywordComparisonKey));
  const trackedKeywords = getTrackedKeywords(workspaceId, { includeInactive: true });
  const inactiveTracked = new Set(
    trackedKeywords
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  // Precompute per-workspace classifiers once — reused per keyword in the hot loop.
  const serviceTermRegex = buildWorkspaceServiceTermRegex(workspace);
  const geoTermRegex = buildWorkspaceGeoRegex(workspace, markets)
    ?? /\bnear me\b|\/location\//i;
  const settingsPosture = readLocalSeoSettings(workspace).posture;

  return {
    workspace,
    markets,
    declined,
    inactiveTracked,
    trackedKeywords,
    contentGaps: built.contentGaps,
    pageMap: built.pageMap,
    explicitKeywords,
    settingsPosture,
    evaluationContext: options.withEvaluationContext ? built.evaluationContext : undefined,
    classifiers: { geoTermRegex, serviceTermRegex },
  };
}

function warnLocalSeoCandidateHardCap(workspaceId: string): void {
  log.warn({ workspaceId, cap: LOCAL_CANDIDATE_HARD_CAP }, 'local SEO candidate hard cap reached; output truncated');
}

/**
 * Cheap default local SEO candidate builder.
 */
export function buildLocalSeoKeywordCandidates(
  workspaceId: string,
  explicitKeywords: string[] = [],
): LocalSeoKeywordCandidate[] {
  const ctx = loadCandidateIterationContext(workspaceId, explicitKeywords);
  if (!ctx) return [];
  return buildLocalSeoKeywordCandidatesFromContext(ctx, {
    hardCap: LOCAL_CANDIDATE_HARD_CAP,
    onHardCapReached: () => warnLocalSeoCandidateHardCap(workspaceId),
  });
}

/**
 * Slow opt-in local SEO candidate builder with eligibility-evaluator reasons.
 */
export function buildLocalSeoKeywordCandidatesEvaluated(
  workspaceId: string,
  explicitKeywords: string[] = [],
): LocalSeoKeywordCandidate[] {
  const ctx = loadCandidateIterationContext(workspaceId, explicitKeywords, { withEvaluationContext: true });
  if (!ctx || !ctx.evaluationContext) return [];
  return buildLocalSeoKeywordCandidatesEvaluatedFromContext(ctx, {
    hardCap: LOCAL_CANDIDATE_HARD_CAP,
    onHardCapReached: () => warnLocalSeoCandidateHardCap(workspaceId),
  });
}

/**
 * Count-only local SEO candidate iteration — sub-100ms even on rich workspaces.
 */
export function countLocalSeoKeywordCandidates(workspaceId: string): number {
  const ctx = loadCandidateIterationContext(workspaceId, []);
  if (!ctx || ctx.markets.length === 0) return 0;
  return countLocalSeoKeywordCandidatesFromContext(ctx, { hardCap: LOCAL_CANDIDATE_HARD_CAP });
}

/** Count candidates from an already-loaded workspace read projection. */
export function countLocalSeoKeywordCandidatesFromLoadedContext(input: {
  workspace: Workspace;
  markets: LocalSeoMarket[];
  trackedKeywords: TrackedKeyword[];
  contentGaps: ContentGap[];
  pageMap: PageKeywordMap[];
  declinedKeywords: string[];
  settingsPosture?: LocalSeoPosture;
}): number {
  const markets = input.markets
    .filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)
    .filter(localSeoMarketHasProviderLocationIdentity)
    .slice(0, LOCAL_SEO_MAX_MARKETS);
  if (markets.length === 0) return 0;
  const ctx: CandidateIterationContext = {
    workspace: input.workspace,
    markets,
    declined: new Set(input.declinedKeywords.map(keywordComparisonKey)),
    inactiveTracked: new Set(input.trackedKeywords
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query))),
    trackedKeywords: input.trackedKeywords,
    contentGaps: input.contentGaps,
    pageMap: input.pageMap,
    explicitKeywords: [],
    settingsPosture: input.settingsPosture,
    classifiers: {
      geoTermRegex: buildWorkspaceGeoRegex(input.workspace, markets) ?? /\bnear me\b|\/location\//i,
      serviceTermRegex: buildWorkspaceServiceTermRegex(input.workspace),
    },
  };
  return countLocalSeoKeywordCandidatesFromContext(ctx, { hardCap: LOCAL_CANDIDATE_HARD_CAP });
}

function selectExplicitLocalSeoKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  const budget = getEffectiveKeywordsPerRefresh(workspaceId);
  const declined = new Set(getDeclinedKeywords(workspaceId).map(keywordComparisonKey));
  const inactiveTracked = new Set(
    getTrackedKeywords(workspaceId, { includeInactive: true })
      .filter(tracked => (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(tracked => keywordComparisonKey(tracked.query)),
  );
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const keyword of explicitKeywords) {
    const display = cleanKeywordDisplay(keyword);
    const key = display ? keywordComparisonKey(display) : '';
    if (!display || !key || seen.has(key) || declined.has(key) || inactiveTracked.has(key)) continue;
    seen.add(key);
    selected.push(display);
    if (selected.length >= budget) break;
  }
  return selected;
}

export function selectLocalIntentKeywords(workspaceId: string, explicitKeywords: string[] = []): string[] {
  if (explicitKeywords.length > 0) {
    const selected = selectExplicitLocalSeoKeywords(workspaceId, explicitKeywords);
    return selected.filter(kw => {
      const intent = classifyLocalKeywordIntent(kw);
      return intent !== 'informational' && intent !== 'comparison';
    });
  }
  const budget = getEffectiveKeywordsPerRefresh(workspaceId);
  const candidates = buildLocalSeoKeywordCandidatesEvaluated(workspaceId, explicitKeywords);
  const filteredCandidates = candidates.filter(c => c.intent !== 'informational' && c.intent !== 'comparison');
  const capped = applySourcePageCap(filteredCandidates, budget);
  return capped.slice(0, budget).map(c => c.keyword);
}

export function createLocalSeoRefreshPlan(
  workspaceId: string,
  request: LocalSeoRefreshRequest = {},
): { markets: LocalSeoMarket[]; keywords: string[]; device: LocalSeoDevice; languageCode: string } | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const markets = activeLocalSeoMarkets(workspaceId, request.marketIds).slice(0, LOCAL_SEO_MAX_MARKETS);
  const keywords = selectLocalIntentKeywords(workspaceId, request.keywords ?? [])
    .slice(0, getEffectiveKeywordsPerRefresh(workspaceId));
  return {
    markets,
    keywords,
    device: request.device === LOCAL_SEO_DEVICE.MOBILE ? LOCAL_SEO_DEVICE.MOBILE : LOCAL_SEO_DEVICE.DESKTOP,
    languageCode: request.languageCode || LOCAL_SEO_DEFAULT_LANGUAGE_CODE,
  };
}

/**
 * Deprecated alias — kept temporarily for downstream readers that haven't
 * migrated to the new per-workspace budget. New code should read
 * `LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH` from `shared/types/local-seo.ts`
 * or call `getEffectiveKeywordsPerRefresh(workspaceId)` for the resolved value.
 */
export const LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH = LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH;
