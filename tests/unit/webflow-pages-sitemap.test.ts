import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchPublicWebText: vi.fn(),
  fetchPublicWebTextBounded: vi.fn(),
}));

vi.mock('../../server/external-fetch.js', () => ({
  fetchPublicWebText: mocks.fetchPublicWebText,
  fetchPublicWebTextBounded: mocks.fetchPublicWebTextBounded,
}));

import { discoverSitemapUrls } from '../../server/webflow-pages.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('discoverSitemapUrls generation completeness', () => {
  it('rejects a partial sitemap index when a required child is unavailable', async () => {
    mocks.fetchPublicWebText
      .mockResolvedValueOnce(`
        <sitemapindex>
          <loc>https://example.com/static-sitemap.xml</loc>
          <loc>https://example.com/cms-sitemap.xml</loc>
        </sitemapindex>
      `)
      .mockResolvedValueOnce(`
        <urlset><loc>https://example.com/</loc></urlset>
      `)
      .mockRejectedValueOnce(new Error('CMS sitemap unavailable'));

    await expect(discoverSitemapUrls('https://example.com/', {
      requireComplete: true,
    })).rejects.toThrow('CMS sitemap unavailable');
    expect(mocks.fetchPublicWebText).toHaveBeenCalledTimes(3);
  });

  it('preserves the legacy best-effort result for non-generation callers', async () => {
    mocks.fetchPublicWebText
      .mockResolvedValueOnce(`
        <sitemapindex>
          <loc>https://example.com/static-sitemap.xml</loc>
          <loc>https://example.com/cms-sitemap.xml</loc>
        </sitemapindex>
      `)
      .mockResolvedValueOnce(`
        <urlset><loc>https://example.com/</loc></urlset>
      `)
      .mockRejectedValueOnce(new Error('CMS sitemap unavailable'));

    await expect(discoverSitemapUrls('https://example.com/')).resolves.toEqual([
      'https://example.com/',
    ]);
  });

  it('fails closed when a strict sitemap index exceeds its document budget', async () => {
    mocks.fetchPublicWebText.mockResolvedValueOnce(`
      <sitemapindex>
        <loc>https://example.com/static-sitemap.xml</loc>
      </sitemapindex>
    `);

    await expect(discoverSitemapUrls('https://example.com', {
      requireComplete: true,
      maxDocuments: 1,
    })).rejects.toThrow('Sitemap document limit exceeded');
    expect(mocks.fetchPublicWebText).toHaveBeenCalledOnce();
  });

  it('fails closed before returning more locations than the strict census budget', async () => {
    mocks.fetchPublicWebText.mockResolvedValueOnce(`
      <urlset>
        <loc>https://example.com/one</loc>
        <loc>https://example.com/two</loc>
      </urlset>
    `);

    await expect(discoverSitemapUrls('https://example.com', {
      requireComplete: true,
      maxLocations: 1,
    })).rejects.toThrow('Sitemap location limit exceeded');
  });

  it('uses the incremental bounded reader for strict per-document byte limits', async () => {
    mocks.fetchPublicWebTextBounded.mockRejectedValueOnce(
      new Error('External response exceeded the byte limit'),
    );

    await expect(discoverSitemapUrls('https://example.com', {
      requireComplete: true,
      maxDocumentBytes: 1_024,
    })).rejects.toThrow('External response exceeded the byte limit');
    expect(mocks.fetchPublicWebTextBounded).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/sitemap.xml' }),
      1_024,
    );
    expect(mocks.fetchPublicWebText).not.toHaveBeenCalled();
  });
});
