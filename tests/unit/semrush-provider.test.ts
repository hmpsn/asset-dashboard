import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsConfigured = vi.fn();
const mockGetKeywordOverview = vi.fn();
const mockGetRelatedKeywords = vi.fn();
const mockGetQuestionKeywords = vi.fn();
const mockGetDomainOrganicKeywords = vi.fn();
const mockGetUrlOrganicKeywords = vi.fn();
const mockGetDomainOverview = vi.fn();
const mockGetOrganicCompetitors = vi.fn();
const mockGetKeywordGap = vi.fn();
const mockGetBacklinksOverview = vi.fn();
const mockGetTopReferringDomains = vi.fn();

vi.mock('../../server/semrush.js', () => ({
  isSemrushConfigured: mockIsConfigured,
  getKeywordOverview: mockGetKeywordOverview,
  getRelatedKeywords: mockGetRelatedKeywords,
  getQuestionKeywords: mockGetQuestionKeywords,
  getDomainOrganicKeywords: mockGetDomainOrganicKeywords,
  getUrlOrganicKeywords: mockGetUrlOrganicKeywords,
  getDomainOverview: mockGetDomainOverview,
  getOrganicCompetitors: mockGetOrganicCompetitors,
  getKeywordGap: mockGetKeywordGap,
  getBacklinksOverview: mockGetBacklinksOverview,
  getTopReferringDomains: mockGetTopReferringDomains,
}));

describe('SemrushProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the expected provider name', async () => {
    const { SemrushProvider } = await import('../../server/providers/semrush-provider.js');
    expect(new SemrushProvider().name).toBe('semrush');
  });

  it('delegates isConfigured to isSemrushConfigured', async () => {
    mockIsConfigured.mockReturnValue(true);
    const { SemrushProvider } = await import('../../server/providers/semrush-provider.js');

    const configured = new SemrushProvider().isConfigured();

    expect(configured).toBe(true);
    expect(mockIsConfigured).toHaveBeenCalledTimes(1);
  });

  it('delegates getKeywordMetrics with database default and ignores locationCode', async () => {
    const expected = [{ keyword: 'hvac', volume: 100 }];
    mockGetKeywordOverview.mockResolvedValue(expected);
    const { SemrushProvider } = await import('../../server/providers/semrush-provider.js');

    const result = await new SemrushProvider().getKeywordMetrics(['hvac'], 'ws_1', undefined, 2840);

    expect(result).toBe(expected);
    expect(mockGetKeywordOverview).toHaveBeenCalledWith(['hvac'], 'ws_1', 'us');
  });

  it('delegates related/question keywords with default limit/database', async () => {
    mockGetRelatedKeywords.mockResolvedValue([{ keyword: 'hvac repair' }]);
    mockGetQuestionKeywords.mockResolvedValue([{ keyword: 'how much is hvac repair' }]);
    const { SemrushProvider } = await import('../../server/providers/semrush-provider.js');
    const provider = new SemrushProvider();

    await provider.getRelatedKeywords('hvac', 'ws_1');
    await provider.getQuestionKeywords('hvac', 'ws_1');

    expect(mockGetRelatedKeywords).toHaveBeenCalledWith('hvac', 'ws_1', 20, 'us');
    expect(mockGetQuestionKeywords).toHaveBeenCalledWith('hvac', 'ws_1', 20, 'us');
  });

  it('delegates domain/url keyword calls with provided limit/database overrides', async () => {
    mockGetDomainOrganicKeywords.mockResolvedValue([{ keyword: 'plumber austin' }]);
    mockGetUrlOrganicKeywords.mockResolvedValue([{ keyword: 'pipe repair' }]);
    const { SemrushProvider } = await import('../../server/providers/semrush-provider.js');
    const provider = new SemrushProvider();

    await provider.getDomainKeywords('example.com', 'ws_1', 250, 'uk');
    await provider.getUrlKeywords('https://example.com/services', 'ws_1', 30, 'de');

    expect(mockGetDomainOrganicKeywords).toHaveBeenCalledWith('example.com', 'ws_1', 250, 'uk');
    expect(mockGetUrlOrganicKeywords).toHaveBeenCalledWith('https://example.com/services', 'ws_1', 30, 'de');
  });

  it('delegates overview/competitor/gap/backlinks/referring-domain methods unchanged', async () => {
    const overview = { organicTraffic: 1234 };
    const competitors = [{ domain: 'competitor.com' }];
    const gaps = [{ keyword: 'best hvac austin' }];
    const backlinks = { referringDomains: 87 };
    const referring = [{ domain: 'ref1.com' }];

    mockGetDomainOverview.mockResolvedValue(overview);
    mockGetOrganicCompetitors.mockResolvedValue(competitors);
    mockGetKeywordGap.mockResolvedValue(gaps);
    mockGetBacklinksOverview.mockResolvedValue(backlinks);
    mockGetTopReferringDomains.mockResolvedValue(referring);

    const { SemrushProvider } = await import('../../server/providers/semrush-provider.js');
    const provider = new SemrushProvider();

    await expect(provider.getDomainOverview('example.com', 'ws_1')).resolves.toBe(overview);
    await expect(provider.getCompetitors('example.com', 'ws_1', 9, 'fr')).resolves.toBe(competitors);
    await expect(provider.getKeywordGap('example.com', ['a.com', 'b.com'], 'ws_1', 11, 'ca')).resolves.toBe(gaps);
    await expect(provider.getBacklinksOverview('example.com', 'ws_1')).resolves.toBe(backlinks);
    await expect(provider.getReferringDomains('example.com', 'ws_1', 15, 'br')).resolves.toBe(referring);

    expect(mockGetDomainOverview).toHaveBeenCalledWith('example.com', 'ws_1', 'us');
    expect(mockGetOrganicCompetitors).toHaveBeenCalledWith('example.com', 'ws_1', 9, 'fr');
    expect(mockGetKeywordGap).toHaveBeenCalledWith('example.com', ['a.com', 'b.com'], 'ws_1', 11, 'ca');
    expect(mockGetBacklinksOverview).toHaveBeenCalledWith('example.com', 'ws_1', 'us');
    expect(mockGetTopReferringDomains).toHaveBeenCalledWith('example.com', 'ws_1', 15, 'br');
  });
});
