import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWebflowFetch } = vi.hoisted(() => ({
  mockWebflowFetch: vi.fn(),
}));

vi.mock('../../server/webflow-client.js', () => ({
  webflowFetch: mockWebflowFetch,
}));

import { getWebflowSiteDomainInfo, normalizeWebflowDomainUrl } from '../../server/webflow-domains.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeWebflowDomainUrl', () => {
  it('adds https to bare domains', () => {
    expect(normalizeWebflowDomainUrl('example.com')).toBe('https://example.com');
  });

  it('keeps explicit protocols and trims blanks', () => {
    expect(normalizeWebflowDomainUrl(' http://staging.example.com ')).toBe('http://staging.example.com');
    expect(normalizeWebflowDomainUrl('https://example.com')).toBe('https://example.com');
  });

  it('returns null for empty values', () => {
    expect(normalizeWebflowDomainUrl('')).toBeNull();
    expect(normalizeWebflowDomainUrl(null)).toBeNull();
  });
});

describe('getWebflowSiteDomainInfo', () => {
  it('uses a timed site fetch and recovers custom domains from the dedicated endpoint', async () => {
    mockWebflowFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ shortName: 'sample-site' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ customDomains: [{ url: 'example.com' }] }),
      });

    const result = await getWebflowSiteDomainInfo('site-1', 'token-1');
    expect(mockWebflowFetch).toHaveBeenNthCalledWith(
      1,
      '/sites/site-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'token-1',
    );
    expect(mockWebflowFetch).toHaveBeenNthCalledWith(
      2,
      '/sites/site-1/custom_domains',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'token-1',
    );
    expect(result).toEqual({
      staging: 'https://sample-site.webflow.io',
      customDomains: ['https://example.com'],
      defaultDomain: 'https://example.com',
    });
  });

  it('keeps staging domain info when custom-domain lookup fails', async () => {
    mockWebflowFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ shortName: 'sample-site' }),
      })
      .mockRejectedValueOnce(new Error('network down'));

    const result = await getWebflowSiteDomainInfo('site-1', 'token-1');
    expect(result).toEqual({
      staging: 'https://sample-site.webflow.io',
      customDomains: [],
      defaultDomain: 'https://sample-site.webflow.io',
    });
  });
});
