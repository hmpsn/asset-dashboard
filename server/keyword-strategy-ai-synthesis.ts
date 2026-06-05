import { applySuppressionsToAudit, getAuditTrafficForWorkspace, normalizePageUrl, stripCodeFences } from './helpers.js';
import { callAI } from './ai.js';
import { getLatestSnapshot } from './reports.js';
import { getTrackedKeywords } from './rank-tracking.js';
import type { SeoDataProvider } from './seo-data-provider.js';
import { listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { KeywordSourceEvidence } from '../shared/types/keywords.js';
import type { KeywordStrategy, Workspace } from '../shared/types/workspace.js';
import type { KeywordStrategyPageInfo } from './keyword-strategy-pages.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import type { CompetitorKeywordData, QuestionKeywordGroup } from './keyword-strategy-seo-data.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword } from './seo-data-provider.js';
import { buildStrategySignals } from './insight-feedback.js';
import { filterBrandedKeywords, filterBrandedContentGaps, extractBrandTokens } from './competitor-brand-filter.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { isProgrammingError } from './errors.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { resolveWorkspaceLocationCode, resolveWorkspaceLanguageCode, getLocalSeoPosture } from './local-seo.js';
import { LOCAL_SEO_POSTURE } from '../shared/types/local-seo.js';
import { filterDeclinedFromPool } from './strategy-filters.js';
import { buildWorkspaceIntelligence, formatPersonasForPrompt, formatKnowledgeBaseForPrompt, formatForPrompt } from './workspace-intelligence.js';
import { withActiveLocalSeoSlice } from './intelligence/generation-context-builders.js';
import { backfillContentGapsToFloor, buildStrategyIntelligenceBlock, getPagesNeedingAnalysis, isStrategyQualityDiscoveryKeyword, isSuspiciousPlannerGroupedVolume, upsertKeywordPoolCandidate, STRATEGY_CONTENT_GAP_FLOOR, type BackfillContentGapCandidate } from './keyword-strategy-helpers.js';
import { pageAssignmentResponseSchema, siteSynthesisResponseSchema } from './schemas/keyword-strategy-schemas.js';
import type { AIOperationId } from './ai-operation-registry.js';
import { buildOutcomeLearningStatusNote } from './outcome-learning-default-path.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword, type KeywordEvaluationContext } from './keyword-intelligence/index.js';
import { buildStrategyKeywordEvaluationContext } from './keyword-strategy-context.js';
import { buildKeywordUniverse } from './keyword-strategy-universe.js';
import type { KeywordCandidate } from '../shared/types/keyword-universe.js';

const log = createLogger('keyword-strategy:synthesis');

export interface StrategyPageMapEntry {
  pagePath: string;
  pageTitle?: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  intent?: string;
  searchIntent?: string;
  rationale?: string;
  impressions?: number;
  clicks?: number;
  currentPosition?: number;
  previousPosition?: number;
  trendDirection?: string;
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  validated?: boolean;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: string;
  urlLevelKeywords?: { keyword: string; position: number; volume: number; difficulty: number; cpc: number; traffic?: number; url?: string }[];
  urlLevelKeywordSource?: 'semrush' | 'dataforseo';
  gscKeywords?: { query: string; clicks: number; impressions: number; position: number }[];
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
  analysisGeneratedAt?: string;
}

export interface StrategyContentGap {
  topic?: string;
  targetKeyword: string;
  intent?: string;
  priority?: string;
  rationale?: string;
  suggestedPageType?: string;
  competitorProof?: string;
  impressions?: number;
  volume?: number;
  difficulty?: number;
  trendDirection?: string;
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  opportunityScore?: number;
  /** SEO Generation Quality P2 — re-admitted by the deterministic backfill floor. */
  backfilled?: boolean;
  /**
   * SEO Generation Quality P3 (M2, flag-ON) — TRANSIENT marker: this gap was injected
   * by the requested-re-add hard guarantee (the client explicitly asked for this
   * keyword and no page covers it). `_removePageCoveredContentGaps` SKIPS marked gaps
   * so the covered-topic prune heuristic cannot silently undo the hard guarantee.
   * NOT persisted — the `content_gaps` write path uses an explicit field list that
   * omits this, so it never reaches the DB; it only survives in-memory through
   * enrichment's prune step.
   */
  requested?: boolean;
}

export interface StrategyQuickWin {
  pagePath: string;
  action: string;
  estimatedImpact?: string;
  rationale?: string;
  roiScore?: number;
}

export interface StrategyKeywordFix {
  pagePath: string;
  newPrimaryKeyword: string;
}

export interface StrategyOutput {
  siteKeywords?: string[];
  opportunities?: string[];
  contentGaps?: StrategyContentGap[];
  quickWins?: StrategyQuickWin[];
  keywordFixes?: StrategyKeywordFix[];
  pageMap?: StrategyPageMapEntry[];
}

export type KeywordStrategyKeywordPool = Map<string, { volume: number; difficulty: number; source: string }>;

export class KeywordStrategySynthesisError extends Error {
  statusCode: number;
  payload: { error: string; message?: string; raw?: string };

