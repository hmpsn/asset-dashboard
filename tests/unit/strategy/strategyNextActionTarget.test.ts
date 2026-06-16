import { describe, it, expect } from 'vitest';
import { strategyNextActionTarget } from '../../../src/lib/strategyNextActionTarget';
import type { KeywordStrategyExplanation, KeywordStrategyNextAction } from '../../../shared/types/keyword-strategy-ux';

const expl = (nextAction: KeywordStrategyNextAction, over: Partial<KeywordStrategyExplanation> = {}): KeywordStrategyExplanation => ({
  keyword: 'seo tips', normalizedKeyword: 'seo tips', role: 'primary', surfaceLabel: '',
  sourceEvidence: [], reasons: ['r'], fitSignals: [], pagePath: '/blog/seo', nextAction, ...over,
} as KeywordStrategyExplanation);

describe('strategyNextActionTarget', () => {
  it('maps optimize_page → page-intelligence with pageSlug (auto-expand)', () => {
    const t = strategyNextActionTarget(expl({ type: 'optimize_page', label: 'Optimize page', detail: '' }));
    expect(t).toEqual({
      tab: 'page-intelligence',
      fixContext: { targetRoute: 'page-intelligence', pageSlug: '/blog/seo', pageName: undefined, primaryKeyword: 'seo tips' },
    });
  });

  it('maps generate_brief → content-pipeline', () => {
    expect(strategyNextActionTarget(expl({ type: 'generate_brief', label: 'Draft brief', detail: '' }))?.tab).toBe('content-pipeline');
  });

  it('maps track_keyword → seo-keywords', () => {
    expect(strategyNextActionTarget(expl({ type: 'track_keyword', label: 'Track', detail: '' }))?.tab).toBe('seo-keywords');
  });

  it('returns null for watch and review_evidence (no dead CTA)', () => {
    expect(strategyNextActionTarget(expl({ type: 'watch', label: 'Watch', detail: '' }))).toBeNull();
    expect(strategyNextActionTarget(expl({ type: 'review_evidence', label: 'Review', detail: '' }))).toBeNull();
  });

  it('prefers nextAction.pagePath over explanation.pagePath', () => {
    const t = strategyNextActionTarget(
      expl({ type: 'optimize_page', label: 'x', detail: '', pagePath: '/next-action' }, { pagePath: '/explanation' }),
    );
    expect(t?.fixContext.pageSlug).toBe('/next-action');
  });
});
