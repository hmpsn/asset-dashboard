import type { IntelligenceSlice, WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { buildWorkspaceIntelligence, formatForPrompt, formatPageMapForPrompt } from '../workspace-intelligence.js';

const SEO_CONTEXT_SECTIONS = ['seoContext'] as const;
const LEARNINGS_SECTIONS = ['learnings'] as const;

export type AdminChatContextCategory =
  | 'general'
  | 'search'
  | 'analytics'
  | 'audit'
  | 'content'
  | 'strategy'
  | 'performance'
  | 'approvals'
  | 'activity'
  | 'ranks'
  | 'competitors'
  | 'client'
  | 'page_analysis'
  | 'content_review'
  | 'insights'
  | 'copy';

export interface AdminChatIntelligenceContext {
  intelligence: WorkspaceIntelligence;
  workspaceContextBlock: string;
  learningsBlock: string;
  dataSources: string[];
}

function hasFormattedIntelligenceSection(block: string): boolean {
  return /##\s/.test(block);
}

function appendSlice(slices: IntelligenceSlice[], slice: IntelligenceSlice): void {
  if (!slices.includes(slice)) slices.push(slice);
}

export function selectAdminChatSlices(
  question: string,
  categories: ReadonlySet<AdminChatContextCategory>,
): IntelligenceSlice[] {
  const slices: IntelligenceSlice[] = ['seoContext', 'learnings'];

  if (categories.has('activity') || categories.has('general')) appendSlice(slices, 'operational');
  if (categories.has('performance') || categories.has('general')) appendSlice(slices, 'siteHealth');
  if (categories.has('client') || categories.has('general')) appendSlice(slices, 'clientSignals');
  if (categories.has('insights') || categories.has('general') || categories.has('strategy')) appendSlice(slices, 'insights');
  if (categories.has('approvals')) appendSlice(slices, 'operational');
  if (categories.has('copy')) appendSlice(slices, 'contentPipeline');

  const mentionsLocal = /\b(local|near me|near-me|gbp|google business|local pack|market|markets|location|city)\b/.test(question.toLowerCase());
  if (categories.has('performance') || categories.has('general') || mentionsLocal) appendSlice(slices, 'localSeo');

  return slices;
}

export async function buildAdminChatIntelligenceContext(
  workspaceId: string,
  question: string,
  categories: ReadonlySet<AdminChatContextCategory>,
): Promise<AdminChatIntelligenceContext> {
  const slices = selectAdminChatSlices(question, categories);
  const intelligence = await buildWorkspaceIntelligence(workspaceId, {
    slices,
    learningsDomain: 'all',
    enrichWithBacklinks: true,
  });

  const seoContextBlock = formatForPrompt(intelligence, {
    verbosity: 'detailed',
    sections: SEO_CONTEXT_SECTIONS,
    tokenBudget: 2600,
  });
  const keywordMapBlock = intelligence.seoContext ? formatPageMapForPrompt(intelligence.seoContext) : '';
  const workspaceParts = [
    hasFormattedIntelligenceSection(seoContextBlock) ? seoContextBlock : '',
    keywordMapBlock,
  ].filter(Boolean);

  const learningsBlock = intelligence.learnings
    ? formatForPrompt(intelligence, {
        verbosity: 'detailed',
        sections: LEARNINGS_SECTIONS,
        learningsDomain: 'all',
        tokenBudget: 1800,
      })
    : '';

  return {
    intelligence,
    workspaceContextBlock: workspaceParts.length > 0
      ? `WORKSPACE INTELLIGENCE CONTEXT:\n${workspaceParts.join('\n\n')}`
      : '',
    learningsBlock: hasFormattedIntelligenceSection(learningsBlock) ? learningsBlock : '',
    dataSources: workspaceParts.length > 0 ? ['Workspace Intelligence: SEO Context'] : [],
  };
}
