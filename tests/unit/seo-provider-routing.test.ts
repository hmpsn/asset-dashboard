/**
 * Tests for generic capability-based provider routing in seo-data-provider.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  markCapabilityDisabled,
  clearCapabilityDisabled,
  getProviderForCapability,
  getBacklinksProvider,
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
    clearCapabilityDisabled('dataforseo', 'backlinks');
    clearCapabilityDisabled('semrush', 'backlinks');
    clearCapabilityDisabled('dataforseo', 'serp_features');
  });

  it('returns primary provider when capability is not disabled', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(dfs);
  });

  it('falls back to SEMRush when DataForSEO backlinks is disabled', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(semrush);
  });

  it('returns null when no fallback provider is available', () => {
    const dfs = makeProvider('dataforseo');
    const unconfiguredSemrush = makeProvider('semrush', false);
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', unconfiguredSemrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBeNull();
  });

  it('getBacklinksProvider delegates to getProviderForCapability', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');
    const provider = getBacklinksProvider('dataforseo');
    expect(provider).toBe(semrush);
  });
});
