import { applySuppressionsToAudit } from './seo-audit-suppressions.js';
import { getAuditTrafficForWorkspace } from './audit-traffic.js';
import { normalizePageUrl } from './utils/page-address.js';
import { getLatestSnapshot } from './reports.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { KeywordSourceEvidence } from '../shared/types/keywords.js';
import type { KeywordStrategy, Workspace } from '../shared/types/workspace.js';
import type { KeywordStrategyPageInfo } from './keyword-strategy-pages.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import type { CompetitorKeywordData, QuestionKeywordGroup } from './keyword-strategy-seo-data.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword, SeoDataProvider } from './seo-data-provider.js';
import { buildStrategySignals } from './insight-feedback.js';
import { extractBrandTokens } from './competitor-brand-filter.js';
import { isProgrammingError } from './errors.js';
import { resolveWorkspaceLanguageCode, resolveWorkspaceLocationCode } from './local-seo.js';
import { buildStrategyIntelligenceBlock, getPagesNeedingAnalysis, isSuspiciousPlannerGroupedVolume, STRATEGY_CONTENT_GAP_FLOOR } from './keyword-strategy-helpers.js';
import { pageAssignmentResponseSchema, siteSynthesisResponseSchema } from './schemas/keyword-strategy-schemas.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword, type KeywordEvaluationContext } from './keyword-intelligence/index.js';
import { buildKeywordUniverse } from './keyword-strategy-universe.js';
import type { KeywordCandidate } from '../shared/types/keyword-universe.js';
import { callKeywordStrategyAI, callNamedStrategyAI } from './keyword-strategy-synthesis/ai-callers.js';
import { KeywordStrategySynthesisError } from './keyword-strategy-synthesis/errors.js';
import { assembleSynthesisContext } from './keyword-strategy-synthesis/context.js';
import { validatePageMappingsWithProvider } from './keyword-strategy-synthesis/provider-validation.js';
import {
  buildKeywordPoolSection,
  buildLegacyKeywordPool,
} from './keyword-strategy-synthesis/pool.js';
import {
  buildBatchPagesBlock,
  buildCandidateIds,
  buildClosedSetBlock,
  buildClosedSetPageAssignmentPrompt,
  buildClosedSetSiteSynthesisPrompt,
  buildLegacyPageAssignmentPrompt,
  buildLegacySiteSynthesisPrompt,
  resolveClosedSetKeyword,
} from './keyword-strategy-synthesis/prompts.js';
import {
  applyDeclinedPageMapFilter,
  applyKeywordConflictFixes,
  applyRequestedGapsAndBackfill,
  filterMasterContentGaps,
  filterMasterSiteKeywords,
} from './keyword-strategy-synthesis/finalize.js';
import type {
  KeywordStrategyKeywordPool,
  MasterStrategyData,
  PageMapping,
  StrategyContentGap,
  StrategyKeywordFix,
  StrategyOutput,
  StrategyPageMapEntry,
  StrategyQuickWin,
} from './keyword-strategy-synthesis/types.js';

export { callKeywordStrategyAI, callNamedStrategyAI } from './keyword-strategy-synthesis/ai-callers.js';
export { KeywordStrategySynthesisError } from './keyword-strategy-synthesis/errors.js';
export {
  buildConflictNote,
  buildCountryBreakdownBlock,
  buildDeviceBreakdownBlock,
  buildFallbackKeywordFromPageIdentity,
  buildGscQueriesBlock,
  buildKeywordSummaryLine,
  buildPeriodComparisonBlock,
  buildTopConvertingPages,
  detectKeywordConflicts,
  filterDeclinedContentGaps,
  filterDeclinedSiteKeywords,
  findHighBounceLandingPages,
  findUnmappedLandingPages,
} from './keyword-strategy-synthesis/prompt-blocks.js';
export {
  buildKeywordPoolSection,
  buildLegacyKeywordPool,
  type BuildLegacyKeywordPoolOptions,
  type BuildLegacyKeywordPoolResult,
} from './keyword-strategy-synthesis/pool.js';
export type {
  KeywordStrategyKeywordPool,
  MasterStrategyData,
  PageMapping,
  StrategyContentGap,
  StrategyKeywordFix,
  StrategyOutput,
  StrategyPageMapEntry,
  StrategyQuickWin,
} from './keyword-strategy-synthesis/types.js';

const log = createLogger('keyword-strategy:synthesis');

export interface SynthesizeKeywordStrategyOptions {
  ws: Workspace;
  businessContext: string;
  strategyMode: 'full' | 'incremental';
  seoDataMode: 'quick' | 'full' | 'none';
  /** Resolved live base URL used by the keyword-universe assembler. */
  baseUrl?: string;
  competitorDomains: string[];
  pageInfo: KeywordStrategyPageInfo[];
  preloadedPageKeywords: ReturnType<typeof listPageKeywords> | null;
  searchData: KeywordStrategySearchData;
  seoContext: string;
  domainKeywords: DomainKeyword[];
  keywordGaps: KeywordGapEntry[];
  discoveryKeywords: KeywordSourceEvidence[];
  relatedKeywords: RelatedKeyword[];
  competitorKeywords: CompetitorKeywordData[];
  provider: SeoDataProvider | null;
  sendProgress: (step: string, detail: string, progress: number) => void;
}

export interface SynthesizeKeywordStrategyResult {
  strategy: StrategyOutput | (KeywordStrategy & { pageMap?: StrategyPageMapEntry[] }) | null;
  pagesToAnalyze: KeywordStrategyPageInfo[];
  keywordPool: KeywordStrategyKeywordPool;
  businessSection: string;
  keywordEvaluationContext: KeywordEvaluationContext;
  upToDate?: boolean;
  freshPageCount?: number;
  /** Candidates suppressed by the flag-ON keyword-universe assembler. */
  suppressedCount?: number;
  /** Flag-ON question keywords surfaced by the keyword-universe assembler. */
  questionKeywords?: QuestionKeywordGroup[];
}

