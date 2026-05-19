import type {
  IntelligenceOptions,
  IntelligenceSlice,
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
}

export interface GenerationContextResult {
  intelligence: WorkspaceIntelligence;
  slices: readonly IntelligenceSlice[];
  promptContext: string;
  pagePath?: string;
  learningsDomain: LearningsDomain;
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
  };
}

export async function buildContentGenerationContext(
  workspaceId: string,
  opts: ContentGenerationContextOptions = {},
): Promise<GenerationContextResult> {
  const baseSlices = ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline'] as const;
  const slices = opts.slices ?? (opts.pagePath ? [...baseSlices, 'pageProfile'] as const : baseSlices);
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
  const baseSlices = ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'siteHealth'] as const;
  const slices = opts.slices ?? (opts.pagePath ? [...baseSlices, 'pageProfile'] as const : baseSlices);
  return buildGenerationContext(workspaceId, slices, {
    ...opts,
    verbosity: opts.verbosity ?? 'detailed',
    learningsDomain: opts.learningsDomain ?? 'all',
  });
}
