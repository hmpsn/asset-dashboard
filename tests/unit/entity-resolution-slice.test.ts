import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  resolveCandidateWithWikidata: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));
vi.mock('../../server/intelligence/entity-resolution-wikidata.js', () => ({
  resolveCandidateWithWikidata: mocks.resolveCandidateWithWikidata,
}));

const { assembleEntityResolution } = await import('../../server/intelligence/entity-resolution-slice.js');

describe('assembleEntityResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCandidateWithWikidata.mockResolvedValue({
      status: 'unresolved',
      confidence: 0,
    });
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

  it('resolves candidates to Wikidata references when enabled', async () => {
    mocks.getWorkspace.mockReturnValue({
      id: 'ws-1',
      keywordStrategy: {
        siteKeywords: ['webflow'],
      },
    });
    mocks.resolveCandidateWithWikidata.mockResolvedValue({
      status: 'resolved',
      confidence: 0.92,
      reference: {
        qid: 'Q170477',
        label: 'Webflow',
        sameAs: 'https://www.wikidata.org/wiki/Q170477',
      },
    });

    const result = await assembleEntityResolution('ws-1', { resolveEntityReferences: true });

    expect(mocks.resolveCandidateWithWikidata).toHaveBeenCalled();
    // ID format includes type bucket so Thing/Place resolutions to the same QID stay separate.
    expect(result.entities[0]?.id).toBe('wikidata:thing:Q170477');
    expect(result.entities[0]?.wikidata?.qid).toBe('Q170477');
  });

  it('does not call Wikidata resolver when opt-in is not set', async () => {
    mocks.getWorkspace.mockReturnValue({
      id: 'ws-1',
      keywordStrategy: {
        siteKeywords: ['technical SEO'],
      },
    });

    await assembleEntityResolution('ws-1');

    expect(mocks.resolveCandidateWithWikidata).not.toHaveBeenCalled();
  });
});