export async function synthesizeKeywordStrategy(options: SynthesizeKeywordStrategyOptions): Promise<SynthesizeKeywordStrategyResult> {
  const {
    ws,
    businessContext,
    strategyMode,
    seoDataMode,
    competitorDomains,
    pageInfo,
    preloadedPageKeywords,
    searchData,
    seoContext: semrushContext,
    domainKeywords: semrushDomainData,
    keywordGaps,
    discoveryKeywords,
    relatedKeywords: relatedKws,
    competitorKeywords: competitorKeywordData,
    provider,
    sendProgress,
  } = options;
  const {
    gscData,
    deviceBreakdown,
    countryBreakdown,
    periodComparison,
    organicLandingPages,
    organicOverview,
    ga4Conversions,
    ga4EventsByPage,
  } = searchData;

  const callStrategyAI = (messages: Array<{ role: string; content: string }>, maxTokens: number, label?: string): Promise<string> =>
    callKeywordStrategyAI(ws.id, messages, maxTokens, label);

  // Keyword pool — declared outside try so enrichment code can access it after batching
  const keywordPool = new Map<string, { volume: number; difficulty: number; source: string }>();

  const {
    businessSection,
    strategyIntel,
    declinedKeywords,
    requestedKeywords,
    includeLocalUniverse,
    keywordEvaluationContext: strategyKeywordEvaluationContext,
  } = await assembleSynthesisContext({ ws, businessContext });
  const clientSignals = strategyIntel.clientSignals;

  // The generation-quality path is now canonical. Local-intent candidates still stay
  // posture-gated so non-local workspaces do not accumulate irrelevant local terms.
  const seoGenQualityEnabled = true;

    let strategy: StrategyOutput = {};
    // Hoisted out of the try-block so incremental-mode post-processing (below) can reference it.
    let pagesToAnalyze: typeof pageInfo = [];
    // --- Incremental mode: split pages into fresh (preserve) vs stale (analyze) ---
    // Reuse the pre-loaded records from before content fetch (avoids a redundant DB read).
    const existingPageKeywords = preloadedPageKeywords ?? listPageKeywords(ws.id);
    const existingByPath = new Map(
      existingPageKeywords.map(pk => [pk.pagePath, { analysisGeneratedAt: pk.analysisGeneratedAt ?? null }])
    );
    const { toAnalyze, toPreserve: pagesToPreserve } = getPagesNeedingAnalysis(
      pageInfo,
      strategyMode,
      existingByPath,
    );
    pagesToAnalyze = toAnalyze;
    if (strategyMode === 'incremental') {
      log.info(`Incremental mode: ${pagesToAnalyze.length} stale pages to analyze, ${pagesToPreserve.length} fresh pages to preserve`);
      sendProgress('ai', `Incremental mode: ${pagesToAnalyze.length} pages need fresh analysis, ${pagesToPreserve.length} already fresh`, 0.54);
      // Early exit: all pages are fresh — nothing to re-analyze. Refund the pre-reserved slot.
      if (pagesToAnalyze.length === 0) {
        log.info({ workspaceId: ws.id }, 'Incremental mode: all pages already fresh, skipping re-analysis');
        sendProgress('complete', 'All pages are already up to date — no re-analysis needed.', 1.0);
        const currentStrategy = {
          ...(ws.keywordStrategy ?? {}),
          pageMap: existingPageKeywords,
        } as StrategyOutput;
        return { strategy: currentStrategy, upToDate: true, freshPageCount: pagesToPreserve.length, pagesToAnalyze, keywordPool, businessSection, keywordEvaluationContext: strategyKeywordEvaluationContext };
      }
    }
    // For AI batching we only process stale pages; preserved pages are merged back after.
    const pagesForBatching = strategyMode === 'incremental' ? pagesToAnalyze : pageInfo;

    // --- STEP 1: Parallel page analysis batches ---
    const BATCH_SIZE = 20;
    const batches: typeof pageInfo[] = [];
    for (let i = 0; i < pagesForBatching.length; i += BATCH_SIZE) {
      batches.push(pagesForBatching.slice(i, i + BATCH_SIZE));
    }
    log.info(`Splitting ${pagesForBatching.length} pages into ${batches.length} batches of ~${BATCH_SIZE}`);
    sendProgress('ai', `Analyzing pages in ${batches.length} parallel batches...`, 0.55);

    // Build per-page GSC context lookup
    const gscByPath = new Map<string, Array<{ query: string; position: number; clicks: number; impressions: number }>>();
    for (const r of gscData) {
      const p = normalizePageUrl(r.page);
      if (!gscByPath.has(p)) gscByPath.set(p, []);
      gscByPath.get(p)!.push({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions });
    }

    // Build provider keyword reference for batch prompts — give the AI real search terms to pick from
    let semrushBatchRef = '';
    const semrushByPath = new Map<string, typeof semrushDomainData>();
    // Populate keyword pool from ALL available data sources
    const isEligibleStrategyPoolKeyword = (keyword: { keyword: string; volume?: number; difficulty?: number; cpc?: number; source?: string; sourceKind?: string }): boolean => {
      const evaluation = isStrategyPoolEligibleKeyword(keyword, strategyKeywordEvaluationContext);
      if (evaluation.suppressed) {
        log.info({ workspaceId: ws.id, keyword: keyword.keyword, reasons: evaluation.reasons.map(reason => reason.message) }, 'Suppressed keyword pool candidate via shared keyword intelligence');
        return false;
      }
      return true;
    };
    const isEligibleGeneratedKeyword = (keyword: string): boolean => {
      const normalizedKeyword = normalizeKeyword(keyword);
      const poolMatch = keywordPool.get(normalizedKeyword);
      return isEligibleStrategyPoolKeyword({
        keyword,
        volume: poolMatch?.volume ?? 0,
        difficulty: poolMatch?.difficulty ?? 0,
        source: poolMatch?.source ?? 'ai_suggested',
      });
    };
    let sanitizedProviderKeywordLines = 0;
    const sanitizedProviderContext = semrushContext.split('\n').filter(line => {
      const keywordMatch = line.match(/^\s*-\s*"([^"]+)"/);
      if (!keywordMatch) return true;

      const volumeMatch = line.match(/vol:\s*([\d,]+)/i);
      const difficultyMatch = line.match(/KD:\s*([\d.]+)/i);
      const keyword = keywordMatch[1];
      const eligible = isEligibleStrategyPoolKeyword({
        keyword,
        volume: volumeMatch ? Number(volumeMatch[1].replace(/,/g, '')) : 0,
        difficulty: difficultyMatch ? Number(difficultyMatch[1]) : 0,
        source: 'provider_context',
      });
      if (eligible) sanitizedProviderKeywordLines++;
      return eligible;
    }).join('\n');
    const eligibleKeywordGapCount = keywordGaps.filter(gap =>
      isEligibleStrategyPoolKeyword({
        keyword: gap.keyword,
        volume: gap.volume,
        difficulty: gap.difficulty,
        source: `gap:${gap.competitorDomain}`,
      })
    ).length;

    // Declined set — needed by BOTH the flag-ON and flag-OFF pool paths and by
    // downstream post-generation filters, so it is hoisted above the branch.
    const declinedSet = new Set(declinedKeywords.map(k => normalizeKeyword(k)).filter(Boolean));

    // ── DARK LAUNCH (P1): buildKeywordUniverse is the single pool builder ──
    // Flag-ON folds the entire pool build (and the provider discovery fetch) into
    // the shared assembler — one builder, geo + language threaded, MCP-seedable.
    // Flag-OFF keeps the legacy block VERBATIM so it is byte-identical to today.
    // (`seoGenQualityEnabled` is computed once above, before the eval context.)
    let suppressedUniverseCount = 0;
    // Prompt-facing count of client-sourced keywords. (M1) On the flag-OFF path
    // this MUST keep the exact pre-filter increment semantics of origin/staging
    // (counted as each client keyword is upserted, BEFORE the branded/declined
    // hard-filters run) so the flag-OFF master-prompt sentence is byte-identical —
    // it diverges from a post-filter pool-derived count when a client keyword is
    // also branded/declined. On the flag-ON path we use the universe-derived
    // (final-pool) count instead. The legacy fold increments this directly.
    let clientKeywordsAdded = 0;
    // The assembler built the pool on the flag-ON path (vs the legacy else fold).
    // Used downstream to thread the resolved language into metrics validation (I4)
    // without disturbing the flag-OFF path. M2 may flip this back to false if the
    // assembler throws and we degrade to the legacy fold.
    let usedKeywordUniverse = false;
    // Grouped question keywords surfaced by the assembler (flag-ON) so generation
    // can thread them into FAQ enrichment in place of the legacy prefetch (which is
    // gated off on flag-ON). Undefined unless the assembler ran successfully — on
    // the flag-OFF path AND the M2 degradation fallback it stays undefined so
    // generation uses the legacy seo-data `questionKeywords` (flag-OFF byte-identical).
    let universeQuestionKeywords: QuestionKeywordGroup[] | undefined;
    // SEO Generation Quality P3: the annotated closed-set candidates the assembler
    // produced (declined/requested/voteWeight/priority populated). Used to build the
    // closed-set prompt for OP1/OP2 and as the universe-side source for the
    // never-emit-empty content-gap backfill. Undefined on the flag-OFF path and the
    // M2 degradation fallback (legacy path has no candidate universe).
    let universeCandidates: KeywordCandidate[] | undefined;
    if (seoGenQualityEnabled) {
      // semrushByPath (per-page provider keyword lookup) is built here on both
      // paths — the assembler owns the candidate POOL, not per-page assignment.
      if (semrushDomainData.length > 0) {
        for (const k of semrushDomainData) {
          if (!isEligibleStrategyPoolKeyword({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, source: provider?.name ?? 'seo-provider' })) continue;
          const p = normalizePageUrl(k.url);
          if (!semrushByPath.has(p)) semrushByPath.set(p, []);
          semrushByPath.get(p)!.push(k);
        }
      }
      // M2 (dark-launch safety): isolate flag-ON failure. The assembler does two
      // resolver DB reads (geo + language) and the provider discovery fetch; if any
      // throws we degrade gracefully to the legacy pool build below rather than
      // aborting the whole generation. The flag-OFF code path is unaffected.
      try {
        const siteDomain = options.baseUrl ? (() => { try { return new URL(options.baseUrl).hostname; } catch { return ''; } })() : '';
        const { universe, pool: universePool, suppressedCount, questionKeywords: universeQuestions } = await buildKeywordUniverse(ws.id, {
          provider,
          seoDataMode,
          siteDomain,
          priorSiteKeywords: ws.keywordStrategy?.siteKeywords ?? [],
          gscData,
          domainKeywords: semrushDomainData,
          competitorKeywords: competitorKeywordData,
          keywordGaps,
          discoveryKeywords,
          relatedKeywords: relatedKws,
          requestedKeywords,
          declinedKeywords,
          competitorDomains,
          evaluationContext: strategyKeywordEvaluationContext,
          // SEO Generation Quality P3 (G4) — client-signal contract. Threaded so the
          // assembler can populate per-candidate `voteWeight` annotations. (M3) The
          // OP2 prompt sources businessPriorities directly from
          // `clientSignals.effectiveBusinessPriorities` (businessPrioritiesContext),
          // so the assembler does NOT take a businessPriorities option.
          contentGapVotes: clientSignals?.contentGapVotes ?? [],
          // Caller-resolved local-intent gate (canonical posture-driven local SEO path).
          includeLocal: includeLocalUniverse,
          sendProgress,
        });
        suppressedUniverseCount = suppressedCount;
        universeQuestionKeywords = universeQuestions;
        // P3: capture the annotated closed-set candidates for the grounded prompts +
        // the synthesis-internal content-gap backfill.
        universeCandidates = universe.candidates;
        for (const [kw, candidate] of universePool.entries()) {
          keywordPool.set(kw, candidate);
        }
        usedKeywordUniverse = true;
        // Flag-ON: universe-derived client count = client-sourced rows in the final
        // (post-filter) pool. (M1 — flag-ON may use the universe-derived count.)
        clientKeywordsAdded = [...keywordPool.values()].filter(m => m.source === 'client').length;
        log.info(`Keyword universe (flag-ON): ${keywordPool.size} unique terms (suppressed ${suppressedUniverseCount})`);
      } catch (err) {
        log.error({ err, workspaceId: ws.id }, 'buildKeywordUniverse failed — degrading to legacy pool build');
        // Reset partial state so the legacy fold rebuilds a clean pool.
        keywordPool.clear();
        semrushByPath.clear();
        suppressedUniverseCount = 0;
        clientKeywordsAdded = 0;
        runLegacyPoolBuild();
      }
    } else {
      runLegacyPoolBuild();
    }
    // Legacy inline pool build (the verbatim pre-P1 `:403-472` logic) — invoked on
    // the flag-OFF path AND as the M2 graceful-degradation fallback when the
    // assembler throws. Delegates to the exported `buildLegacyKeywordPool` so the
    // flag-OFF parity test can drive the SAME code (not a reimplemented copy — I3a).
    function runLegacyPoolBuild(): void {
      const legacy = buildLegacyKeywordPool({
        keywordPool,
        semrushByPath,
        domainKeywords: semrushDomainData,
        gscData,
        competitorKeywords: competitorKeywordData,
        keywordGaps,
        discoveryKeywords,
        relatedKeywords: relatedKws,
        clientTracked: getTrackedKeywords(ws.id),
        requestedKeywords,
        competitorDomains,
        declinedKeywords,
        providerName: provider?.name,
        isEligible: isEligibleStrategyPoolKeyword,
      });
      // (M1) Pre-filter client increment count from the legacy fold.
      clientKeywordsAdded = legacy.clientKeywordsAdded;
      const brandedRemoved = legacy.brandedRemoved;
      const declinedPoolRemoved = legacy.declinedPoolRemoved;
      if (declinedPoolRemoved > 0) log.info(`Removed ${declinedPoolRemoved} declined keywords from keyword pool`);
      log.info(`Keyword pool: ${keywordPool.size} unique terms (${semrushDomainData.length} domain + ${competitorKeywordData.length} competitor + ${keywordGaps.length} gaps + ${discoveryKeywords.length} discovery + ${clientKeywordsAdded} client + GSC)${brandedRemoved > 0 ? ` — removed ${brandedRemoved} branded competitor keywords` : ''}`);
    }
    if (keywordPool.size > 0) {
      semrushBatchRef = buildKeywordPoolSection(keywordPool);
    }

    // ── SEO Generation Quality P3 (flag-ON only): closed-set candidate block ──
    // Enumerate the universe candidates with a stable source-row id (the normalized
    // keyword) + their client-signal annotations, and instruct the AI to SELECT +
    // JUSTIFY each pick BY ID. Built once and reused by OP1 (page assignment) and
    // OP2 (site synthesis). Declined candidates are excluded from the visible set
    // (belt-and-suspenders alongside the post-AI declined filters). Empty string
    // when there are no candidates (degrade to the legacy pool ref).
    const closedSetBlock = buildClosedSetBlock(universeCandidates);
    // Global (not per-keyword) business-priorities context for OP2.
    const businessPrioritiesContext = (clientSignals?.effectiveBusinessPriorities ?? []);

    // ── SEO Generation Quality P3 (I1, flag-ON only): closed-set membership guard ──
    // The grounded prompts (OP1/OP2) tell the AI to SELECT a `*SourceId` from the
    // closed candidate set, but the model can hallucinate an id that is not in the
    // set. On the flag-ON path `relaxConservatism` disables the business_mismatch
    // hard-suppressor, so a plausible-but-invented phrase can otherwise survive the
    // downstream eligibility filter. Build the closed set ONCE (normalized keyword ==
    // candidate id) and verify membership before trusting the AI's id/keyword.
    // Empty on the flag-OFF path (universeCandidates undefined) — never consulted.
    const candidateIds = buildCandidateIds(universeCandidates);

    const existingKeywordByPath = new Map(existingPageKeywords.map(pk => [pk.pagePath, pk]));
    const pageInfoByPath = new Map(pageInfo.map(page => [page.path, page]));
    const fallbackKeywordFromPageIdentity = (pagePath: string): string | null => {
      const page = pageInfoByPath.get(pagePath);
      const titleFallback = page?.seoTitle || page?.title;
      const slugFallback = pagePath.split('/').filter(Boolean).join(' ');
      const fallback = normalizeKeyword(titleFallback || slugFallback);
      return fallback || null;
    };
    const findFallbackKeywordForPage = (pagePath: string): string | null => {
      const existingKeyword = existingKeywordByPath.get(pagePath)?.primaryKeyword;
      if (existingKeyword && isEligibleGeneratedKeyword(existingKeyword)) {
        return existingKeyword;
      }

      const providerKeyword = [...(semrushByPath.get(pagePath) ?? [])]
        .sort((a, b) => b.volume - a.volume)
        .find(keyword => isEligibleGeneratedKeyword(keyword.keyword));
      if (providerKeyword) return providerKeyword.keyword;

      const gscKeyword = [...(gscByPath.get(pagePath) ?? [])]
        .sort((a, b) => b.impressions - a.impressions)
        .find(keyword => isEligibleGeneratedKeyword(keyword.query));
      return gscKeyword?.query ?? fallbackKeywordFromPageIdentity(pagePath);
    };

    const runBatch = async (batch: typeof pageInfo, batchIdx: number): Promise<PageMapping[]> => {
      const batchPages = buildBatchPagesBlock(batch, gscByPath, semrushByPath);

      // EXISTING post-processing applied to a parsed PageMapping[] — factored out so
      // BOTH the legacy parse path AND the P3 flag-ON closed-set path run it VERBATIM
      // (the `primaryKeywordSourceId` that IS in the pool short-circuits the
      // eligibility check, exactly as a pool keyword does today).
      const postProcessBatch = (parsed: PageMapping[]): PageMapping[] => {
        // Strip AI-hallucinated volume/difficulty — those must come from keyword-provider enrichment only
        // Also strip "(invented)" suffix and pre-enrich keywords that are already in the pool
        let fromPool = 0;
        let invented = 0;
        for (const pm of parsed) {
          delete pm.volume; delete pm.difficulty; delete pm.cpc;
          // Strip "(invented)" marker the AI may add
          if (pm.primaryKeyword) {
            pm.primaryKeyword = pm.primaryKeyword.replace(/\s*\(invented\)\s*$/i, '').trim();
          }
          if (!Array.isArray(pm.secondaryKeywords)) {
            pm.secondaryKeywords = [];
          }
          if (pm.secondaryKeywords?.length) {
            pm.secondaryKeywords = pm.secondaryKeywords
              .map(keyword => keyword.replace(/\s*\(invented\)\s*$/i, '').trim())
              .filter(Boolean)
              .filter(keyword => isEligibleGeneratedKeyword(keyword));
          }
          if (pm.primaryKeyword) {
            const primaryEvaluation = isEligibleGeneratedKeyword(pm.primaryKeyword);
            if (!primaryEvaluation) {
              const promotedSecondary = pm.secondaryKeywords.shift();
              if (promotedSecondary) {
                pm.primaryKeyword = promotedSecondary;
              } else {
                const fallbackKeyword = findFallbackKeywordForPage(pm.pagePath);
                if (fallbackKeyword) {
                  pm.primaryKeyword = fallbackKeyword;
                  pm.validated = false;
                } else {
                  pm.primaryKeyword = '';
                  pm._parseError = true;
                  continue;
                }
              }
            }
          }
          // Pre-enrich from pool — if the keyword is in our pool, apply the data now
          const poolMatch = keywordPool.get(normalizeKeyword(pm.primaryKeyword ?? ''));
          if (poolMatch && poolMatch.source !== 'gsc') {
            pm.volume = poolMatch.volume;
            pm.difficulty = poolMatch.difficulty;
            fromPool++;
          } else {
            invented++;
          }
        }
        log.info(`Batch ${batchIdx + 1}: ${fromPool} keywords from pool, ${invented} invented`);
        return parsed;
      };

      // Legacy flag-OFF "invalid JSON" return. NOTE: these rows are tagged
      // `_parseError:true` and `primaryKeyword:''`, so they are FILTERED OUT of the
      // final mappings downstream (~:902-908) — i.e. on the legacy path a parse-fail
      // drops the batch's pages entirely. Flag-OFF preserves this verbatim.
      const syntheticBatchFallback = (): PageMapping[] => batch.map(p => ({
        pagePath: p.path,
        pageTitle: p.title,
        primaryKeyword: '',
        secondaryKeywords: [],
        searchIntent: 'informational',
        _parseError: true,
      }));

      // SEO Generation Quality P3 (M1, flag-ON): real per-page fallback that keeps
      // pages instead of dropping them after a parse-fail. Synthesize each page's
      // primaryKeyword from its own identity/provider/GSC signal via the existing
      // findFallbackKeywordForPage — when that yields a keyword the page survives
      // (validated:false); only when no signal exists at all does the page degrade
      // to the legacy `_parseError` drop (rare). This is the genuine quality
      // improvement: the previous flag-ON fallback re-used syntheticBatchFallback,
      // whose empty/_parseError rows were filtered out → zero surviving pages.
      const perPageFallbackBatch = (): PageMapping[] => batch.map(p => {
        const fallbackKeyword = findFallbackKeywordForPage(p.path);
        if (!fallbackKeyword) {
          return {
            pagePath: p.path,
            pageTitle: p.title,
            primaryKeyword: '',
            secondaryKeywords: [],
            searchIntent: 'informational',
            _parseError: true,
          };
        }
        return {
          pagePath: p.path,
          pageTitle: p.title,
          primaryKeyword: fallbackKeyword,
          secondaryKeywords: [],
          searchIntent: 'informational',
          validated: false,
        };
      });

      // ── SEO Generation Quality P3 (flag-ON): closed-set, Zod-validated OP1 ──
      if (seoGenQualityEnabled && closedSetBlock) {
        const groundedPrompt = buildClosedSetPageAssignmentPrompt({
          businessSection,
          closedSetBlock,
          batchPages,
          batchLength: batch.length,
        });

        log.info(`Batch ${batchIdx + 1}/${batches.length} (closed-set): ${batch.length} pages, ${groundedPrompt.length} chars`);
        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
          { role: 'user', content: groundedPrompt },
        ];
        let raw = await callNamedStrategyAI(ws.id, 'keyword-page-assignment', messages, 3000);
        let parsedResult = pageAssignmentResponseSchema.safeParse(parseJsonFallback<unknown>(raw, null));
        if (!parsedResult.success) {
          // Retry ONCE: append the raw assistant turn + a user turn quoting the issues.
          const issues = parsedResult.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
          log.warn({ workspaceId: ws.id, issues }, `Batch ${batchIdx + 1} closed-set OP1 failed validation — retrying once`);
          messages.push({ role: 'assistant', content: raw });
          messages.push({ role: 'user', content: `Your previous response failed schema validation: ${issues}. Return ONLY the corrected JSON object matching the exact { "assignments": [...] } shape. No markdown.` });
          raw = await callNamedStrategyAI(ws.id, 'keyword-page-assignment', messages, 3000);
          parsedResult = pageAssignmentResponseSchema.safeParse(parseJsonFallback<unknown>(raw, null));
        }
        if (parsedResult.success) {
          sendProgress('ai', `Batch ${batchIdx + 1}/${batches.length} complete (${parsedResult.data.assignments.length} pages)`, 0.55 + ((batchIdx + 1) / batches.length) * 0.20);
          const mapped: PageMapping[] = parsedResult.data.assignments.map(a => {
            // (I1) Verify closed-set membership: accept the AI's sourceId only if it
            // is a real candidate id; else fall back to the keyword only if THAT is
            // in the set. An in-set pick (normalized == candidate id) short-circuits
            // the eligibility check in post-processing. If neither is in the set, pass
            // the raw keyword through so postProcessBatch's eligibility + per-page
            // fallback path rejects the hallucination (never admits it, and never
            // lets a hallucinated id override a valid in-set keyword).
            const resolved = resolveClosedSetKeyword(candidateIds, a.primaryKeywordSourceId, a.primaryKeyword);
            return {
              pagePath: a.pagePath,
              pageTitle: a.pageTitle,
              primaryKeyword: resolved ?? a.primaryKeyword,
              secondaryKeywords: a.secondaryKeywords,
              searchIntent: a.searchIntent ?? 'informational',
            };
          });
          return postProcessBatch(mapped);
        }
        // Still failing after the retry: synthesize a REAL per-page keyword via
        // findFallbackKeywordForPage so pages are NOT dropped (M1). Unlike the legacy
        // syntheticBatchFallback (empty/_parseError → filtered out), this keeps pages
        // with a page-identity/provider/GSC-derived keyword.
        log.error({ workspaceId: ws.id, detail: raw.slice(0, 200) }, `Batch ${batchIdx + 1} closed-set OP1 failed after retry — real per-page fallback`);
        return perPageFallbackBatch();
      }

      // ── Legacy flag-OFF path — VERBATIM ──
      const hasPool = keywordPool.size > 0;
      const batchPrompt = buildLegacyPageAssignmentPrompt({
        businessSection,
        keywordPoolReference: semrushBatchRef,
        batchPages,
        batchLength: batch.length,
        hasPool,
      });

      log.info(`Batch ${batchIdx + 1}/${batches.length}: ${batch.length} pages, ${batchPrompt.length} chars`);
      const raw = await callStrategyAI([
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: batchPrompt },
      ], 3000, `batch-${batchIdx + 1}`);

      const parsed = parseJsonFallback<PageMapping[] | null>(raw, null);
      if (Array.isArray(parsed)) {
        log.info(`Batch ${batchIdx + 1} returned ${Array.isArray(parsed) ? parsed.length : 0} page mappings`);
        sendProgress('ai', `Batch ${batchIdx + 1}/${batches.length} complete (${Array.isArray(parsed) ? parsed.length : 0} pages)`, 0.55 + ((batchIdx + 1) / batches.length) * 0.20);
        return postProcessBatch(parsed);
      }
      log.error({ detail: raw.slice(0, 200) }, `Batch ${batchIdx + 1} returned invalid JSON:`);
      return syntheticBatchFallback();
    };

    // Run batches with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    const allPageMappings: PageMapping[] = [];
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const chunk = batches.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((batch, ci) => runBatch(batch, i + ci)));
      allPageMappings.push(...results.flat());
    }
    // Filter out pages with parse errors and log warning
    const parseErrors = allPageMappings.filter((pm: { _parseError?: boolean }) => pm._parseError);
    if (parseErrors.length > 0) {
      log.warn(`${parseErrors.length} pages had JSON parse or keyword validation errors and were assigned empty keywords`);
      // Remove invalid pages from the mappings so empty primary keywords are not persisted.
      const validMappings = allPageMappings.filter((pm: { _parseError?: boolean }) => !pm._parseError);
      allPageMappings.length = 0;
      allPageMappings.push(...validMappings);
    }
    log.info(`All batches complete: ${allPageMappings.length} total page mappings`);

    // --- Incremental mode: merge preserved (fresh) pages back into the page mappings ---
    // These pages had analysis_generated_at < 7 days old so we keep their existing keywords.
    if (strategyMode === 'incremental' && pagesToPreserve.length > 0) {
      const preservedPaths = new Set(pagesToPreserve.map(p => p.path));
      for (const pk of existingPageKeywords) {
        if (preservedPaths.has(pk.pagePath)) {
          allPageMappings.push({
            ...pk,
            searchIntent: pk.searchIntent || 'informational',
            secondaryKeywords: pk.secondaryKeywords || [],
          });
        }
      }
      log.info(`Incremental mode: merged ${pagesToPreserve.length} preserved pages into final mappings`);
    }

    await validatePageMappingsWithProvider({
      workspaceId: ws.id,
      pageMappings: allPageMappings,
      provider,
      seoDataMode,
      domainKeywords: semrushDomainData,
      usedKeywordUniverse,
      isSuspiciousGroupedVolume: isSuspiciousPlannerGroupedVolume,
      resolveLocationCode: resolveWorkspaceLocationCode,
      resolveLanguageCode: resolveWorkspaceLanguageCode,
    });

    // --- STEP 2: Master synthesis — site-level strategy only ---
    // The batch results ARE the pageMap. Master only generates siteKeywords, contentGaps, quickWins, opportunities.
    // This keeps output small (~2K tokens) and fast.
    sendProgress('ai', 'Synthesizing site-level strategy...', 0.78);

    // Detect keyword conflicts from batch results (batches don't know about each other)
    const kwCount = new Map<string, string[]>();
    for (const pm of allPageMappings) {
      const kw = normalizeKeyword(pm.primaryKeyword);
      if (!kw) continue;
      if (!kwCount.has(kw)) kwCount.set(kw, []);
      kwCount.get(kw)!.push(pm.pagePath);
    }
    const conflicts = [...kwCount.entries()].filter(([, pages]) => pages.length > 1);
    if (conflicts.length > 0) {
      log.info(`Found ${conflicts.length} keyword conflicts to resolve`);
    }

    // Compact summary: just keywords per page (no secondary details — keep prompt small)
    const kwSummary = allPageMappings.map(pm => `${pm.pagePath}: "${pm.primaryKeyword}"`).join('\n');

    // GSC: top queries + enriched signals
    let gscSummary = '';
    if (gscData.length > 0) {
      const topGsc = [...gscData].sort((a, b) => b.impressions - a.impressions).slice(0, 30);
      gscSummary = `\n\nTop GSC queries (last 90 days):\n` +
        topGsc.map(r => {
          const pagePath = normalizePageUrl(r.page);
          return `- "${r.query}" → ${pagePath} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`;
        }).join('\n');
    }

    // Device breakdown context
    if (deviceBreakdown.length > 0) {
      gscSummary += `\n\nDEVICE BREAKDOWN (last 28 days):\n` +
        deviceBreakdown.map(d => `- ${d.device}: ${d.clicks} clicks, ${d.impressions} imp, CTR ${d.ctr}%, avg pos ${d.position}`).join('\n');
      // Flag if mobile dominates but has worse position
      const mobile = deviceBreakdown.find(d => d.device === 'MOBILE');
      const desktop = deviceBreakdown.find(d => d.device === 'DESKTOP');
      if (mobile && desktop && mobile.impressions > desktop.impressions && mobile.position > desktop.position + 2) {
        gscSummary += `\n⚠️ MOBILE GAP: Mobile has ${mobile.impressions} imp vs desktop ${desktop.impressions} but avg position is ${mobile.position.toFixed(1)} vs ${desktop.position.toFixed(1)} — mobile optimization is critical.`;
      }
    }

    // Period comparison context
    if (periodComparison) {
      const { change, changePercent } = periodComparison;
      gscSummary += `\n\nPERIOD COMPARISON (last 28 days vs previous 28 days):\n` +
        `- Clicks: ${change.clicks >= 0 ? '+' : ''}${change.clicks} (${changePercent.clicks >= 0 ? '+' : ''}${changePercent.clicks}%)\n` +
        `- Impressions: ${change.impressions >= 0 ? '+' : ''}${change.impressions} (${changePercent.impressions >= 0 ? '+' : ''}${changePercent.impressions}%)\n` +
        `- Avg Position: ${change.position >= 0 ? '+' : ''}${change.position} (${change.position > 0 ? 'declining ⚠️' : change.position < 0 ? 'improving ✓' : 'stable'})`;
    }

    // Country breakdown
    if (countryBreakdown.length > 0) {
      gscSummary += `\n\nTOP COUNTRIES by clicks:\n` +
        countryBreakdown.slice(0, 5).map(c => `- ${c.country}: ${c.clicks} clicks, ${c.impressions} imp, pos ${c.position}`).join('\n');
    }

    // GA4 organic landing pages — find pages getting traffic that aren't in the keyword map
    let ga4Context = '';
    if (organicLandingPages.length > 0) {
      const mappedPaths = new Set(allPageMappings.map(pm => pm.pagePath));
      const unmappedLanding = organicLandingPages.filter(lp => !mappedPaths.has(lp.landingPage));
      if (unmappedLanding.length > 0) {
        ga4Context += `\n\nGA4 ORGANIC LANDING PAGES not in keyword map (getting traffic but no keyword strategy):\n` +
          unmappedLanding.slice(0, 10).map(lp => `- ${lp.landingPage}: ${lp.sessions} organic sessions, ${lp.users} users, bounce ${lp.bounceRate}%`).join('\n');
      }
      // High-bounce organic landing pages = content quality signal
      const highBounce = organicLandingPages.filter(lp => lp.bounceRate > 70 && lp.sessions > 5);
      if (highBounce.length > 0) {
        ga4Context += `\n\nHIGH-BOUNCE ORGANIC PAGES (>70% bounce, may need content improvement):\n` +
          highBounce.slice(0, 5).map(lp => `- ${lp.landingPage}: bounce ${lp.bounceRate}%, ${lp.sessions} sessions`).join('\n');
      }
    }
    if (organicOverview) {
      ga4Context += `\n\nORGANIC SEARCH OVERVIEW (GA4, last 28 days):\n` +
        `- ${organicOverview.organicUsers} organic users (${organicOverview.shareOfTotalUsers}% of all traffic)\n` +
        `- Engagement rate: ${organicOverview.engagementRate}%\n` +
        `- Avg engagement time: ${organicOverview.avgEngagementTime.toFixed(0)}s`;
    }

    // GA4 conversions — which events fire and on which pages
    if (ga4Conversions.length > 0) {
      ga4Context += `\n\nCONVERSION EVENTS (GA4, last 28 days — these are the site's money actions):\n` +
        ga4Conversions.slice(0, 10).map(c => `- "${c.eventName}": ${c.conversions} events, ${c.users} users (${c.rate}% conversion rate)`).join('\n');
    }
    if (ga4EventsByPage.length > 0) {
      // Group events by page to find "money pages"
      const pageEvents = new Map<string, { events: number; topEvent: string }>();
      for (const ep of ga4EventsByPage) {
        const existing = pageEvents.get(ep.pagePath);
        if (!existing || ep.eventCount > existing.events) {
          pageEvents.set(ep.pagePath, { events: ep.eventCount, topEvent: ep.eventName });
        }
      }
      const topConvertingPages = [...pageEvents.entries()]
        .sort((a, b) => b[1].events - a[1].events)
        .slice(0, 8);
      if (topConvertingPages.length > 0) {
        ga4Context += `\n\nTOP CONVERTING PAGES (pages that drive the most events — protect these keywords):\n` +
          topConvertingPages.map(([p, d]) => `- ${p}: ${d.events} events (top: "${d.topEvent}")`).join('\n');
      }
    }

    // Audit data — pages with SEO errors + traffic = high-priority quick wins
    let auditContext = '';
    if (ws.webflowSiteId) {
      try {
        const trafficMap = await getAuditTrafficForWorkspace(ws);
        const latestAudit = getLatestSnapshot(ws.webflowSiteId);
        if (latestAudit && Object.keys(trafficMap).length > 0) {
          // Apply suppressions so strategy chat excludes suppressed issues
          const filteredAudit = applySuppressionsToAudit(latestAudit.audit, ws.auditSuppressions || []);
          const pagesWithIssues = filteredAudit.pages
            .filter(p => p.issues.length > 0)
            .map(p => {
              const slug = normalizePageUrl(p.slug);
              const traffic = trafficMap[slug] || trafficMap[p.slug];
              return { slug, issues: p.issues.length, score: p.score, traffic };
            })
            .filter(p => p.traffic && (p.traffic.clicks > 0 || p.traffic.pageviews > 0))
            .sort((a, b) => ((b.traffic?.clicks || 0) + (b.traffic?.pageviews || 0)) - ((a.traffic?.clicks || 0) + (a.traffic?.pageviews || 0)))
            .slice(0, 8);
          if (pagesWithIssues.length > 0) {
            auditContext = `\n\nSEO AUDIT: HIGH-TRAFFIC PAGES WITH ERRORS (fix these for immediate impact):\n` +
              pagesWithIssues.map(p => `- ${p.slug}: ${p.issues} issues, score ${p.score}/100 | ${p.traffic!.clicks} clicks, ${p.traffic!.pageviews} pageviews`).join('\n');
            if (filteredAudit.siteScore != null) {
              auditContext += `\nOverall site health score: ${filteredAudit.siteScore}/100`;
            }
          }
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* non-critical */ }
    }

    const hasProviderContext = sanitizedProviderKeywordLines > 0;
    const hasKeywordGaps = eligibleKeywordGapCount > 0;
    const conflictNote = conflicts.length > 0
      ? `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n${conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n')}\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
      : '';

    // Fetch analytics intelligence from computed insights layer
    let intelligenceBlock = '';
    try {
      const insights = strategyIntel.insights?.all ?? [];
      if (insights.length > 0) {
        const strategyEligibleInsights = insights.filter(insight => {
          if (insight.insightType !== 'competitor_gap') return true;
          const gapInsight = insight as AnalyticsInsight<'competitor_gap'>;
          return isEligibleStrategyPoolKeyword({
            keyword: gapInsight.data.keyword,
            volume: gapInsight.data.volume,
            difficulty: gapInsight.data.difficulty,
            source: `insight_gap:${gapInsight.data.competitorDomain}`,
          });
        });
        const keywordClusters = insights
          .filter((i): i is AnalyticsInsight<'keyword_cluster'> => i.insightType === 'keyword_cluster')
          .map(i => i.data)
          .sort((a, b) => b.totalImpressions - a.totalImpressions);
        const competitorGaps = strategyEligibleInsights
          .filter((i): i is AnalyticsInsight<'competitor_gap'> => i.insightType === 'competitor_gap')
          .map(i => i.data)
          .sort((a, b) => b.volume - a.volume);
        const conversionPages = insights
          .filter((i): i is AnalyticsInsight<'conversion_attribution'> => i.insightType === 'conversion_attribution')
          .map(i => ({ pageUrl: i.pageId || '', ...i.data }))
          .sort((a, b) => b.conversionRate - a.conversionRate);
        const contentDecaySignals = insights
          .filter((i): i is AnalyticsInsight<'content_decay'> => i.insightType === 'content_decay' && i.pageId != null)
          .map(i => ({
            pageId: i.pageId!,
            clicksDelta: i.data.currentClicks - i.data.baselineClicks,
            deltaPercent: i.data.deltaPercent,
          }));
        const rankingMovers = insights
          .filter((i): i is AnalyticsInsight<'ranking_mover'> => i.insightType === 'ranking_mover')
          .map(i => ({
            query: i.data.query,
            // StrategyIntelligenceInput treats positive as a drop for legacy display.
            // RankingMoverData treats positive as improvement, so invert here.
            positionDelta: -i.data.positionChange,
            clicksDelta: i.data.currentClicks - i.data.previousClicks,
            currentPosition: i.data.currentPosition,
          }))
          .sort((a, b) => Math.abs(b.positionDelta) - Math.abs(a.positionDelta));
        const cannibalization = insights
          .filter((i): i is AnalyticsInsight<'cannibalization'> => i.insightType === 'cannibalization')
          .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
        const ctrOpportunities = insights
          .filter((i): i is AnalyticsInsight<'ctr_opportunity'> => i.insightType === 'ctr_opportunity')
          .sort((a, b) => b.data.estimatedClickGap - a.data.estimatedClickGap);
        const rankingOpportunities = insights
          .filter((i): i is AnalyticsInsight<'ranking_opportunity'> => i.insightType === 'ranking_opportunity')
          .sort((a, b) => b.data.estimatedTrafficGain - a.data.estimatedTrafficGain);

        intelligenceBlock = buildStrategyIntelligenceBlock({
          keywordClusters: keywordClusters.length > 0 ? keywordClusters : undefined,
          competitorGaps: competitorGaps.length > 0 ? competitorGaps : undefined,
          conversionPages: conversionPages.length > 0 ? conversionPages : undefined,
          performanceDeltas: rankingMovers.length > 0 ? rankingMovers : undefined,
          contentDecay: contentDecaySignals.length > 0 ? contentDecaySignals : undefined,
          cannibalization: cannibalization.length > 0 ? cannibalization : undefined,
          ctrOpportunities: ctrOpportunities.length > 0 ? ctrOpportunities : undefined,
          rankingOpportunities: rankingOpportunities.length > 0 ? rankingOpportunities : undefined,
        });

        // Append feedback-loop signals to give the AI real performance context
        const stratSignals = buildStrategySignals(strategyEligibleInsights, { keywordEvaluationContext: strategyKeywordEvaluationContext });
        if (stratSignals.length > 0) {
          intelligenceBlock += `\n\nSTRATEGY SIGNALS (analytics feedback loop — use to prioritize recommendations):\n${stratSignals.slice(0, 10).map(s => `- [${s.type}] ${s.detail}`).join('\n')}`;
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* non-critical — strategy works without intelligence data */ }

    let masterData: MasterStrategyData;
    const masterClosedSetBlock = closedSetBlock;
    const competitorBrandTokens = [...new Set(competitorDomains.flatMap(d => extractBrandTokens(d)))];
    if (seoGenQualityEnabled && masterClosedSetBlock) {
      // ── SEO Generation Quality P3 (flag-ON): closed-set, Zod-validated OP2 ──
      const groundedMasterPrompt = buildClosedSetSiteSynthesisPrompt({
        businessSection,
        pageMappingCount: allPageMappings.length,
        keywordSummary: kwSummary,
        conflictNote,
        gscSummary,
        ga4Context,
        auditContext,
        providerContext: sanitizedProviderContext,
        intelligenceBlock,
        closedSetBlock: masterClosedSetBlock,
        effectiveBusinessPriorities: businessPrioritiesContext,
        hasProviderContext,
        hasKeywordGaps,
        competitorDomains,
        competitorBrandTokens,
        conflictsCount: conflicts.length,
      });

      log.info(`Master prompt (closed-set): ${groundedMasterPrompt.length} chars (~${Math.ceil(groundedMasterPrompt.length / 4)} tokens)`);
      const masterMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: groundedMasterPrompt },
      ];
      let masterRaw = await callNamedStrategyAI(ws.id, 'keyword-site-synthesis', masterMessages, 4500);
      let masterResult = siteSynthesisResponseSchema.safeParse(parseJsonFallback<unknown>(masterRaw, null));
      if (!masterResult.success) {
        const issues = masterResult.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        log.warn({ workspaceId: ws.id, issues }, 'Master closed-set OP2 failed validation — retrying once');
        masterMessages.push({ role: 'assistant', content: masterRaw });
        masterMessages.push({ role: 'user', content: `Your previous response failed schema validation: ${issues}. Return ONLY the corrected JSON object with the exact keys siteKeywords, opportunities, contentGaps, quickWins. No markdown.` });
        masterRaw = await callNamedStrategyAI(ws.id, 'keyword-site-synthesis', masterMessages, 4500);
        masterResult = siteSynthesisResponseSchema.safeParse(parseJsonFallback<unknown>(masterRaw, null));
      }
      if (masterResult.success) {
        const d = masterResult.data;
        // (I1) Verify closed-set membership for every content-gap target. Accept the
        // AI's targetKeywordSourceId only if it is a real candidate id; else fall back
        // to targetKeyword only if THAT is in the set; else DROP the gap (do not admit
        // an out-of-set/hallucinated keyword). The never-emit-empty backfill below
        // re-fills contentGaps from the universe candidates if dropping leaves us
        // below the floor, so this never silently empties the strategy.
        let droppedOutOfSetGaps = 0;
        const validatedGaps = d.contentGaps.flatMap(cg => {
          const resolved = resolveClosedSetKeyword(candidateIds, cg.targetKeywordSourceId, cg.targetKeyword);
          if (!resolved) {
            droppedOutOfSetGaps++;
            return [];
          }
          const { targetKeywordSourceId: _ignored, ...rest } = cg;
          void _ignored;
          return [{
            ...rest,
            targetKeyword: resolved,
            topic: cg.topic,
          } as StrategyContentGap & { targetKeyword: string; topic: string }];
        });
        if (droppedOutOfSetGaps > 0) {
          log.info({ workspaceId: ws.id, droppedOutOfSetGaps }, 'Dropped OP2 content gaps whose targetKeyword/sourceId was not in the closed candidate set');
        }
        masterData = {
          siteKeywords: d.siteKeywords,
          opportunities: d.opportunities,
          contentGaps: validatedGaps,
          quickWins: d.quickWins as StrategyQuickWin[],
          keywordFixes: d.keywordFixes as StrategyKeywordFix[],
        };
      } else {
        // Still failing after the retry: use a TYPED-EMPTY object (NOT a throw). The
        // never-emit-empty content-gap backfill below fills contentGaps to the floor
        // from the universe candidates so the flag-ON path is never silently empty.
        log.error({ workspaceId: ws.id, detail: masterRaw.slice(0, 300) }, 'Master closed-set OP2 failed after retry — typed-empty + deterministic backfill');
        masterData = { siteKeywords: [], opportunities: [], contentGaps: [], quickWins: [], keywordFixes: [] };
      }
    } else {
      // ── Legacy flag-OFF path — VERBATIM (including the throw) ──
      const masterPrompt = buildLegacySiteSynthesisPrompt({
        businessSection,
        pageMappingCount: allPageMappings.length,
        keywordSummary: kwSummary,
        conflictNote,
        gscSummary,
        ga4Context,
        auditContext,
        providerContext: sanitizedProviderContext,
        intelligenceBlock,
        hasProviderContext,
        hasKeywordGaps,
        competitorDomains,
        competitorBrandTokens,
        conflictsCount: conflicts.length,
        clientKeywordsAdded,
      });

      log.info(`Master prompt: ${masterPrompt.length} chars (~${Math.ceil(masterPrompt.length / 4)} tokens)`);

      const masterRaw = await callStrategyAI([
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: masterPrompt },
      ], 3000, 'master');

      const parsedMasterData = parseJsonFallback<MasterStrategyData | null>(masterRaw, null);
      if (!parsedMasterData) {
        log.error({ detail: masterRaw.slice(0, 300) }, 'Master returned invalid JSON');
        const errMsg = 'AI returned invalid JSON in master synthesis';
        throw new KeywordStrategySynthesisError(500, { error: errMsg, raw: masterRaw.slice(0, 500) });
      }
      masterData = parsedMasterData;
    }

    // Apply keyword conflict fixes from master
    if (masterData.keywordFixes?.length) {
      const { appliedFixes, suppressedFixes } = applyKeywordConflictFixes(
        allPageMappings,
        masterData.keywordFixes,
        isEligibleGeneratedKeyword,
      );
      log.info(`Applied ${appliedFixes} keyword conflict fixes`);
      if (suppressedFixes > 0) {
        log.info(`Suppressed ${suppressedFixes} keyword conflict fixes via shared keyword intelligence`);
      }
    }

    // Post-generation hard filter: remove declined keywords from siteKeywords.
    // The AI prompt instructs this, but LLMs don't always comply — hard filter is the real defense.
    const siteKeywordFilter = filterMasterSiteKeywords(masterData.siteKeywords, declinedSet, isEligibleGeneratedKeyword);
    masterData.siteKeywords = siteKeywordFilter.siteKeywords;
    if (siteKeywordFilter.declinedRemoved > 0) {
      log.info(`Stripped ${siteKeywordFilter.declinedRemoved} declined keywords from siteKeywords despite prompt instruction`);
    }
    if (siteKeywordFilter.sharedRemoved > 0) {
      log.info(`Stripped ${siteKeywordFilter.sharedRemoved} site keywords via shared keyword intelligence`);
    }

    // Post-generation hard filter: remove any content gaps containing competitor brand names.
    // The AI prompt tells it not to suggest these, but LLMs don't always comply.
    // This filter is the real defense — the prompt is the soft guardrail.
    const contentGapFilter = filterMasterContentGaps(
      masterData.contentGaps,
      competitorDomains,
      declinedSet,
      isEligibleGeneratedKeyword,
    );
    const brandedGaps = contentGapFilter.brandedRemoved;
    if (brandedGaps.length > 0) {
      log.info(`Stripped ${brandedGaps.length} branded content gaps despite prompt instruction: ${brandedGaps.map((g: { targetKeyword: string }) => g.targetKeyword).join(', ')}`);
    }
    // Filter declined keywords from content gap targets (mirrors filterBrandedContentGaps pattern)
    let finalContentGaps = contentGapFilter.finalContentGaps;
    if (contentGapFilter.declinedRemoved > 0) {
      log.info(`Stripped ${contentGapFilter.declinedRemoved} declined content gaps despite prompt instruction`);
    }
    if (contentGapFilter.sharedRemoved > 0) {
      log.info(`Stripped ${contentGapFilter.sharedRemoved} content gaps via shared keyword intelligence`);
    }

    // ── SEO Generation Quality P3 (flag-ON only) ──
    if (seoGenQualityEnabled && universeCandidates) {
      const requestedAndBackfill = applyRequestedGapsAndBackfill({
        contentGaps: finalContentGaps,
        pageMappings: allPageMappings,
        universeCandidates,
        floor: STRATEGY_CONTENT_GAP_FLOOR,
      });
      finalContentGaps = requestedAndBackfill.contentGaps;
      if (requestedAndBackfill.requestedReadded > 0) {
        log.info({ workspaceId: ws.id, requestedReadded: requestedAndBackfill.requestedReadded }, 'Re-added client-requested keywords as content gaps (hard guarantee)');
      }
      if (requestedAndBackfill.backfilledCount > 0) {
        log.info({ workspaceId: ws.id, backfilledCount: requestedAndBackfill.backfilledCount, floor: STRATEGY_CONTENT_GAP_FLOOR }, 'Synthesis-internal content-gap backfill applied (flag-ON)');
      }
    }

    // Assemble final strategy: batch pageMap + master site-level data
    strategy = {
      siteKeywords: masterData.siteKeywords || [],
      pageMap: allPageMappings,
      opportunities: masterData.opportunities || [],
      contentGaps: finalContentGaps,
      quickWins: masterData.quickWins || [],
    };
    // Post-generation: hard filter declined keywords from pageMap assignments
    if (declinedKeywords.length > 0 && strategy.pageMap?.length) {
      applyDeclinedPageMapFilter(strategy.pageMap as PageMapping[], declinedSet);
    }
    log.info(`Final strategy: ${strategy.pageMap?.length ?? 0} pages, ${strategy.siteKeywords?.length ?? 0} site keywords, ${strategy.contentGaps?.length ?? 0} content gaps, ${strategy.quickWins?.length ?? 0} quick wins`);

  return { strategy, pagesToAnalyze, keywordPool, businessSection, keywordEvaluationContext: strategyKeywordEvaluationContext, suppressedCount: suppressedUniverseCount, questionKeywords: universeQuestionKeywords };
}