  constructor(statusCode: number, payload: { error: string; message?: string; raw?: string }) {
    super(payload.error);
    this.name = 'KeywordStrategySynthesisError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

interface SynthesizeKeywordStrategyOptions {
  ws: Workspace;
  businessContext: string;
  strategyMode: 'full' | 'incremental';
  seoDataMode: 'quick' | 'full' | 'none';
  /**
   * Resolved live base URL — threaded so the flag-ON keyword-universe assembler
   * can derive the site domain for `getKeywordsForSite` discovery. Optional;
   * unused on the flag-OFF legacy path.
   */
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
  /**
   * Candidates the flag-ON keyword-universe assembler removed via the branded +
   * declined hard filters. Wired to `GenerationQuality.suppressedCount` on the
   * flag-ON path; undefined (left as 0 by the telemetry emit) on the legacy path.
   */
  suppressedCount?: number;
  /**
   * Question keywords grouped by seed (geo + language threaded), surfaced by the
   * flag-ON keyword-universe assembler in the SAME shape the legacy
   * `seoDataMode === 'full'` prefetch produced. Threaded into `enrichKeywordStrategy`
   * by generation on the flag-ON path so FAQ questions are attached to content gaps
   * exactly as before (the legacy prefetch is gated off on flag-ON to avoid a
   * double-fetch). Undefined on the flag-OFF path (generation falls back to the
   * legacy seo-data `questionKeywords`, keeping flag-OFF byte-identical).
   */
  questionKeywords?: QuestionKeywordGroup[];
}

export async function callKeywordStrategyAI(
  workspaceId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  _label?: string,
): Promise<string> {
  void _label;
  const wrappedMessages = messages.map((m, i) =>
    i === 0 && m.role === 'system'
      ? { ...m, content: buildSystemPrompt(workspaceId, m.content) }
      : m
  );

  const system = wrappedMessages[0]?.role === 'system' ? wrappedMessages[0].content : undefined;
  const aiMessages = (system ? wrappedMessages.slice(1) : wrappedMessages) as Array<{ role: 'user' | 'assistant'; content: string }>;

  const result = await callAI({
    operation: 'keyword-strategy',
    model: 'gpt-5.4-mini',
    system,
    messages: aiMessages,
    maxTokens,
    temperature: 0.3,
    // No responseFormat: callers expect arrays or objects — instruction-based JSON is safer
    workspaceId,
    maxRetries: 3,
    timeoutMs: 90_000,
  });
  return stripCodeFences(result.text);
}

/**
 * SEO Generation Quality P3 — flag-ON named-operation caller. Mirrors
 * {@link callKeywordStrategyAI} but takes `operation` as a parameter so the
 * closed-set ops (`keyword-page-assignment` / `keyword-site-synthesis`) carry
 * their own registry contract (json_object responseFormat, research-mode,
 * timeout/retry) instead of the hardcoded `keyword-strategy` op id. Reuses
 * `buildSystemPrompt` for the same voice/guardrail layer. Returns the stripped
 * model text — the caller does `safeParse` (NOT a throwing parser).
 *
 * Do NOT route this through `callKeywordStrategyAI`; that helper hardcodes
 * `operation: 'keyword-strategy'`, which would defeat the named-op contract.
 */
export async function callNamedStrategyAI(
  workspaceId: string,
  operation: Extract<AIOperationId, 'keyword-page-assignment' | 'keyword-site-synthesis'>,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Promise<string> {
  const wrappedMessages = messages.map((m, i) =>
    i === 0 && m.role === 'system'
      ? { ...m, content: buildSystemPrompt(workspaceId, m.content) }
      : m
  );

  const system = wrappedMessages[0]?.role === 'system' ? wrappedMessages[0].content : undefined;
  const aiMessages = (system ? wrappedMessages.slice(1) : wrappedMessages) as Array<{ role: 'user' | 'assistant'; content: string }>;

  const result = await callAI({
    operation,
    system,
    messages: aiMessages,
    maxTokens,
    temperature: 0.3,
    workspaceId,
    // model / responseFormat / maxRetries / timeoutMs / researchMode all flow from
    // the registry operation contract.
  });
  return stripCodeFences(result.text);
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

  // Business context section — declared outside try so topic clustering can access it
  let businessSection = '';
  if (businessContext) {
    businessSection = `\nBUSINESS CONTEXT: ${businessContext}\n`;
  }
  const strategySlices = await withActiveLocalSeoSlice(ws.id, ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline']);
  const strategyIntel = await buildWorkspaceIntelligence(ws.id, { slices: strategySlices,
    learningsDomain: 'strategy',
  });
    const strategySeo = strategyIntel.seoContext;
    const kbBlock = formatKnowledgeBaseForPrompt(strategySeo?.knowledgeBase);
    const persBlock = formatPersonasForPrompt(strategySeo?.personas ?? []);
    const localSeoBlock = formatForPrompt(strategyIntel, {
      verbosity: 'standard',
      sections: ['localSeo'],
      tokenBudget: 1600,
      learningsDomain: 'strategy',
    });
    if (kbBlock) {
      businessSection += kbBlock + '\n';
    }
    if (persBlock) {
      businessSection += persBlock + '\n';
    }
    if (/##\s/.test(localSeoBlock)) {
      businessSection += `${localSeoBlock}\nUse Local SEO evidence conservatively. It can shape local content/page posture, but do not treat local visibility as GSC rank tracking and do not imply provider checks ran during this strategy generation.\n`;
    }

    const clientSignals = strategyIntel.clientSignals;

    // Inject client-declined keywords so AI avoids them. Use the intelligence slice
    // plus the direct helper as a fallback/compat guard.
    const declinedKeywords = [...new Set([
      ...(clientSignals?.keywordFeedback.rejected ?? []),
      ...getDeclinedKeywords(ws.id),
    ])];
    if (declinedKeywords.length > 0) {
      businessSection += `\nDECLINED KEYWORDS (the client has explicitly rejected these — do NOT suggest them or close variants as primaryKeyword, secondaryKeywords, or content gap targets):\n${declinedKeywords.map(k => `- "${k}"`).join('\n')}\n`;
      const rejectionReasons = clientSignals?.keywordFeedback.patterns.topRejectionReasons ?? [];
      if (rejectionReasons.length > 0) {
        businessSection += `Top rejection reasons: ${rejectionReasons.join(', ')} — avoid keywords matching these patterns.\n`;
      }
      log.info(`Injecting ${declinedKeywords.length} declined keywords into AI prompt`);
    }

    // Inject client-requested keywords so AI prioritizes them. These are not the
    // same as clientSignals.keywordFeedback.approved; requested is its own status.
    const requestedKeywords = getRequestedKeywords(ws.id);
    if (requestedKeywords.length > 0) {
      businessSection += `\nCLIENT-REQUESTED KEYWORDS (the client has submitted these keyword ideas — give them HIGH PRIORITY in page assignments and content gap suggestions. If no existing page covers a requested keyword, it MUST appear as a content gap):\n${requestedKeywords.map(k => `- "${k}"`).join('\n')}\n`;
      log.info(`Injecting ${requestedKeywords.length} client-requested keywords into AI prompt`);
    }

    const approvedKeywords = clientSignals?.keywordFeedback.approved ?? [];
    if (approvedKeywords.length > 0) {
      businessSection += `\nAPPROVED KEYWORDS (client has positively reviewed these — treat as safe strategic direction):\n${approvedKeywords.map(k => `- "${k}"`).join('\n')}\n`;
    }
    if (clientSignals?.contentGapVotes?.length) {
      businessSection += `\nCLIENT-PRIORITIZED TOPICS (upvoted by client — give high priority):\n${clientSignals.contentGapVotes.map(v => `- "${v.topic}" (${v.votes} votes)`).join('\n')}\n`;
    }
    if (clientSignals?.effectiveBusinessPriorities?.length) {
      businessSection += `\nBUSINESS PRIORITIES: ${clientSignals.effectiveBusinessPriorities.join('; ')}\n`;
    }
    const coverageGaps = strategyIntel.contentPipeline?.coverageGaps ?? [];
    if (coverageGaps.length > 0) {
      businessSection += `\nSTRATEGY COVERAGE GAPS (strategy keywords without content briefs — prioritize in contentGaps):\n${coverageGaps.map(k => `- "${k}"`).join('\n')}\n`;
    }

    const learningsBlock = formatForPrompt(strategyIntel, {
      sections: ['learnings'],
      learningsDomain: 'strategy',
      verbosity: 'standard',
      tokenBudget: 1500,
    });
    if (learningsBlock) {
      businessSection += `\n\n${learningsBlock}\n`;
      log.info({ workspaceId: ws.id }, 'Injected workspace learnings into strategy prompt');
    } else {
      const learningsStatusNote = buildOutcomeLearningStatusNote(strategyIntel.learnings?.availability, 'strategy');
      if (learningsStatusNote) {
        businessSection += `\nOUTCOME LEARNING STATUS: ${learningsStatusNote}\n`;
      }
    }

    // The generation-quality path is now canonical. Local-intent candidates still stay
    // posture-gated so non-local workspaces do not accumulate irrelevant local terms.
    const seoGenQualityEnabled = true;
    const localPosture = getLocalSeoPosture(ws.id);
    const includeLocalUniverse = localPosture === LOCAL_SEO_POSTURE.LOCAL || localPosture === LOCAL_SEO_POSTURE.HYBRID;
    const strategyKeywordEvaluationContext = buildStrategyKeywordEvaluationContext({
      workspaceId: ws.id,
      workspaceName: ws.name,
      businessContext,
      seoContext: strategySeo,
      clientSignals,
      declinedKeywords,
      requestedKeywords,
      approvedKeywords,
      strictBusinessFit: true,
      // Drop the business_mismatch hard-suppress escalation so narrow-but-real
      // keywords survive into ranking (penalty stays).
      relaxConservatism: seoGenQualityEnabled,
    });

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
      // Sort by volume descending and include ALL keywords
      const poolList = [...keywordPool.entries()]
        .sort((a, b) => b[1].volume - a[1].volume)
        .slice(0, 200)
        .map(([kw, m]) => `"${kw}" (${m.volume}/mo${m.difficulty ? ` KD:${m.difficulty}%` : ''})`)
        .join(', ');
      // Call out client-requested keywords so AI gives them priority
      const clientKws = [...keywordPool.entries()].filter(([, m]) => m.source === 'client').map(([kw]) => `"${kw}"`);
      const clientNote = clientKws.length > 0
        ? `\n\nCLIENT-REQUESTED KEYWORDS — The client specifically wants to target these keywords. Give them PRIORITY when assigning to relevant pages, and ensure they appear in content gap suggestions if no existing page covers them:\n${clientKws.join(', ')}`
        : '';
      semrushBatchRef = `\n\nKEYWORD POOL — VERIFIED search terms with real volume. You MUST pick primaryKeyword from this list when a reasonable match exists for the page topic. Only invent a new keyword if NONE of these are relevant:\n${poolList}${clientNote}`;
    }

    // ── SEO Generation Quality P3 (flag-ON only): closed-set candidate block ──
    // Enumerate the universe candidates with a stable source-row id (the normalized
    // keyword) + their client-signal annotations, and instruct the AI to SELECT +
    // JUSTIFY each pick BY ID. Built once and reused by OP1 (page assignment) and
    // OP2 (site synthesis). Declined candidates are excluded from the visible set
    // (belt-and-suspenders alongside the post-AI declined filters). Empty string
    // when there are no candidates (degrade to the legacy pool ref).
    const buildClosedSetBlock = (maxCandidates = 200): string => {
      if (!universeCandidates || universeCandidates.length === 0) return '';
      const visible = universeCandidates
        .filter(c => !c.declined)
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
        .slice(0, maxCandidates);
      if (visible.length === 0) return '';
      const lines = visible.map(c => {
        const annotations: string[] = [];
        if (c.requested) annotations.push('CLIENT-REQUESTED');
        if (typeof c.voteWeight === 'number' && c.voteWeight > 0) annotations.push(`votes:${c.voteWeight}`);
        if (c.priority) annotations.push(`priority:${c.priority}`);
        const meta = `${c.volume ?? 0}/mo${c.difficulty ? ` KD:${c.difficulty}%` : ''}`;
        const tag = annotations.length > 0 ? ` [${annotations.join(', ')}]` : '';
        // id == normalized keyword (the stable source-row id).
        return `- id:"${c.keyword}" "${c.keyword}" (${meta})${tag}`;
      });
      return `\n\nCLOSED CANDIDATE SET — You MUST select keywords ONLY from this list by their id. Each pick must reference the candidate's id and include a one-line justification. Do NOT invent keywords outside this set:\n${lines.join('\n')}`;
    };
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
    const candidateIds = new Set(
      (universeCandidates ?? []).map(c => normalizeKeyword(c.keyword)).filter(Boolean),
    );
    // Resolve the AI's selection to an IN-SET keyword: prefer the returned sourceId
    // if it is a real candidate id; else fall back to the returned keyword ONLY if IT
    // is in the set; else return null so the caller drops to the synthetic/eligibility
    // path instead of admitting an out-of-set (hallucinated) keyword. Returns the
    // NORMALIZED in-set keyword (== the candidate id) so a valid pick short-circuits
    // the downstream eligibility check exactly as a pool keyword does.
    const resolveClosedSetKeyword = (sourceId: string | undefined, keyword: string | undefined): string | null => {
      const normSourceId = normalizeKeyword(sourceId ?? '');
      if (normSourceId && candidateIds.has(normSourceId)) return normSourceId;
      const normKeyword = normalizeKeyword(keyword ?? '');
      if (normKeyword && candidateIds.has(normKeyword)) return normKeyword;
      return null;
    };

    type PageMapping = {
      pagePath: string;
      pageTitle: string;
      primaryKeyword: string;
      secondaryKeywords: string[];
      searchIntent: string;
      volume?: number;
      difficulty?: number;
      cpc?: number;
      metricsSource?: string;
      serpFeatures?: string[];
      secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
      validated?: boolean;
      _parseError?: boolean;
    };

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
      const batchPages = batch.map(p => {
        let entry = `- ${p.path}: "${p.title}"`;
        if (p.seoTitle) entry += ` | SEO: "${p.seoTitle}"`;
        if (p.seoDesc) entry += ` | Desc: "${p.seoDesc.slice(0, 150)}"`;
        if (p.contentSnippet) entry += `\n  Content: ${p.contentSnippet.slice(0, 800)}`;
        const pageGsc = gscByPath.get(p.path);
        if (pageGsc && pageGsc.length > 0) {
          const topGsc = pageGsc.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
          entry += `\n  GSC: ${topGsc.map(g => `"${g.query}" pos:${g.position.toFixed(1)} clicks:${g.clicks} imp:${g.impressions}`).join(', ')}`;
        }
        // Add per-page provider keywords so the AI sees what this page actually ranks for
        const pageSem = semrushByPath.get(p.path);
        if (pageSem && pageSem.length > 0) {
          const topSem = pageSem.sort((a, b) => b.volume - a.volume).slice(0, 3);
          entry += `\n  SEO provider keywords: ${topSem.map(s => `"${s.keyword}" vol:${s.volume} KD:${s.difficulty}% pos:#${s.position}`).join(', ')}`;
        }
        return entry;
      }).join('\n');

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
      const closedSetBlock = buildClosedSetBlock();
      if (seoGenQualityEnabled && closedSetBlock) {
        const groundedPrompt = `You are an SEO keyword ASSIGNMENT engine. Match each page to the BEST candidate from the CLOSED CANDIDATE SET below — SELECT by id, never invent.
${businessSection}${closedSetBlock}
Pages to analyze:
${batchPages}

Return a JSON OBJECT (not a bare array) with this EXACT shape:
{
  "assignments": [
    {
      "pagePath": "/exact-path",
      "pageTitle": "Page Title",
      "primaryKeyword": "the candidate keyword you selected",
      "primaryKeywordSourceId": "the id of the candidate you selected from the CLOSED CANDIDATE SET",
      "secondaryKeywords": ["3-5 related terms, preferably also candidates from the set"],
      "searchIntent": "commercial|informational|transactional|navigational",
      "justification": "one line: why this candidate fits this page"
    }
  ]
}

Rules:
- MANDATORY: primaryKeyword + primaryKeywordSourceId MUST come from the CLOSED CANDIDATE SET above. Do NOT invent keywords.
- Prefer CLIENT-REQUESTED candidates and higher-priority/higher-vote candidates when a reasonable page match exists.
- If a page has GSC or SEO provider data among the candidates, prefer those (proven ranking terms).
- If multiple pages could target the same candidate, assign it to the MOST relevant page. Pages can share candidates.
- LOCATION TARGETING: If a page references a specific city/state/region, keywords MUST target THAT location.
- Cover ALL ${batch.length} pages — do not skip any.
- Return ONLY valid JSON, no markdown, no explanation.`;

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
            const resolved = resolveClosedSetKeyword(a.primaryKeywordSourceId, a.primaryKeyword);
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
      const batchPrompt = `You are an SEO keyword ASSIGNMENT engine. Your job is to match each page to the BEST keyword from a verified keyword pool — NOT to invent keywords.
${businessSection}${semrushBatchRef}
Pages to analyze:
${batchPages}

Return a JSON array with one entry per page:
[
  {
    "pagePath": "/exact-path",
    "pageTitle": "Page Title",
    "primaryKeyword": "keyword FROM THE POOL above",
    "secondaryKeywords": ["3-5 related terms, preferably also from the pool"],
    "searchIntent": "commercial|informational|transactional|navigational"
  }
]

Rules:
${hasPool ? `- MANDATORY: primaryKeyword MUST be selected from the KEYWORD POOL above. These are real, verified search terms with actual search volume. Do NOT invent keywords.
- If a page has GSC data, the highest-impression GSC query IS your primaryKeyword (it's already in the pool).
- If a page has SEO provider data, prefer those keywords (they're proven ranking terms).
- If multiple pages could target the same keyword, assign it to the MOST relevant page. Other pages can share keywords — that's better than inventing fake ones.
- ONLY if absolutely NO keyword in the pool is even remotely relevant to the page topic, you may suggest a SHORT generic industry term (2-4 words). Mark these with "(invented)" suffix so we can identify them.` : `- primaryKeyword must be a real search term people actually use on Google. Short, generic industry terms (2-4 words).
- If GSC data is available, PREFER the highest-impression GSC query.`}
- Blog posts, changelog entries, and update pages CAN share the same broader keyword — that's better than inventing a niche term nobody searches for.
- LOCATION TARGETING: If a page references a specific city/state/region, keywords MUST target THAT location.
- Cover ALL ${batch.length} pages — do not skip any
- Return ONLY valid JSON array, no markdown, no explanation`;

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
            pagePath: pk.pagePath,
            pageTitle: pk.pageTitle,
            primaryKeyword: pk.primaryKeyword,
            secondaryKeywords: pk.secondaryKeywords || [],
            searchIntent: pk.searchIntent || 'informational',
          });
        }
      }
      log.info(`Incremental mode: merged ${pagesToPreserve.length} preserved pages into final mappings`);
    }

    // --- Post-AI keyword validation via SEO provider bulk lookup ---
    // Optimization: check domain organic data + existing page_keywords before calling API
    if (provider && seoDataMode !== 'none') {
      const domainKwLookup = new Map(semrushDomainData.map(k => [normalizeKeyword(k.keyword), k])); // map-dup-ok
      const existingPkLookup = new Map(
        listPageKeywords(ws.id)
          .filter(pk => pk.volume && pk.volume > 0 && !isSuspiciousPlannerGroupedVolume(pk.primaryKeyword, pk.volume))
          .map(pk => [normalizeKeyword(pk.primaryKeyword), pk])
      );

      // First pass: enrich from already-fetched data (no API calls)
      const needsApiLookup: string[] = [];
      let preEnriched = 0;
      for (const pm of allPageMappings) {
        const kwLower = normalizeKeyword(pm.primaryKeyword ?? '');
        if (!kwLower) continue;
        // Check domain organic data (already fetched this run)
        const domainHit = domainKwLookup.get(kwLower);
        if (domainHit && domainHit.volume > 0) {
          pm.validated = true;
          pm.volume = domainHit.volume;
          pm.difficulty = domainHit.difficulty;
          preEnriched++;
          continue;
        }
        // Check existing page_keywords from previous strategy runs
        const pkHit = existingPkLookup.get(kwLower);
        if (pkHit && pkHit.volume && pkHit.volume > 0) {
          pm.validated = true;
          pm.volume = pkHit.volume;
          pm.difficulty = pkHit.difficulty ?? 0;
          preEnriched++;
          continue;
        }
        needsApiLookup.push(pm.primaryKeyword);
      }
      log.info(`Keyword validation: ${preEnriched} pre-enriched from existing data, ${needsApiLookup.length} need API lookup`);

      // Second pass: fetch remaining from provider API
      if (needsApiLookup.length > 0) {
        try {
          const uniqueNeedsByKey = new Map<string, string>();
          for (const keyword of needsApiLookup) {
            const key = normalizeKeyword(keyword);
            if (key && !uniqueNeedsByKey.has(key)) {
              uniqueNeedsByKey.set(key, keyword);
            }
          }
          const uniqueNeeds = [...uniqueNeedsByKey.values()];
          const locationCode = resolveWorkspaceLocationCode(ws.id) ?? undefined;
          // (I4) On the flag-ON path validate page keywords in the resolved
          // workspace language (matching the universe's resolved-language pool);
          // flag-OFF passes no languageCode → the provider's 'en' default, so the
          // flag-OFF request is byte-identical to before.
          const languageCode = usedKeywordUniverse ? resolveWorkspaceLanguageCode(ws.id) : undefined;
          const metrics = await provider.getKeywordMetrics(uniqueNeeds.slice(0, 100), ws.id, undefined, locationCode, languageCode);
          const metricMap = new Map(metrics.map(m => [normalizeKeyword(m.keyword), m])); // map-dup-ok

          let unvalidated = 0;
          for (const pm of allPageMappings) {
            if (pm.validated != null) continue; // already handled
            const m = metricMap.get(normalizeKeyword(pm.primaryKeyword));
            if (m && m.volume > 0 && !isSuspiciousPlannerGroupedVolume(m.keyword, m.volume)) {
              pm.validated = true;
              pm.volume = m.volume;
              pm.difficulty = m.difficulty;
            } else {
              pm.validated = false;
              unvalidated++;
            }
          }
          log.info(`API validation: ${needsApiLookup.length - unvalidated} validated, ${unvalidated} unvalidated`);
        } catch (err) {
          log.error({ err }, 'Post-AI keyword validation error');
        }
      }
    }

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

    type MasterStrategyData = {
      siteKeywords?: string[];
      opportunities?: string[];
      contentGaps?: Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
      quickWins?: StrategyQuickWin[];
      keywordFixes?: StrategyKeywordFix[];
    };

    let masterData: MasterStrategyData;
    const masterClosedSetBlock = buildClosedSetBlock();
    if (seoGenQualityEnabled && masterClosedSetBlock) {
      // ── SEO Generation Quality P3 (flag-ON): closed-set, Zod-validated OP2 ──
      const businessPrioritiesBlock = businessPrioritiesContext.length > 0
        ? `\n\nBUSINESS PRIORITIES (global context — favor candidates that advance these): ${businessPrioritiesContext.join('; ')}`
        : '';
      const groundedMasterPrompt = `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy by SELECTING from the CLOSED CANDIDATE SET — never invent keywords.
${businessSection}
Current keyword assignments (${allPageMappings.length} pages):
${kwSummary}
${conflictNote}${gscSummary}${ga4Context}${auditContext}
${sanitizedProviderContext}${intelligenceBlock}${masterClosedSetBlock}${businessPrioritiesBlock}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword SELECTED from the CLOSED CANDIDATE SET",
      "targetKeywordSourceId": "the id of the candidate you selected",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact",
      "suggestedPageType": "blog|landing|service|location|product|pillar|resource",
      "competitorProof": "competitor.com ranks #3 (optional — cite if a competitor ranks for this keyword)"
    }
  ],
  "quickWins": [
    {
      "pagePath": "/exact-path-from-list-above",
      "action": "Specific actionable fix",
      "estimatedImpact": "high|medium|low",
      "rationale": "Why this improves rankings"
    }
  ]${conflicts.length > 0 ? `,
  "keywordFixes": [
    { "pagePath": "/path", "newPrimaryKeyword": "better unique keyword" }
  ]` : ''}
}

Rules:
- siteKeywords: 8-15 broad themes covering the full site, drawn from the CLOSED CANDIDATE SET.
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. CRITICAL: every targetKeyword + targetKeywordSourceId MUST be SELECTED from the CLOSED CANDIDATE SET — do NOT invent keywords. ${hasKeywordGaps ? 'PRIORITIZE keywords from COMPETITOR KEYWORD GAPS — these are keywords competitors rank for that this site doesn\'t. For each gap backed by competitor data, include competitorProof citing which competitor ranks and at what position. At least 50% of content gaps should come from competitor gap data.' : ''} CLIENT-REQUESTED candidates (tagged in the set) get HIGH PRIORITY: if a client-requested candidate has no existing page covering it, it MUST appear as a content gap. Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority.
- suggestedPageType: Choose the best page type for each content gap. Use "blog" for informational articles, "landing" for conversion pages, "service" for service descriptions, "location" for local SEO, "product" for product pages, "pillar" for topic hubs, "resource" for guides/downloads.
- quickWins: 3-5 existing pages where small changes boost rankings. Use GSC data if available (high impressions + poor position = opportunity).
- If DEVICE BREAKDOWN shows mobile ranking gaps, include a mobile-optimization quick win.
- If PERIOD COMPARISON shows declining metrics, flag defensive content gaps to recover traffic.
- If GA4 shows high-bounce organic pages, include content-improvement quick wins for those pages.
- If GA4 shows organic landing pages NOT in the keyword map, suggest adding them to the strategy.
- If CONVERSION EVENTS data is available, prioritize keywords for pages that drive conversions. Protect "money pages" — never deprioritize their keywords.
- If TOP CONVERTING PAGES data is available, mention specific conversion events in quickWin rationales.
- If SEO AUDIT data shows high-traffic pages with errors, include them as quickWins with specific fix actions.
- If COUNTRY data shows a dominant market, consider location-specific content gaps.
${hasProviderContext ? '- Use SEO provider data to inform priorities. KD < 40% = quick wins.' : ''}
${competitorDomains.length > 0 ? `- NEVER suggest a keyword that contains a competitor's brand name. Do NOT include keywords containing any of these brand tokens: ${[...new Set(competitorDomains.flatMap(d => extractBrandTokens(d)))].join(', ')}.` : '- NEVER suggest branded competitor keywords — keywords containing a competitor\'s company or product name.'}
- Return ONLY valid JSON, no markdown`;

      log.info(`Master prompt (closed-set): ${groundedMasterPrompt.length} chars (~${Math.ceil(groundedMasterPrompt.length / 4)} tokens)`);
      const masterMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: groundedMasterPrompt },
      ];
      let masterRaw = await callNamedStrategyAI(ws.id, 'keyword-site-synthesis', masterMessages, 3000);
      let masterResult = siteSynthesisResponseSchema.safeParse(parseJsonFallback<unknown>(masterRaw, null));
      if (!masterResult.success) {
        const issues = masterResult.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        log.warn({ workspaceId: ws.id, issues }, 'Master closed-set OP2 failed validation — retrying once');
        masterMessages.push({ role: 'assistant', content: masterRaw });
        masterMessages.push({ role: 'user', content: `Your previous response failed schema validation: ${issues}. Return ONLY the corrected JSON object with the exact keys siteKeywords, opportunities, contentGaps, quickWins. No markdown.` });
        masterRaw = await callNamedStrategyAI(ws.id, 'keyword-site-synthesis', masterMessages, 3000);
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
          const resolved = resolveClosedSetKeyword(cg.targetKeywordSourceId, cg.targetKeyword);
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
      const masterPrompt = `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy.
${businessSection}
Current keyword assignments (${allPageMappings.length} pages):
${kwSummary}
${conflictNote}${gscSummary}${ga4Context}${auditContext}
${sanitizedProviderContext}${intelligenceBlock}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword (MUST be from keyword-provider/GSC data when available)",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact",
      "suggestedPageType": "blog|landing|service|location|product|pillar|resource",
      "competitorProof": "competitor.com ranks #3 (optional — cite if a competitor ranks for this keyword)"
    }
  ],
  "quickWins": [
    {
      "pagePath": "/exact-path-from-list-above",
      "action": "Specific actionable fix",
      "estimatedImpact": "high|medium|low",
      "rationale": "Why this improves rankings"
    }
  ]${conflicts.length > 0 ? `,
  "keywordFixes": [
    { "pagePath": "/path", "newPrimaryKeyword": "better unique keyword" }
  ]` : ''}
}

