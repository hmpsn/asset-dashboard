import { normalizePageUrl } from './utils/page-address.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import type { KeywordSourceEvidence } from '../shared/types/keywords.js';
import type { KeywordStrategy, Workspace } from '../shared/types/workspace.js';
import type { KeywordStrategyPageInfo } from './keyword-strategy-pages.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import type { CompetitorKeywordData, QuestionKeywordGroup } from './keyword-strategy-seo-data.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword, SeoDataProvider } from './seo-data-provider.js';
import { resolveWorkspaceLanguageCode, resolveWorkspaceLocationCode } from './domains/local-seo/configuration-service.js';
import { getPagesNeedingAnalysis, isSuspiciousPlannerGroupedVolume, STRATEGY_CONTENT_GAP_FLOOR } from './keyword-strategy-helpers.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword, type KeywordEvaluationContext } from './keyword-intelligence/index.js';
import { buildKeywordUniverse } from './keyword-strategy-universe.js';
import type { KeywordCandidate } from '../shared/types/keyword-universe.js';
import type { WorkspaceIntelligence } from '../shared/types/intelligence.js';
import { callKeywordStrategyAI, callNamedStrategyAI } from './keyword-strategy-synthesis/ai-callers.js';
import type { KeywordStrategyAIExecution } from './keyword-strategy-synthesis/ai-callers.js';
import { validatePageMappingsWithProvider } from './keyword-strategy-synthesis/provider-validation.js';
import {
  buildKeywordPoolSection,
  buildLegacyKeywordPool,
} from './keyword-strategy-synthesis/pool.js';
import {
  buildCandidateIds,
  buildClosedSetBlock,
} from './keyword-strategy-synthesis/prompts.js';
import { runPageAssignmentBatches } from './keyword-strategy-synthesis/page-assignment.js';
import { buildSiteSynthesisContext } from './keyword-strategy-synthesis/site-synthesis-context.js';
import { runSiteSynthesis } from './keyword-strategy-synthesis/site-synthesis.js';
import {
  applyDeclinedPageMapFilter,
  applyRequestedGapsAndBackfill,
  filterMasterContentGaps,
  filterMasterSiteKeywords,
} from './keyword-strategy-synthesis/finalize.js';
import type {
  KeywordStrategyKeywordPool,
  MasterStrategyData,
  PageMapping,
  StrategyOutput,
  StrategyPageMapEntry,
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

function synthesisModulePath(name: string): string {
  return `./keyword-strategy-synthesis/${name}.js`;
}

const synthesisContextModule = synthesisModulePath('context');

interface SynthesisContextModule {
  assembleSynthesisContext(options: {
    ws: Workspace;
    businessContext: string;
  }): Promise<{
    businessSection: string;
    strategyIntel: WorkspaceIntelligence;
    declinedKeywords: string[];
    requestedKeywords: string[];
    approvedKeywords: string[];
    includeLocalUniverse: boolean;
    keywordEvaluationContext: KeywordEvaluationContext;
  }>;
}

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
  executions: KeywordStrategyAIExecution[];
}

export async function synthesizeKeywordStrategy(options: SynthesizeKeywordStrategyOptions): Promise<SynthesizeKeywordStrategyResult> {
  const executions: KeywordStrategyAIExecution[] = [];
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
  const { gscData } = searchData;

  const callStrategyAI = (messages: Array<{ role: string; content: string }>, maxTokens: number, label?: string): Promise<string> =>
    callKeywordStrategyAI(ws.id, messages, maxTokens, label, execution => executions.push(execution));
  const callNamedAI = (workspaceId: string, operation: 'keyword-page-assignment' | 'keyword-site-synthesis' | 'keyword-topic-clusters', messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> =>
    callNamedStrategyAI(workspaceId, operation, messages, maxTokens, execution => executions.push(execution));

  // Keyword pool — declared outside try so enrichment code can access it after batching
  const keywordPool: KeywordStrategyKeywordPool = new Map();

  const { assembleSynthesisContext } = await import(synthesisContextModule) as SynthesisContextModule; // dynamic-import-ok - context reads workspace intelligence; keep it off the synthesis facade's static import path.
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
        return { strategy: currentStrategy, upToDate: true, freshPageCount: pagesToPreserve.length, pagesToAnalyze, keywordPool, businessSection, keywordEvaluationContext: strategyKeywordEvaluationContext, executions };
      }
    }
    // For AI batching we only process stale pages; preserved pages are merged back after.
    const pagesForBatching = strategyMode === 'incremental' ? pagesToAnalyze : pageInfo;

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

    const allPageMappings = await runPageAssignmentBatches({
      workspaceId: ws.id,
      businessSection,
      pagesForBatching,
      allPageInfo: pageInfo,
      strategyMode,
      pagesToPreserve,
      existingPageKeywords,
      gscByPath,
      providerKeywordsByPath: semrushByPath,
      keywordPool,
      keywordPoolReference: semrushBatchRef,
      seoGenQualityEnabled,
      closedSetBlock,
      candidateIds,
      isEligibleGeneratedKeyword,
      callStrategyAI,
      callNamedStrategyAI: callNamedAI,
      sendProgress,
    });

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

    const hasProviderContext = sanitizedProviderKeywordLines > 0;
    const hasKeywordGaps = eligibleKeywordGapCount > 0;

    const siteSynthesisContext = await buildSiteSynthesisContext({
      ws,
      searchData,
      pageMappings: allPageMappings,
      providerContext: sanitizedProviderContext,
      strategyIntel,
      keywordEvaluationContext: strategyKeywordEvaluationContext,
      isEligibleStrategyPoolKeyword,
    });
    const masterData: MasterStrategyData = await runSiteSynthesis({
      workspaceId: ws.id,
      businessSection,
      allPageMappings,
      closedSetBlock,
      candidateIds,
      effectiveBusinessPriorities: businessPrioritiesContext,
      context: siteSynthesisContext,
      hasProviderContext,
      hasKeywordGaps,
      competitorDomains,
      clientKeywordsAdded,
      seoGenQualityEnabled,
      isEligibleGeneratedKeyword,
      callStrategyAI,
      callNamedStrategyAI: callNamedAI,
    });

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

  return { strategy, pagesToAnalyze, keywordPool, businessSection, keywordEvaluationContext: strategyKeywordEvaluationContext, suppressedCount: suppressedUniverseCount, questionKeywords: universeQuestionKeywords, executions };
}
