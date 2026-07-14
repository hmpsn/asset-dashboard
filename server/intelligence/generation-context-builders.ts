import type {
  IntelligenceOptions,
  IntelligenceSlice,
  LearningsSlice,
  PromptVerbosity,
  SeoContextSlice,
  WorkspaceIntelligence,
} from '../../shared/types/intelligence.js';
import { buildWorkspaceIntelligence } from '../workspace-intelligence.js';
import { listLocalSeoMarkets } from '../domains/local-seo/configuration-service.js';
import {
  formatForPrompt,
  formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt,
  formatPageMapForPrompt,
} from './formatters.js';
import { formatPersonasForPrompt } from './persona-format.js';

type LearningsDomain = NonNullable<IntelligenceOptions['learningsDomain']>;

export interface GenerationContextBuilderOptions {
  pagePath?: string;
  verbosity?: PromptVerbosity;
  tokenBudget?: number;
  learningsDomain?: LearningsDomain;
  slices?: readonly IntelligenceSlice[];
  enrichWithBacklinks?: boolean;
  includeLocalSeo?: boolean;
  includeRankMovers?: boolean;
  /**
   * Client formatting uses the explicit client-safe learnings projection. It
   * never falls back to admin learnings when that projection is unavailable.
   */
  audience?: 'internal' | 'client';
}

export interface GenerationContextResult {
  intelligence: WorkspaceIntelligence;
  slices: readonly IntelligenceSlice[];
  promptContext: string;
  pagePath?: string;
  learningsDomain: LearningsDomain;
  learningsAvailability: LearningsSlice['availability'] | 'not_requested';
}

export type ContentGenerationContextOptions = GenerationContextBuilderOptions;

export type RecommendationGenerationContextOptions = GenerationContextBuilderOptions;

export interface SeoPromptContextOptions extends GenerationContextBuilderOptions {
  includePageMap?: boolean;
}

export interface SeoPromptContextResult extends GenerationContextResult {
  pageMapContext: string;
  seoPromptContext: string;
}

export interface SeoPromptBlocksOptions {
  includePageMap?: boolean;
}

export interface SeoPromptBlocks {
  keywordBlock: string;
  brandVoiceBlock: string;
  personasBlock: string;
  knowledgeBlock: string;
  pageMapBlock: string;
}

async function buildGenerationContext(
  workspaceId: string,
  slices: readonly IntelligenceSlice[],
  opts: Required<Pick<GenerationContextBuilderOptions, 'verbosity' | 'learningsDomain'>> & Omit<GenerationContextBuilderOptions, 'verbosity' | 'learningsDomain'>,
): Promise<GenerationContextResult> {
  const intelligence = await buildWorkspaceIntelligence(workspaceId, {
    slices,
    pagePath: opts.pagePath,
    learningsDomain: opts.learningsDomain,
    enrichWithBacklinks: opts.enrichWithBacklinks,
  });
  const formattedIntelligence = opts.audience === 'client'
    ? projectIntelligenceForClientPrompt(intelligence)
    : intelligence;
  const promptContext = formatForPrompt(formattedIntelligence, {
    verbosity: opts.verbosity,
    sections: slices,
    tokenBudget: opts.tokenBudget,
    learningsDomain: opts.learningsDomain,
    includeRankMovers: opts.includeRankMovers,
  });
  return {
    intelligence: formattedIntelligence,
    slices,
    promptContext,
    pagePath: opts.pagePath,
    learningsDomain: opts.learningsDomain,
    learningsAvailability: slices.includes('learnings')
      ? (formattedIntelligence.learnings?.availability
        ?? (opts.audience === 'client' ? 'no_data' : 'degraded'))
      : 'not_requested',
  };
}

