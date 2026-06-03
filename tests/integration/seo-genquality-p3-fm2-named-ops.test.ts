/**
 * SEO Generation Quality P3 — FM-2 (malformed AI) + client-signal contract.
 *
 * Drives `synthesizeKeywordStrategy` directly (no HTTP boot, so no 13xxx port is
 * allocated) with `server/ai.ts`'s `callAI` mocked so we control the model output:
 *
 *   - FM-2 (flag-ON): the named ops (`keyword-page-assignment` /
 *     `keyword-site-synthesis`) return a MALFORMED payload. The flag-ON path
 *     validates with Zod, RETRIES once, then falls to a typed-empty object whose
 *     contentGaps are deterministically backfilled from the universe candidates →
 *     the result is NON-EMPTY (NOT a throw, NOT silent empty).
 *   - FM-2 (flag-OFF): the legacy `keyword-strategy` op returns a malformed master
 *     payload → synthesis THROWS `KeywordStrategySynthesisError` (byte-identical to
 *     today).
 *   - Client-signal (flag-ON): a `requested` keyword the AI omits is re-added as a
 *     content gap (hard guarantee); a `declined` keyword never appears.
 *
 * The named-op call is detected by the registry `operation` passed to `callAI`; the
 * legacy call is detected by `operation === 'keyword-strategy'`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aiState = vi.hoisted(() => ({
  // When 'malformed', every callAI returns malformed JSON (the FM-2 condition).
  // When 'requested-omitted', the assignment/synthesis ops return VALID payloads
  // that intentionally omit the requested keyword (client-signal case).
  // When 'out-of-set', the ops return VALID-shape payloads that select a
  // hallucinated id/keyword NOT in the closed candidate set (I1 membership case).
  mode: 'malformed' as 'malformed' | 'requested-omitted' | 'out-of-set',
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async (opts: { operation?: string }) => {
    if (aiState.mode === 'malformed') {
      // Unparseable for the named ops AND the legacy op — forces the retry then the
      // typed-empty/throw branch depending on the path.
      return { text: 'NOT JSON — the model failed', tokens: { prompt: 0, completion: 0, total: 0 } };
    }
    // requested-omitted: return valid payloads that DO NOT include the requested kw.
    if (opts.operation === 'keyword-page-assignment') {
      return {
        text: JSON.stringify({
          assignments: [
            {
              pagePath: '/services',
              pageTitle: 'Services',
              primaryKeyword: 'platform analytics',
              primaryKeywordSourceId: 'platform analytics',
              secondaryKeywords: [],
              searchIntent: 'commercial',
              justification: 'core term',
            },
          ],
        }),
        tokens: { prompt: 0, completion: 0, total: 0 },
      };
    }
    if (aiState.mode === 'out-of-set') {
      // I1: the model hallucinates an id/keyword NOT in the closed candidate set.
      if (opts.operation === 'keyword-page-assignment') {
        return {
          text: JSON.stringify({
            assignments: [
              {
                pagePath: '/services',
                pageTitle: 'Services',
                // BOTH the keyword and the sourceId are invented (not in the set).
                primaryKeyword: 'totally invented saas growth hack',
                primaryKeywordSourceId: 'totally invented saas growth hack',
                secondaryKeywords: [],
                searchIntent: 'commercial',
                justification: 'hallucinated',
              },
            ],
          }),
          tokens: { prompt: 0, completion: 0, total: 0 },
        };
      }
      if (opts.operation === 'keyword-site-synthesis') {
        return {
          text: JSON.stringify({
            siteKeywords: [],
            opportunities: [],
            contentGaps: [
              // Out-of-set target — must be DROPPED by the membership check.
              { topic: 'Invented topic', targetKeyword: 'fabricated keyword nobody searches', targetKeywordSourceId: 'fabricated keyword nobody searches', intent: 'commercial', priority: 'high', rationale: 'hallucinated' },
            ],
            quickWins: [],
          }),
          tokens: { prompt: 0, completion: 0, total: 0 },
        };
      }
      return { text: '{}', tokens: { prompt: 0, completion: 0, total: 0 } };
    }
    if (opts.operation === 'keyword-site-synthesis') {
      return {
        text: JSON.stringify({
          siteKeywords: ['platform analytics'],
          opportunities: [],
          contentGaps: [
            { topic: 'Analytics platform', targetKeyword: 'platform analytics', targetKeywordSourceId: 'platform analytics', intent: 'commercial', priority: 'high', rationale: 'core' },
          ],
          quickWins: [],
        }),
        tokens: { prompt: 0, completion: 0, total: 0 },
      };
    }
    return { text: '{}', tokens: { prompt: 0, completion: 0, total: 0 } };
  }),
}));

import { callAI } from '../../server/ai.js';
import {
  synthesizeKeywordStrategy,
  KeywordStrategySynthesisError,
} from '../../server/keyword-strategy-ai-synthesis.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { saveKeywordFeedback } from '../../server/keyword-feedback.js';
import { getWorkspace } from '../../server/workspaces.js';
import { deleteWorkspace } from '../../server/workspaces.js';
import { normalizeKeyword } from '../../server/keyword-intelligence/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { DomainKeyword } from '../../server/seo-data-provider.js';

let seeded: SeededFullWorkspace;

function buildOptions(workspaceId: string) {
  const ws = getWorkspace(workspaceId)!;
  const dk = (keyword: string, volume: number, difficulty: number, url: string, position: number): DomainKeyword =>
    ({ keyword, volume, difficulty, url, position, traffic: 10, trafficPercent: 1, cpc: 1 });
  const domainKeywords: DomainKeyword[] = [
    dk('platform analytics', 1500, 25, 'https://example.com/services', 5),
    dk('deployment frequency', 900, 20, 'https://example.com/blog', 8),
    dk('dora metrics', 1200, 28, 'https://example.com/metrics', 12),
    dk('engineering benchmarks', 600, 22, 'https://example.com/bench', 15),
    dk('lead time tracking', 300, 18, 'https://example.com/lead', 18),
    dk('incident cost analysis', 200, 14, 'https://example.com/incident', 22),
    dk('cycle time reporting', 250, 16, 'https://example.com/cycle', 25),
  ];
  return {
    ws,
    businessContext: 'Engineering intelligence platform.',
    strategyMode: 'full' as const,
    seoDataMode: 'full' as const,
    baseUrl: 'https://example.com',
    competitorDomains: [],
    pageInfo: [
      { path: '/services', title: 'Services', seoTitle: 'Services', seoDesc: 'Our services.', contentSnippet: 'Services snippet.' },
    ],
    preloadedPageKeywords: null,
    searchData: {
      gscData: [], deviceBreakdown: [], countryBreakdown: [], periodComparison: null,
      organicLandingPages: [], organicOverview: null, ga4Conversions: [], ga4EventsByPage: [],
    },
    seoContext: '',
    domainKeywords,
    keywordGaps: [],
    discoveryKeywords: [],
    relatedKeywords: [],
    competitorKeywords: [],
    provider: null,
    sendProgress: () => {},
  };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
  seeded = seedWorkspace({ tier: 'premium' });
  aiState.mode = 'malformed';
});

afterEach(() => {
  setWorkspaceFlagOverride('seo-generation-quality', seeded.workspaceId, null);
  deleteWorkspace(seeded.workspaceId);
});

describe('P3 FM-2 — malformed AI on the flag-ON path is never-empty (retry → backfill)', () => {
  it('flag-ON: malformed assignment + synthesis → retry → deterministic backfill → NON-EMPTY contentGaps', async () => {
    setWorkspaceFlagOverride('seo-generation-quality', seeded.workspaceId, true);
    aiState.mode = 'malformed';

    const mockCallAI = vi.mocked(callAI);
    mockCallAI.mockClear();

    const result = await synthesizeKeywordStrategy(buildOptions(seeded.workspaceId));

    // Did NOT throw; contentGaps are NON-EMPTY (backfilled from the universe).
    expect(result.strategy).toBeTruthy();
    const gaps = (result.strategy as { contentGaps?: unknown[] }).contentGaps ?? [];
    expect(gaps.length).toBeGreaterThan(0);

    // The retry fired: the page-assignment op was called more than once (initial +
    // repair turn) before falling to the synthetic/backfill path.
    const pageAssignmentCalls = mockCallAI.mock.calls.filter(
      ([opts]) => (opts as { operation?: string }).operation === 'keyword-page-assignment',
    );
    expect(pageAssignmentCalls.length).toBeGreaterThanOrEqual(2);
    const siteSynthesisCalls = mockCallAI.mock.calls.filter(
      ([opts]) => (opts as { operation?: string }).operation === 'keyword-site-synthesis',
    );
    expect(siteSynthesisCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('P3 FM-2 — malformed AI on the flag-OFF path still THROWS (legacy parity)', () => {
  // Evidence token (ai-reliability-registry `seo-gen-quality-malformed-ai-throws`):
  // on the flag-OFF legacy path a malformed AI synthesis response makes generation THROW.
  it('flag-OFF: malformed master synthesis response makes generation THROW', async () => {
    // Flag left OFF (default).
    aiState.mode = 'malformed';
    await expect(synthesizeKeywordStrategy(buildOptions(seeded.workspaceId)))
      .rejects.toBeInstanceOf(KeywordStrategySynthesisError);
  });
});

describe('P3 I1 — closed-set membership (flag-ON): hallucinated id/keyword is rejected', () => {
  it('an out-of-set sourceId/keyword is NOT admitted and does not override a valid in-set keyword', async () => {
    setWorkspaceFlagOverride('seo-generation-quality', seeded.workspaceId, true);
    aiState.mode = 'out-of-set';

    const result = await synthesizeKeywordStrategy(buildOptions(seeded.workspaceId));
    const strategy = result.strategy as {
      pageMap?: { pagePath: string; primaryKeyword: string }[];
      contentGaps?: { targetKeyword?: string }[];
    };

    // OP1: the hallucinated keyword must NOT be the page's primaryKeyword. The
    // membership check rejected the invented sourceId AND the invented keyword, so
    // post-processing fell back to a real page-identity/provider signal (or dropped
    // the page) — never the hallucination.
    const servicesPage = (strategy.pageMap ?? []).find(pm => pm.pagePath === '/services');
    const allPrimary = (strategy.pageMap ?? []).map(pm => normalizeKeyword(pm.primaryKeyword));
    expect(allPrimary).not.toContain(normalizeKeyword('totally invented saas growth hack'));
    if (servicesPage) {
      // The page survived with a REAL fallback keyword (the in-set provider term),
      // not the invented one.
      expect(normalizeKeyword(servicesPage.primaryKeyword)).not.toBe(normalizeKeyword('totally invented saas growth hack'));
    }

    // OP2: the out-of-set content-gap target must NOT appear among content gaps.
    const gapKeys = (strategy.contentGaps ?? []).map(g => normalizeKeyword(g.targetKeyword ?? ''));
    expect(gapKeys).not.toContain(normalizeKeyword('fabricated keyword nobody searches'));
  });
});

describe('P3 client-signal contract (flag-ON)', () => {
  it('a requested keyword the AI omits is re-added as a content gap; a declined keyword never appears', async () => {
    setWorkspaceFlagOverride('seo-generation-quality', seeded.workspaceId, true);
    aiState.mode = 'requested-omitted';

    // Client requested a keyword the AI never returns; client declined another.
    saveKeywordFeedback({ workspaceId: seeded.workspaceId, keyword: 'incident cost analysis', status: 'requested' });
    saveKeywordFeedback({ workspaceId: seeded.workspaceId, keyword: 'deployment frequency', status: 'declined' });

    const result = await synthesizeKeywordStrategy(buildOptions(seeded.workspaceId));
    const gaps = ((result.strategy as { contentGaps?: { targetKeyword?: string }[] }).contentGaps ?? []);
    const gapKeys = gaps.map(g => normalizeKeyword(g.targetKeyword ?? ''));

    // Requested keyword the AI omitted MUST appear (hard guarantee).
    expect(gapKeys).toContain(normalizeKeyword('incident cost analysis'));
    // Declined keyword NEVER appears in content gaps.
    expect(gapKeys).not.toContain(normalizeKeyword('deployment frequency'));
  });
});
