import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client StrategyTab page improvements split', () => {
  it('keeps quick wins and page review cards behind a focused strategy component', () => {
    const strategyTabSrc = readFileSync('src/components/client/StrategyTab.tsx', 'utf-8'); // readFile-ok - migration guard: StrategyTab should orchestrate improve-pages state without owning rendered quick-win/page-review cards.
    const sectionSrc = readFileSync('src/components/client/strategy/StrategyPageImprovementsSection.tsx', 'utf-8'); // readFile-ok - migration guard: quick wins, growth opportunity scoring, and request-review actions live in the extracted section component.

    expect(strategyTabSrc).toContain("from './strategy/StrategyPageImprovementsSection'");
    expect(strategyTabSrc).toContain('<StrategyPageImprovementsSection');
    expect(strategyTabSrc).not.toContain('Quick Wins sub-section');
    expect(strategyTabSrc).not.toContain('Growth Opportunities sub-section');
    expect(strategyTabSrc).not.toContain('Google is already crawling this page');
    expect(strategyTabSrc).not.toContain('Optimization request created');

    expect(sectionSrc).toContain('function buildGrowthOpportunityPages');
    expect(sectionSrc).toContain('Quick Wins');
    expect(sectionSrc).toContain('Pages to Review');
    expect(sectionSrc).toContain("post(`/api/public/content-request/${workspaceId}`");
    expect(sectionSrc).toContain('Optimization request created');
    expect(sectionSrc).toContain('growth-opportunities-all');
  });
});
