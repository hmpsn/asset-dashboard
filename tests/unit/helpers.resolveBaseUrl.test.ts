import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock getSiteSubdomain before importing url-helpers
vi.mock('../../server/webflow-pages.js', () => ({
  getSiteSubdomain: vi.fn(),
}));

import { resolveBaseUrl } from '../../server/url-helpers';
import { getSiteSubdomain } from '../../server/webflow-pages';

const mockGetSiteSubdomain = vi.mocked(getSiteSubdomain);

describe('resolveBaseUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns liveDomain as-is if it already has https://', async () => {
    const ws = { liveDomain: 'https://example.com' };
    expect(await resolveBaseUrl(ws)).toBe('https://example.com');
  });

  it('prepends https:// to bare liveDomain', async () => {
    const ws = { liveDomain: 'example.com' };
    expect(await resolveBaseUrl(ws)).toBe('https://example.com');
  });

  it('falls back to webflow subdomain when no liveDomain', async () => {
    mockGetSiteSubdomain.mockResolvedValue('mysite');
    const ws = { webflowSiteId: 'site-abc' };
    expect(await resolveBaseUrl(ws)).toBe('https://mysite.webflow.io');
    expect(mockGetSiteSubdomain).toHaveBeenCalledWith('site-abc', undefined);
  });

  it('passes tokenOverride to getSiteSubdomain', async () => {
    mockGetSiteSubdomain.mockResolvedValue('mysite');
    const ws = { webflowSiteId: 'site-abc' };
    await resolveBaseUrl(ws, 'tok-override');
    expect(mockGetSiteSubdomain).toHaveBeenCalledWith('site-abc', 'tok-override');
  });

  it('returns empty string when no liveDomain and getSiteSubdomain returns null', async () => {
    mockGetSiteSubdomain.mockResolvedValue(null);
    const ws = { webflowSiteId: 'site-abc' };
    expect(await resolveBaseUrl(ws)).toBe('');
  });

  it('returns empty string when workspace has neither liveDomain nor webflowSiteId', async () => {
    const ws = {};
    expect(await resolveBaseUrl(ws)).toBe('');
  });
});