Rules:
- siteKeywords: 8-15 broad themes covering the full site
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. CRITICAL: Every targetKeyword MUST come from SEO provider/GSC data above when available — do NOT invent keywords. ${hasKeywordGaps ? 'PRIORITIZE keywords from COMPETITOR KEYWORD GAPS — these are keywords competitors rank for that this site doesn\'t. For each gap backed by competitor data, include competitorProof citing which competitor ranks and at what position. At least 50% of content gaps should come from competitor gap data.' : ''}${clientKeywordsAdded > 0 ? ` CLIENT-REQUESTED KEYWORDS get HIGH PRIORITY: if any client-requested keyword from the pool has no existing page covering it, it MUST appear as a content gap. The client specifically wants to rank for these terms.` : ''} Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority
- suggestedPageType: Choose the best page type for each content gap. Use "blog" for informational articles, "landing" for conversion pages, "service" for service descriptions, "location" for local SEO, "product" for product pages, "pillar" for topic hubs, "resource" for guides/downloads.
- quickWins: 3-5 existing pages where small changes boost rankings. Use GSC data if available (high impressions + poor position = opportunity).
- If DEVICE BREAKDOWN shows mobile ranking gaps, include a mobile-optimization quick win.
- If PERIOD COMPARISON shows declining metrics, flag defensive content gaps to recover traffic.
- If GA4 shows high-bounce organic pages, include content-improvement quick wins for those pages.
- If GA4 shows organic landing pages NOT in the keyword map, suggest adding them to the strategy.
- If CONVERSION EVENTS data is available, prioritize keywords for pages that drive conversions. Protect "money pages" — never deprioritize their keywords.
- If TOP CONVERTING PAGES data is available, mention specific conversion events in quickWin rationales (e.g., "this page drives 15 form_submissions — fixing its meta description could increase CTR").
- If SEO AUDIT data shows high-traffic pages with errors, include them as quickWins with specific fix actions.
- If COUNTRY data shows a dominant market, consider location-specific content gaps.
${hasProviderContext ? '- Use SEO provider data to inform priorities. KD < 40% = quick wins.' : ''}
${competitorDomains.length > 0 ? `- NEVER suggest a keyword that contains a competitor's brand name. Competitor domains are used to identify topic areas and intent gaps — NOT to recommend branded searches that funnel users to a competitor. Specifically, do NOT include keywords containing any of these brand tokens: ${[...new Set(competitorDomains.flatMap(d => extractBrandTokens(d)))].join(', ')}. If a keyword gap came from competitor data but contains a competitor brand name, skip it and find the next best non-branded gap.` : '- NEVER suggest branded competitor keywords — keywords containing a competitor\'s company or product name. Use competitor data to find topic areas, not to recommend searches that drive users to a competitor.'}
- Return ONLY valid JSON, no markdown`;

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
      const fixMap = new Map(masterData.keywordFixes.map((f: { pagePath: string; newPrimaryKeyword: string }) => [f.pagePath, f.newPrimaryKeyword]));
      let appliedFixes = 0;
      let suppressedFixes = 0;
      for (const pm of allPageMappings) {
        const fix = fixMap.get(pm.pagePath);
        if (fix && isEligibleGeneratedKeyword(fix as string)) {
          pm.primaryKeyword = fix as string;
          appliedFixes++;
        } else if (fix) {
          suppressedFixes++;
        }
      }
      log.info(`Applied ${appliedFixes} keyword conflict fixes`);
      if (suppressedFixes > 0) {
        log.info(`Suppressed ${suppressedFixes} keyword conflict fixes via shared keyword intelligence`);
      }
    }

    // Post-generation hard filter: remove declined keywords from siteKeywords.
    // The AI prompt instructs this, but LLMs don't always comply — hard filter is the real defense.
    if (declinedKeywords.length > 0 && masterData.siteKeywords?.length) {
      const before = masterData.siteKeywords.length;
      masterData.siteKeywords = masterData.siteKeywords.filter(
        (kw: string) => !declinedSet.has(normalizeKeyword(kw))
      );
      const declinedSiteKwsRemoved = before - masterData.siteKeywords.length;
      if (declinedSiteKwsRemoved > 0) {
        log.info(`Stripped ${declinedSiteKwsRemoved} declined keywords from siteKeywords despite prompt instruction`);
      }
    }
    if (masterData.siteKeywords?.length) {
      const beforeSharedFilter = masterData.siteKeywords.length;
      masterData.siteKeywords = masterData.siteKeywords.filter((kw: string) => isEligibleGeneratedKeyword(kw));
      const sharedSiteKwsRemoved = beforeSharedFilter - masterData.siteKeywords.length;
      if (sharedSiteKwsRemoved > 0) {
        log.info(`Stripped ${sharedSiteKwsRemoved} site keywords via shared keyword intelligence`);
      }
    }

    // Post-generation hard filter: remove any content gaps containing competitor brand names.
    // The AI prompt tells it not to suggest these, but LLMs don't always comply.
    // This filter is the real defense — the prompt is the soft guardrail.
    const rawContentGaps = masterData.contentGaps || [];
    const { filtered: cleanContentGaps, removed: brandedGaps } = filterBrandedContentGaps(rawContentGaps, competitorDomains);
    if (brandedGaps.length > 0) {
      log.info(`Stripped ${brandedGaps.length} branded content gaps despite prompt instruction: ${brandedGaps.map((g: { targetKeyword: string }) => g.targetKeyword).join(', ')}`);
    }
    // Filter declined keywords from content gap targets (mirrors filterBrandedContentGaps pattern)
    let finalContentGaps = cleanContentGaps;
    if (declinedKeywords.length > 0 && cleanContentGaps.length > 0) {
      finalContentGaps = cleanContentGaps.filter(
        (cg: { targetKeyword?: string }) =>
          !cg.targetKeyword || !declinedSet.has(normalizeKeyword(cg.targetKeyword))
      );
      const declinedGapsRemoved = cleanContentGaps.length - finalContentGaps.length;
      if (declinedGapsRemoved > 0) {
        log.info(`Stripped ${declinedGapsRemoved} declined content gaps despite prompt instruction`);
      }
    }
    if (finalContentGaps.length > 0) {
      const beforeSharedFilter = finalContentGaps.length;
      finalContentGaps = finalContentGaps.filter((cg: { targetKeyword?: string }) =>
        !cg.targetKeyword || isEligibleGeneratedKeyword(cg.targetKeyword)
      );
      const sharedFilterRemoved = beforeSharedFilter - finalContentGaps.length;
      if (sharedFilterRemoved > 0) {
        log.info(`Stripped ${sharedFilterRemoved} content gaps via shared keyword intelligence`);
      }
    }

    // ── SEO Generation Quality P3 (flag-ON only) ──
    if (seoGenQualityEnabled && universeCandidates) {
      // (G4) REQUESTED re-add — make "requested MUST appear" a HARD guarantee, not
      // just a prompt. After the content-gap filters and BEFORE the backfill, inject
      // any requested candidate not covered by pageMap AND absent from finalContentGaps
      // as a content gap (priority high). Runs only on flag-ON.
      const pageMapKeys = new Set(
        allPageMappings
          .flatMap(pm => [pm.primaryKeyword, ...(pm.secondaryKeywords ?? [])])
          .map(k => normalizeKeyword(k))
          .filter(Boolean),
      );
      const gapKeys = new Set(
        finalContentGaps.map(cg => normalizeKeyword(cg.targetKeyword ?? '')).filter(Boolean),
      );
      let requestedReadded = 0;
      for (const candidate of universeCandidates) {
        if (!candidate.requested || candidate.declined) continue;
        const key = normalizeKeyword(candidate.keyword);
        if (!key || pageMapKeys.has(key) || gapKeys.has(key)) continue;
        finalContentGaps = [
          ...finalContentGaps,
          {
            topic: candidate.keyword,
            targetKeyword: candidate.keyword,
            intent: 'commercial',
            priority: 'high',
            rationale: 'Client-requested keyword with no existing page coverage — surfaced as a content gap.',
            volume: candidate.volume,
            difficulty: candidate.difficulty,
            // (M2) Transient marker so enrichment's covered-topic prune SKIPS this gap
            // and cannot silently undo the requested-re-add hard guarantee. Not persisted.
            requested: true,
          } as StrategyContentGap & { targetKeyword: string; topic: string },
        ];
        gapKeys.add(key);
        requestedReadded++;
      }
      if (requestedReadded > 0) {
        log.info({ workspaceId: ws.id, requestedReadded }, 'Re-added client-requested keywords as content gaps (hard guarantee)');
      }

      // Never-emit-empty backfill (synthesis-internal). COMPLEMENTARY to P2's
      // generation-layer backfill — both stay; the `seen` de-dup inside
      // backfillContentGapsToFloor makes them idempotent. If the kept gap count is
      // below the floor, build prunedFromUniverse from the candidates (exclude declined
      // + already-selected keys), shaped as BackfillContentGapCandidate, and re-admit
      // the highest-scoring up to the floor (tagged backfilled: true).
      if (finalContentGaps.length < STRATEGY_CONTENT_GAP_FLOOR) {
        const selectedKeys = new Set([...pageMapKeys, ...gapKeys]);
        const prunedFromUniverse: BackfillContentGapCandidate[] = [];
        for (const candidate of universeCandidates) {
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
            finalContentGaps as Array<StrategyContentGap & { targetKeyword: string; topic: string }>,
            prunedFromUniverse.map(c => ({
              ...c,
              topic: c.targetKeyword,
              intent: 'informational',
              priority: 'medium',
              rationale: 'Re-admitted from the keyword universe to meet the content-gap floor.',
            })) as Array<StrategyContentGap & { targetKeyword: string; topic: string }>,
            STRATEGY_CONTENT_GAP_FLOOR,
          );
          if (backfill.backfilledCount > 0) {
            finalContentGaps = backfill.gaps;
            log.info({ workspaceId: ws.id, backfilledCount: backfill.backfilledCount, floor: STRATEGY_CONTENT_GAP_FLOOR }, 'Synthesis-internal content-gap backfill applied (flag-ON)');
          }
        }
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
      for (const pm of strategy.pageMap) {
        if (pm.primaryKeyword && declinedSet.has(normalizeKeyword(pm.primaryKeyword))) {
          pm.primaryKeyword = '';
        }
        if (pm.secondaryKeywords?.length) {
          pm.secondaryKeywords = pm.secondaryKeywords.filter(
            (k: string) => !declinedSet.has(normalizeKeyword(k))
          );
        }
      }
    }
    log.info(`Final strategy: ${strategy.pageMap?.length ?? 0} pages, ${strategy.siteKeywords?.length ?? 0} site keywords, ${strategy.contentGaps?.length ?? 0} content gaps, ${strategy.quickWins?.length ?? 0} quick wins`);

  return { strategy, pagesToAnalyze, keywordPool, businessSection, keywordEvaluationContext: strategyKeywordEvaluationContext, suppressedCount: suppressedUniverseCount, questionKeywords: universeQuestionKeywords };
}

// ---------------------------------------------------------------------------
// Pure helper functions — exported for unit testing
// These are extracted data-transformation utilities with no AI/DB side-effects.
// ---------------------------------------------------------------------------

export interface BuildLegacyKeywordPoolOptions {
  /** Canonical pool Map (mutated in place — same Map the caller reads). */
  keywordPool: KeywordStrategyKeywordPool;
  /** Per-page provider-keyword lookup (mutated in place for page assignment). */
  semrushByPath: Map<string, DomainKeyword[]>;
  domainKeywords: DomainKeyword[];
  gscData: Array<{ query: string; impressions: number }>;
  competitorKeywords: CompetitorKeywordData[];
  keywordGaps: KeywordGapEntry[];
  discoveryKeywords: KeywordSourceEvidence[];
  relatedKeywords: RelatedKeyword[];
  /** Already-resolved client-tracked rows (caller does the `getTrackedKeywords` read). */
  clientTracked: Array<{ query: string }>;
  requestedKeywords: string[];
  competitorDomains: string[];
  declinedKeywords: string[];
  providerName?: string;
  /** The shared admission predicate (closes over the workspace eval context). */
  isEligible: (k: { keyword: string; volume?: number; difficulty?: number; cpc?: number; source?: string; sourceKind?: string }) => boolean;
}

export interface BuildLegacyKeywordPoolResult {
  /** Pre-filter client increment count (M1 semantics — counted before filters). */
  clientKeywordsAdded: number;
  brandedRemoved: number;
  declinedPoolRemoved: number;
}

/**
 * The legacy (pre-P1) inline keyword-pool build, extracted VERBATIM so the
 * flag-OFF code path and the flag-OFF parity test drive the same code (I3a — no
 * reimplemented "local copy"). Mutates `keywordPool` + `semrushByPath` in place.
 * Pure with respect to DB/AI: the caller supplies `clientTracked` and `isEligible`.
 */
export function buildLegacyKeywordPool(opts: BuildLegacyKeywordPoolOptions): BuildLegacyKeywordPoolResult {
  const {
    keywordPool, semrushByPath, domainKeywords, gscData, competitorKeywords,
    keywordGaps, discoveryKeywords, relatedKeywords, clientTracked,
    requestedKeywords, competitorDomains, declinedKeywords, providerName, isEligible,
  } = opts;

  if (domainKeywords.length > 0) {
    // Group domain keywords by URL path for per-page matching
    for (const k of domainKeywords) {
      const eligible = isEligible({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, source: providerName ?? 'seo-provider' });
      if (!eligible) continue;
      const p = normalizePageUrl(k.url);
      if (!semrushByPath.has(p)) semrushByPath.set(p, []);
      semrushByPath.get(p)!.push(k);
      upsertKeywordPoolCandidate(keywordPool, k.keyword, { volume: k.volume, difficulty: k.difficulty, source: providerName ?? 'seo-provider' });
    }
  }
  // Add GSC queries to the pool (these are proven search terms)
  for (const r of gscData) {
    const q = normalizeKeyword(r.query);
    if (q.length > 3 && q.split(' ').length >= 2) {
      upsertKeywordPoolCandidate(keywordPool, q, { volume: r.impressions, difficulty: 0, source: 'gsc' });
    }
  }
  // Add competitor keywords to the pool — these are proven industry terms with real volume
  for (const ck of competitorKeywords) {
    const kw = normalizeKeyword(ck.keyword);
    if (ck.volume > 0 && isEligible({ keyword: kw, volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` })) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` });
    }
  }
  // Add keyword gaps to the pool — highest priority since competitors rank and you don't
  for (const gap of keywordGaps) {
    const kw = normalizeKeyword(gap.keyword);
    if (gap.volume > 0 && isEligible({ keyword: kw, volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` })) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` });
    }
  }
  // Add provider discovery keywords to the pool for sparse/low-footprint sites.
  for (const dk of discoveryKeywords) {
    const kw = normalizeKeyword(dk.keyword);
    if (isStrategyQualityDiscoveryKeyword(dk) && isEligible(dk)) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: dk.volume, difficulty: dk.difficulty, source: `discovery:${dk.sourceKind}` });
    }
  }
  // Add related keywords to the pool
  for (const rk of relatedKeywords) {
    const kw = normalizeKeyword(rk.keyword);
    if (rk.volume > 0 && isEligible({ keyword: kw, volume: rk.volume, difficulty: rk.difficulty, cpc: rk.cpc, source: 'related' })) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: rk.volume, difficulty: rk.difficulty, source: 'related' });
    }
  }
  // Add client-tracked keywords to the pool — these are keywords the client explicitly wants to target
  let clientKeywordsAdded = 0;
  for (const tk of clientTracked) {
    const kw = normalizeKeyword(tk.query);
    if (kw.length > 1) {
      const added = upsertKeywordPoolCandidate(keywordPool, kw, { volume: 0, difficulty: 0, source: 'client' });
      if (!added) continue;
      clientKeywordsAdded++;
    }
  }
  // Add client-requested keywords to pool
  for (const kw of requestedKeywords) {
    const added = upsertKeywordPoolCandidate(keywordPool, kw, { volume: 0, difficulty: 0, source: 'client' });
    if (added) {
      clientKeywordsAdded++;
    }
  }
  // Filter branded competitor keywords from the pool BEFORE feeding to AI
  const brandedRemoved = filterBrandedKeywords(keywordPool, competitorDomains);
  // Hard filter: remove declined keywords before the AI sees the pool (prompt instruction is soft)
  const declinedPoolRemoved = filterDeclinedFromPool(keywordPool, declinedKeywords);
  return { clientKeywordsAdded, brandedRemoved, declinedPoolRemoved };
}

/**
 * Render the keyword pool into a prompt reference block for batch page analysis.
 * Returns an empty string when the pool is empty.
 */
export function buildKeywordPoolSection(
  pool: Map<string, { volume: number; difficulty: number; source: string }>,
  maxKeywords = 200,
): string {
  if (pool.size === 0) return '';
  const poolList = [...pool.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, maxKeywords)
    .map(([kw, m]) => `"${kw}" (${m.volume}/mo${m.difficulty ? ` KD:${m.difficulty}%` : ''})`)
    .join(', ');
  const clientKws = [...pool.entries()]
    .filter(([, m]) => m.source === 'client')
    .map(([kw]) => `"${kw}"`);
  const clientNote =
    clientKws.length > 0
      ? `\n\nCLIENT-REQUESTED KEYWORDS — The client specifically wants to target these keywords. Give them PRIORITY when assigning to relevant pages, and ensure they appear in content gap suggestions if no existing page covers them:\n${clientKws.join(', ')}`
      : '';
  return `\n\nKEYWORD POOL — VERIFIED search terms with real volume. You MUST pick primaryKeyword from this list when a reasonable match exists for the page topic. Only invent a new keyword if NONE of these are relevant:\n${poolList}${clientNote}`;
}

/**
 * Detect primary keyword conflicts: multiple pages assigned the same keyword.
 * Returns an array of [normalizedKeyword, pagePaths[]] pairs where len > 1.
 */
export function detectKeywordConflicts(
  pageMappings: Array<{ pagePath: string; primaryKeyword: string }>,
  normalize: (kw: string) => string,
): Array<[string, string[]]> {
  const kwCount = new Map<string, string[]>();
  for (const pm of pageMappings) {
    const kw = normalize(pm.primaryKeyword);
    if (!kw) continue;
    if (!kwCount.has(kw)) kwCount.set(kw, []);
    kwCount.get(kw)!.push(pm.pagePath);
  }
  return [...kwCount.entries()].filter(([, pages]) => pages.length > 1);
}

/**
 * Build the keyword conflict resolution note appended to the master prompt.
 * Returns an empty string when there are no conflicts.
 */
export function buildConflictNote(conflicts: Array<[string, string[]]>): string {
  if (conflicts.length === 0) return '';
  return (
    `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n` +
    conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n') +
    `\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
  );
}

