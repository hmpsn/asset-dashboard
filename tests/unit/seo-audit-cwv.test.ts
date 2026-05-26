import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---- hoisted mocks --------------------------------------------------------

const { mockRunSinglePageSpeed } = vi.hoisted(() => ({
  mockRunSinglePageSpeed: vi.fn(),
}));

vi.mock('../../server/pagespeed.js', () => ({
  runSinglePageSpeed: mockRunSinglePageSpeed,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---- imports ---------------------------------------------------------------

import { runHomepageCwv } from '../../server/seo-audit-cwv.js';
import type { SeoIssue } from '../../server/audit-page.js';

// ---------------------------------------------------------------------------

function makePsiResult(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://example.com',
    page: 'Homepage',
    strategy: 'mobile' as const,
    score: 85,
    vitals: { LCP: 2.1, FID: null, CLS: 0.08, FCP: 1.2, INP: 150, SI: null, TBT: null, TTI: null },
    fieldDataAvailable: true,
    cwvAssessment: {
      assessment: 'good' as const,
      fieldDataAvailable: true,
      metrics: {
        LCP: { value: 2.1, rating: 'good' as const },
        INP: { value: 150, rating: 'needs-improvement' as const },
        CLS: { value: 0.08, rating: 'good' as const },
      },
    },
    opportunities: [],
    diagnostics: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('runHomepageCwv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty CwvSummary when GOOGLE_PSI_KEY is not set', async () => {
    const savedKey = process.env.GOOGLE_PSI_KEY;
    delete process.env.GOOGLE_PSI_KEY;

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    expect(result).toEqual({});
    expect(mockRunSinglePageSpeed).not.toHaveBeenCalled();
    process.env.GOOGLE_PSI_KEY = savedKey;
  });

  it('returns empty CwvSummary when homepageUrl is empty string', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: '', siteWideIssues });

    expect(result).toEqual({});
    expect(mockRunSinglePageSpeed).not.toHaveBeenCalled();

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('populates mobile and desktop CwvStrategyResult when PSI succeeds', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    const mobilePsi = makePsiResult({ strategy: 'mobile', score: 85 });
    const desktopPsi = makePsiResult({ strategy: 'desktop', score: 92 });
    mockRunSinglePageSpeed
      .mockResolvedValueOnce(mobilePsi)
      .mockResolvedValueOnce(desktopPsi);

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    expect(result.mobile).toBeDefined();
    expect(result.desktop).toBeDefined();
    expect(result.mobile?.lighthouseScore).toBe(85);
    expect(result.desktop?.lighthouseScore).toBe(92);

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('maps cwvAssessment fields to CwvStrategyResult correctly', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    const mobilePsi = makePsiResult({
      cwvAssessment: {
        assessment: 'needs-improvement',
        fieldDataAvailable: true,
        metrics: {
          LCP: { value: 3.5, rating: 'needs-improvement' },
          INP: { value: 300, rating: 'needs-improvement' },
          CLS: { value: 0.15, rating: 'needs-improvement' },
        },
      },
    });
    mockRunSinglePageSpeed
      .mockResolvedValueOnce(mobilePsi)
      .mockResolvedValueOnce(null);

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    expect(result.mobile?.assessment).toBe('needs-improvement');
    expect(result.mobile?.fieldDataAvailable).toBe(true);
    expect(result.mobile?.metrics.LCP.value).toBe(3.5);

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('pushes cwv-lab issues to siteWideIssues for each available strategy', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    mockRunSinglePageSpeed
      .mockResolvedValueOnce(makePsiResult({ score: 85 }))
      .mockResolvedValueOnce(makePsiResult({ strategy: 'desktop', score: 56 }));

    const siteWideIssues: SeoIssue[] = [];
    await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    const cwvIssues = siteWideIssues.filter(i => i.check === 'cwv-lab');
    expect(cwvIssues).toHaveLength(2);
    expect(cwvIssues[0].severity).toBe('info');
    expect(cwvIssues[0].message).toContain('Mobile');
    expect(cwvIssues[1].message).toContain('Desktop');

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('labels score ≥90 as good', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    mockRunSinglePageSpeed
      .mockResolvedValueOnce(makePsiResult({ score: 95 }))
      .mockResolvedValueOnce(null);

    const siteWideIssues: SeoIssue[] = [];
    await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    const cwvIssue = siteWideIssues.find(i => i.check === 'cwv-lab');
    expect(cwvIssue?.message).toContain('good');

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('labels score 50–89 as needs improvement', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    mockRunSinglePageSpeed
      .mockResolvedValueOnce(makePsiResult({ score: 65 }))
      .mockResolvedValueOnce(null);

    const siteWideIssues: SeoIssue[] = [];
    await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    const cwvIssue = siteWideIssues.find(i => i.check === 'cwv-lab');
    expect(cwvIssue?.message).toContain('needs improvement');

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('labels score <50 as poor', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    mockRunSinglePageSpeed
      .mockResolvedValueOnce(makePsiResult({ score: 30 }))
      .mockResolvedValueOnce(null);

    const siteWideIssues: SeoIssue[] = [];
    await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    const cwvIssue = siteWideIssues.find(i => i.check === 'cwv-lab');
    expect(cwvIssue?.message).toContain('poor');

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('falls back to vitals when cwvAssessment is absent', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    const psiWithoutCwv = {
      url: 'https://example.com',
      page: 'Homepage',
      strategy: 'mobile' as const,
      score: 70,
      vitals: { LCP: 3.0, FID: null, CLS: 0.1, FCP: 1.5, INP: 200, SI: null, TBT: null, TTI: null },
      fieldDataAvailable: false,
      cwvAssessment: undefined,
      opportunities: [],
      diagnostics: [],
      fetchedAt: new Date().toISOString(),
    };

    mockRunSinglePageSpeed
      .mockResolvedValueOnce(psiWithoutCwv)
      .mockResolvedValueOnce(null);

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    // Should still populate mobile with no-data assessment
    expect(result.mobile?.assessment).toBe('no-data');
    expect(result.mobile?.fieldDataAvailable).toBe(false);
    expect(result.mobile?.metrics.LCP.value).toBe(3.0);

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('handles PSI failure gracefully without throwing', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    mockRunSinglePageSpeed.mockRejectedValue(new Error('Network error'));

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    expect(result).toEqual({});
    expect(siteWideIssues).toHaveLength(0);

    delete process.env.GOOGLE_PSI_KEY;
  });

  it('only populates desktop when mobile PSI returns null', async () => {
    process.env.GOOGLE_PSI_KEY = 'test-psi-key';

    mockRunSinglePageSpeed
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePsiResult({ strategy: 'desktop', score: 90 }));

    const siteWideIssues: SeoIssue[] = [];
    const result = await runHomepageCwv({ homepageUrl: 'https://example.com', siteWideIssues });

    expect(result.mobile).toBeUndefined();
    expect(result.desktop?.lighthouseScore).toBe(90);

    delete process.env.GOOGLE_PSI_KEY;
  });
});
