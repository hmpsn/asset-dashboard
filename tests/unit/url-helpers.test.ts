import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSiteSubdomain: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../server/webflow-pages.js', () => ({
  getSiteSubdomain: mocks.getSiteSubdomain,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ debug: mocks.debug, warn: mocks.warn, info: vi.fn(), error: vi.fn() }),
}));

import { resolveBaseUrl } from '../../server/url-helpers.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveBaseUrl', () => {
  it('returns normalized liveDomain when present without protocol', async () => {
    const result = await resolveBaseUrl({ liveDomain: 'example.com' });
    expect(result).toBe('https://example.com');
    expect(mocks.getSiteSubdomain).not.toHaveBeenCalled();
  });

  it('returns liveDomain as-is when already absolute', async () => {
    const result = await resolveBaseUrl({ liveDomain: 'https://example.com' });
    expect(result).toBe('https://example.com');
    expect(mocks.getSiteSubdomain).not.toHaveBeenCalled();
  });

  it('uses Webflow subdomain when no liveDomain is present', async () => {
    mocks.getSiteSubdomain.mockResolvedValue('acme');
    const result = await resolveBaseUrl({ webflowSiteId: 'site_1' }, 'token_1');

    expect(mocks.getSiteSubdomain).toHaveBeenCalledWith('site_1', 'token_1');
    expect(result).toBe('https://acme.webflow.io');
  });

  it('returns empty string when Webflow subdomain lookup returns null', async () => {
    mocks.getSiteSubdomain.mockResolvedValue(null);
    const result = await resolveBaseUrl({ webflowSiteId: 'site_2' });

    expect(result).toBe('');
  });

  it('logs debug and returns empty string when token is not configured', async () => {
    mocks.getSiteSubdomain.mockRejectedValue(new Error('Webflow token not configured'));
    const result = await resolveBaseUrl({ webflowSiteId: 'site_3' });

    expect(result).toBe('');
    expect(mocks.debug).toHaveBeenCalledWith(
      { siteId: 'site_3' },
      'resolveBaseUrl: no Webflow token, returning empty',
    );
  });

  it('logs warn and returns empty string for non-token lookup failures', async () => {
    mocks.getSiteSubdomain.mockRejectedValue(new Error('request failed 500'));
    const result = await resolveBaseUrl({ webflowSiteId: 'site_4' });

    expect(result).toBe('');
    expect(mocks.warn).toHaveBeenCalledWith(
      { siteId: 'site_4', err: 'request failed 500' },
      'resolveBaseUrl: subdomain lookup failed, returning empty',
    );
  });
});
