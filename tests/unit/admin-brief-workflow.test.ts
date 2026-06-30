import { describe, expect, it } from 'vitest';
import type { ContentBrief } from '../../shared/types/content';
import { extractGeneratedBriefResult, renderBriefMarkdown } from '../../src/hooks/admin/useAdminBriefWorkflow';

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: 'brief-1',
    workspaceId: 'ws-1',
    targetKeyword: 'technical seo',
    secondaryKeywords: ['crawl budget', 'site architecture'],
    suggestedTitle: 'Technical SEO Guide',
    suggestedMetaDesc: 'Improve crawlability and site health.',
    outline: [
      { heading: 'Audit Crawl Paths', notes: 'Cover crawl diagnostics.', wordCount: 300, keywords: ['crawl budget'] },
    ],
    wordCountTarget: 1200,
    intent: 'informational',
    audience: 'marketing leaders',
    competitorInsights: 'Competitors emphasize tooling.',
    internalLinkSuggestions: ['services/seo', 'blog/site-health'],
    createdAt: '2026-06-01T00:00:00.000Z',
    contentFormat: 'guide',
    executiveSummary: 'Prioritize technical fixes that unlock indexation.',
    toneAndStyle: 'Clear and practical.',
    topicalEntities: ['Googlebot'],
    peopleAlsoAsk: ['How do I improve crawl budget?'],
    ctaRecommendations: ['Book a technical audit'],
    serpAnalysis: {
      contentType: 'guide',
      avgWordCount: 1800,
      gaps: ['Few pages explain prioritization'],
    },
    ...overrides,
  };
}

describe('admin brief workflow helpers', () => {
  it('extracts generated brief job result fields without accepting invalid shapes', () => {
    const brief = makeBrief();

    expect(extractGeneratedBriefResult({ brief, briefId: brief.id, requestId: 'req-1' })).toEqual({
      brief,
      briefId: brief.id,
      requestId: 'req-1',
    });
    expect(extractGeneratedBriefResult(null)).toBeNull();
    expect(extractGeneratedBriefResult('done')).toBeNull();
    expect(extractGeneratedBriefResult({ briefId: 123, requestId: false })).toEqual({
      brief: undefined,
      briefId: undefined,
      requestId: undefined,
    });
  });

  it('renders the existing copy-as-markdown sections from a brief', () => {
    const markdown = renderBriefMarkdown(makeBrief());

    expect(markdown).toContain('# Content Brief: technical seo');
    expect(markdown).toContain('**Write a 1200-word guide targeting "technical seo".**');
    expect(markdown).toContain('## Strategic Context');
    expect(markdown).toContain('- crawl budget');
    expect(markdown).toContain('### Audit Crawl Paths (~300 words)');
    expect(markdown).toContain('*Keywords: crawl budget*');
    expect(markdown).toContain('- **Primary:** Book a technical audit');
    expect(markdown).toContain('- /services/seo');
    expect(markdown).toContain('- Content type: guide');
  });
});
