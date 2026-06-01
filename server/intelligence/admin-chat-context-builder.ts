import type { IntelligenceSlice, WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { PROMPT_FORMATTABLE_INTELLIGENCE_SLICES } from '../../shared/types/intelligence.js';
import { buildWorkspaceIntelligence, formatForPrompt, formatPageMapForPrompt } from '../workspace-intelligence.js';

const SEO_CONTEXT_SECTIONS = ['seoContext'] as const;
const LEARNINGS_SECTIONS = ['learnings'] as const;

/**
 * Slices that have dedicated top-level blocks in buildAdminChatIntelligenceContext
 * (seoContextBlock and learningsBlock). All other assembled + prompt-formattable slices
 * are routed through the additional-slices block so their data reaches the model.
 */
const DEDICATED_SECTIONS = new Set<IntelligenceSlice>(['seoContext', 'learnings']);

/**
 * Token budget for the additional slices block (operational, siteHealth, clientSignals,
 * insights, contentPipeline, localSeo). Kept below the seoContext budget (2600) so the
 * combined prompt stays within the ~6400-token workspace context envelope.
 */
const ADDITIONAL_SLICES_TOKEN_BUDGET = 1500;

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

  // Route the additional assembled slices (operational, siteHealth, clientSignals, insights,
  // contentPipeline, localSeo) through formatForPrompt so their data reaches the model.
  // B-10 fix: previously these slices were assembled but their formatted output was never
  // included in the context block, making them invisible to the advisor.
  const additionalSections = slices.filter(
    (s): s is typeof PROMPT_FORMATTABLE_INTELLIGENCE_SLICES[number] =>
      !DEDICATED_SECTIONS.has(s) &&
      (PROMPT_FORMATTABLE_INTELLIGENCE_SLICES as readonly string[]).includes(s),
  );

  let additionalBlock = '';
  const additionalDataSources: string[] = [];
  if (additionalSections.length > 0) {
    const formatted = formatForPrompt(intelligence, {
      verbosity: 'standard',
      sections: additionalSections,
      tokenBudget: ADDITIONAL_SLICES_TOKEN_BUDGET,
    });
    if (hasFormattedIntelligenceSection(formatted)) {
      additionalBlock = formatted;
      // Build a readable data-source label from the section names
      const label = additionalSections.map(s => s.replace(/([A-Z])/g, ' $1').trim()).join(', ');
      additionalDataSources.push(`Workspace Intelligence: ${label}`);
    }
  }

  if (additionalBlock) workspaceParts.push(additionalBlock);

  const dataSources: string[] = [];
  if (workspaceParts.length > 0) dataSources.push('Workspace Intelligence: SEO Context');
  dataSources.push(...additionalDataSources);

  return {
    intelligence,
    workspaceContextBlock: workspaceParts.length > 0
      ? `WORKSPACE INTELLIGENCE CONTEXT:\n${workspaceParts.join('\n\n')}`
      : '',
    learningsBlock: hasFormattedIntelligenceSection(learningsBlock) ? learningsBlock : '',
    dataSources,
  };
}
