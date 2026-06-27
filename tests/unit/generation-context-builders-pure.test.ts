// tests/unit/generation-context-builders-pure.test.ts
//
// Pure unit tests for generation-context-builders.ts.
// Focuses on:
//   - withActiveLocalSeoSlice: slice widening logic (not yet covered by
//     generation-context-builders.test.ts which only tests it indirectly
//     through buildContentGenerationContext/buildRecommendationGenerationContext)
//
// Does NOT re-test:
//   - buildContentGenerationContext / buildRecommendationGenerationContext end-to-end
//     behaviour (covered by tests/unit/generation-context-builders.test.ts)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntelligenceSlice } from '../../shared/types/intelligence.js';

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../server/intelligence/formatters.js', () => ({
  formatForPrompt: vi.fn().mockReturnValue(''),
  formatKeywordsForPrompt: vi.fn().mockReturnValue(''),
  formatKnowledgeBaseForPrompt: vi.fn().mockReturnValue(''),
  formatPageMapForPrompt: vi.fn().mockReturnValue(''),
}));

vi.mock('../../server/intelligence/persona-format.js', () => ({
  formatPersonasForPrompt: vi.fn().mockReturnValue(''),
}));

const listLocalSeoMarketsMock = vi.fn(() => []);

vi.mock('../../server/domains/local-seo/configuration-service.js', () => ({
  listLocalSeoMarkets: (...args: unknown[]) => listLocalSeoMarketsMock(...args),
}));

import { withActiveLocalSeoSlice } from '../../server/intelligence/generation-context-builders.js';
import type { LocalSeoMarket } from '../../shared/types/local-seo.js';

function makeMarket(overrides: Partial<LocalSeoMarket> = {}): LocalSeoMarket {
  return {
    id: 'market-1',
    workspaceId: 'ws-test',
    label: 'Austin, TX',
    city: 'Austin',
    stateOrRegion: 'TX',
    country: 'US',
    source: 'admin_override',
    status: 'active',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('withActiveLocalSeoSlice', () => {
  beforeEach(() => {
    listLocalSeoMarketsMock.mockReset();
    listLocalSeoMarketsMock.mockReturnValue([]);
  });

  it('returns the original slices unchanged when includeLocalSeo is false', async () => {
    const slices: readonly IntelligenceSlice[] = ['seoContext', 'insights'];
    const result = await withActiveLocalSeoSlice('ws-1', slices, false);
    expect(result).toBe(slices); // same reference
    expect(listLocalSeoMarketsMock).not.toHaveBeenCalled();
  });

  it('returns the original slices unchanged when localSeo is already included', async () => {
    const slices: readonly IntelligenceSlice[] = ['seoContext', 'localSeo'];
    const result = await withActiveLocalSeoSlice('ws-1', slices, true);
    expect(result).toBe(slices); // same reference — no need to check markets
    expect(listLocalSeoMarketsMock).not.toHaveBeenCalled();
  });

  it('returns the original slices unchanged when no active markets exist', async () => {
    listLocalSeoMarketsMock.mockReturnValue([]);
    const slices: readonly IntelligenceSlice[] = ['seoContext', 'insights'];
    const result = await withActiveLocalSeoSlice('ws-1', slices);
    expect(result).toEqual(slices);
    expect(result).not.toContain('localSeo');
  });

  it('appends localSeo when there is at least one active market', async () => {
    listLocalSeoMarketsMock.mockReturnValue([makeMarket({ status: 'active' })]);
    const slices: readonly IntelligenceSlice[] = ['seoContext', 'insights'];
    const result = await withActiveLocalSeoSlice('ws-1', slices);
    expect(result).toContain('localSeo');
    expect(result).toEqual(['seoContext', 'insights', 'localSeo']);
  });

  it('does NOT append localSeo when all markets are inactive', async () => {
    listLocalSeoMarketsMock.mockReturnValue([
      makeMarket({ status: 'inactive' }),
      makeMarket({ id: 'market-2', status: 'needs_review' }),
    ]);
    const slices: readonly IntelligenceSlice[] = ['seoContext'];
    const result = await withActiveLocalSeoSlice('ws-1', slices);
    expect(result).not.toContain('localSeo');
  });

  it('appends localSeo when at least one market is active even among inactive ones', async () => {
    listLocalSeoMarketsMock.mockReturnValue([
      makeMarket({ status: 'inactive' }),
      makeMarket({ id: 'market-2', status: 'active' }),
      makeMarket({ id: 'market-3', status: 'needs_review' }),
    ]);
    const slices: readonly IntelligenceSlice[] = ['seoContext'];
    const result = await withActiveLocalSeoSlice('ws-1', slices);
    expect(result).toContain('localSeo');
  });

  it('defaults includeLocalSeo to true when the argument is omitted', async () => {
    listLocalSeoMarketsMock.mockReturnValue([makeMarket({ status: 'active' })]);
    const slices: readonly IntelligenceSlice[] = ['seoContext'];
    // Call without the third argument (defaults to true)
    const result = await withActiveLocalSeoSlice('ws-1', slices);
    expect(result).toContain('localSeo');
  });

  it('passes the workspaceId through to listLocalSeoMarkets', async () => {
    listLocalSeoMarketsMock.mockReturnValue([]);
    const slices: readonly IntelligenceSlice[] = ['seoContext'];
    await withActiveLocalSeoSlice('ws-specific-id', slices, true);
    expect(listLocalSeoMarketsMock).toHaveBeenCalledWith('ws-specific-id');
  });

  it('returns the original slices (not a new array) when localSeo is not appended', async () => {
    listLocalSeoMarketsMock.mockReturnValue([]);
    const slices: readonly IntelligenceSlice[] = ['seoContext', 'insights'];
    const result = await withActiveLocalSeoSlice('ws-1', slices, true);
    // No active markets → no widening → same reference preserved
    expect(result).toBe(slices);
  });

  it('returns a new array (not the original) when localSeo is appended', async () => {
    listLocalSeoMarketsMock.mockReturnValue([makeMarket({ status: 'active' })]);
    const slices: readonly IntelligenceSlice[] = ['seoContext'];
    const result = await withActiveLocalSeoSlice('ws-1', slices, true);
    expect(result).not.toBe(slices); // New array
    expect(result.length).toBe(slices.length + 1);
  });

  it('falls back to no-markets (returns original slices) when listLocalSeoMarkets throws', async () => {
    // The underlying hasActiveLocalMarkets catches errors gracefully
    listLocalSeoMarketsMock.mockImplementation(() => {
      throw new Error('DB unavailable');
    });
    const slices: readonly IntelligenceSlice[] = ['seoContext', 'insights'];
    // Should not throw and should return original slices
    const result = await withActiveLocalSeoSlice('ws-1', slices, true);
    expect(result).toEqual(slices);
    expect(result).not.toContain('localSeo');
  });

  it('does not add localSeo twice if called twice for the same workspace', async () => {
    listLocalSeoMarketsMock.mockReturnValue([makeMarket({ status: 'active' })]);
    const slices: readonly IntelligenceSlice[] = ['seoContext'];
    const once = await withActiveLocalSeoSlice('ws-1', slices, true);
    // Calling again with the already-widened slice should be idempotent
    const twice = await withActiveLocalSeoSlice('ws-1', once, true);
    expect(twice.filter(s => s === 'localSeo').length).toBe(1);
  });
});