/**
 * Build a one-line keyword assignment summary entry for the master prompt.
 */
export function buildKeywordSummaryLine(pagePath: string, primaryKeyword: string): string {
  return `${pagePath}: "${primaryKeyword}"`;
}

/**
 * Build a fallback primary keyword from page identity (title or URL slug).
 * Returns null when no non-empty string can be derived.
 */
export function buildFallbackKeywordFromPageIdentity(
  pagePath: string,
  page: { seoTitle?: string | null; title?: string | null } | undefined,
  normalizer: (kw: string) => string,
): string | null {
  const titleFallback = page?.seoTitle || page?.title;
  const slugFallback = pagePath.split('/').filter(Boolean).join(' ');
  const fallback = normalizer(titleFallback || slugFallback);
  return fallback || null;
}

/**
 * Format a period comparison (last 28 days vs previous 28 days) into a prompt block.
 * Returns an empty string when `periodComparison` is null/undefined.
 */
export function buildPeriodComparisonBlock(
  periodComparison: {
    change: { clicks: number; impressions: number; position: number };
    changePercent: { clicks: number; impressions: number; position: number };
  } | null | undefined,
): string {
  if (!periodComparison) return '';
  const { change, changePercent } = periodComparison;
  const posLabel =
    change.position > 0 ? 'declining ⚠️' : change.position < 0 ? 'improving ✓' : 'stable';
  return (
    `\n\nPERIOD COMPARISON (last 28 days vs previous 28 days):\n` +
    `- Clicks: ${change.clicks >= 0 ? '+' : ''}${change.clicks} (${changePercent.clicks >= 0 ? '+' : ''}${changePercent.clicks}%)\n` +
    `- Impressions: ${change.impressions >= 0 ? '+' : ''}${change.impressions} (${changePercent.impressions >= 0 ? '+' : ''}${changePercent.impressions}%)\n` +
    `- Avg Position: ${change.position >= 0 ? '+' : ''}${change.position} (${posLabel})`
  );
}

