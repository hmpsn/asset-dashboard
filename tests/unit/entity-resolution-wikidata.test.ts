import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedEntityResolution: vi.fn(),
  upsertEntityResolutionCache: vi.fn(),
}));

vi.mock('../../server/intelligence/entity-resolution-cache.js', () => ({
  getCachedEntityResolution: mocks.getCachedEntityResolution,
  upsertEntityResolutionCache: mocks.upsertEntityResolutionCache,
}));

const { resolveCandidateWithWikidata } = await import('../../server/intelligence/entity-resolution-wikidata.js');

describe('resolveCandidateWithWikidata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.getCachedEntityResolution.mockReturnValue(null);
  });

  it('returns cached resolution without calling fetch', async () => {
    mocks.getCachedEntityResolution.mockReturnValue({
      cacheKey: 'Thing:webflow',
      entityLabel: 'webflow',
      entityType: 'Thing',
      wikidata: {
        qid: 'Q170477',
        label: 'Webflow',
        sameAs: 'https://www.wikidata.org/wiki/Q170477',
      },
      confidence: 0.91,
      status: 'resolved',
      errorMessage: null,
      fetchedAt: '2026-05-27T00:00:00.000Z',
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await resolveCandidateWithWikidata({
      label: 'webflow',
      type: 'Thing',
      surface: 'organization_knows_about',
      source: 'workspace',
      confidence: 0.6,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('resolved');
    expect(result.reference?.qid).toBe('Q170477');
  });

  it('parses sparql response and caches resolved candidate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              item: { value: 'http://www.wikidata.org/entity/Q170477' },
              itemLabel: { value: 'Webflow' },
              itemDescription: { value: 'website builder platform' },
            },
          ],
        },
      }),
    } as Response);

    const result = await resolveCandidateWithWikidata({
      label: 'Webflow',
      type: 'Thing',
      surface: 'organization_knows_about',
      source: 'workspace',
      confidence: 0.6,
    });

    expect(result.status).toBe('resolved');
    expect(result.reference?.qid).toBe('Q170477');
    expect(mocks.upsertEntityResolutionCache).toHaveBeenCalledTimes(1);
  });

  it('returns unresolved when no reliable match is found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              item: { value: 'http://www.wikidata.org/entity/Q112233' },
              itemLabel: { value: 'Completely Different' },
              itemDescription: { value: 'fictional character' },
            },
          ],
        },
      }),
    } as Response);

    const result = await resolveCandidateWithWikidata({
      label: 'Austin, TX',
      type: 'Place',
      surface: 'area_served',
      source: 'workspace',
      confidence: 0.7,
    });

    expect(result.status).toBe('unresolved');
    expect(result.reference).toBeUndefined();
    expect(mocks.upsertEntityResolutionCache).toHaveBeenCalledTimes(1);
  });
});
