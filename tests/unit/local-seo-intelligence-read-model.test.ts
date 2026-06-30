import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildLocalSeoKeywordCandidates: vi.fn(),
  listLocalSeoMarkets: vi.fn(),
  buildLocalSeoKeywordVisibilitySummaryByKey: vi.fn(),
  listLatestLocalVisibilitySnapshots: vi.fn(),
  getLocalSeoServiceGaps: vi.fn(),
  getLocalSeoCompetitorBrands: vi.fn(),
}));

vi.mock('../../server/domains/local-seo/candidate-service.js', () => ({
  buildLocalSeoKeywordCandidates: mocks.buildLocalSeoKeywordCandidates,
}));

vi.mock('../../server/domains/local-seo/configuration-service.js', () => ({
  listLocalSeoMarkets: mocks.listLocalSeoMarkets,
}));

vi.mock('../../server/domains/local-seo/snapshot-store.js', () => ({
  buildLocalSeoKeywordVisibilitySummaryByKey: mocks.buildLocalSeoKeywordVisibilitySummaryByKey,
  listLatestLocalVisibilitySnapshots: mocks.listLatestLocalVisibilitySnapshots,
}));

vi.mock('../../server/domains/local-seo/visibility-read-model.js', () => ({
  getLocalSeoServiceGaps: mocks.getLocalSeoServiceGaps,
  getLocalSeoCompetitorBrands: mocks.getLocalSeoCompetitorBrands,
}));

import { loadLocalSeoIntelligenceInputs } from '../../server/domains/local-seo/intelligence-read-model.js';

describe('local SEO intelligence read model', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buildLocalSeoKeywordCandidates.mockReturnValue([]);
    mocks.listLocalSeoMarkets.mockReturnValue([]);
    mocks.buildLocalSeoKeywordVisibilitySummaryByKey.mockReturnValue(new Map());
    mocks.listLatestLocalVisibilitySnapshots.mockReturnValue([]);
    mocks.getLocalSeoServiceGaps.mockReturnValue([]);
    mocks.getLocalSeoCompetitorBrands.mockReturnValue([]);
  });

  it('short-circuits heavy local SEO reads when no markets are configured', async () => {
    mocks.listLocalSeoMarkets.mockReturnValue([]);

    const result = await loadLocalSeoIntelligenceInputs('ws-no-markets');

    expect(result).toMatchObject({
      markets: [],
      candidates: [],
      latestSnapshots: [],
      serviceGaps: [],
      competitorBrands: [],
    });
    expect(result.visibilityByKey.size).toBe(0);
    expect(mocks.buildLocalSeoKeywordCandidates).not.toHaveBeenCalled();
    expect(mocks.buildLocalSeoKeywordVisibilitySummaryByKey).not.toHaveBeenCalled();
    expect(mocks.listLatestLocalVisibilitySnapshots).not.toHaveBeenCalled();
    expect(mocks.getLocalSeoServiceGaps).not.toHaveBeenCalled();
    expect(mocks.getLocalSeoCompetitorBrands).not.toHaveBeenCalled();
  });

  it('keeps required market/candidate/visibility reads while optional inputs degrade to empty arrays', async () => {
    const market = {
      id: 'market-austin',
      workspaceId: 'ws-local',
      label: 'Austin, TX',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      source: 'admin_override',
      status: 'active',
      isPrimary: true,
      createdAt: '',
      updatedAt: '',
    };
    const candidate = {
      keyword: 'austin dentist',
      normalizedKeyword: 'austin dentist',
      source: 'local_variant',
      sourceLabel: 'Local candidate',
      score: 80,
      selected: false,
      reasons: [],
      intent: 'transactional',
    };
    const visibilityByKey = new Map([['austin dentist', { keyword: 'austin dentist', markets: [] }]]);
    mocks.listLocalSeoMarkets.mockReturnValue([market]);
    mocks.buildLocalSeoKeywordCandidates.mockReturnValue([candidate]);
    mocks.buildLocalSeoKeywordVisibilitySummaryByKey.mockReturnValue(visibilityByKey);
    mocks.listLatestLocalVisibilitySnapshots.mockImplementation(() => {
      throw new Error('snapshots unavailable');
    });
    mocks.getLocalSeoServiceGaps.mockImplementation(() => {
      throw new Error('service gaps unavailable');
    });
    mocks.getLocalSeoCompetitorBrands.mockImplementation(() => {
      throw new Error('competitors unavailable');
    });

    const result = await loadLocalSeoIntelligenceInputs('ws-local');

    expect(result.markets).toEqual([market]);
    expect(result.candidates).toEqual([candidate]);
    expect(result.visibilityByKey).toBe(visibilityByKey);
    expect(result.latestSnapshots).toEqual([]);
    expect(result.serviceGaps).toEqual([]);
    expect(result.competitorBrands).toEqual([]);
  });
});
