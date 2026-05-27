import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllGscPages: vi.fn(),
  getGA4TopPages: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  isProgrammingError: vi.fn(),
}));

vi.mock('../../server/search-console.js', () => ({
  getAllGscPages: mocks.getAllGscPages,
}));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4TopPages: mocks.getGA4TopPages,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: mocks.logWarn,
    debug: mocks.logDebug,
  }),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

const {
  getAuditTrafficForWorkspace,
  clearAuditTrafficCache,
} = await import('../../server/audit-traffic.js');

describe('audit-traffic service', () => {
  beforeEach(() => {
    clearAuditTrafficCache();
    vi.clearAllMocks();
    mocks.isProgrammingError.mockReturnValue(false);
  });

  it('merges GSC and GA4 traffic using normalized paths', async () => {
    mocks.getAllGscPages.mockResolvedValue([
      { page: 'https://example.com/services/', clicks: 10, impressions: 120 },
      { page: 'https://example.com/services', clicks: 4, impressions: 40 },
      { page: 'malformed-url', clicks: 1, impressions: 10 },
    ]);
    mocks.getGA4TopPages.mockResolvedValue([
      { path: '/services', pageviews: 200, users: 80 },
      { path: 'services', pageviews: 30, users: 10 },
    ]);

    const map = await getAuditTrafficForWorkspace({
      id: 'ws_audit_1',
      webflowSiteId: 'site_1',
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'ga4_1',
    });

    expect(map['/services']).toEqual({
      clicks: 14,
      impressions: 160,
      pageviews: 230,
      sessions: 90,
    });
  });

  it('skips malformed GSC page URLs', async () => {
    mocks.getAllGscPages.mockResolvedValue([
      { page: 'malformed-url', clicks: 1, impressions: 10 },
      { page: 'https://example.com/services', clicks: 2, impressions: 20 },
    ]);
    mocks.getGA4TopPages.mockResolvedValue([]);

    const map = await getAuditTrafficForWorkspace({
      id: 'ws_audit_malformed',
      gscPropertyUrl: 'sc-domain:example.com',
    });

    expect(map).toEqual({
      '/services': {
        clicks: 2,
        impressions: 20,
        pageviews: 0,
        sessions: 0,
      },
    });
  });

  it('degrades gracefully when providers fail', async () => {
    mocks.getAllGscPages.mockRejectedValue(new Error('gsc-down'));
    mocks.getGA4TopPages.mockRejectedValue(new Error('ga4-down'));

    const map = await getAuditTrafficForWorkspace({
      id: 'ws_audit_2',
      webflowSiteId: 'site_2',
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'ga4_2',
    });

    expect(map).toEqual({});
    expect(mocks.logDebug).toHaveBeenCalledTimes(2);
  });

  it('uses cache for repeated reads within TTL', async () => {
    mocks.getAllGscPages.mockResolvedValue([
      { page: 'https://example.com/', clicks: 3, impressions: 30 },
    ]);
    mocks.getGA4TopPages.mockResolvedValue([
      { path: '/', pageviews: 12, users: 7 },
    ]);

    const ws = {
      id: 'ws_audit_3',
      webflowSiteId: 'site_3',
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'ga4_3',
    };

    const first = await getAuditTrafficForWorkspace(ws);
    const second = await getAuditTrafficForWorkspace(ws);

    expect(first).toEqual(second);
    expect(mocks.getAllGscPages).toHaveBeenCalledTimes(1);
    expect(mocks.getGA4TopPages).toHaveBeenCalledTimes(1);
  });

  it('does not require webflowSiteId when analytics integrations exist', async () => {
    mocks.getAllGscPages.mockResolvedValue([
      { page: 'https://example.com/pricing', clicks: 6, impressions: 60 },
    ]);
    mocks.getGA4TopPages.mockResolvedValue([
      { path: '/pricing', pageviews: 14, users: 9 },
    ]);

    const map = await getAuditTrafficForWorkspace({
      id: 'ws_audit_no_webflow',
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'ga4_no_webflow',
    });

    expect(map['/pricing']).toEqual({
      clicks: 6,
      impressions: 60,
      pageviews: 14,
      sessions: 9,
    });
  });
});
