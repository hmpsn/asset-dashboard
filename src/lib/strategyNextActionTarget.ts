import type { Page } from '../routes';
import type { RecFixContext } from './recTypeTab';
import { buildHubDeepLinkQuery } from './keywordHubDeepLink';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../shared/types/keyword-command-center';
import type { KeywordStrategyExplanation } from '../../shared/types/keyword-strategy-ux';

/**
 * Navigation descriptor for a "What Changed" next-action CTA. Two delivery mechanisms because the
 * receivers differ: page-intelligence / content-pipeline read router STATE (fixContext), but the
 * Keyword Hub reads only URL query params (?q=/?tab=), never location.state — so track_keyword must
 * deep-link via `search`, not fixContext, or the keyword is silently dropped.
 */
export interface StrategyNavTarget {
  tab: Page;
  /** Router-state fixContext (page-intelligence auto-expand, content-pipeline prefill). */
  fixContext?: RecFixContext;
  /** Query string to append to the path (Keyword Hub deep-link contract). */
  search?: string;
}

/**
 * Maps a "What Changed" explanation's nextAction to a navigation target, or null for informational
 * actions (watch / review_evidence) that have no actionable destination — so their badge stays a
 * passive label, never a dead CTA.
 *
 * optimize_page → page-intelligence (auto-expands via fixContext.pageSlug); generate_brief →
 * content-pipeline (fixContext prefill); track_keyword → Keyword Hub via the ?q=/?tab= deep-link
 * (KeywordHub ignores router state). nextAction.pagePath wins over explanation.pagePath.
 * nextAction.targetTab is ignored — it is a free-form string, not a typed Page.
 */
export function strategyNextActionTarget(
  explanation: KeywordStrategyExplanation,
): StrategyNavTarget | null {
  const { nextAction } = explanation;
  const pageSlug = nextAction.pagePath ?? explanation.pagePath;
  const base = { pageName: explanation.pageTitle, primaryKeyword: explanation.keyword };
  switch (nextAction.type) {
    case 'optimize_page':
      return { tab: 'page-intelligence', fixContext: { targetRoute: 'page-intelligence', pageSlug, ...base } };
    case 'generate_brief':
      return { tab: 'content-pipeline', fixContext: { targetRoute: 'content-pipeline', pageSlug, ...base } };
    case 'track_keyword':
      // Keyword Hub reads ?q=/?tab= (see keywordHubDeepLink.ts), not router state.
      return {
        tab: 'seo-keywords',
        search: buildHubDeepLinkQuery({ keyword: explanation.keyword, segment: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED }),
      };
    case 'watch':
    case 'review_evidence':
      return null;
  }
}