/**
 * Format top GSC queries into a prompt block (sorted by impressions descending, top 30).
 * Returns an empty string when `gscRows` is empty.
 */
export function buildGscQueriesBlock(
  gscRows: Array<{ page: string; query: string; position: number; clicks: number; impressions: number }>,
): string {
  if (gscRows.length === 0) return '';
  const top = [...gscRows].sort((a, b) => b.impressions - a.impressions).slice(0, 30);
  const lines = top.map(r => {
    const pagePath = normalizePageUrl(r.page);
    return `- "${r.query}" → ${pagePath} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`;
  });
  return `\n\nTop GSC queries (last 90 days):\n` + lines.join('\n');
}

/**
 * Format the device breakdown section and optionally append a mobile-gap warning.
 * Returns an empty string when `deviceBreakdown` is empty.
 */
export function buildDeviceBreakdownBlock(
  deviceBreakdown: Array<{ device: string; clicks: number; impressions: number; ctr: number; position: number }>,
): string {
  if (deviceBreakdown.length === 0) return '';
  let out =
    `\n\nDEVICE BREAKDOWN (last 28 days):\n` +
    deviceBreakdown
      .map(d => `- ${d.device}: ${d.clicks} clicks, ${d.impressions} imp, CTR ${d.ctr}%, avg pos ${d.position}`)
      .join('\n');
  const mobile = deviceBreakdown.find(d => d.device === 'MOBILE');
  const desktop = deviceBreakdown.find(d => d.device === 'DESKTOP');
  if (
    mobile &&
    desktop &&
    mobile.impressions > desktop.impressions &&
    mobile.position > desktop.position + 2
  ) {
    out += `\n⚠️ MOBILE GAP: Mobile has ${mobile.impressions} imp vs desktop ${desktop.impressions} but avg position is ${mobile.position.toFixed(1)} vs ${desktop.position.toFixed(1)} — mobile optimization is critical.`;
  }
  return out;
}

