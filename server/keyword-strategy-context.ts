import type { ClientSignalsSlice, SeoContextSlice } from '../shared/types/intelligence.js';
import type { KeywordEvaluationContext } from './keyword-intelligence/index.js';

export interface BuildStrategyKeywordEvaluationContextOptions {
  workspaceId: string;
  workspaceName?: string;
  businessContext?: string;
  seoContext?: Pick<SeoContextSlice, 'businessContext' | 'knowledgeBase' | 'brandVoice' | 'backlinkProfile'> | null;
  clientSignals?: ClientSignalsSlice | null;
  declinedKeywords?: string[];
  requestedKeywords?: string[];
  approvedKeywords?: string[];
  strictBusinessFit?: boolean;
}

function compact(values: Array<string | undefined | null>): string[] {
  return values.map(value => value?.trim()).filter((value): value is string => Boolean(value));
}

export function buildStrategyKeywordEvaluationContext(
  options: BuildStrategyKeywordEvaluationContextOptions,
): KeywordEvaluationContext {
  return {
    workspaceId: options.workspaceId,
    businessTerms: compact([
      options.workspaceName,
      options.businessContext,
      options.seoContext?.businessContext,
      options.seoContext?.knowledgeBase,
      options.seoContext?.brandVoice,
    ]),
    businessPriorities: options.clientSignals?.businessPriorities ?? [],
    contentGapTopics: (options.clientSignals?.contentGapVotes ?? []).map(vote => vote.topic),
    recentChatTopics: options.clientSignals?.recentChatTopics ?? [],
    declinedKeywords: options.declinedKeywords ?? [],
    requestedKeywords: options.requestedKeywords ?? [],
    approvedKeywords: options.approvedKeywords ?? options.clientSignals?.keywordFeedback.approved ?? [],
    rejectionReasons: options.clientSignals?.keywordFeedback.patterns.topRejectionReasons ?? [],
    backlinkProfile: options.seoContext?.backlinkProfile,
    strictBusinessFit: options.strictBusinessFit ?? false,
  };
}
