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

  // P5: the backlinks breaker is now RESPECTED. A 40204 trips markCapabilityDisabled
  // and getProviderForCapability/getBacklinksProvider short-circuit to null so callers
  // degrade the optional backlink fields instead of re-hitting the unsubscribed endpoint
  // (previously a `capability !== 'backlinks'` guard ignored the flag).
  it('returns null for backlinks once the backlinks breaker is tripped', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBeNull();
  });

  it('breaker is per-capability: disabling backlinks does not disable other capabilities', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    markCapabilityDisabled('dataforseo', 'backlinks');

    // A non-backlinks capability is unaffected by the backlinks breaker.
    expect(getProviderForCapability('domain_overview', 'dataforseo')).toBe(dfs);
    expect(getProviderForCapability('backlinks', 'dataforseo')).toBeNull();
  });

  it('getBacklinksProvider returns null when the backlinks breaker is tripped', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    markCapabilityDisabled('dataforseo', 'backlinks');
    const provider = getBacklinksProvider('dataforseo');
    expect(provider).toBeNull();
  });

  it('treats legacy semrush backlink preference as DataForSEO', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    const provider = getBacklinksProvider('semrush' as unknown as ProviderName);
    expect(provider).toBe(dfs);
  });
});

describe('getConfiguredProvider', () => {
  beforeEach(() => {
    _resetRegistryForTest();
  });

  it('defaults to DataForSEO when both providers are configured and no preference is supplied', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    expect(getConfiguredProvider()).toBe(dfs);
  });

  it('treats legacy semrush preference as DataForSEO', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    expect(getConfiguredProvider('semrush' as unknown as ProviderName)).toBe(dfs);
  });
});
