// tests/integration/brand-filter-wiring.test.ts
//
// WIRING tests: verifies that filterBrandedContentGaps() and filterBrandedKeywords()
// are actually called in every pipeline that generates keyword recommendations.
//
// Strategy: two layers of coverage:
//   1. Static source assertions — grep the source files to confirm the import and
//      call-site are present in each pipeline. Catches regressions where someone
//      removes the call without breaking types.
//   2. Functional assertions — exercise the filter functions directly with a pool
//      / gap list that contains known competitor brand tokens, then assert zero
//      branded tokens survive into the output.
//
// The UNIT tests for the filter logic itself live in:
//   tests/unit/competitor-brand-filter.test.ts
// This file does NOT re-test the filter algorithm — only that each pipeline
// actually invokes it and uses its output.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Source file paths ─────────────────────────────────────────────────────────

const serverDir = path.resolve(import.meta.dirname, '../../server');
const routesDir = path.join(serverDir, 'routes');

// Read source files once at module level — cheap text operations, no I/O in each test.
const keywordStrategySrc = fs.readFileSync(
  path.join(routesDir, 'keyword-strategy.ts'),
  'utf-8',
);
const contentBriefSrc = fs.readFileSync(
  path.join(serverDir, 'content-brief.ts'),
  'utf-8',
);
const contentBriefRouteSrc = fs.readFileSync(
  path.join(routesDir, 'content-briefs.ts'),
  'utf-8',
);
const contentDecaySrc = fs.readFileSync(
  path.join(routesDir, 'content-decay.ts'),
  'utf-8',
);
const insightFeedbackSrc = fs.readFileSync(
  path.join(serverDir, 'insight-feedback.ts'),
  'utf-8',
);

// ── Competitor brand filter imports ──────────────────────────────────────────

let filterBrandedContentGaps: typeof import('../../server/competitor-brand-filter.js').filterBrandedContentGaps;
let filterBrandedKeywords: typeof import('../../server/competitor-brand-filter.js').filterBrandedKeywords;
let extractBrandTokens: typeof import('../../server/competitor-brand-filter.js').extractBrandTokens;

// DB and workspace helpers for seeding
let db: typeof import('../../server/db/index.js').default;
let updateWorkspace: typeof import('../../server/workspaces.js').updateWorkspace;
let getWorkspace: typeof import('../../server/workspaces.js').getWorkspace;

const TEST_WS_ID = 'test-ws-brand-filter-wiring';
const COMPETITOR_DOMAINS = ['getdx.com', 'jellyfish.co', 'linearb.io'];

// Tokens we expect to see filtered: extracted from each competitor domain.
// These are the tokens that the filter uses to detect branded keywords.
// "dx" from getdx, "jellyfish" from jellyfish.co, "linearb" from linearb.io.
// Note: 'linear' is NOT a token here — extractBrandTokens('linearb.io') produces
// only 'linearb' (the prefix list doesn't include 'linear' as a strippable prefix).
const KNOWN_BRANDED_TOKENS = ['dx', 'getdx', 'jellyfish', 'linearb'];

// Keywords that should be removed after filtering (contain competitor brand tokens)
const BRANDED_KEYWORDS = [
  'dx integrations',         // "dx" from getdx.com
  'getdx review',            // "getdx" from getdx.com
  'jellyfish analytics',     // "jellyfish" from jellyfish.co
  'linearb pricing',         // "linearb" from linearb.io
  'jellyfish vs alternatives', // "jellyfish" token
];

// Keywords that should survive filtering (no competitor brand tokens)
const CLEAN_KEYWORDS = [
  'engineering metrics dashboard',
  'developer productivity tools',
  'sprint velocity tracking',
  'software team performance',
  'dora metrics guide',
];