/**
 * Format the country breakdown section (top 5 countries by clicks).
 * Returns an empty string when `countryBreakdown` is empty.
 */
export function buildCountryBreakdownBlock(
  countryBreakdown: Array<{ country: string; clicks: number; impressions: number; position: number }>,
): string {
  if (countryBreakdown.length === 0) return '';
  return (
    `\n\nTOP COUNTRIES by clicks:\n` +
    countryBreakdown
      .slice(0, 5)
      .map(c => `- ${c.country}: ${c.clicks} clicks, ${c.impressions} imp, pos ${c.position}`)
      .join('\n')
  );
}

/**
 * Detect unmapped organic landing pages (pages with GA4 organic traffic but no page map entry).
 */
export function findUnmappedLandingPages<T extends { landingPage: string }>(
  organicLandingPages: T[],
  mappedPaths: Set<string>,
): T[] {
  return organicLandingPages.filter(lp => !mappedPaths.has(lp.landingPage));
}

/**
 * Filter high-bounce organic landing pages (bounce > 70% AND sessions > 5).
 */
export function findHighBounceLandingPages<T extends { landingPage: string; bounceRate: number; sessions: number }>(
  organicLandingPages: T[],
): T[] {
  return organicLandingPages.filter(lp => lp.bounceRate > 70 && lp.sessions > 5);
}

