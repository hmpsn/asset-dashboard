/**
 * Strategy v2 Phase 6a follow-up — server-side tier-gating of raw `cpc` on the
 * PUBLIC read path `GET /api/public/seo-strategy/:id`.
 *
 * Raw cost-per-click is an admin/scoring-internal money input. The Growth+ client
 * "Revenue potential" drawer renders SERVER-COMPUTED `currentMonthly` / `upsideMonthly`
 * (from `strategyUx`), never the raw `pageMap.cpc`. So free-tier clients must not be
 * able to read raw `cpc` from the network payload — the UI hiding it is not enough.
 *
 * This guards the gate both directions against regression:
 *  - free tier  → `cpc` is OMITTED from every pageMap entry, and
 *  - growth tier → `cpc` is present (paying clients keep parity with the drawer claim).
 *
 * Per CLAUDE.md, integration tests must exercise the actual public read path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertAndCleanPageKeywords } from '../../server/page-keywords.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import type { KeywordStrategy, PageKeywordMap } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const STRATEGY: KeywordStrategy = {
  siteKeywords: ['kw one'],
  opportunities: [],
  businessContext: 'Test clinic.',
  generatedAt: '2026-06-01T00:00:00.000Z',
};

// Page map carrying a real, non-null cpc + commercial intent so presence/absence
// is unambiguous AND the keyword-value-scoring valueReasons text path produces a
// raw "$X CPC" reason (which the surface gate must then strip on the client path).
const PAGE_MAP: PageKeywordMap[] = [
  { pagePath: '/a', pageTitle: 'A', primaryKeyword: 'kw a', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 3, impressions: 500, clicks: 50, volume: 1000, difficulty: 30, cpc: 4.25 },
  { pagePath: '/b', pageTitle: 'B', primaryKeyword: 'kw b', secondaryKeywords: [], searchIntent: 'commercial', currentPosition: 15, impressions: 200, clicks: 5, volume: 800, difficulty: 40, cpc: 2.1 },
];

let freeWsId = '';
let growthWsId = '';
let trialWsId = '';

type PublicPageMapEntry = { pagePath: string; cpc?: number };
type PublicStrategyExplanation = { valueReasons?: string[] };
type PublicStrategyBody = {
  pageMap: PublicPageMapEntry[];
  strategyUx?: { explanations?: PublicStrategyExplanation[] };
};

beforeAll(async () => {
  await ctx.startServer();

  freeWsId = createWorkspace(`Cpc Gate Free ${ctx.PORT}`).id;
  // createWorkspace() seeds a 14-day Growth trial, which computeEffectiveTier()
  // promotes free → growth. Expire it so this workspace is genuinely free-tier and
  // the gate (which honors the same trial-aware resolver) actually omits cpc.
  updateWorkspace(freeWsId, { keywordStrategy: STRATEGY, tier: 'free', trialEndsAt: '2020-01-01T00:00:00.000Z' });
  upsertAndCleanPageKeywords(freeWsId, PAGE_MAP);

  growthWsId = createWorkspace(`Cpc Gate Growth ${ctx.PORT}`).id;
  updateWorkspace(growthWsId, { keywordStrategy: STRATEGY, tier: 'growth' });
  upsertAndCleanPageKeywords(growthWsId, PAGE_MAP);

  // tier === 'free' but with an ACTIVE trial → computeEffectiveTier promotes to growth.
  trialWsId = createWorkspace(`Cpc Gate Trial ${ctx.PORT}`).id;
  const futureTrial = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  updateWorkspace(trialWsId, { keywordStrategy: STRATEGY, tier: 'free', trialEndsAt: futureTrial });
  upsertAndCleanPageKeywords(trialWsId, PAGE_MAP);

  // Enable keyword-value-scoring so strategyUx.explanations[].valueReasons is
  // actually computed — otherwise the raw-cpc-text guard below is vacuous.
  for (const id of [freeWsId, growthWsId]) {
    setWorkspaceFlagOverride('keyword-value-scoring', id, true);
  }
}, 25_000);

afterAll(async () => {
  for (const id of [freeWsId, growthWsId]) {
    if (id) setWorkspaceFlagOverride('keyword-value-scoring', id, null);
  }
  if (freeWsId) deleteWorkspace(freeWsId);
  if (growthWsId) deleteWorkspace(growthWsId);
  if (trialWsId) deleteWorkspace(trialWsId);
  await ctx.stopServer();
});

describe('GET /api/public/seo-strategy/:id — raw cpc is tier-gated server-side', () => {
  it('OMITS cpc from every pageMap entry for a free-tier workspace', async () => {
    const res = await api(`/api/public/seo-strategy/${freeWsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicStrategyBody;
    expect(body.pageMap.length).toBeGreaterThan(0);
    for (const entry of body.pageMap) {
      // Not just `cpc == null` — the key must be absent from the serialized payload.
      expect(Object.prototype.hasOwnProperty.call(entry, 'cpc')).toBe(false);
    }
  });

  it('INCLUDES cpc in pageMap entries for a growth-tier workspace', async () => {
    const res = await api(`/api/public/seo-strategy/${growthWsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicStrategyBody;
    const withCpc = body.pageMap.filter((p) => typeof p.cpc === 'number');
    expect(withCpc.length).toBeGreaterThan(0);
    expect(withCpc.some((p) => p.cpc === 4.25)).toBe(true);
  });

  it('INCLUDES cpc for a free-tier workspace on an active trial (trial-aware gate)', async () => {
    const res = await api(`/api/public/seo-strategy/${trialWsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicStrategyBody;
    const withCpc = body.pageMap.filter((p) => typeof p.cpc === 'number');
    expect(withCpc.length).toBeGreaterThan(0);
  });
});

// Parallel raw-cpc path: the keyword-value-scoring `valueReasons` text ("Commercial
// intent · $4.25 CPC") renders unconditionally in the client drawer, so raw cpc must
// be suppressed in the reason TEXT for the client surface regardless of tier — the
// raw `$X CPC` substring is admin-only (#1103), same convention as content gaps.
describe('GET /api/public/seo-strategy/:id — raw cpc never leaks via valueReasons text', () => {
  const collectReasons = (body: PublicStrategyBody): string[] =>
    (body.strategyUx?.explanations ?? []).flatMap((e) => e.valueReasons ?? []);

  it('produces valueReasons (flag on) but with NO raw "$X CPC" text for a free-tier workspace', async () => {
    const res = await api(`/api/public/seo-strategy/${freeWsId}`);
    expect(res.status).toBe(200);
    const reasons = collectReasons((await res.json()) as PublicStrategyBody);
    // Non-vacuous: the value-scoring path actually ran and emitted reasons.
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((r) => /intent/i.test(r))).toBe(true);
    // The gate: no reason string carries a raw dollar figure.
    expect(reasons.some((r) => /\$\s*\d/.test(r))).toBe(false);
  });

  it('produces valueReasons (flag on) but with NO raw "$X CPC" text for a growth-tier workspace', async () => {
    const res = await api(`/api/public/seo-strategy/${growthWsId}`);
    expect(res.status).toBe(200);
    const reasons = collectReasons((await res.json()) as PublicStrategyBody);
    expect(reasons.length).toBeGreaterThan(0);
    // Surface-gated, not tier-gated: even paying clients never see raw cpc in text.
    expect(reasons.some((r) => /\$\s*\d/.test(r))).toBe(false);
  });
});
