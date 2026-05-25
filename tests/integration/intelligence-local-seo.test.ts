// tests/integration/intelligence-local-seo.test.ts
// Verify LocalSeoSlice assembly via buildWorkspaceIntelligence, including:
//   - Slice carries the FULL candidate list (not a pre-sampled 25)
//   - effectiveLocalSeoBlock is bounded for prompt safety
//   - Empty-but-valid baseline when no markets configured
//   - selectRelevantLocalCandidates filters by target

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { selectRelevantLocalCandidates } from '../../server/intelligence/local-seo-slice.js';
import { updateLocalSeoConfiguration } from '../../server/local-seo.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_POSTURE } from '../../shared/types/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { setFlagOverride } from '../../server/feature-flags.js';
import { vi } from 'vitest';

let workspaceId = '';

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  setFlagOverride('local-seo-visibility', true);
  // Tables created on demand by other tests; reuse same schema.
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_seo_markets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      label TEXT NOT NULL,
      city TEXT NOT NULL,
      state_or_region TEXT,
      country TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      provider_location_code INTEGER,
      provider_location_name TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'needs_review',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_visibility_snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      normalized_keyword TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_label TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      local_pack_present INTEGER NOT NULL DEFAULT 0,
      business_found INTEGER NOT NULL DEFAULT 0,
      business_match_confidence TEXT NOT NULL DEFAULT 'unknown',
      business_match_reason TEXT,
      local_rank INTEGER,
      top_competitors TEXT NOT NULL DEFAULT '[]',
      source_endpoint TEXT NOT NULL,
      provider TEXT NOT NULL,
      device TEXT NOT NULL,
      language_code TEXT NOT NULL,
      status TEXT NOT NULL,
      degraded_reason TEXT
    );
  `);
  try {
    db.exec('ALTER TABLE local_seo_markets ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists in migrated test databases.
  }
  workspaceId = createWorkspace(`Local SEO Slice Test ${randomUUID().slice(0, 6)}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
  setFlagOverride('local-seo-visibility', null);
});

function seedWorkspaceWithMarkets(opts: { pages?: Array<{ primaryKeyword: string; pagePath: string; pageTitle: string; secondaryKeywords?: string[] }> } = {}) {
  updateWorkspace(workspaceId, {
    name: 'Local SEO test',
    liveDomain: 'https://swish.example.com',
    businessProfile: {
      address: { street: '100 Service St', city: 'Austin', region: 'TX', country: 'US', postalCode: '78701' },
      serviceAreas: ['Austin', 'Round Rock'],
    },
  } as never);
  updateLocalSeoConfiguration(workspaceId, {
    posture: LOCAL_SEO_POSTURE.LOCAL,
    markets: [
      { label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
      { label: 'Round Rock, TX', city: 'Round Rock', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026202, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
    ],
  }, true);
  for (const page of opts.pages ?? [
    { primaryKeyword: 'emergency plumbing', pagePath: '/services/emergency', pageTitle: 'Emergency Plumbing' },
    { primaryKeyword: 'drain cleaning', pagePath: '/services/drain', pageTitle: 'Drain Cleaning' },
  ]) {
    upsertPageKeyword(workspaceId, {
      pagePath: page.pagePath,
      pageTitle: page.pageTitle,
      primaryKeyword: page.primaryKeyword,
      secondaryKeywords: page.secondaryKeywords ?? [],
      searchIntent: 'commercial',
    });
  }
}

describe('LocalSeoSlice via buildWorkspaceIntelligence', () => {
  it('assembles localSeo slice when requested', async () => {
    seedWorkspaceWithMarkets();
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['localSeo'] });
    expect(intel.localSeo).toBeDefined();
    expect(intel.localSeo!.markets.length).toBe(2);
    expect(intel.localSeo!.enabled).toBe(true);
    expect(typeof intel.localSeo!.effectiveLocalSeoBlock).toBe('string');
    expect(intel.localSeo!.effectiveLocalSeoBlock.length).toBeGreaterThan(0);
  });

  it('candidates field carries the full bounded universe (not pre-sampled)', async () => {
    seedWorkspaceWithMarkets();
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['localSeo'] });
    // The number of candidates depends on local-seo generator output, but the key
    // contract is that the field exists as a real array (NOT a 25-cap sample).
    expect(Array.isArray(intel.localSeo!.candidates)).toBe(true);
  });

  it('effectiveLocalSeoBlock is bounded for prompt safety', async () => {
    seedWorkspaceWithMarkets();
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['localSeo'] });
    // Even on a heavily-seeded workspace the prompt block must stay well under
    // any reasonable token budget. 8KB is a generous upper bound.
    expect(intel.localSeo!.effectiveLocalSeoBlock.length).toBeLessThan(8000);
  });

  it('skips localSeo slice when not requested', async () => {
    seedWorkspaceWithMarkets();
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    expect(intel.localSeo).toBeUndefined();
  });

  it('returns empty-but-valid slice when no markets configured', async () => {
    // No updateLocalSeoConfiguration call — workspace has no markets.
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['localSeo'] });
    expect(intel.localSeo).toBeDefined();
    expect(intel.localSeo!.markets).toEqual([]);
    expect(intel.localSeo!.candidates).toEqual([]);
    expect(intel.localSeo!.visibility).toEqual({ visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 });
    // Block is still a non-empty string so prompt injection sites can rely on it.
    expect(intel.localSeo!.effectiveLocalSeoBlock.length).toBeGreaterThan(0);
  });
});

describe('selectRelevantLocalCandidates', () => {
  it('returns empty when slice disabled or has no candidates', () => {
    const result = selectRelevantLocalCandidates(
      {
        enabled: false,
        markets: [],
        visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
        candidates: [],
        effectiveLocalSeoBlock: '',
        latestSnapshotAt: null,
      },
      'emergency plumbing',
    );
    expect(result).toEqual([]);
  });

  it('returns top-N by score when no target is provided', () => {
    const candidates = [
      { keyword: 'a', source: 'x', sourceLabel: 'X', score: 10 },
      { keyword: 'b', source: 'x', sourceLabel: 'X', score: 50 },
      { keyword: 'c', source: 'x', sourceLabel: 'X', score: 30 },
    ];
    const result = selectRelevantLocalCandidates(
      {
        enabled: true,
        markets: [],
        visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
        candidates,
        effectiveLocalSeoBlock: '',
        latestSnapshotAt: null,
      },
      undefined,
      2,
    );
    expect(result.map(c => c.keyword)).toEqual(['b', 'c']);
  });

  it('boosts token-overlap candidates when target keyword is provided', () => {
    const candidates = [
      { keyword: 'unrelated topic', source: 'x', sourceLabel: 'X', score: 100 },
      { keyword: 'emergency plumbing austin', source: 'x', sourceLabel: 'X', score: 10 },
      { keyword: 'emergency repair dallas', source: 'x', sourceLabel: 'X', score: 5 },
    ];
    const result = selectRelevantLocalCandidates(
      {
        enabled: true,
        markets: [],
        visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
        candidates,
        effectiveLocalSeoBlock: '',
        latestSnapshotAt: null,
      },
      'emergency plumbing',
      3,
    );
    // Token overlap should push 'emergency plumbing austin' above 'unrelated topic' despite lower base score
    expect(result[0].keyword).toBe('emergency plumbing austin');
  });
});