/**
 * Filter declined keywords from a siteKeywords list using a pre-built declined set.
 * Returns the filtered list (does not mutate the input array).
 */
export function filterDeclinedSiteKeywords(
  siteKeywords: string[],
  declinedSet: Set<string>,
  normalize: (kw: string) => string,
): string[] {
  return siteKeywords.filter(kw => !declinedSet.has(normalize(kw)));
}

/**
 * Filter declined keywords from content gap targets.
 * Returns only content gaps whose `targetKeyword` is not in the declined set.
 */
export function filterDeclinedContentGaps<T extends { targetKeyword?: string }>(
  contentGaps: T[],
  declinedSet: Set<string>,
  normalize: (kw: string) => string,
): T[] {
  return contentGaps.filter(cg => !cg.targetKeyword || !declinedSet.has(normalize(cg.targetKeyword)));
}

/**
 * Find the top converting page for each path from a list of page+event records.
 * Returns [pagePath, { events, topEvent }][] sorted by event count descending, limited to top N.
 */
export function buildTopConvertingPages(
  ga4EventsByPage: Array<{ pagePath: string; eventName: string; eventCount: number }>,
  limit = 8,
): Array<[string, { events: number; topEvent: string }]> {
  const pageEvents = new Map<string, { events: number; topEvent: string }>();
  for (const ep of ga4EventsByPage) {
    const existing = pageEvents.get(ep.pagePath);
    if (!existing || ep.eventCount > existing.events) {
      pageEvents.set(ep.pagePath, { events: ep.eventCount, topEvent: ep.eventName });
    }
  }
  return [...pageEvents.entries()]
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, limit);
}
