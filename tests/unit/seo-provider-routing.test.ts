/**
 * Tests for generic capability-based provider routing in seo-data-provider.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  getConfiguredProvider,
  markCapabilityDisabled,
  getProviderForCapability,
  getBacklinksProvider,
  _resetRegistryForTest,
  type SeoDataProvider,
  type ProviderName,
} from '../../server/seo-data-provider.js';

function makeProvider(name: ProviderName, configured = true): SeoDataProvider {
  return {
    name,
    isConfigured: () => configured,
    getKeywordMetrics: async () => [],
    getRelatedKeywords: async () => [],
    getQuestionKeywords: async () => [],
    getDomainKeywords: async () => [],
    getDomainOverview: async () => null,
    getCompetitors: async () => [],
    getKeywordGap: async () => [],
    getBacklinksOverview: async () => null,
    getReferringDomains: async () => [],
  };
}

describe('getProviderForCapability', () => {
  beforeEach(() => {
    _resetRegistryForTest();
  });

  it('returns primary provider when capability is not disabled', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(dfs);
  });

  it('ignores legacy backlinks disable flags and stays on DataForSEO', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(dfs);
  });

  it('keeps DataForSEO for backlinks even if a legacy disable flag exists', () => {
    const dfs = makeProvider('dataforseo');
    const unconfiguredSemrush = makeProvider('semrush', false);
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', unconfiguredSemrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(dfs);
  });

  it('getBacklinksProvider stays on DataForSEO instead of falling back', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');
    const provider = getBacklinksProvider('dataforseo');
    expect(provider).toBe(dfs);
  });

  it('treats legacy semrush backlink preference as DataForSEO', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    const provider = getBacklinksProvider('semrush');
    expect(provider).toBe(dfs);
  });
});

describe('getConfiguredProvider', () => {
  beforeEach(() => {
    _resetRegistryForTest();
  });

  it('defaults to DataForSEO when both providers are configured and no preference is supplied', () => {
    const semrush = makeProvider('semrush');
    const dfs = makeProvider('dataforseo');
    registerProvider('semrush', semrush);
    registerProvider('dataforseo', dfs);

    expect(getConfiguredProvider()).toBe(dfs);
  });

  it('treats legacy semrush preference as DataForSEO', () => {
    const semrush = makeProvider('semrush');
    const dfs = makeProvider('dataforseo');
    registerProvider('semrush', semrush);
    registerProvider('dataforseo', dfs);

    expect(getConfiguredProvider('semrush')).toBe(dfs);
  });
});
