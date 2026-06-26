import { extractBrandTokens } from '../competitor-brand-filter.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { KeywordStrategySynthesisError } from './errors.js';
import { normalizeKeyword } from '../keyword-intelligence/index.js';
import { createLogger } from '../logger.js';
import { siteSynthesisResponseSchema } from '../schemas/keyword-strategy-schemas.js';
import {
  buildClosedSetSiteSynthesisPrompt,
  buildLegacySiteSynthesisPrompt,
  resolveClosedSetKeyword,
} from './prompts.js';
import { applyKeywordConflictFixes } from './finalize.js';
import type { MasterStrategyData, PageMapping, StrategyContentGap, StrategyKeywordFix, StrategyQuickWin } from './types.js';

const log = createLogger('keyword-strategy:synthesis');

type StrategyAI = (
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  label?: string,
) => Promise<string>;

type NamedStrategyAI = (
  workspaceId: string,
  operation: 'keyword-site-synthesis',
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
) => Promise<string>;

export interface SiteSynthesisContext {
  gscSummary: string;
  ga4Context: string;
  auditContext: string;
  providerContext: string;
  intelligenceBlock: string;
}

interface RunSiteSynthesisOptions {
  workspaceId: string;
  businessSection: string;
  allPageMappings: PageMapping[];
  closedSetBlock: string;
  candidateIds: Set<string>;
  effectiveBusinessPriorities: string[];
  context: SiteSynthesisContext;
  hasProviderContext: boolean;
  hasKeywordGaps: boolean;
  competitorDomains: string[];
  clientKeywordsAdded: number;
  seoGenQualityEnabled: boolean;
  isEligibleGeneratedKeyword: (keyword: string) => boolean;
  callStrategyAI: StrategyAI;
  callNamedStrategyAI: NamedStrategyAI;
}

