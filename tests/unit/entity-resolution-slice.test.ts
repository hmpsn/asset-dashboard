import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

const { assembleEntityResolution } = await import('../../server/intelligence/entity-resolution-slice.js');

describe('assembleEntityResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no_data when workspace is missing', async () => {
    mocks.getWorkspace.mockReturnValue(undefined);

    const result = await assembleEntityResolution('missing-workspace');

    expect(result.availability).toBe('no_data');
    expect(result.entities).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('assembles thing/place candidates from workspace and page context', async () => {
    mocks.getWorkspace.mockReturnValue({
      id: 'ws-1',
      keywordStrategy: {
        siteKeywords: ['web design', 'seo strategy'],
        pageMap: [
          {
            pagePath: '/services',
            primaryKeyword: 'austin web design',
            secondaryKeywords: ['conversion optimization'],
          },
        ],
      },
      businessProfile: {
        address: {
          city: 'Austin',
          state: 'TX',
        },
      },
    });

    const result = await assembleEntityResolution('ws-1', { pagePath: '/services' });

    expect(result.availability).toBe('ready');
    expect(result.entities.some(entity => entity.type === 'Thing')).toBe(true);
    expect(result.entities.some(entity => entity.type === 'Place')).toBe(true);
    expect(result.entities.some(entity => entity.surfaces.includes('organization_knows_about'))).toBe(true);
    expect(result.entities.some(entity => entity.surfaces.includes('article_about'))).toBe(true);
    expect(result.entities.some(entity => entity.surfaces.includes('area_served'))).toBe(true);
    expect(result.unresolved.length).toBeGreaterThan(0);
    expect(result.generatedAt).toBeTruthy();
  });
});
