import type { KeywordStrategyPageInfo } from '../keyword-strategy-pages.js';
import type { DomainKeyword } from '../seo-data-provider.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';
import { normalizeKeyword } from '../keyword-intelligence/index.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { pageAssignmentResponseSchema } from '../schemas/keyword-strategy-schemas.js';
import { createLogger } from '../logger.js';
import {
  buildBatchPagesBlock,
  buildClosedSetPageAssignmentPrompt,
  buildLegacyPageAssignmentPrompt,
  type PageGscQuery,
  resolveClosedSetKeyword,
} from './prompts.js';
import type { KeywordStrategyKeywordPool, PageMapping } from './types.js';

const log = createLogger('keyword-strategy:synthesis');

type StrategyAI = (
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  label?: string,
) => Promise<string>;

type NamedStrategyAI = (
  workspaceId: string,
  operation: 'keyword-page-assignment',
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
) => Promise<string>;

interface RunPageAssignmentBatchesOptions {
  workspaceId: string;
  businessSection: string;
  pagesForBatching: KeywordStrategyPageInfo[];
  allPageInfo: KeywordStrategyPageInfo[];
  strategyMode: 'full' | 'incremental';
  pagesToPreserve: KeywordStrategyPageInfo[];
  existingPageKeywords: PageKeywordMap[];
  gscByPath: Map<string, PageGscQuery[]>;
  providerKeywordsByPath: Map<string, DomainKeyword[]>;
  keywordPool: KeywordStrategyKeywordPool;
  keywordPoolReference: string;
  seoGenQualityEnabled: boolean;
  closedSetBlock: string;
  candidateIds: Set<string>;
  isEligibleGeneratedKeyword: (keyword: string) => boolean;
  callStrategyAI: StrategyAI;
  callNamedStrategyAI: NamedStrategyAI;
  sendProgress: (step: string, detail: string, progress: number) => void;
}

const BATCH_SIZE = 20;
const CONCURRENCY = 3;

