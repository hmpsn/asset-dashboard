import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildWorkspaceIntelligence: vi.fn(),
  listWorkspaces: vi.fn(),
  resolveBaseUrl: vi.fn(),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
  getWorkspaceBySiteId: vi.fn((siteId: string) => mocks.listWorkspaces().find((w: { webflowSiteId?: string }) => w.webflowSiteId === siteId)),
}));

vi.mock('../../server/url-helpers.js', () => ({
  resolveBaseUrl: mocks.resolveBaseUrl,
}));

const { buildSchemaIntelligence } = await import('../../server/schema-intelligence.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkspaces.mockReturnValue([
    {
      id: 'ws-schema',
      webflowSiteId: 'site-schema',
      webflowToken: 'workspace-token',
      liveDomain: 'example.com',
    },
  ]);
  mocks.resolveBaseUrl.mockResolvedValue('https://example.com/');
  mocks.buildWorkspaceIntelligence.mockResolvedValue({
    seoContext: {
      pageKeywords: {
        primaryKeyword: 'schema keyword',
        secondaryKeywords: ['secondary'],
      },
    },
    pageElements: {
      pagePath: '/services',
      catalog: { videos: [], lists: [], citations: [] },
    },
    siteInventory: {
      siteId: 'site-schema',
      baseUrl: 'https://example.com',
      assembledAt: '2026-05-26T00:00:00.000Z',
      pages: [],
      collections: [],
      cmsItems: [],
    },
  });
});

describe('buildSchemaIntelligence', () => {
  it('resolves workspace and routes schema reads through buildWorkspaceIntelligence', async () => {
    const result = await buildSchemaIntelligence({
      siteId: 'site-schema',
      pagePath: '/services',
      includeSiteInventory: true,
      includePageElements: true,
    });

    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-schema', {
      slices: ['seoContext', 'siteInventory', 'pageElements'],
      pagePath: '/services',
      siteId: 'site-schema',
      siteBaseUrl: 'https://example.com',
      webflowToken: 'workspace-token',
      enrichWithBacklinks: undefined,
      resolveEntityReferences: undefined,
    });
    expect(result.workspaceId).toBe('ws-schema');
    expect(result.baseUrl).toBe('https://example.com');
    expect(result.pageKeywords).toEqual({ primary: 'schema keyword', secondary: ['secondary'] });
    expect(result.pageElements).toEqual({ videos: [], lists: [], citations: [] });
    expect(result.siteInventory?.siteId).toBe('site-schema');
  });

  it('passes backlink enrichment only when requested', async () => {
    await buildSchemaIntelligence({
      siteId: 'site-schema',
      includeBacklinks: true,
    });

    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledWith(
      'ws-schema',
      expect.objectContaining({ enrichWithBacklinks: true }),
    );
  });

  it('includes entityResolution slice only when requested', async () => {
    await buildSchemaIntelligence({
      siteId: 'site-schema',
      includeEntityResolution: true,
    });

    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledWith(
      'ws-schema',
      expect.objectContaining({ slices: ['seoContext', 'entityResolution'], resolveEntityReferences: true }),
    );
  });

  it('does not assemble workspace intelligence when the site has no workspace', async () => {
    mocks.listWorkspaces.mockReturnValue([]);

    const result = await buildSchemaIntelligence({ siteId: 'missing-site' });

    expect(mocks.buildWorkspaceIntelligence).not.toHaveBeenCalled();
    expect(result.workspace).toBeUndefined();
    expect(result.intelligence).toBeNull();
  });
});
