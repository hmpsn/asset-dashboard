import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
  formatPersonasForPrompt: vi.fn((personas) => {
    if (!personas?.length) return '';
    return `\n\nTARGET AUDIENCE PERSONAS:\n${personas.map((p: { name: string; painPoints?: string[] }) => [
      `**${p.name}**`,
      ...(p.painPoints ?? []),
    ].join('\n')).join('\n\n')}`;
  }),
}));

vi.mock('../../server/keyword-feedback.js', () => ({
  getDeclinedKeywords: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: vi.fn().mockReturnValue([]),
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

  it('reads knowledgeBase and personas from intel.seoContext instead of legacy helpers', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: [] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: 'B2B SaaS implementation partner',
        knowledgeBase: 'Slice knowledge base',
        personas: [
          {
            id: 'persona-ops',
            name: 'Operations Director',
            description: 'Owns repeated service buying decisions',
            painPoints: ['No clear ROI'],
            goals: ['Show pipeline progress'],
            objections: ['Too much setup'],
            preferredContentFormat: 'brief',
            buyingStage: 'consideration',
          },
        ],
      } as never,
    } as never);

    const mockWs = {
      id: 'ws_test',
      name: 'Test',
      webflowSiteId: 'site_test_123',
      keywordStrategy: { siteKeywords: [] },
    } as never;
    vi.mocked(listWorkspaces).mockReturnValue([mockWs]);

    const { ctx } = await buildSchemaContext('site_test_123');

    expect(ctx.businessContext).toBe('B2B SaaS implementation partner');
    expect(ctx.knowledgeBase).toBe('Slice knowledge base');
    expect(ctx._personasBlock).toContain('Operations Director');
    expect(ctx._personasBlock).toContain('No clear ROI');
  });

  it('reads _businessProfile from intel.seoContext.businessProfile', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: [] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: '',
        knowledgeBase: '',
        personas: [],
        businessProfile: {
          industry: 'Healthcare',
          goals: [],
          targetAudience: 'Patients',
          phone: '+1-555-0100',
          email: 'care@example.com',
          address: '123 Main St, Springfield, IL, 62701, US',
          addressParts: {
            street: '123 Main St',
            city: 'Springfield',
            state: 'IL',
            zip: '62701',
            country: 'US',
          },
          socialProfiles: ['https://example.com/linkedin'],
          openingHours: 'Mon-Fri 9am-5pm',
          foundedDate: '2010-01-01',
          numberOfEmployees: '10-50',
        },
      } as never,
    } as never);

    const mockWs = {
      id: 'ws_test',
      name: 'Test',
      webflowSiteId: 'site_test_123',
      keywordStrategy: { siteKeywords: [] },
    } as never;
    vi.mocked(listWorkspaces).mockReturnValue([mockWs]);

    const { ctx } = await buildSchemaContext('site_test_123');

    expect(ctx._businessProfile?.address?.city).toBe('Springfield');
    expect(ctx._businessProfile?.phone).toBe('+1-555-0100');
    expect(ctx._businessProfile?.foundedDate).toBe('2010-01-01');
    expect(ctx._businessProfile?.numberOfEmployees).toBe('10-50');
  });

  it('does not read migrated-forbidden legacy workspace fields', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: ['slice-keyword'] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: 'Slice business context',
        knowledgeBase: 'Slice knowledge',
        personas: [],
        businessProfile: {
          industry: '',
          goals: [],
          targetAudience: '',
          phone: '+1-555-0100',
          addressParts: { city: 'Springfield' },
        },
      } as never,
    } as never);

    const ws: Record<string, unknown> = {
      id: 'ws_test',
      name: 'Test',
      webflowSiteId: 'site_test_123',
      liveDomain: 'example.com',
      brandLogoUrl: '',
      siteHasSearch: false,
    };
    Object.defineProperty(ws, 'brandVoice', {
      get() { throw new Error('legacy brandVoice read'); },
    });
    Object.defineProperty(ws, 'keywordStrategy', {
      get() { throw new Error('legacy keywordStrategy read'); },
    });
    Object.defineProperty(ws, 'businessProfile', {
      get() { throw new Error('legacy businessProfile read'); },
    });

    vi.mocked(listWorkspaces).mockReturnValue([ws as never]);

    const { ctx } = await buildSchemaContext('site_test_123');

    expect(ctx.businessContext).toBe('Slice business context');
    expect(ctx.siteKeywords).toEqual(['slice-keyword']);
    expect(ctx._businessProfile?.phone).toBe('+1-555-0100');
  });
});
