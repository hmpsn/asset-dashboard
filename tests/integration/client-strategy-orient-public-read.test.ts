/**
 * Strategy v2 Phase 6a — client-safe visibility score on the PUBLIC read path.
 *
 * Exercises the REAL client endpoint `GET /api/public/seo-strategy/:id` and asserts that:
 *  1. it now exposes the CTR-weighted visibility score (0–100) via `strategyUx.orient`, and
 *  2. the Orient payload NEVER leaks an admin money/EMV field.
 *
 * OrientMetrics is money-free by construction today (its only inputs are per-page {position, volume}).
 * This test is the guard against a FUTURE field on the shared OrientMetrics type silently flowing to the
 * client: any key outside the known money-free allow-list fails the leak assertion, forcing a conscious
 * client-safety decision. Per CLAUDE.md, integration tests must cover the actual public read path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertAndCleanPageKeywords } from '../../server/page-keywords.js';
import type { KeywordStrategy, PageKeywordMap } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

// Every key OrientMetrics is allowed to expose on the client path (score + aggregate counts + deltas).
const ALLOWED_ORIENT_KEYS = [
  'visibilityScore', 'visibilityScoreDelta',
  'clicks', 'clicksDelta',
  'impressions', 'impressionsDelta',
  'rankedKeywords', 'rankedKeywordsDelta',
  'avgPosition', 'avgPositionDelta',
];
// Substrings that would indicate an admin money/EMV/opportunity leak if they ever appeared in a key.
const FORBIDDEN_KEY_SUBSTRINGS = ['emv', 'opportunity', 'predicted', 'roiper', 'revenue', 'dollar', 'cpc', 'value'];

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`Client Orient Read ${ctx.PORT}`).id;
  updateWorkspace(wsId, {
    keywordStrategy: {
      siteKeywords: ['kw one'],
      opportunities: [],
      businessContext: 'Test clinic.',
      generatedAt: '2026-06-01T00:00:00.000Z',
    } as KeywordStrategy,
  });
  const pageMap: PageKeywordMap[] = [
    { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw a', secondaryKeywords: [], currentPosition: 3, impressions: 500, clicks: 50, volume: 1000 },
    { pagePath: '/b', pageTitle: 'B', primaryKeyword: 'kw b', secondaryKeywords: [], currentPosition: 15, impressions: 200, clicks: 5, volume: 800 },
  ];
  upsertAndCleanPageKeywords(wsId, pageMap);
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/public/seo-strategy/:id — client Orient visibility score (Phase 6a)', () => {
  it('exposes a 0–100 visibility score via strategyUx.orient', async () => {
    const res = await api(`/api/public/seo-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { strategyUx?: { orient?: Record<string, unknown> } };
    const orient = body.strategyUx?.orient;
    expect(orient).toBeTruthy();
    expect(typeof orient!.visibilityScore).toBe('number');
    expect(orient!.visibilityScore as number).toBeGreaterThanOrEqual(0);
    expect(orient!.visibilityScore as number).toBeLessThanOrEqual(100);
  });

  it('never leaks an admin money/EMV field through the client Orient payload', async () => {
    const res = await api(`/api/public/seo-strategy/${wsId}`);
    const body = await res.json() as { strategyUx: { orient: Record<string, unknown> } };
    const orient = body.strategyUx.orient;
    // Allow-list: a NEW field on OrientMetrics (e.g. a $-valued stat) fails here, forcing a conscious
    // client-safety decision before it can reach the public payload.
    for (const key of Object.keys(orient)) {
      expect(ALLOWED_ORIENT_KEYS).toContain(key);
    }
    // Defense in depth: no key name hints at money/EMV/opportunity.
    const lowerKeys = Object.keys(orient).map((k) => k.toLowerCase());
    for (const bad of FORBIDDEN_KEY_SUBSTRINGS) {
      expect(lowerKeys.some((k) => k.includes(bad))).toBe(false);
    }
  });
});
