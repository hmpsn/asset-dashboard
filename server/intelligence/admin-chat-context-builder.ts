import type { IntelligenceSlice, WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { PROMPT_FORMATTABLE_INTELLIGENCE_SLICES } from '../../shared/types/intelligence.js';
import { buildWorkspaceIntelligence, formatForPrompt, formatPageMapForPrompt } from '../workspace-intelligence.js';

const SEO_CONTEXT_SECTIONS = ['seoContext'] as const;
const LEARNINGS_SECTIONS = ['learnings'] as const;

/**
 * Slices that must not be repeated in the additional formatted block. SEO context
 * and learnings have dedicated top-level blocks here. Insights are intentionally
 * formatted by assembleAdminContext's richer type-aware ANALYTICS INTELLIGENCE
 * renderer from the same assembled slice.
 */
const SEPARATELY_FORMATTED_SECTIONS = new Set<IntelligenceSlice>(['seoContext', 'learnings', 'insights']);

/**
 * Token budget for the additional slices block (operational, siteHealth, clientSignals,
 * insights, contentPipeline, localSeo). Kept below the seoContext budget (2600) so the
 * combined prompt stays within the ~6400-token workspace context envelope.
 */
const ADDITIONAL_SLICES_TOKEN_BUDGET = 1500;

/**
 * Paid backlink enrichment is question-scoped. Keep this matcher conservative:
 * generic "links" can mean navigation, broken links, or internal links and must
 * not trigger a provider charge. These phrases specifically ask about off-site
 * link authority or a backlink profile.
 */
const BACKLINK_INTENT_PATTERN = /\b(?:backlinks?|backlink\s+profile|referring\s+domains?|inbound\s+links?|off[-\s]?page\s+(?:seo|links?)|link\s+(?:authority|profile|building|equity)|domain\s+(?:authority|rating)|authority\s+score)\b/i;

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

export function hasBacklinkIntent(question: string): boolean {
  return BACKLINK_INTENT_PATTERN.test(question);
}

function hasFormattedIntelligenceSection(block: string): boolean {
  return /##\s/.test(block);
}

function stripWorkspaceIntelligenceHeader(block: string): string {
  return block.replace(/^\[Workspace Intelligence\]\s*/i, '').trim();
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
    enrichWithBacklinks: hasBacklinkIntent(question),
  });

  const seoContextBlock = formatForPrompt(intelligence, {
    verbosity: 'detailed',
    sections: SEO_CONTEXT_SECTIONS,
    tokenBudget: 2600,
  });
  const keywordMapBlock = intelligence.seoContext ? formatPageMapForPrompt(intelligence.seoContext) : '';
  const workspaceParts = [
    hasFormattedIntelligenceSection(seoContextBlock) ? stripWorkspaceIntelligenceHeader(seoContextBlock) : '',
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

  // Route the additional assembled slices (operational, siteHealth, clientSignals,
  // contentPipeline, localSeo) through formatForPrompt so their unique data reaches the model.
  // B-10 fix: previously these slices were assembled but their formatted output was never
  // included in the context block, making them invisible to the advisor. Insights are the
  // one exception because the caller already renders the same slice in greater detail.
  const additionalSections = slices.filter(
    (s): s is typeof PROMPT_FORMATTABLE_INTELLIGENCE_SLICES[number] =>
      !SEPARATELY_FORMATTED_SECTIONS.has(s) &&
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
      additionalBlock = stripWorkspaceIntelligenceHeader(formatted);
      // Build a readable data-source label from the section names
      const label = additionalSections.map(s => s.replace(/([A-Z])/g, ' $1').trim()).join(', ');
      additionalDataSources.push(`Workspace Intelligence: ${label}`);
    }
  }

  if (additionalBlock) workspaceParts.push(additionalBlock);

  // Gate the 'SEO Context' data-source label on the seoContext block having
  // produced real content — NOT on workspaceParts being non-empty. workspaceParts
  // can be non-empty solely because additionalBlock (operational, siteHealth, …)
  // was pushed, even when seoContext formatted to nothing; listing 'SEO Context'
  // in that case is a false claim about which slices grounded the answer.
  const hasSeoContextContent = hasFormattedIntelligenceSection(seoContextBlock);
  const dataSources: string[] = [];
  if (hasSeoContextContent) dataSources.push('Workspace Intelligence: SEO Context');
  dataSources.push(...additionalDataSources);

  const workspaceContextBlock = workspaceParts.length > 0
    ? `WORKSPACE INTELLIGENCE CONTEXT:\n[Workspace Intelligence]\n\n${workspaceParts.join('\n\n')}`
    : '';
  const hasLearningsContent = hasFormattedIntelligenceSection(learningsBlock);

  return {
    intelligence,
    workspaceContextBlock,
    // formatForPrompt adds its wrapper to every call. Keep one wrapper across the
    // final prompt: the workspace block owns it when present; a learnings-only
    // result retains it so the fragment still has provenance when used alone.
    learningsBlock: hasLearningsContent
      ? (workspaceContextBlock ? stripWorkspaceIntelligenceHeader(learningsBlock) : learningsBlock)
      : '',
    dataSources,
  };
}
