import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
}));

vi.mock('../../server/keyword-feedback.js', () => ({
  getDeclinedKeywords: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/seo-context.js', () => ({
  getRawKnowledge: vi.fn().mockReturnValue(null),
  buildPersonasContext: vi.fn().mockReturnValue(''),
}));

vi.mock('../../server/webflow-pages.js', () => ({
  listSites: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/search-console.js', () => ({
  getAllGscPages: vi.fn().mockResolvedValue([]),
  getQueryPageData: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4TopPages: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn().mockReturnValue([]),
}));

import { buildSchemaContext } from '../../server/helpers.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { getDeclinedKeywords } from '../../server/keyword-feedback.js';
import { listWorkspaces } from '../../server/workspaces.js';

describe('buildSchemaContext — slice migration (Pattern B starter)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('reads siteKeywords from intel.seoContext.strategy.siteKeywords (not direct ws read)', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: ['from-slice-1', 'from-slice-2', 'from-slice-3'] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: '',
        personas: [],
        knowledgeBase: '',
      } as never,
    } as never);

    const mockWs = {
      id: 'ws_test',
      name: 'Test',
      webflowSiteId: 'site_test_123',
      keywordStrategy: { siteKeywords: ['LEGACY-DIRECT-READ'] },
    } as never;
    vi.mocked(listWorkspaces).mockReturnValue([mockWs]);

    const { ctx } = await buildSchemaContext('site_test_123');

    expect(ctx.siteKeywords).toEqual(['from-slice-1', 'from-slice-2', 'from-slice-3']);
    expect(ctx.siteKeywords).not.toContain('LEGACY-DIRECT-READ');
  });

  it('applies declined-keyword filter at schema layer (slice does NOT apply it per audit Correction 3)', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: ['keep-this', 'declined-this', 'keep-that'] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: '',
        personas: [],
        knowledgeBase: '',
      } as never,
    } as never);

    vi.mocked(getDeclinedKeywords).mockReturnValue(['declined-this']);

    const mockWs = {
      id: 'ws_test',
      name: 'Test',
      webflowSiteId: 'site_test_123',
      keywordStrategy: { siteKeywords: [] },
    } as never;
    vi.mocked(listWorkspaces).mockReturnValue([mockWs]);

    const { ctx } = await buildSchemaContext('site_test_123');

    expect(ctx.siteKeywords).toEqual(['keep-this', 'keep-that']);
  });
});
