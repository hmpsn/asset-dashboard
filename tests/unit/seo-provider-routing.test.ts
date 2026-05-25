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

  it('does not fall back to SEMRush when DataForSEO backlinks is disabled', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBeNull();
  });

  it('returns null when the selected provider cannot serve the capability', () => {
    const dfs = makeProvider('dataforseo');
    const unconfiguredSemrush = makeProvider('semrush', false);
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', unconfiguredSemrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBeNull();
  });

  it('getBacklinksProvider returns null instead of falling back when selected provider cannot serve backlinks', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');
    const provider = getBacklinksProvider('dataforseo');
    expect(provider).toBeNull();
  });

  it('uses SEMRush for backlinks when SEMRush is explicitly preferred', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getBacklinksProvider('semrush');
    expect(provider).toBe(semrush);
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

  it('uses SEMRush only when it is explicitly preferred', () => {
    const semrush = makeProvider('semrush');
    const dfs = makeProvider('dataforseo');
    registerProvider('semrush', semrush);
    registerProvider('dataforseo', dfs);

    expect(getConfiguredProvider('semrush')).toBe(semrush);
  });
});
