import type {
  IntelligenceOptions,
  IntelligenceSlice,
  LearningsSlice,
  PromptVerbosity,
  WorkspaceIntelligence,
} from '../../shared/types/intelligence.js';
import { buildWorkspaceIntelligence, formatForPrompt } from '../workspace-intelligence.js';

type LearningsDomain = NonNullable<IntelligenceOptions['learningsDomain']>;

interface GenerationContextBuilderOptions {
  pagePath?: string;
  verbosity?: PromptVerbosity;
  tokenBudget?: number;
  learningsDomain?: LearningsDomain;
  slices?: readonly IntelligenceSlice[];
  enrichWithBacklinks?: boolean;
  includeLocalSeo?: boolean;
}

export interface GenerationContextResult {
  intelligence: WorkspaceIntelligence;
  slices: readonly IntelligenceSlice[];
  promptContext: string;
  pagePath?: string;
  learningsDomain: LearningsDomain;
  learningsAvailability: LearningsSlice['availability'] | 'not_requested';
}

export interface ContentGenerationContextOptions extends GenerationContextBuilderOptions {}

export interface RecommendationGenerationContextOptions extends GenerationContextBuilderOptions {}

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
  const promptContext = formatForPrompt(intelligence, {
    verbosity: opts.verbosity,
    sections: slices,
    tokenBudget: opts.tokenBudget,
    learningsDomain: opts.learningsDomain,
  });
  return {
    intelligence,
    slices,
    promptContext,
    pagePath: opts.pagePath,
    learningsDomain: opts.learningsDomain,
    learningsAvailability: slices.includes('learnings')
      ? (intelligence.learnings?.availability ?? 'degraded')
      : 'not_requested',
  };
}

/**
 * Returns true when the workspace has at least one active local SEO market configured.
 * Used to gate localSeo slice inclusion in generation context — workspaces without
 * active markets don't pay token cost for an empty slice.
 *
 * Dynamic import keeps the local-seo subsystem off the synchronous import path of
 * generation-context-builders, which is consistent with the lazy-load pattern other
 * slice consumers use.
 */
async function hasActiveLocalMarkets(workspaceId: string): Promise<boolean> {
  try {
    const { listLocalSeoMarkets } = await import('../local-seo.js'); // dynamic-import-ok - lazy-load local SEO module to keep generation builders light
    return listLocalSeoMarkets(workspaceId).some(m => m.status === 'active');
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
  const baseSlices: IntelligenceSlice[] = ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline'];
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
