import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab content opportunity split', () => {
  it('keeps create-content opportunity rendering behind a focused strategy component', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab should orchestrate create-content state without owning the rendered opportunity section.
    const sectionSrc = readFileSync('src/components/client/strategy/StrategyContentOpportunitiesSection.tsx', 'utf-8'); // readFile-ok - migration guard: create-content opportunity cards and request actions live in the extracted section component.
    const displaySrc = readFileSync('src/components/client/strategy/strategyKeywordDisplay.ts', 'utf-8'); // readFile-ok - migration guard: shared keyword display helpers stay reusable across StrategyTab sections.

    expect(strategyTabSrc).toContain("from './strategy/StrategyContentOpportunitiesSection'");
    expect(strategyTabSrc).toContain('<StrategyContentOpportunitiesSection');
    expect(strategyTabSrc).not.toContain('Strong Recommendations sub-section');
    expect(strategyTabSrc).not.toContain('Clear new-page recommendations come first');
    expect(strategyTabSrc).not.toContain('Review Keyword Ideas');

    expect(sectionSrc).toContain('function ContentGapCard');
    expect(sectionSrc).toContain('Strong Recommendations');
    expect(sectionSrc).toContain('Review Keyword Ideas');
    expect(sectionSrc).toContain('Additional Page Ideas');
    expect(sectionSrc).toContain("setPricingModal({ serviceType: 'brief_only'");
    expect(sectionSrc).toContain("submitFeedback(gap.targetKeyword, 'approved', 'content_gap')");

    expect(displaySrc).toContain('export const kdColor');
  });
});
