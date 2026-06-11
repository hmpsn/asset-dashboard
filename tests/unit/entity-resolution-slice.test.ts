import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listPageKeywords: vi.fn(),
  resolveCandidateWithWikidata: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));
// Bug 3 fix: the slice now reads pageMap from the page_keywords TABLE via
// listPageKeywords, not from ws.keywordStrategy.pageMap (which is always
// undefined post-strip — the blob field is stripped before persistence).
vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: mocks.listPageKeywords,
}));
vi.mock('../../server/intelligence/entity-resolution-wikidata.js', () => ({
  resolveCandidateWithWikidata: mocks.resolveCandidateWithWikidata,
}));

const { assembleEntityResolution } = await import('../../server/intelligence/entity-resolution-slice.js');

describe('assembleEntityResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty page map (table has no rows for this workspace)
    mocks.listPageKeywords.mockReturnValue([]);
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
      // pageMap is NOT on keywordStrategy blob (stripped before storage — always undefined
      // at read time). siteKeywords comes from the blob.
      keywordStrategy: {
        siteKeywords: ['web design', 'seo strategy'],
      },
      businessProfile: {
        address: {
          city: 'Austin',
          state: 'TX',
        },
      },
    });
    // Bug 3 fix: page-level entity candidates now come from the TABLE via listPageKeywords.
    mocks.listPageKeywords.mockReturnValue([
      {
        pagePath: '/services',
        primaryKeyword: 'austin web design',
        secondaryKeywords: ['conversion optimization'],
      },
    ]);

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

  it('Bug 3 — page-level entity candidates come from the table (listPageKeywords), not the blob', async () => {
    // Workspace has NO pageMap on its keywordStrategy (simulates the post-strip state:
    // ws.keywordStrategy.pageMap is always undefined at read time).
    mocks.getWorkspace.mockReturnValue({
      id: 'ws-bug3',
      keywordStrategy: { siteKeywords: [] },
    });
    // The TABLE has a page keyword row for the target path.
    mocks.listPageKeywords.mockReturnValue([
      {
        pagePath: '/about',
        primaryKeyword: 'about keyword from table',
        secondaryKeywords: ['secondary from table'],
      },
    ]);

    const result = await assembleEntityResolution('ws-bug3', { pagePath: '/about' });

    // article_about and article_mentions must come from the table row, not the blob.
    expect(result.entities.some(e => e.surfaces.includes('article_about'))).toBe(true);
    const articleAbout = result.entities.find(e => e.surfaces.includes('article_about'));
    expect(articleAbout?.label).toBe('about keyword from table');
    // listPageKeywords must have been called (not the never-populated blob path).
    expect(mocks.listPageKeywords).toHaveBeenCalledWith('ws-bug3');
  });

  it('Bug 3 — page-level candidates are absent when table is empty (even if blob carried pageMap)', async () => {
    // Simulates the broken state before the fix: ws.keywordStrategy.pageMap had data
    // but was inaccessible via the blob path. Post-fix: table is empty → no article_about.
    mocks.getWorkspace.mockReturnValue({
      id: 'ws-bug3-empty',
      keywordStrategy: {
        siteKeywords: ['site kw'],
        // blob pageMap would have been here pre-strip, but is never populated now
        pageMap: [{ pagePath: '/old', primaryKeyword: 'blob keyword', secondaryKeywords: [] }],
      },
    });
    // Table is empty for this workspace
    mocks.listPageKeywords.mockReturnValue([]);

    const result = await assembleEntityResolution('ws-bug3-empty', { pagePath: '/old' });

    // No article_about from the blob path (table is authoritative; table is empty)
    expect(result.entities.some(e => e.surfaces.includes('article_about'))).toBe(false);
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