export async function runPageAssignmentBatches(opts: RunPageAssignmentBatchesOptions): Promise<PageMapping[]> {
  const batches: KeywordStrategyPageInfo[][] = [];
  for (let i = 0; i < opts.pagesForBatching.length; i += BATCH_SIZE) {
    batches.push(opts.pagesForBatching.slice(i, i + BATCH_SIZE));
  }
  log.info(`Splitting ${opts.pagesForBatching.length} pages into ${batches.length} batches of ~${BATCH_SIZE}`);
  opts.sendProgress('ai', `Analyzing pages in ${batches.length} parallel batches...`, 0.55);

  const existingKeywordByPath = new Map(opts.existingPageKeywords.map(pk => [pk.pagePath, pk]));
  const pageInfoByPath = new Map(opts.allPageInfo.map(page => [page.path, page]));
  const fallbackKeywordFromPageIdentity = (pagePath: string): string | null => {
    const page = pageInfoByPath.get(pagePath);
    const titleFallback = page?.seoTitle || page?.title;
    const slugFallback = pagePath.split('/').filter(Boolean).join(' ');
    const fallback = normalizeKeyword(titleFallback || slugFallback);
    return fallback || null;
  };
  const findFallbackKeywordForPage = (pagePath: string): string | null => {
    const existingKeyword = existingKeywordByPath.get(pagePath)?.primaryKeyword;
    if (existingKeyword && opts.isEligibleGeneratedKeyword(existingKeyword)) {
      return existingKeyword;
    }

    const providerKeyword = [...(opts.providerKeywordsByPath.get(pagePath) ?? [])]
      .sort((a, b) => b.volume - a.volume)
      .find(keyword => opts.isEligibleGeneratedKeyword(keyword.keyword));
    if (providerKeyword) return providerKeyword.keyword;

    const gscKeyword = [...(opts.gscByPath.get(pagePath) ?? [])]
      .sort((a, b) => b.impressions - a.impressions)
      .find(keyword => opts.isEligibleGeneratedKeyword(keyword.query));
    return gscKeyword?.query ?? fallbackKeywordFromPageIdentity(pagePath);
  };

  const runBatch = async (batch: KeywordStrategyPageInfo[], batchIdx: number): Promise<PageMapping[]> => {
    const batchPages = buildBatchPagesBlock(batch, opts.gscByPath, opts.providerKeywordsByPath);

    const postProcessBatch = (parsed: PageMapping[]): PageMapping[] => {
      let fromPool = 0;
      let invented = 0;
      for (const pm of parsed) {
        delete pm.volume; delete pm.difficulty; delete pm.cpc; delete pm.cpcSource;
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
            .filter(keyword => opts.isEligibleGeneratedKeyword(keyword));
        }
        if (pm.primaryKeyword) {
          const primaryEvaluation = opts.isEligibleGeneratedKeyword(pm.primaryKeyword);
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
        const poolMatch = opts.keywordPool.get(normalizeKeyword(pm.primaryKeyword ?? ''));
        if (poolMatch && poolMatch.source !== 'gsc') {
          pm.volume = poolMatch.volume;
          pm.difficulty = poolMatch.difficulty;
          pm.cpc = poolMatch.cpc;
          pm.cpcSource = poolMatch.cpcSource;
          pm.searchIntent = poolMatch.intent ?? pm.searchIntent;
          pm.intentSource = poolMatch.intent ? poolMatch.intentSource : pm.intentSource;
          fromPool++;
        } else {
          invented++;
        }
      }
      log.info(`Batch ${batchIdx + 1}: ${fromPool} keywords from pool, ${invented} invented`);
      return parsed;
    };

    const syntheticBatchFallback = (): PageMapping[] => batch.map(p => ({
      pagePath: p.path,
      pageTitle: p.title,
      primaryKeyword: '',
      secondaryKeywords: [],
      searchIntent: 'informational',
      _parseError: true,
    }));

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

    if (opts.seoGenQualityEnabled && opts.closedSetBlock) {
      const groundedPrompt = buildClosedSetPageAssignmentPrompt({
        businessSection: opts.businessSection,
        closedSetBlock: opts.closedSetBlock,
        batchPages,
        batchLength: batch.length,
      });

      log.info(`Batch ${batchIdx + 1}/${batches.length} (closed-set): ${batch.length} pages, ${groundedPrompt.length} chars`);
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
        { role: 'user', content: groundedPrompt },
      ];
      let raw = await opts.callNamedStrategyAI(opts.workspaceId, 'keyword-page-assignment', messages, 3000);
      let parsedResult = pageAssignmentResponseSchema.safeParse(parseJsonFallback<unknown>(raw, null));
      if (!parsedResult.success) {
        const issues = parsedResult.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        log.warn({ workspaceId: opts.workspaceId, issues }, `Batch ${batchIdx + 1} closed-set OP1 failed validation — retrying once`);
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: `Your previous response failed schema validation: ${issues}. Return ONLY the corrected JSON object matching the exact { "assignments": [...] } shape. No markdown.` });
        raw = await opts.callNamedStrategyAI(opts.workspaceId, 'keyword-page-assignment', messages, 3000);
        parsedResult = pageAssignmentResponseSchema.safeParse(parseJsonFallback<unknown>(raw, null));
      }
      if (parsedResult.success) {
        opts.sendProgress('ai', `Batch ${batchIdx + 1}/${batches.length} complete (${parsedResult.data.assignments.length} pages)`, 0.55 + ((batchIdx + 1) / batches.length) * 0.20);
        const mapped: PageMapping[] = parsedResult.data.assignments.map(a => {
          const resolved = resolveClosedSetKeyword(opts.candidateIds, a.primaryKeywordSourceId, a.primaryKeyword);
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
      log.error({ workspaceId: opts.workspaceId, detail: raw.slice(0, 200) }, `Batch ${batchIdx + 1} closed-set OP1 failed after retry — real per-page fallback`);
      return perPageFallbackBatch();
    }

    const hasPool = opts.keywordPool.size > 0;
    const batchPrompt = buildLegacyPageAssignmentPrompt({
      businessSection: opts.businessSection,
      keywordPoolReference: opts.keywordPoolReference,
      batchPages,
      batchLength: batch.length,
      hasPool,
    });

    log.info(`Batch ${batchIdx + 1}/${batches.length}: ${batch.length} pages, ${batchPrompt.length} chars`);
    const raw = await opts.callStrategyAI([
      { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
      { role: 'user', content: batchPrompt },
    ], 3000, `batch-${batchIdx + 1}`);

    const parsed = parseJsonFallback<PageMapping[] | null>(raw, null);
    if (Array.isArray(parsed)) {
      log.info(`Batch ${batchIdx + 1} returned ${Array.isArray(parsed) ? parsed.length : 0} page mappings`);
      opts.sendProgress('ai', `Batch ${batchIdx + 1}/${batches.length} complete (${Array.isArray(parsed) ? parsed.length : 0} pages)`, 0.55 + ((batchIdx + 1) / batches.length) * 0.20);
      return postProcessBatch(parsed);
    }
    log.error({ detail: raw.slice(0, 200) }, `Batch ${batchIdx + 1} returned invalid JSON:`);
    return syntheticBatchFallback();
  };

  const allPageMappings: PageMapping[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((batch, ci) => runBatch(batch, i + ci)));
    allPageMappings.push(...results.flat());
  }

  const parseErrors = allPageMappings.filter((pm: { _parseError?: boolean }) => pm._parseError);
  if (parseErrors.length > 0) {
    log.warn(`${parseErrors.length} pages had JSON parse or keyword validation errors and were assigned empty keywords`);
    const validMappings = allPageMappings.filter((pm: { _parseError?: boolean }) => !pm._parseError);
    allPageMappings.length = 0;
    allPageMappings.push(...validMappings);
  }
  log.info(`All batches complete: ${allPageMappings.length} total page mappings`);

  if (opts.strategyMode === 'incremental' && opts.pagesToPreserve.length > 0) {
    const preservedPaths = new Set(opts.pagesToPreserve.map(p => p.path));
    for (const pk of opts.existingPageKeywords) {
      if (preservedPaths.has(pk.pagePath)) {
        allPageMappings.push({
          ...pk,
          searchIntent: pk.searchIntent || 'informational',
          secondaryKeywords: pk.secondaryKeywords || [],
        });
      }
    }
    log.info(`Incremental mode: merged ${opts.pagesToPreserve.length} preserved pages into final mappings`);
  }

  return allPageMappings;
}
