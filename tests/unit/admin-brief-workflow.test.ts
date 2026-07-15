import { describe, expect, it, vi } from 'vitest';
import type { ContentBrief } from '../../shared/types/content';
import {
  createBriefFieldSaveQueue,
  extractGeneratedBriefResult,
  renderBriefMarkdown,
} from '../../src/hooks/admin/useAdminBriefWorkflow';

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

  it('serializes rapid field commits and advances later edits only over its own local result', async () => {
    let current = makeBrief({ generationRevision: 4 });
    let resolveFirst!: (brief: ContentBrief) => void;
    const firstPersist = new Promise<ContentBrief>(resolve => { resolveFirst = resolve; });
    const persist = vi.fn(async (
      _briefId: string,
      updates: Partial<ContentBrief>,
      expectedRevision: number,
    ) => {
      if (persist.mock.calls.length === 1) return firstPersist;
      return { ...current, ...updates, generationRevision: expectedRevision + 1 };
    });
    const queue = createBriefFieldSaveQueue({
      readCurrent: () => current,
      persist,
      commit: updated => {
        current = updated;
        return current;
      },
      onStale: vi.fn(),
      onError: vi.fn(),
    });

    const titleSave = queue.enqueue('brief-1', { suggestedTitle: 'Pinned title draft' }, 4);
    const summarySave = queue.enqueue('brief-1', { executiveSummary: 'Pinned summary draft' }, 4);
    await Promise.resolve();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenNthCalledWith(1, 'brief-1', { suggestedTitle: 'Pinned title draft' }, 4);

    resolveFirst({ ...current, suggestedTitle: 'Pinned title draft', generationRevision: 5 });

    await expect(titleSave).resolves.toBe(true);
    await expect(summarySave).resolves.toBe(true);
    expect(persist).toHaveBeenNthCalledWith(2, 'brief-1', { executiveSummary: 'Pinned summary draft' }, 5);
    expect(current.suggestedTitle).toBe('Pinned title draft');
    expect(current.executiveSummary).toBe('Pinned summary draft');
    expect(current.generationRevision).toBe(6);
  });

  it('invalidates queued field drafts when an external refetch replaces the local authority chain', async () => {
    let current = makeBrief({ generationRevision: 8 });
    let resolveFirst!: (brief: ContentBrief) => void;
    const firstPersist = new Promise<ContentBrief>(resolve => { resolveFirst = resolve; });
    const persist = vi.fn(() => firstPersist);
    const onStale = vi.fn();
    const queue = createBriefFieldSaveQueue({
      readCurrent: () => current,
      persist,
      commit: updated => {
        const locallyCommitted = updated;
        current = {
          ...updated,
          audience: 'Externally refreshed audience',
          generationRevision: (updated.generationRevision ?? 0) + 1,
        };
        return locallyCommitted;
      },
      onStale,
      onError: vi.fn(),
    });

    const titleSave = queue.enqueue('brief-1', { suggestedTitle: 'Local title' }, 8);
    const summarySave = queue.enqueue('brief-1', { executiveSummary: 'Must remain buffered' }, 8);
    await Promise.resolve();
    resolveFirst({ ...current, suggestedTitle: 'Local title', generationRevision: 9 });

    await expect(titleSave).resolves.toBe(true);
    await expect(summarySave).resolves.toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(current.executiveSummary).not.toBe('Must remain buffered');
    expect(current.generationRevision).toBe(10);
  });
});
