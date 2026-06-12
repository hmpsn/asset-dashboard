import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndCacheKeywordStrategySeoData } from '../../server/keyword-strategy-seo-data.js';
import {
  _resetRegistryForTest,
  registerProvider,
  type SeoDataProvider,
} from '../../server/seo-data-provider.js';
import type { Workspace } from '../../shared/types/workspace.js';

function makeWorkspace(): Workspace {
  return {
    id: `ws-seo-data-${Date.now()}`,
    name: 'SEO Data Status Test',
    folder: 'seo-data-status-test',
    createdAt: new Date().toISOString(),
  };
}

function makeProvider(name: string, overrides: Partial<SeoDataProvider> = {}): SeoDataProvider {
  return {
    name,
    isConfigured: () => true,
    getKeywordMetrics: vi.fn(async () => []),
    getRelatedKeywords: vi.fn(async () => []),
    getQuestionKeywords: vi.fn(async () => []),
    getDomainKeywords: vi.fn(async () => []),
    getDomainOverview: vi.fn(async () => null),
    getCompetitors: vi.fn(async () => []),
    getKeywordGap: vi.fn(async () => []),
    getBacklinksOverview: vi.fn(async () => null),
    getReferringDomains: vi.fn(async () => []),
    ...overrides,
  };
}

afterEach(() => {
  _resetRegistryForTest();
});

describe('fetchAndCacheKeywordStrategySeoData provider status', () => {
  it('marks requested provider mode as degraded when no provider is configured', async () => {
    const result = await fetchAndCacheKeywordStrategySeoData({
      ws: makeWorkspace(),
      provider: null,
      baseUrl: 'https://example.com',
      strategyMode: 'full',
      seoDataMode: 'quick',
      competitorDomains: [],
      sendProgress: vi.fn(),
    });

    expect(result.seoDataStatus).toEqual(expect.objectContaining({
      mode: 'quick',
      status: 'degraded',
      reasons: ['no_configured_provider'],
    }));
  });

  it('marks empty provider responses as degraded and records alternate provider availability', async () => {
    const dataForSeo = makeProvider('dataforseo');
    registerProvider('dataforseo', dataForSeo);

    const result = await fetchAndCacheKeywordStrategySeoData({
      ws: makeWorkspace(),
      provider: dataForSeo,
      baseUrl: 'https://example.com',
      strategyMode: 'full',
      seoDataMode: 'full',
      competitorDomains: [],
      sendProgress: vi.fn(),
    });

    expect(result.seoDataStatus.status).toBe('degraded');
    expect(result.seoDataStatus.provider).toBe('dataforseo');
    expect(result.seoDataStatus.fallbackProviderAvailable).toBe(false);
    expect(result.seoDataStatus.reasons).toContain('provider_returned_no_keyword_data');
  });

  it('skips legacy discovery prefetch because the keyword universe owns provider discovery', async () => {
    const getKeywordsForKeywords = vi.fn(async () => [
      {
        keyword: 'planner grouped dental term',
        volume: 1_000_000,
        difficulty: 21,
        cpc: 0,
        provider: 'dataforseo',
        sourceKind: 'google_ads_keywords_for_keywords' as const,
        seed: 'dentist',
      },
    ]);
    const getKeywordsForSite = vi.fn(async () => [
        {
          keyword: 'austin dental implants',
          volume: 900,
          difficulty: 38,
          cpc: 8,
          provider: 'dataforseo',
          sourceKind: 'keywords_for_site',
          sourceTarget: 'example.com',
          confidence: 'high',
        },
      ]);
    const provider = makeProvider('dataforseo', {
      getKeywordsForSite,
      getKeywordsForKeywords,
    });

    const result = await fetchAndCacheKeywordStrategySeoData({
      ws: makeWorkspace(),
      provider,
      baseUrl: 'https://example.com',
      strategyMode: 'full',
      seoDataMode: 'full',
      competitorDomains: [],
      sendProgress: vi.fn(),
    });

    expect(result.discoveryKeywords).toEqual([]);
    expect(result.seoContext).not.toContain('SEO PROVIDER DISCOVERY KEYWORDS');
    expect(result.seoDataStatus.status).toBe('degraded');
    expect(result.seoDataStatus.reasons).toContain('provider_returned_no_keyword_data');
    expect(getKeywordsForSite).not.toHaveBeenCalled();
    expect(getKeywordsForKeywords).not.toHaveBeenCalled();
  });
});
