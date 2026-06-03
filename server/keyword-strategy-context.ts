import type { ClientSignalsSlice, SeoContextSlice } from '../shared/types/intelligence.js';
import type { PageKeywordMap } from '../shared/types/workspace.js';

/**
 * Evaluation context shape used by keyword intelligence rules.
 * Inlined here since the keyword-intelligence module is not available in this branch.
 */
interface KeywordEvaluationContext {
  workspaceId?: string;
  businessTerms?: string[];
  businessPriorities?: string[];
  contentGapTopics?: string[];
  recentChatTopics?: string[];
  declinedKeywords?: string[];
  requestedKeywords?: string[];
  approvedKeywords?: string[];
  rejectionReasons?: string[];
  backlinkProfile?: SeoContextSlice['backlinkProfile'];
  strictBusinessFit?: boolean;
  /** SEO Generation Quality P2 — drops the business_mismatch hard-suppress escalation. */
  relaxConservatism?: boolean;
  seedKeyword?: string;
  pageMap?: PageKeywordMap[];
}

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
  /**
   * SEO Generation Quality P2 (flag `seo-generation-quality`, per-workspace).
   * Computed ONCE per generation and threaded here; do NOT call isFeatureEnabled
   * in the per-candidate hot loop. Flag-OFF (undefined/false) is byte-identical.
   */
  relaxConservatism?: boolean;
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
    businessPriorities: options.clientSignals?.effectiveBusinessPriorities ?? [],
    contentGapTopics: (options.clientSignals?.contentGapVotes ?? []).map(vote => vote.topic),
    recentChatTopics: options.clientSignals?.recentChatTopics ?? [],
    declinedKeywords: options.declinedKeywords ?? [],
    requestedKeywords: options.requestedKeywords ?? [],
    approvedKeywords: options.approvedKeywords ?? options.clientSignals?.keywordFeedback.approved ?? [],
    rejectionReasons: options.clientSignals?.keywordFeedback.patterns.topRejectionReasons ?? [],
    backlinkProfile: options.seoContext?.backlinkProfile,
    strictBusinessFit: options.strictBusinessFit ?? false,
    relaxConservatism: options.relaxConservatism ?? false,
  };
}
