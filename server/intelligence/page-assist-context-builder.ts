import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type {
  IntelligenceSlice,
  PromptVerbosity,
  SeoContextSlice,
  WorkspaceIntelligence,
} from '../../shared/types/intelligence.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
  formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt,
  formatPageMapForPrompt,
  formatPersonasForPrompt,
} from '../workspace-intelligence.js';
import { normalizePageUrl } from '../helpers.js';

const PAGE_PROFILE_SECTIONS = ['pageProfile'] as const;

export interface PageAssistContextOptions {
  pagePath?: string;
  pageUrl?: string;
  includePageElements?: boolean;
  includeLocalSeo?: boolean;
  includeLearnings?: boolean;
  includeContentPipeline?: boolean;
  includeInsights?: boolean;
  includePageMap?: boolean;
  baseSeoContext?: SeoContextSlice;
  pageKeywords?: PageKeywordMap;
  verbosity?: PromptVerbosity;
  tokenBudget?: number;
}

export interface PageAssistContextBlocks {
  keywordBlock: string;
  brandVoiceBlock: string;
  personasBlock: string;
  knowledgeBlock: string;
  pageProfileBlock: string;
  pageMapBlock: string;
  pageInsightsBlock: string;
  playbookBlock: string;
}

export interface PageAssistContext {
  intelligence: WorkspaceIntelligence;
  slices: readonly IntelligenceSlice[];
  promptContext: string;
  pagePath?: string;
  seoContext?: SeoContextSlice;
  blocks: PageAssistContextBlocks;
}

function resolvePagePath(opts: PageAssistContextOptions): string | undefined {
  if (opts.pagePath) return normalizePageUrl(opts.pagePath);
  if (!opts.pageUrl) return undefined;
  try {
    return normalizePageUrl(new URL(opts.pageUrl).pathname);
  } catch (err) {
    void err;
    return normalizePageUrl(opts.pageUrl);
  }
}

function appendSlice(slices: IntelligenceSlice[], slice: IntelligenceSlice): void {
  if (!slices.includes(slice)) slices.push(slice);
}

function createEmptyIntelligence(workspaceId: string): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId,
    assembledAt: new Date().toISOString(),
  };
}

function formatPageInsights(insights: readonly AnalyticsInsight[] | undefined): string {
  if (!insights?.length) return '';

  const cannibalization = insights
    .filter(i => i.insightType === 'cannibalization')
    .slice(0, 2)
    .map(i => `- Cannibalization: ${i.pageTitle ?? i.pageId ?? 'unknown page'}`);

  const decay = insights
    .filter(i => i.insightType === 'content_decay')
    .slice(0, 1)
    .map(i => `- Content decay: ${i.pageTitle ?? i.pageId ?? 'unknown page'}`);

  const health = insights
    .filter(i => i.insightType === 'page_health')
    .slice(0, 1)
    .map(i => `- Page health: ${i.pageTitle ?? i.pageId ?? 'unknown page'} (impact: ${i.impactScore ?? 'n/a'})`);

  const lines = [...cannibalization, ...decay, ...health];
  return lines.length > 0 ? `\n\nPAGE INTELLIGENCE:\n${lines.join('\n')}` : '';
}

export async function buildPageAssistContext(
  workspaceId: string,
  opts: PageAssistContextOptions = {},
): Promise<PageAssistContext> {
  const pagePath = resolvePagePath(opts);
  const slices: IntelligenceSlice[] = opts.baseSeoContext ? [] : ['seoContext'];
  if (pagePath) appendSlice(slices, 'pageProfile');
  if (pagePath && opts.includePageElements) appendSlice(slices, 'pageElements');
  if (opts.includeLocalSeo) appendSlice(slices, 'localSeo');
  if (opts.includeLearnings) appendSlice(slices, 'learnings');
  if (opts.includeContentPipeline) appendSlice(slices, 'contentPipeline');
  if (opts.includeInsights) appendSlice(slices, 'insights');

  const assembled = slices.length > 0
    ? await buildWorkspaceIntelligence(workspaceId, {
        slices,
        pagePath,
        learningsDomain: opts.includeLearnings ? 'content' : undefined,
      })
    : createEmptyIntelligence(workspaceId);
  const seoContext = opts.baseSeoContext
    ? { ...opts.baseSeoContext, ...(opts.pageKeywords ? { pageKeywords: opts.pageKeywords } : {}) }
    : assembled.seoContext;
  const intelligence: WorkspaceIntelligence = seoContext
    ? { ...assembled, seoContext }
    : assembled;
  const pageProfileBlock = pagePath
    ? formatForPrompt(intelligence, { verbosity: opts.verbosity ?? 'detailed', sections: PAGE_PROFILE_SECTIONS, tokenBudget: opts.tokenBudget })
    : '';
  const pageMapBlock = opts.includePageMap === false || !seoContext ? '' : formatPageMapForPrompt(seoContext);
  const playbookPatterns = intelligence.contentPipeline?.rewritePlaybook?.patterns;

  const promptSections: readonly IntelligenceSlice[] = seoContext && opts.baseSeoContext ? ['seoContext', ...slices] : slices;
  const promptContext = formatForPrompt(intelligence, {
    verbosity: opts.verbosity ?? 'detailed',
    sections: promptSections,
    tokenBudget: opts.tokenBudget,
    learningsDomain: opts.includeLearnings ? 'content' : undefined,
  });

  return {
    intelligence,
    slices,
    promptContext,
    pagePath,
    seoContext,
    blocks: {
      keywordBlock: formatKeywordsForPrompt(seoContext),
      brandVoiceBlock: seoContext?.effectiveBrandVoiceBlock ?? '',
      personasBlock: formatPersonasForPrompt(seoContext?.personas ?? []),
      knowledgeBlock: formatKnowledgeBaseForPrompt(seoContext?.knowledgeBase),
      pageProfileBlock,
      pageMapBlock,
      pageInsightsBlock: formatPageInsights(intelligence.insights?.forPage),
      playbookBlock: playbookPatterns?.length
        ? `\n\nREWRITING PLAYBOOK (follow these instructions when suggesting rewrites):\n${playbookPatterns.join('\n')}`
        : '',
    },
  };
}
