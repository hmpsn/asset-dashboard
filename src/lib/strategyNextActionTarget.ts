import type { Page } from '../routes';
import type { RecFixContext } from './recTypeTab';
import type { KeywordStrategyExplanation } from '../../shared/types/keyword-strategy-ux';

/**
 * Maps a "What Changed" explanation's nextAction to a navigation target + fixContext, or null
 * for informational actions (watch / review_evidence) that have no actionable destination —
 * so the badge for those stays a passive label, never a dead CTA.
 *
 * Routing: optimize_page → page-intelligence (auto-expands the page via fixContext.pageSlug);
 * generate_brief → content-pipeline; track_keyword → seo-keywords. nextAction.pagePath wins over
 * explanation.pagePath. nextAction.targetTab is deliberately ignored — it is a free-form string,
 * NOT a typed Page, so it is unsafe to navigate to.
 */
export function strategyNextActionTarget(
  explanation: KeywordStrategyExplanation,
): { tab: Page; fixContext: RecFixContext } | null {
  const { nextAction } = explanation;
  const pageSlug = nextAction.pagePath ?? explanation.pagePath;
  const base = { pageName: explanation.pageTitle, primaryKeyword: explanation.keyword };
  switch (nextAction.type) {
    case 'optimize_page':
      return { tab: 'page-intelligence', fixContext: { targetRoute: 'page-intelligence', pageSlug, ...base } };
    case 'generate_brief':
      return { tab: 'content-pipeline', fixContext: { targetRoute: 'content-pipeline', pageSlug, ...base } };
    case 'track_keyword':
      return { tab: 'seo-keywords', fixContext: { targetRoute: 'seo-keywords', ...base } };
    case 'watch':
    case 'review_evidence':
      return null;
  }
}
