/**
 * Integration tests for GSC query enrichment in getKeywordRecommendations.
 *
 * Port reservation: 13320 (no HTTP server needed — calls module functions directly)
 *
 * Verifies that GSC queries are fetched as additional keyword candidates
 * when a workspace has gscPropertyUrl configured, with proper filtering
 * (word overlap, impressions >= 10, multi-word queries).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { getKeywordRecommendations, shouldIncludeKeywordCandidate } from '../../server/keyword-recommendations.js';

// ── Mock search-console (hoisted by Vitest before any imports run) ────────────
vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getQueryPageData: vi.fn().mockResolvedValue([
      { query: 'best plumber near me', page: 'https://example.com/plumbing', clicks: 50, impressions: 1200, position: 6.2, ctr: 4.1 },
      { query: 'plumber denver',        page: 'https://example.com/plumbing', clicks: 12, impressions: 340,  position: 9.1, ctr: 3.5 },
      { query: 'unrelated term',        page: 'https://example.com/other',    clicks: 2,  impressions: 40,   position: 22,  ctr: 5.0 },
      { query: 'low vol plumber',       page: 'https://example.com/plumbing', clicks: 0,  impressions: 3,    position: 40,  ctr: 0 },
    ]),
  };
});

// ── Mock seo-data-provider to avoid needing a configured provider ─────────────
vi.mock('../../server/seo-data-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getConfiguredProvider: vi.fn().mockReturnValue({
      getKeywordMetrics: vi.fn().mockResolvedValue([]),
      getRelatedKeywords: vi.fn().mockResolvedValue([]),
    }),
  };
});

describe('getKeywordRecommendations — GSC candidate enrichment', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace({
      gscPropertyUrl: 'https://example.com/',
    });
    wsId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
    vi.resetModules();
  });

  it('includes GSC queries with word overlap and impressions >= 10 as candidates', async () => {
    const result = await getKeywordRecommendations(wsId, 'plumber');
    const gsc = result.candidates.filter(c => c.source === 'gsc');
    expect(gsc.length).toBeGreaterThan(0);
    expect(gsc.some(c => c.keyword === 'best plumber near me')).toBe(true);
    // impressions < 10 dropped
    expect(gsc.some(c => c.keyword === 'low vol plumber')).toBe(false);
    // no word overlap dropped
    expect(gsc.some(c => c.keyword === 'unrelated term')).toBe(false);
  });

  it('shouldIncludeKeywordCandidate preserves gsc source', () => {
    expect(shouldIncludeKeywordCandidate('gsc', 0)).toBe(true);
    expect(shouldIncludeKeywordCandidate('gsc', 5)).toBe(true);
    expect(shouldIncludeKeywordCandidate('semrush_related', 5)).toBe(false);
    expect(shouldIncludeKeywordCandidate('pattern', 0)).toBe(true);
  });
});
