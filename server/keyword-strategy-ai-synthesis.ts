import { applySuppressionsToAudit, getAuditTrafficForWorkspace, normalizePath, stripCodeFences } from './helpers.js';
import { callAI } from './ai.js';
import { getLatestSnapshot } from './reports.js';
import { getTrackedKeywords } from './rank-tracking.js';
import type { SeoDataProvider } from './seo-data-provider.js';
import { listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { KeywordStrategy, Workspace } from '../shared/types/workspace.js';
import type { KeywordStrategyPageInfo } from './keyword-strategy-pages.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import type { CompetitorKeywordData } from './keyword-strategy-seo-data.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword } from './seo-data-provider.js';
import { buildStrategySignals } from './insight-feedback.js';
import { filterBrandedKeywords, filterBrandedContentGaps, extractBrandTokens } from './competitor-brand-filter.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { isProgrammingError } from './errors.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { filterDeclinedFromPool } from './strategy-filters.js';
import { buildWorkspaceIntelligence, formatPersonasForPrompt, formatKnowledgeBaseForPrompt, formatForPrompt } from './workspace-intelligence.js';
import { buildStrategyIntelligenceBlock, getPagesNeedingAnalysis } from './keyword-strategy-helpers.js';

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
  competitorDomains: string[];
  pageInfo: KeywordStrategyPageInfo[];
  preloadedPageKeywords: ReturnType<typeof listPageKeywords> | null;
  searchData: KeywordStrategySearchData;
  seoContext: string;
  domainKeywords: DomainKeyword[];
  keywordGaps: KeywordGapEntry[];
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
  upToDate?: boolean;
  freshPageCount?: number;
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
    model: 'gpt-5.4-mini',
    system,
    messages: aiMessages,
    maxTokens,
    temperature: 0.3,
    // No responseFormat: callers expect arrays or objects — instruction-based JSON is safer
    feature: 'keyword-strategy',
    workspaceId,
    maxRetries: 3,
    timeoutMs: 90_000,
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
  const strategyIntel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline'],
    learningsDomain: 'strategy',
  });
    const strategySeo = strategyIntel.seoContext;
    const kbBlock = formatKnowledgeBaseForPrompt(strategySeo?.knowledgeBase);
    const persBlock = formatPersonasForPrompt(strategySeo?.personas ?? []);
    if (kbBlock) {
      businessSection += kbBlock + '\n';
    }
    if (persBlock) {
      businessSection += persBlock + '\n';
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
    if (clientSignals?.businessPriorities?.length) {
      businessSection += `\nBUSINESS PRIORITIES: ${clientSignals.businessPriorities.join('; ')}\n`;
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
    }

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
        return { strategy: ws.keywordStrategy ?? null, upToDate: true, freshPageCount: pagesToPreserve.length, pagesToAnalyze, keywordPool, businessSection };
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
      try {
        const p = new URL(r.page).pathname;
        if (!gscByPath.has(p)) gscByPath.set(p, []);
        gscByPath.get(p)!.push({ query: r.query, position: r.position, clicks: r.clicks, impressions: r.impressions });
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* skip */ } // url-fetch-ok
    }

    // Build provider keyword reference for batch prompts — give the AI real search terms to pick from
    let semrushBatchRef = '';
    const semrushByPath = new Map<string, typeof semrushDomainData>();
    // Populate keyword pool from ALL available data sources
    if (semrushDomainData.length > 0) {
      // Group domain keywords by URL path for per-page matching
      for (const k of semrushDomainData) {
        try {
          const p = new URL(k.url).pathname;
          if (!semrushByPath.has(p)) semrushByPath.set(p, []);
          semrushByPath.get(p)!.push(k);
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* skip */ } // url-fetch-ok
        keywordPool.set(k.keyword.toLowerCase(), { volume: k.volume, difficulty: k.difficulty, source: provider?.name ?? 'seo-provider' });
      }
    }
    // Add GSC queries to the pool (these are proven search terms)
    for (const r of gscData) {
      const q = r.query.toLowerCase();
      if (!keywordPool.has(q) && q.length > 3 && q.split(' ').length >= 2) {
        keywordPool.set(q, { volume: r.impressions, difficulty: 0, source: 'gsc' });
      }
    }
    // Add competitor keywords to the pool — these are proven industry terms with real volume
    for (const ck of competitorKeywordData) {
      const kw = ck.keyword.toLowerCase();
      if (!keywordPool.has(kw) && ck.volume > 0) {
        keywordPool.set(kw, { volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` });
      }
    }
    // Add keyword gaps to the pool — highest priority since competitors rank and you don't
    for (const gap of keywordGaps) {
      const kw = gap.keyword.toLowerCase();
      if (!keywordPool.has(kw) && gap.volume > 0) {
        keywordPool.set(kw, { volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` });
      }
    }
    // Add related keywords to the pool
    for (const rk of relatedKws) {
      const kw = rk.keyword.toLowerCase();
      if (!keywordPool.has(kw) && rk.volume > 0) {
        keywordPool.set(kw, { volume: rk.volume, difficulty: rk.difficulty, source: 'related' });
      }
    }
    // Add client-tracked keywords to the pool — these are keywords the client explicitly wants to target
    const clientTracked = getTrackedKeywords(ws.id);
    let clientKeywordsAdded = 0;
    for (const tk of clientTracked) {
      const kw = tk.query.toLowerCase().trim();
      if (!keywordPool.has(kw) && kw.length > 1) {
        keywordPool.set(kw, { volume: 0, difficulty: 0, source: 'client' });
        clientKeywordsAdded++;
      }
    }
    // Add client-requested keywords to pool
    for (const kw of requestedKeywords) {
      if (!keywordPool.has(kw.toLowerCase())) {
        keywordPool.set(kw.toLowerCase(), { volume: 0, difficulty: 0, source: 'client' });
        clientKeywordsAdded++;
      }
    }
    // Filter branded competitor keywords from the pool BEFORE feeding to AI
    const brandedRemoved = filterBrandedKeywords(keywordPool, competitorDomains);
    // Hard filter: remove declined keywords before the AI sees the pool (prompt instruction is soft)
    const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));
    const declinedPoolRemoved = filterDeclinedFromPool(keywordPool, declinedKeywords);
    if (declinedPoolRemoved > 0) log.info(`Removed ${declinedPoolRemoved} declined keywords from keyword pool`);
    log.info(`Keyword pool: ${keywordPool.size} unique terms (${semrushDomainData.length} domain + ${competitorKeywordData.length} competitor + ${keywordGaps.length} gaps + ${clientKeywordsAdded} client + GSC)${brandedRemoved > 0 ? ` — removed ${brandedRemoved} branded competitor keywords` : ''}`);
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
          // Pre-enrich from pool — if the keyword is in our pool, apply the data now
          const poolMatch = keywordPool.get(pm.primaryKeyword?.toLowerCase());
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
      }
      log.error({ detail: raw.slice(0, 200) }, `Batch ${batchIdx + 1} returned invalid JSON:`);
      return batch.map(p => ({
        pagePath: p.path,
        pageTitle: p.title,
        primaryKeyword: '',
        secondaryKeywords: [],
        searchIntent: 'informational',
        _parseError: true,
      }));
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
      log.warn(`${parseErrors.length} pages had JSON parse errors and were assigned empty keywords`);
      // Remove parse-error pages from the mappings
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
      const domainKwLookup = new Map(semrushDomainData.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
      const existingPkLookup = new Map(
        listPageKeywords(ws.id)
          .filter(pk => pk.volume && pk.volume > 0)
          .map(pk => [pk.primaryKeyword.toLowerCase(), pk])
      );

      // First pass: enrich from already-fetched data (no API calls)
      const needsApiLookup: string[] = [];
      let preEnriched = 0;
      for (const pm of allPageMappings) {
        const kwLower = pm.primaryKeyword?.toLowerCase();
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
          const uniqueNeeds = [...new Set(needsApiLookup.map(k => k.toLowerCase()))];
          const metrics = await provider.getKeywordMetrics(uniqueNeeds.slice(0, 100), ws.id);
          const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m])); // map-dup-ok

          let unvalidated = 0;
          for (const pm of allPageMappings) {
            if (pm.validated != null) continue; // already handled
            const m = metricMap.get(pm.primaryKeyword.toLowerCase());
            if (m && m.volume > 0) {
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
      const kw = pm.primaryKeyword.toLowerCase();
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
          let pagePath: string;
          try { pagePath = new URL(r.page).pathname; } catch { pagePath = r.page; }
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
              const slug = normalizePath(p.slug);
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

    const hasSemrush = semrushContext.length > 0;
    const conflictNote = conflicts.length > 0
      ? `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n${conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n')}\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
      : '';

    // Fetch analytics intelligence from computed insights layer
    let intelligenceBlock = '';
    try {
      const insights = strategyIntel.insights?.all ?? [];
      if (insights.length > 0) {
        const keywordClusters = insights
          .filter((i): i is AnalyticsInsight<'keyword_cluster'> => i.insightType === 'keyword_cluster')
          .map(i => i.data)
          .sort((a, b) => b.totalImpressions - a.totalImpressions);
        const competitorGaps = insights
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
        const stratSignals = buildStrategySignals(insights);
        if (stratSignals.length > 0) {
          intelligenceBlock += `\n\nSTRATEGY SIGNALS (analytics feedback loop — use to prioritize recommendations):\n${stratSignals.slice(0, 10).map(s => `- [${s.type}] ${s.detail}`).join('\n')}`;
        }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* non-critical — strategy works without intelligence data */ }

    const masterPrompt = `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy.
${businessSection}
Current keyword assignments (${allPageMappings.length} pages):
${kwSummary}
${conflictNote}${gscSummary}${ga4Context}${auditContext}
${semrushContext}${intelligenceBlock}

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
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. CRITICAL: Every targetKeyword MUST come from SEO provider/GSC data above when available — do NOT invent keywords. ${hasSemrush ? 'PRIORITIZE keywords from COMPETITOR KEYWORD GAPS — these are keywords competitors rank for that this site doesn\'t. For each gap backed by competitor data, include competitorProof citing which competitor ranks and at what position. At least 50% of content gaps should come from competitor gap data.' : ''}${clientKeywordsAdded > 0 ? ` CLIENT-REQUESTED KEYWORDS get HIGH PRIORITY: if any client-requested keyword from the pool has no existing page covering it, it MUST appear as a content gap. The client specifically wants to rank for these terms.` : ''} Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority
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
${hasSemrush ? '- Use SEO provider data to inform priorities. KD < 40% = quick wins.' : ''}
${competitorDomains.length > 0 ? `- NEVER suggest a keyword that contains a competitor's brand name. Competitor domains are used to identify topic areas and intent gaps — NOT to recommend branded searches that funnel users to a competitor. Specifically, do NOT include keywords containing any of these brand tokens: ${[...new Set(competitorDomains.flatMap(d => extractBrandTokens(d)))].join(', ')}. If a keyword gap came from competitor data but contains a competitor brand name, skip it and find the next best non-branded gap.` : '- NEVER suggest branded competitor keywords — keywords containing a competitor\'s company or product name. Use competitor data to find topic areas, not to recommend searches that drive users to a competitor.'}
- Return ONLY valid JSON, no markdown`;

    log.info(`Master prompt: ${masterPrompt.length} chars (~${Math.ceil(masterPrompt.length / 4)} tokens)`);

    const masterRaw = await callStrategyAI([
      { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
      { role: 'user', content: masterPrompt },
    ], 3000, 'master');

    type MasterStrategyData = {
      siteKeywords?: string[];
      opportunities?: string[];
      contentGaps?: Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
      quickWins?: StrategyQuickWin[];
      keywordFixes?: StrategyKeywordFix[];
    };
    const masterData = parseJsonFallback<MasterStrategyData | null>(masterRaw, null);
    if (!masterData) {
      log.error({ detail: masterRaw.slice(0, 300) }, 'Master returned invalid JSON');
      const errMsg = 'AI returned invalid JSON in master synthesis';
      throw new KeywordStrategySynthesisError(500, { error: errMsg, raw: masterRaw.slice(0, 500) });
    }

    // Apply keyword conflict fixes from master
    if (masterData.keywordFixes?.length) {
      const fixMap = new Map(masterData.keywordFixes.map((f: { pagePath: string; newPrimaryKeyword: string }) => [f.pagePath, f.newPrimaryKeyword]));
      for (const pm of allPageMappings) {
        const fix = fixMap.get(pm.pagePath);
        if (fix) pm.primaryKeyword = fix as string;
      }
      log.info(`Applied ${masterData.keywordFixes.length} keyword conflict fixes`);
    }

    // Post-generation hard filter: remove declined keywords from siteKeywords.
    // The AI prompt instructs this, but LLMs don't always comply — hard filter is the real defense.
    if (declinedKeywords.length > 0 && masterData.siteKeywords?.length) {
      const before = masterData.siteKeywords.length;
      masterData.siteKeywords = masterData.siteKeywords.filter(
        (kw: string) => !declinedSet.has(kw.toLowerCase())
      );
      const declinedSiteKwsRemoved = before - masterData.siteKeywords.length;
      if (declinedSiteKwsRemoved > 0) {
        log.info(`Stripped ${declinedSiteKwsRemoved} declined keywords from siteKeywords despite prompt instruction`);
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
          !cg.targetKeyword || !declinedSet.has(cg.targetKeyword.toLowerCase())
      );
      const declinedGapsRemoved = cleanContentGaps.length - finalContentGaps.length;
      if (declinedGapsRemoved > 0) {
        log.info(`Stripped ${declinedGapsRemoved} declined content gaps despite prompt instruction`);
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
        if (pm.primaryKeyword && declinedSet.has(pm.primaryKeyword.toLowerCase())) {
          pm.primaryKeyword = '';
        }
        if (pm.secondaryKeywords?.length) {
          pm.secondaryKeywords = pm.secondaryKeywords.filter(
            (k: string) => !declinedSet.has(k.toLowerCase())
          );
        }
      }
    }
    log.info(`Final strategy: ${strategy.pageMap?.length ?? 0} pages, ${strategy.siteKeywords?.length ?? 0} site keywords, ${strategy.contentGaps?.length ?? 0} content gaps, ${strategy.quickWins?.length ?? 0} quick wins`);

  return { strategy, pagesToAnalyze, keywordPool, businessSection };
}