export async function runSiteSynthesis(opts: RunSiteSynthesisOptions): Promise<MasterStrategyData> {
  const kwCount = new Map<string, string[]>();
  for (const pm of opts.allPageMappings) {
    const kw = normalizeKeyword(pm.primaryKeyword);
    if (!kw) continue;
    if (!kwCount.has(kw)) kwCount.set(kw, []);
    kwCount.get(kw)!.push(pm.pagePath);
  }
  const conflicts = [...kwCount.entries()].filter(([, pages]) => pages.length > 1);
  if (conflicts.length > 0) {
    log.info(`Found ${conflicts.length} keyword conflicts to resolve`);
  }

  const keywordSummary = opts.allPageMappings.map(pm => `${pm.pagePath}: "${pm.primaryKeyword}"`).join('\n');
  const conflictNote = conflicts.length > 0
    ? `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n${conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n')}\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
    : '';
  const competitorBrandTokens = [...new Set(opts.competitorDomains.flatMap(d => extractBrandTokens(d)))];

  let masterData: MasterStrategyData;
  if (opts.seoGenQualityEnabled && opts.closedSetBlock) {
    masterData = await runClosedSetSiteSynthesis({
      ...opts,
      keywordSummary,
      conflictNote,
      competitorBrandTokens,
      conflictsCount: conflicts.length,
    });
  } else {
    masterData = await runLegacySiteSynthesis({
      ...opts,
      keywordSummary,
      conflictNote,
      competitorBrandTokens,
      conflictsCount: conflicts.length,
    });
  }

  if (masterData.keywordFixes?.length) {
    const { appliedFixes, suppressedFixes } = applyKeywordConflictFixes(
      opts.allPageMappings,
      masterData.keywordFixes,
      opts.isEligibleGeneratedKeyword,
    );
    log.info(`Applied ${appliedFixes} keyword conflict fixes`);
    if (suppressedFixes > 0) {
      log.info(`Suppressed ${suppressedFixes} keyword conflict fixes via shared keyword intelligence`);
    }
  }

  return masterData;
}

async function runClosedSetSiteSynthesis(opts: RunSiteSynthesisOptions & {
  keywordSummary: string;
  conflictNote: string;
  competitorBrandTokens: string[];
  conflictsCount: number;
}): Promise<MasterStrategyData> {
  const groundedMasterPrompt = buildClosedSetSiteSynthesisPrompt({
    businessSection: opts.businessSection,
    pageMappingCount: opts.allPageMappings.length,
    keywordSummary: opts.keywordSummary,
    conflictNote: opts.conflictNote,
    gscSummary: opts.context.gscSummary,
    ga4Context: opts.context.ga4Context,
    auditContext: opts.context.auditContext,
    providerContext: opts.context.providerContext,
    intelligenceBlock: opts.context.intelligenceBlock,
    closedSetBlock: opts.closedSetBlock,
    effectiveBusinessPriorities: opts.effectiveBusinessPriorities,
    hasProviderContext: opts.hasProviderContext,
    hasKeywordGaps: opts.hasKeywordGaps,
    competitorDomains: opts.competitorDomains,
    competitorBrandTokens: opts.competitorBrandTokens,
    conflictsCount: opts.conflictsCount,
  });

  log.info(`Master prompt (closed-set): ${groundedMasterPrompt.length} chars (~${Math.ceil(groundedMasterPrompt.length / 4)} tokens)`);
  const masterMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
    { role: 'user', content: groundedMasterPrompt },
  ];
  let masterRaw = await opts.callNamedStrategyAI(opts.workspaceId, 'keyword-site-synthesis', masterMessages, 4500);
  let masterResult = siteSynthesisResponseSchema.safeParse(parseJsonFallback<unknown>(masterRaw, null));
  if (!masterResult.success) {
    const issues = masterResult.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    log.warn({ workspaceId: opts.workspaceId, issues }, 'Master closed-set OP2 failed validation — retrying once');
    masterMessages.push({ role: 'assistant', content: masterRaw });
    masterMessages.push({ role: 'user', content: `Your previous response failed schema validation: ${issues}. Return ONLY the corrected JSON object with the exact keys siteKeywords, opportunities, contentGaps, quickWins. No markdown.` });
    masterRaw = await opts.callNamedStrategyAI(opts.workspaceId, 'keyword-site-synthesis', masterMessages, 4500);
    masterResult = siteSynthesisResponseSchema.safeParse(parseJsonFallback<unknown>(masterRaw, null));
  }

  if (masterResult.success) {
    const d = masterResult.data;
    let droppedOutOfSetGaps = 0;
    const validatedGaps = d.contentGaps.flatMap(cg => {
      const resolved = resolveClosedSetKeyword(opts.candidateIds, cg.targetKeywordSourceId, cg.targetKeyword);
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
      log.info({ workspaceId: opts.workspaceId, droppedOutOfSetGaps }, 'Dropped OP2 content gaps whose targetKeyword/sourceId was not in the closed candidate set');
    }
    return {
      siteKeywords: d.siteKeywords,
      opportunities: d.opportunities,
      contentGaps: validatedGaps,
      quickWins: d.quickWins as StrategyQuickWin[],
      keywordFixes: d.keywordFixes as StrategyKeywordFix[],
    };
  }

  log.error({ workspaceId: opts.workspaceId, detail: masterRaw.slice(0, 300) }, 'Master closed-set OP2 failed after retry — typed-empty + deterministic backfill');
  return { siteKeywords: [], opportunities: [], contentGaps: [], quickWins: [], keywordFixes: [] };
}

async function runLegacySiteSynthesis(opts: RunSiteSynthesisOptions & {
  keywordSummary: string;
  conflictNote: string;
  competitorBrandTokens: string[];
  conflictsCount: number;
}): Promise<MasterStrategyData> {
  const masterPrompt = buildLegacySiteSynthesisPrompt({
    businessSection: opts.businessSection,
    pageMappingCount: opts.allPageMappings.length,
    keywordSummary: opts.keywordSummary,
    conflictNote: opts.conflictNote,
    gscSummary: opts.context.gscSummary,
    ga4Context: opts.context.ga4Context,
    auditContext: opts.context.auditContext,
    providerContext: opts.context.providerContext,
    intelligenceBlock: opts.context.intelligenceBlock,
    hasProviderContext: opts.hasProviderContext,
    hasKeywordGaps: opts.hasKeywordGaps,
    competitorDomains: opts.competitorDomains,
    competitorBrandTokens: opts.competitorBrandTokens,
    conflictsCount: opts.conflictsCount,
    clientKeywordsAdded: opts.clientKeywordsAdded,
  });

  log.info(`Master prompt: ${masterPrompt.length} chars (~${Math.ceil(masterPrompt.length / 4)} tokens)`);

  const masterRaw = await opts.callStrategyAI([
    { role: 'system', content: 'You are an expert SEO strategist. Return valid JSON only.' },
    { role: 'user', content: masterPrompt },
  ], 3000, 'master');

  const parsedMasterData = parseJsonFallback<MasterStrategyData | null>(masterRaw, null);
  if (!parsedMasterData) {
    log.error({ detail: masterRaw.slice(0, 300) }, 'Master returned invalid JSON');
    const errMsg = 'AI returned invalid JSON in master synthesis';
    throw new KeywordStrategySynthesisError(500, { error: errMsg, raw: masterRaw.slice(0, 500) });
  }
  return parsedMasterData;
}