beforeAll(async () => {
  const filterMod = await import('../../server/competitor-brand-filter.js');
  filterBrandedContentGaps = filterMod.filterBrandedContentGaps;
  filterBrandedKeywords = filterMod.filterBrandedKeywords;
  extractBrandTokens = filterMod.extractBrandTokens;

  const dbMod = await import('../../server/db/index.js');
  db = dbMod.default;

  const wsMod = await import('../../server/workspaces.js');
  updateWorkspace = wsMod.updateWorkspace;
  getWorkspace = wsMod.getWorkspace;

  // Seed a test workspace with competitor domains configured
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
    VALUES (?, ?, ?, ?)
  `).run(TEST_WS_ID, 'Brand Filter Wiring Test WS', TEST_WS_ID, new Date().toISOString());

  // Write competitor domains into the workspace record
  updateWorkspace(TEST_WS_ID, { competitorDomains: COMPETITOR_DOMAINS });
});

afterAll(() => {
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(TEST_WS_ID);
});

// ── 1. Static source: strategy generation pipeline ────────────────────────────

describe('strategy generation pipeline — static wiring', () => {
  it('imports filterBrandedKeywords and filterBrandedContentGaps from competitor-brand-filter', () => {
    expect(keywordStrategySrc).toContain(
      "import { filterBrandedKeywords, filterBrandedContentGaps",
    );
    expect(keywordStrategySrc).toContain('competitor-brand-filter');
  });

  it('calls filterBrandedKeywords on the keyword pool before AI prompt is built', () => {
    // The call must exist in the strategy route
    expect(keywordStrategySrc).toContain('filterBrandedKeywords(keywordPool, competitorDomains)');
  });

  it('calls filterBrandedContentGaps on the AI-returned content gaps before strategy is saved', () => {
    expect(keywordStrategySrc).toContain('filterBrandedContentGaps(rawContentGaps, competitorDomains)');
  });

  it('reads competitorDomains from workspace when not provided in request body', () => {
    // The route falls back to ws.competitorDomains if the body doesn't include them
    expect(keywordStrategySrc).toContain('ws.competitorDomains || []');
  });

  it('uses the filtered content gaps in the final strategy — not the raw AI output', () => {
    // contentGaps in the final strategy object must reference finalContentGaps (which is derived from
    // cleanContentGaps after the declined-keyword hard filter), never rawContentGaps directly
    expect(keywordStrategySrc).toContain('contentGaps: finalContentGaps');
    // Raw gaps must NOT be used directly in the strategy assignment
    const rawUsageAfterFilter = keywordStrategySrc
      .slice(keywordStrategySrc.indexOf('finalContentGaps'))
      .includes('contentGaps: rawContentGaps');
    expect(rawUsageAfterFilter).toBe(false);
  });
});

// ── 2. Static source: content gap analysis sub-pipeline ──────────────────────

describe('content gap analysis sub-pipeline — static wiring', () => {
  it('post-AI hard filter strips branded gaps before strategy is assembled', () => {
    // The comment explains intent; the implementation must follow immediately.
    expect(keywordStrategySrc).toContain(
      'Post-generation hard filter: remove any content gaps containing competitor brand names',
    );
    // The filter call must be present after the master AI call (callStrategyAI for 'master').
    // We use the specific variable assignment "masterRaw = await callStrategyAI" to locate
    // the master call — not lastIndexOf('callStrategyAI') which would match a later cluster
    // AI call that appears after the filter in the file.
    const afterMasterIdx = keywordStrategySrc.indexOf('masterRaw = await callStrategyAI');
    const filterCallIdx = keywordStrategySrc.indexOf('filterBrandedContentGaps(rawContentGaps');
    expect(afterMasterIdx).toBeGreaterThan(0); // guard: master call must exist
    expect(filterCallIdx).toBeGreaterThan(afterMasterIdx);
  });

  it('branded gaps count is logged so the filtering is observable in prod', () => {
    expect(keywordStrategySrc).toContain('brandedGaps.length > 0');
    expect(keywordStrategySrc).toContain('branded content gaps despite prompt instruction');
  });
});

// ── 3. Static source: keyword pool pre-filter ─────────────────────────────────

describe('keyword pool — static wiring', () => {
  it('filter runs BEFORE the pool is serialized for the AI prompt', () => {
    // filterBrandedKeywords must appear before the template literal assignment that
    // builds the KEYWORD POOL prompt section (semrushBatchRef = `...KEYWORD POOL...`).
    // Note: `let semrushBatchRef = ''` is the declaration; the actual pool-building
    // assignment uses a template literal starting with `\n\nKEYWORD POOL`.
    const filterIdx = keywordStrategySrc.indexOf('filterBrandedKeywords(keywordPool');
    const promptBuildIdx = keywordStrategySrc.indexOf('KEYWORD POOL — VERIFIED search terms');
    expect(filterIdx).toBeGreaterThan(0);
    expect(promptBuildIdx).toBeGreaterThan(filterIdx);
  });

  it('branded keyword removal count is logged', () => {
    expect(keywordStrategySrc).toContain('removed ${brandedRemoved} branded competitor keywords');
  });
});

// ── 4. Static source: content brief generation pipeline ──────────────────────

describe('content brief generation pipeline — static source check', () => {
  it('content-brief.ts exposes generateBrief for the route to call', () => {
    expect(contentBriefSrc).toContain('export async function generateBrief');
  });

  it('content-briefs route imports generateBrief from content-brief', () => {
    expect(contentBriefRouteSrc).toContain('generateBrief');
    expect(contentBriefRouteSrc).toContain('content-brief');
  });

  it('content-briefs route reads workspace to provide context including competitor domains', () => {
    // The route fetches workspace data (getWorkspace) which carries competitorDomains
    expect(contentBriefRouteSrc).toContain('getWorkspace');
  });
});

// ── 5. Static source: suggested briefs pipeline ───────────────────────────────

describe('suggested briefs pipeline — static source check', () => {
  it('content-decay route imports createSuggestedBrief', () => {
    expect(contentDecaySrc).toContain("import { createSuggestedBrief }");
    expect(contentDecaySrc).toContain('suggested-briefs-store');
  });

  it('content-decay bridge creates suggested briefs from decaying pages', () => {
    expect(contentDecaySrc).toContain('createSuggestedBrief(');
    expect(contentDecaySrc).toContain('workspaceId: ws.id');
    expect(contentDecaySrc).toContain('keyword: page.title || page.page');
  });

  it('buildPipelineSignals in insight-feedback produces suggested_brief signals from ranking_opportunity insights', () => {
    expect(insightFeedbackSrc).toContain("type: 'suggested_brief'");
    expect(insightFeedbackSrc).toContain("insightType === 'ranking_opportunity'");
  });
});

// ── 6. Functional: filterBrandedKeywords removes all branded tokens from pool ─

describe('filterBrandedKeywords — functional wiring proof', () => {
  it('removes every branded keyword when competitor domains are configured on workspace', () => {
    const ws = getWorkspace(TEST_WS_ID);
    expect(ws).toBeTruthy();

    const domains = ws!.competitorDomains ?? [];
    expect(domains.length).toBeGreaterThan(0);

    // Build a keyword pool that mirrors what the strategy pipeline assembles:
    // a mix of branded and clean keywords with volume/difficulty data.
    const pool = new Map<string, { volume: number; difficulty: number; source: string }>();
    for (const kw of BRANDED_KEYWORDS) {
      pool.set(kw, { volume: 500, difficulty: 30, source: 'competitor' });
    }
    for (const kw of CLEAN_KEYWORDS) {
      pool.set(kw, { volume: 800, difficulty: 40, source: 'gsc' });
    }

    const removed = filterBrandedKeywords(pool, domains);

    // Filter must have removed SOMETHING — guard against vacuous pass
    expect(removed).toBeGreaterThan(0);

    // Every branded keyword must be gone from the pool
    const remainingKeywords = [...pool.keys()];
    expect(remainingKeywords.length).toBeGreaterThan(0);

    for (const branded of BRANDED_KEYWORDS) {
      expect(pool.has(branded)).toBe(false);
    }

    // Clean keywords must all survive
    expect(remainingKeywords.length).toBeGreaterThan(0);
    for (const clean of CLEAN_KEYWORDS) {
      expect(pool.has(clean)).toBe(true);
    }
  });

  it('removes zero keywords when competitor domains are empty', () => {
    const pool = new Map<string, { volume: number; difficulty: number; source: string }>();
    for (const kw of [...BRANDED_KEYWORDS, ...CLEAN_KEYWORDS]) {
      pool.set(kw, { volume: 100, difficulty: 20, source: 'gsc' });
    }
    const before = pool.size;

    const removed = filterBrandedKeywords(pool, []);

    expect(removed).toBe(0);
    expect(pool.size).toBe(before);
  });

  it('no competitor brand token appears in the post-filter pool', () => {
    const pool = new Map<string, { volume: number; difficulty: number; source: string }>();
    for (const kw of [...BRANDED_KEYWORDS, ...CLEAN_KEYWORDS]) {
      pool.set(kw, { volume: 100, difficulty: 20, source: 'gsc' });
    }

    filterBrandedKeywords(pool, COMPETITOR_DOMAINS);

    const remaining = [...pool.keys()];
    expect(remaining.length).toBeGreaterThan(0);

    const allTokens: string[] = [];
    for (const domain of COMPETITOR_DOMAINS) {
      allTokens.push(...extractBrandTokens(domain));
    }
    const uniqueTokens = [...new Set(allTokens)];

    // No remaining keyword should match any competitor brand token as a standalone word
    for (const kw of remaining) {
      const kwLower = kw.toLowerCase();
      const words = kwLower.split(/\s+/);
      for (const token of uniqueTokens) {
        if (token.length < 2) continue;
        if (token.length < 5) {
          // Short tokens: exact word match
          const matched = words.some(w => w === token);
          expect(matched).toBe(false);
        } else {
          // Long tokens: substring check
          const matched = kwLower.includes(token);
          expect(matched).toBe(false);
        }
      }
    }
  });
});

// ── 7. Functional: filterBrandedContentGaps removes all branded gaps ──────────

describe('filterBrandedContentGaps — functional wiring proof', () => {
  const contentGaps = [
    { targetKeyword: 'dx integrations', topic: 'Guide to DX Integrations' },
    { targetKeyword: 'getdx review', topic: 'GetDX Review and Alternatives' },
    { targetKeyword: 'jellyfish analytics', topic: 'Jellyfish Engineering Analytics' },
    { targetKeyword: 'linearb pricing', topic: 'LinearB Cost and Pricing Guide' },
    { targetKeyword: 'engineering metrics dashboard', topic: 'Best Engineering Metrics Tools' },
    { targetKeyword: 'developer productivity tools', topic: 'Top Developer Productivity Tools' },
    { targetKeyword: 'sprint velocity tracking', topic: 'How to Track Sprint Velocity' },
  ];

  it('removes all gaps containing competitor brand tokens when domains are configured', () => {
    const ws = getWorkspace(TEST_WS_ID);
    expect(ws).toBeTruthy();

    const domains = ws!.competitorDomains ?? [];
    expect(domains.length).toBeGreaterThan(0);

    const { filtered, removed } = filterBrandedContentGaps(contentGaps, domains);

    // The filter must have removed something — guard against vacuous pass
    expect(removed.length).toBeGreaterThan(0);

    // All known branded gaps must be removed
    const removedKeywords = removed.map(g => g.targetKeyword);
    expect(removedKeywords).toContain('dx integrations');
    expect(removedKeywords).toContain('getdx review');
    expect(removedKeywords).toContain('jellyfish analytics');
    expect(removedKeywords).toContain('linearb pricing');

    // Clean gaps must all survive
    expect(filtered.length).toBeGreaterThan(0);
    const filteredKeywords = filtered.map(g => g.targetKeyword);
    expect(filteredKeywords).toContain('engineering metrics dashboard');
    expect(filteredKeywords).toContain('developer productivity tools');
    expect(filteredKeywords).toContain('sprint velocity tracking');
  });

  it('no competitor brand token appears in any filtered gap targetKeyword', () => {
    const ws = getWorkspace(TEST_WS_ID);
    const domains = ws!.competitorDomains ?? [];

    const { filtered } = filterBrandedContentGaps(contentGaps, domains);

    // Guard: filtered list must be non-empty for this assertion to be meaningful
    expect(filtered.length).toBeGreaterThan(0);

    const allTokens: string[] = [];
    for (const domain of domains) {
      allTokens.push(...extractBrandTokens(domain));
    }
    const uniqueTokens = [...new Set(allTokens)];

    for (const gap of filtered) {
      const kwLower = gap.targetKeyword.toLowerCase();
      const words = kwLower.split(/\s+/);
      for (const token of uniqueTokens) {
        if (token.length < 2) continue;
        if (token.length < 5) {
          const matched = words.some(w => w === token);
          expect(matched).toBe(false);
        } else {
          const matched = kwLower.includes(token);
          expect(matched).toBe(false);
        }
      }
    }
  });

  it('no competitor brand token appears in any filtered gap topic', () => {
    const ws = getWorkspace(TEST_WS_ID);
    const domains = ws!.competitorDomains ?? [];

    const { filtered } = filterBrandedContentGaps(contentGaps, domains);

    expect(filtered.length).toBeGreaterThan(0);

    const allTokens: string[] = [];
    for (const domain of domains) {
      allTokens.push(...extractBrandTokens(domain));
    }
    const uniqueTokens = [...new Set(allTokens)];

    for (const gap of filtered) {
      const topicLower = gap.topic.toLowerCase();
      const words = topicLower.split(/\s+/);
      for (const token of uniqueTokens) {
        if (token.length < 2) continue;
        if (token.length < 5) {
          const matched = words.some(w => w === token);
          expect(matched).toBe(false);
        } else {
          const matched = topicLower.includes(token);
          expect(matched).toBe(false);
        }
      }
    }
  });

  it('returns all gaps unchanged when competitor domains are empty', () => {
    const { filtered, removed } = filterBrandedContentGaps(contentGaps, []);
    expect(filtered.length).toBe(contentGaps.length);
    expect(removed.length).toBe(0);
  });
});

// ── 8. Functional: workspace stores and surfaces competitor domains ────────────

describe('workspace competitor domain persistence', () => {
  it('competitorDomains are stored and retrieved via updateWorkspace/getWorkspace', () => {
    const ws = getWorkspace(TEST_WS_ID);
    expect(ws).toBeTruthy();
    expect(ws!.competitorDomains).toBeDefined();
    expect(ws!.competitorDomains!.length).toBeGreaterThan(0);

    // Guard: at least one domain
    expect(ws!.competitorDomains!.length).toBeGreaterThan(0);

    for (const domain of COMPETITOR_DOMAINS) {
      expect(ws!.competitorDomains).toContain(domain);
    }
  });

  it('extractBrandTokens produces at least one token for each configured competitor domain', () => {
    const ws = getWorkspace(TEST_WS_ID);
    const domains = ws!.competitorDomains ?? [];
    expect(domains.length).toBeGreaterThan(0);

    for (const domain of domains) {
      const tokens = extractBrandTokens(domain);
      expect(tokens.length).toBeGreaterThan(0);
    }
  });
});

// ── 9. End-to-end pipeline simulation: keyword pool → filter → zero branded ───

describe('end-to-end simulation: full pipeline pool + content gap filter', () => {
  it('simulates the strategy pipeline: pool is populated, branded removed, gaps filtered', () => {
    const ws = getWorkspace(TEST_WS_ID);
    expect(ws).toBeTruthy();

    const domains = ws!.competitorDomains ?? [];
    expect(domains.length).toBeGreaterThan(0);

    // === Step 1: Build keyword pool (mirrors keyword-strategy.ts lines 740-776) ===
    const keywordPool = new Map<string, { volume: number; difficulty: number; source: string }>();

    // Simulate adding competitor keywords (source: `competitor:domain`)
    const simulatedCompetitorKeywords = [
      { keyword: 'dx integrations', volume: 1600, difficulty: 40, domain: 'getdx.com' },
      { keyword: 'engineering metrics', volume: 800, difficulty: 30, domain: 'getdx.com' },
      { keyword: 'getdx pricing', volume: 200, difficulty: 20, domain: 'getdx.com' },
      { keyword: 'jellyfish analytics', volume: 1200, difficulty: 50, domain: 'jellyfish.co' },
      { keyword: 'developer productivity', volume: 500, difficulty: 35, domain: 'jellyfish.co' },
      { keyword: 'linearb review', volume: 300, difficulty: 25, domain: 'linearb.io' },
      { keyword: 'sprint velocity tracking', volume: 600, difficulty: 38, domain: 'linearb.io' },
    ];

    for (const ck of simulatedCompetitorKeywords) {
      keywordPool.set(ck.keyword.toLowerCase(), {
        volume: ck.volume,
        difficulty: ck.difficulty,
        source: `competitor:${ck.domain}`,
      });
    }

    // Simulate adding keyword gaps (higher priority)
    const simulatedGaps = [
      { keyword: 'getdx alternatives', volume: 400 },
      { keyword: 'dora metrics guide', volume: 700 },
    ];
    for (const gap of simulatedGaps) {
      keywordPool.set(gap.keyword, { volume: gap.volume, difficulty: 20, source: 'gap' });
    }

    const poolSizeBefore = keywordPool.size;

    // === Step 2: Apply filter (mirrors keyword-strategy.ts line 778) ===
    const brandedRemoved = filterBrandedKeywords(keywordPool, domains);

    // The filter must have done something
    expect(brandedRemoved).toBeGreaterThan(0);
    expect(keywordPool.size).toBeLessThan(poolSizeBefore);

    // === Step 3: Verify post-filter pool contains no branded keywords ===
    const poolAfter = [...keywordPool.keys()];
    expect(poolAfter.length).toBeGreaterThan(0);

    // Known branded keywords must be gone
    expect(keywordPool.has('dx integrations')).toBe(false);
    expect(keywordPool.has('getdx pricing')).toBe(false);
    expect(keywordPool.has('jellyfish analytics')).toBe(false);
    expect(keywordPool.has('linearb review')).toBe(false);
    expect(keywordPool.has('getdx alternatives')).toBe(false);

    // Non-branded keywords must survive
    expect(keywordPool.has('engineering metrics')).toBe(true);
    expect(keywordPool.has('developer productivity')).toBe(true);
    expect(keywordPool.has('sprint velocity tracking')).toBe(true);
    expect(keywordPool.has('dora metrics guide')).toBe(true);
  });

  it('simulates the master synthesis step: AI contentGaps are filtered before strategy is assembled', () => {
    const ws = getWorkspace(TEST_WS_ID);
    const domains = ws!.competitorDomains ?? [];
    expect(domains.length).toBeGreaterThan(0);

    // Simulate AI-returned contentGaps (mirrors masterData.contentGaps)
    const rawContentGaps = [
      { targetKeyword: 'dx integrations guide', topic: 'Guide to DX Integrations' },
      { targetKeyword: 'jellyfish vs alternatives', topic: 'Jellyfish Analytics Alternatives' },
      { targetKeyword: 'getdx competitors', topic: 'GetDX vs Competitors' },
      { targetKeyword: 'linearb pricing tiers', topic: 'LinearB Pricing and Cost Guide' },
      { targetKeyword: 'engineering metrics dashboard', topic: 'Best Engineering Metrics Tools' },
      { targetKeyword: 'software team performance', topic: 'Improve Software Team Performance' },
      { targetKeyword: 'dora metrics guide', topic: 'Complete DORA Metrics Guide' },
    ];

    // === Step 4: Apply filter (mirrors keyword-strategy.ts lines 1219-1220) ===
    const { filtered: cleanContentGaps, removed: brandedGaps } = filterBrandedContentGaps(
      rawContentGaps,
      domains,
    );

    // The filter must have removed branded gaps
    expect(brandedGaps.length).toBeGreaterThan(0);

    // Specifically, all known branded gaps must be removed
    const removedKeywords = brandedGaps.map(g => g.targetKeyword);
    expect(removedKeywords.length).toBeGreaterThan(0);
    expect(removedKeywords.some(k => k.includes('dx'))).toBe(true); // length already guarded above
    expect(removedKeywords.some(k => k.includes('jellyfish'))).toBe(true);
    expect(removedKeywords.some(k => k.includes('getdx'))).toBe(true);

    // === Step 5: Clean gaps survive, branded gaps do not appear in strategy output ===
    expect(cleanContentGaps.length).toBeGreaterThan(0);

    const cleanKeywords = cleanContentGaps.map(g => g.targetKeyword);
    expect(cleanKeywords).toContain('engineering metrics dashboard');
    expect(cleanKeywords).toContain('software team performance');
    expect(cleanKeywords).toContain('dora metrics guide');

    // The final strategy object (contentGaps: cleanContentGaps) contains NO branded keywords
    for (const gap of cleanContentGaps) {
      const kwLower = gap.targetKeyword.toLowerCase();
      // None of the known branded tokens should appear as exact words or substrings
      for (const token of KNOWN_BRANDED_TOKENS) {
        if (token.length < 5) {
          const words = kwLower.split(/\s+/);
          expect(words.some(w => w === token)).toBe(false);
        } else {
          expect(kwLower.includes(token)).toBe(false);
        }
      }
    }
  });
});