function projectIntelligenceForClientPrompt(
  intelligence: WorkspaceIntelligence,
): WorkspaceIntelligence {
  if (!intelligence.learnings) return intelligence;

  const { learnings: _adminLearnings, ...withoutLearnings } = intelligence;
  const clientLearnings = intelligence.learnings.clientProjection;
  return clientLearnings
    ? { ...withoutLearnings, learnings: clientLearnings }
    : withoutLearnings;
}

/**
 * Returns true when the workspace has at least one active local SEO market configured.
 * Used to gate localSeo slice inclusion in generation context — workspaces without
 * active markets don't pay token cost for an empty slice.
 */
async function hasActiveLocalMarkets(workspaceId: string): Promise<boolean> {
  try {
    const markets = listLocalSeoMarkets(workspaceId);
    return Array.isArray(markets) && markets.some(m => m.status === 'active');
  } catch { // catch-ok: gating check, missing module or DB error should fall back to "no markets" rather than fail the whole build
    return false;
  }
}

export async function withActiveLocalSeoSlice(
  workspaceId: string,
  slices: readonly IntelligenceSlice[],
  includeLocalSeo = true,
): Promise<readonly IntelligenceSlice[]> {
  if (!includeLocalSeo || slices.includes('localSeo')) return slices;
  if (!(await hasActiveLocalMarkets(workspaceId))) return slices;
  return [...slices, 'localSeo'];
}

export async function buildContentGenerationContext(
  workspaceId: string,
  opts: ContentGenerationContextOptions = {},
): Promise<GenerationContextResult> {
  const baseSlices: IntelligenceSlice[] = ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'eeatAssets'];
  if (opts.pagePath) baseSlices.push('pageProfile');
  const slices = await withActiveLocalSeoSlice(workspaceId, opts.slices ?? baseSlices, opts.includeLocalSeo ?? true);
  return buildGenerationContext(workspaceId, slices, {
    ...opts,
    verbosity: opts.verbosity ?? 'detailed',
    learningsDomain: opts.learningsDomain ?? 'content',
  });
}

export async function buildRecommendationGenerationContext(
  workspaceId: string,
  opts: RecommendationGenerationContextOptions = {},
): Promise<GenerationContextResult> {
  const baseSlices: IntelligenceSlice[] = ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'siteHealth'];
  if (opts.pagePath) baseSlices.push('pageProfile');
  const slices = await withActiveLocalSeoSlice(workspaceId, opts.slices ?? baseSlices, opts.includeLocalSeo ?? true);
  return buildGenerationContext(workspaceId, slices, {
    ...opts,
    verbosity: opts.verbosity ?? 'detailed',
    learningsDomain: opts.learningsDomain ?? 'all',
  });
}

export async function buildSeoPromptContext(
  workspaceId: string,
  opts: SeoPromptContextOptions = {},
): Promise<SeoPromptContextResult> {
  const slices = opts.slices ?? ['seoContext', 'learnings'];
  const result = await buildGenerationContext(workspaceId, slices, {
    ...opts,
    verbosity: opts.verbosity ?? 'detailed',
    learningsDomain: opts.learningsDomain ?? 'all',
  });
  const pageMapContext = opts.includePageMap === false
    ? ''
    : formatPageMapForPrompt(result.intelligence.seoContext);
  return {
    ...result,
    pageMapContext,
    seoPromptContext: `${result.promptContext}${pageMapContext}`,
  };
}

export function buildSeoPromptBlocks(
  seoContext: SeoContextSlice | null | undefined,
  opts: SeoPromptBlocksOptions = {},
): SeoPromptBlocks {
  return {
    keywordBlock: formatKeywordsForPrompt(seoContext),
    brandVoiceBlock: seoContext?.effectiveBrandVoiceBlock ?? '',
    personasBlock: formatPersonasForPrompt(seoContext?.personas ?? []),
    knowledgeBlock: formatKnowledgeBaseForPrompt(seoContext?.knowledgeBase),
    pageMapBlock: opts.includePageMap === false ? '' : formatPageMapForPrompt(seoContext),
  };
}
