import { describe, expect, it } from 'vitest';

import { readProjectFile } from '../helpers/source-contracts.js';

describe('keyword opportunity projection boundary', () => {
  it('keeps display projection separate from scoring authority modules', () => {
    const projection = readProjectFile('shared/keyword-opportunity-projection.ts');

    expect(projection).toContain('projectKeywordOpportunity');
    expect(projection).not.toContain('computeKeywordValueScore');
    expect(projection).not.toContain('computeOpportunityValue');
    expect(projection).not.toContain('computeOpportunityScore');
  });

  it('keeps migrated content-gap display/sort surfaces on the shared projection helpers', () => {
    const briefingProjection = readProjectFile('server/briefing-client-projection.ts');
    const enrichment = readProjectFile('server/keyword-strategy-enrichment.ts');
    const intelligenceFormatters = readProjectFile('server/intelligence/formatters.ts');
    const clientOpportunities = readProjectFile('src/components/client/strategy/StrategyContentOpportunitiesSection.tsx');
    const clientKeywords = readProjectFile('src/components/client/strategy/StrategyKeywordsSection.tsx');
    const adminContentGaps = readProjectFile('src/components/strategy/ContentGaps.tsx');

    expect(briefingProjection).toContain('compareBriefingContentGapDisplayOrder');
    expect(enrichment).toContain('compareKeywordOpportunityScoreDesc');
    expect(enrichment).toContain('compareContentGapDemandDisplayOrder');
    expect(intelligenceFormatters).toContain('compareKeywordOpportunityScoreDesc');
    expect(clientOpportunities).toContain('compareOrganicContentGapDisplayOrder');
    expect(clientKeywords).toContain('compareKeywordOpportunityScoreDesc');
    expect(adminContentGaps).toContain('compareContentGapDisplayOrder');

    for (const source of [
      briefingProjection,
      enrichment,
      intelligenceFormatters,
      clientOpportunities,
      clientKeywords,
      adminContentGaps,
    ]) {
      expect(source).not.toContain('(b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)');
    }
    expect(enrichment).not.toContain('const prioWeight = (p: string)');
  });
});
