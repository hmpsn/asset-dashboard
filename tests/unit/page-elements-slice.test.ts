import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { PageElementCatalog } from '../../shared/types/page-elements.js';

const getPageElementsMock = vi.fn();

vi.mock('../../server/page-elements-store.js', () => ({
  getPageElements: getPageElementsMock,
}));

const emptyCatalog = (): PageElementCatalog => ({
  extractedAt: '2026-05-04T00:00:00.000Z',
  sourcePublishedAt: null,
  headings: [],
  tables: [],
  images: [],
  videos: [],
  lists: [],
  testimonials: [],
  codeBlocks: [],
  citations: [],
  diagnostics: {
    aiClassificationCalls: 0,
    hitAiBudgetCap: false,
    rawCounts: {},
  },
});

describe('page-elements intelligence slice', () => {
  beforeEach(() => {
    getPageElementsMock.mockReset();
  });

  it('formats a compact structural summary when page elements exist', async () => {
    const { formatPageElementsSection } = await import('../../server/intelligence/page-elements-slice.js');
    const catalog = emptyCatalog();
    catalog.videos.push({ provider: 'youtube', embedUrl: 'https://example.com/video' });
    catalog.lists.push({ kind: 'ordered', itemCount: 3, isHowToLike: true });
    catalog.citations.push({ url: 'https://example.com/source', text: 'Source', isExternal: true });

    expect(formatPageElementsSection({ pagePath: '/services', catalog })).toBe(
      '## Page elements (/services)\n1 video · 1 HowTo list · 1 citation',
    );
  });

  it('returns undefined instead of extracting when no persisted catalog exists', async () => {
    const { assemblePageElements } = await import('../../server/intelligence/page-elements-slice.js');
    getPageElementsMock.mockReturnValue(null);

    await expect(assemblePageElements('ws-1', '/about')).resolves.toBeUndefined();
    expect(getPageElementsMock).toHaveBeenCalledWith('ws-1', '/about');
  });

  it('returns the persisted page element catalog when one exists', async () => {
    const { assemblePageElements } = await import('../../server/intelligence/page-elements-slice.js');
    const catalog = emptyCatalog();
    getPageElementsMock.mockReturnValue({ pagePath: '/services', catalog });

    await expect(assemblePageElements('ws-1', '/services')).resolves.toEqual({
      pagePath: '/services',
      catalog,
    });
  });

  it('gracefully degrades when the page element store throws', async () => {
    const { assemblePageElements } = await import('../../server/intelligence/page-elements-slice.js');
    getPageElementsMock.mockImplementation(() => {
      throw new Error('store unavailable');
    });

    await expect(assemblePageElements('ws-1', '/about')).resolves.toBeUndefined();
  });
});
