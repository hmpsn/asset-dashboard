import { LOCAL_SEO_POSTURE } from '../../shared/types/local-seo.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { KeywordEvaluationContext } from '../keyword-intelligence/index.js';
import { buildStrategyKeywordEvaluationContext } from '../keyword-strategy-context.js';
import { getRequestedKeywords, getDeclinedKeywords } from '../keyword-feedback.js';
import { getLocalSeoPosture } from '../local-seo.js';
import { createLogger } from '../logger.js';
import { buildOutcomeLearningStatusNote } from '../outcome-learning-default-path.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
  formatKnowledgeBaseForPrompt,
} from '../workspace-intelligence.js';
import { formatPersonasForPrompt } from '../intelligence/persona-format.js';
import { withActiveLocalSeoSlice } from '../intelligence/generation-context-builders.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

const log = createLogger('keyword-strategy:synthesis');

export interface AssembleSynthesisContextOptions {
  ws: Workspace;
  businessContext: string;
}

export interface SynthesisContext {
  businessSection: string;
  strategyIntel: WorkspaceIntelligence;
  declinedKeywords: string[];
  requestedKeywords: string[];
  approvedKeywords: string[];
  includeLocalUniverse: boolean;
  keywordEvaluationContext: KeywordEvaluationContext;
}

export async function assembleSynthesisContext({
  ws,
  businessContext,
}: AssembleSynthesisContextOptions): Promise<SynthesisContext> {
  let businessSection = businessContext ? `\nBUSINESS CONTEXT: ${businessContext}\n` : '';
  const strategySlices = await withActiveLocalSeoSlice(ws.id, ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline']);
  const strategyIntel = await buildWorkspaceIntelligence(ws.id, {
    slices: strategySlices,
    learningsDomain: 'strategy',
  });
  const strategySeo = strategyIntel.seoContext;
  const clientSignals = strategyIntel.clientSignals;

  const kbBlock = formatKnowledgeBaseForPrompt(strategySeo?.knowledgeBase);
  const persBlock = formatPersonasForPrompt(strategySeo?.personas ?? []);
  const localSeoBlock = formatForPrompt(strategyIntel, {
    verbosity: 'standard',
    sections: ['localSeo'],
    tokenBudget: 1600,
    learningsDomain: 'strategy',
  });
  if (kbBlock) {
    businessSection += `${kbBlock}\n`;
  }
  if (persBlock) {
    businessSection += `${persBlock}\n`;
  }
  if (/##\s/.test(localSeoBlock)) {
    businessSection += `${localSeoBlock}\nUse Local SEO evidence conservatively. It can shape local content/page posture, but do not treat local visibility as GSC rank tracking and do not imply provider checks ran during this strategy generation.\n`;
  }

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
  if (clientSignals?.effectiveBusinessPriorities?.length) {
    businessSection += `\nBUSINESS PRIORITIES: ${clientSignals.effectiveBusinessPriorities.join('; ')}\n`;
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
  } else {
    const learningsStatusNote = buildOutcomeLearningStatusNote(strategyIntel.learnings?.availability, 'strategy');
    if (learningsStatusNote) {
      businessSection += `\nOUTCOME LEARNING STATUS: ${learningsStatusNote}\n`;
    }
  }

  const localPosture = getLocalSeoPosture(ws.id);
  const includeLocalUniverse = localPosture === LOCAL_SEO_POSTURE.LOCAL || localPosture === LOCAL_SEO_POSTURE.HYBRID;
  const keywordEvaluationContext = buildStrategyKeywordEvaluationContext({
    workspaceId: ws.id,
    workspaceName: ws.name,
    businessContext,
    seoContext: strategySeo,
    clientSignals,
    declinedKeywords,
    requestedKeywords,
    approvedKeywords,
    strictBusinessFit: true,
    // Drop the business_mismatch hard-suppress escalation so narrow-but-real
    // keywords survive into ranking (penalty stays).
    relaxConservatism: true,
  });

  return {
    businessSection,
    strategyIntel,
    declinedKeywords,
    requestedKeywords,
    approvedKeywords,
    includeLocalUniverse,
    keywordEvaluationContext,
  };
}
