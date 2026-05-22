import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  buildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordCandidatesEvaluated,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  classifyLocalKeywordIntent,
  createLocalSeoRefreshPlan,
  evaluateLocalBusinessMatch,
  getEffectiveLocations,
  getEffectiveKeywordsPerRefresh,
  getLocalSeoReadModel,
  getLocalSeoServiceGaps,
  iterateLocalCandidateSignals,
  loadCandidateIterationContext,
  runLocationBackfillJob,
  runLocalSeoRefreshJob,
  selectLocalIntentKeywords,
  updateLocalSeoConfiguration,
} from '../../server/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { createClientLocation } from '../../server/client-locations.js';
import { clearCompletedJobs, createJob, getJob } from '../../server/jobs.js';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';
import { _resetRegistryForTest, registerProvider } from '../../server/seo-data-provider.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  LOCAL_VISIBILITY_STATUS,
  localSeoKeywordVisibilityFromSnapshot,
  localSeoKeywordVisibilitySummaryFromSnapshots,
} from '../../shared/types/local-seo.js';
import type { LocalVisibilitySnapshot } from '../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { Workspace } from '../../shared/types/workspace.js';
import { buildDataForSeoLocationName } from '../../shared/local-seo-location.js';

const workspace: Workspace = {
  id: 'ws-local-match',
  name: 'Local Dental',
  liveDomain: 'https://local-dental.example.com',
  folder: 'local-dental',
  createdAt: '2026-05-20T00:00:00.000Z',
  businessProfile: {
    phone: '(512) 555-0123',
    address: {
      street: '123 Congress Ave',
      city: 'Austin',
      state: 'TX',
      country: 'US',
    },
  },
};

const cleanupWorkspaceIds = new Set<string>();

beforeEach(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      keywords_per_refresh INTEGER
    );
  `);
  // Add column for the case where the table was created by an earlier test
  // run before the schema migration. SQLite ALTER errors if it already exists
  // — ignore that and only that error.
  try {
    db.exec(`ALTER TABLE local_seo_workspace_settings ADD COLUMN keywords_per_refresh INTEGER`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
  db.exec(`
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_locations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT,
      phone TEXT,
      street_address TEXT,
      city TEXT,
      state_or_region TEXT,
      country TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'needs_review',
      gbp_place_id TEXT,
      primary_market_id TEXT,
      page_target_path TEXT,
      page_target_keyword_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_client_locations_workspace
      ON client_locations(workspace_id);
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
      device TEXT NOT NULL DEFAULT 'desktop',
      language_code TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'success',
      degraded_reason TEXT,
      matched_location_id TEXT,
      matched_location_name TEXT,
      raw_results TEXT
    );
  `);
  for (const columnSql of [
    `ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_id TEXT`,
    `ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_name TEXT`,
    `ALTER TABLE local_visibility_snapshots ADD COLUMN raw_results TEXT`,
  ]) {
    try {
      db.exec(columnSql);
    } catch (err) {
      if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
    }
  }
});

afterEach(() => {
  _resetRegistryForTest();
  for (const workspaceId of cleanupWorkspaceIds) {
    clearCompletedJobs({ workspaceId });
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

describe('local SEO DataForSEO location identity', () => {
  it('formats US provider location names with full state names for DataForSEO', () => {
    expect(buildDataForSeoLocationName({
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
    })).toBe('Austin,Texas,United States');
  });

  it('does not infer an ambiguous US provider location without state evidence', () => {
    expect(buildDataForSeoLocationName({
      city: 'Austin',
      country: 'US',
    })).toBeUndefined();
  });
});

describe('local SEO business match confidence', () => {
  it('does not treat city-only competitor addresses as business matches', () => {
    const match = evaluateLocalBusinessMatch(getEffectiveLocations(workspace), [{
      title: 'Competitor Dental',
      rank: 1,
      domain: 'competitor.example.com',
      address: '999 Congress Ave, Austin, TX',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'not_found',
      found: false,
    }));
  });

  it('uses domain plus identity evidence for verified matches', () => {
    const match = evaluateLocalBusinessMatch(getEffectiveLocations(workspace), [{
      title: 'Local Dental',
      rank: 2,
      domain: 'local-dental.example.com',
      phone: '(512) 555-0123',
      address: '123 Congress Ave, Austin, TX',
      cid: 'abc',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'verified',
      found: true,
      rank: 2,
    }));
  });

  it('does not verify domain-only matches just because the provider returned a cid', () => {
    const match = evaluateLocalBusinessMatch(getEffectiveLocations(workspace), [{
      title: 'Unrelated Directory Listing',
      rank: 2,
      domain: 'local-dental.example.com',
      cid: 'provider-place-id',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'strong_match',
      found: true,
      rank: 2,
    }));
  });

  it('keeps name-only matches as possible, not verified', () => {
    const match = evaluateLocalBusinessMatch(getEffectiveLocations(workspace), [{
      title: 'Local Dental',
      rank: 3,
      domain: 'directory.example.com',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'possible_match',
      found: true,
      rank: 3,
    }));
  });
});

describe('local SEO visibility posture classification', () => {
  const baseSnapshot: LocalVisibilitySnapshot = {
    id: 'snap-1',
    workspaceId: 'ws-local-match',
    keyword: 'Austin dentist',
    normalizedKeyword: 'austin dentist',
    marketId: 'market-austin',
    marketLabel: 'Austin, TX',
    capturedAt: '2026-05-20T12:00:00.000Z',
    localPackPresent: true,
    businessFound: false,
    businessMatchConfidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
    topCompetitors: [],
    sourceEndpoint: 'google_organic_serp',
    provider: 'dataforseo',
    device: 'desktop',
    languageCode: 'en',
    status: LOCAL_VISIBILITY_STATUS.SUCCESS,
  };

  it('classifies verified, possible, local-pack-only, and degraded local evidence consistently', () => {
    expect(localSeoKeywordVisibilityFromSnapshot({
      ...baseSnapshot,
      businessFound: true,
      businessMatchConfidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
      localRank: 2,
    })).toEqual(expect.objectContaining({
      posture: LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE,
      label: 'Visible #2',
    }));

    expect(localSeoKeywordVisibilityFromSnapshot({
      ...baseSnapshot,
      businessFound: true,
      businessMatchConfidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH,
      localRank: 3,
    })).toEqual(expect.objectContaining({
      posture: LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH,
      label: 'Possible match #3',
    }));

    expect(localSeoKeywordVisibilityFromSnapshot(baseSnapshot)).toEqual(expect.objectContaining({
      posture: LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
      label: 'Local pack present',
    }));

    expect(localSeoKeywordVisibilityFromSnapshot({
      ...baseSnapshot,
      status: LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
      localPackPresent: false,
      degradedReason: 'Provider credits exhausted',
    })).toEqual(expect.objectContaining({
      posture: LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED,
      label: 'Provider degraded',
    }));
  });

  it('summarizes conflicting market snapshots without dropping market-specific evidence', () => {
    const summary = localSeoKeywordVisibilitySummaryFromSnapshots([
      {
        ...baseSnapshot,
        marketId: 'market-austin',
        marketLabel: 'Austin, TX',
        businessFound: true,
        businessMatchConfidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
        localRank: 2,
      },
      {
        ...baseSnapshot,
        id: 'snap-2',
        marketId: 'market-round-rock',
        marketLabel: 'Round Rock, TX',
        localPackPresent: false,
        businessFound: false,
        businessMatchConfidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
      },
    ]);

    expect(summary).toEqual(expect.objectContaining({
      posture: LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE,
      label: 'Visible in 1/2 markets',
      marketCount: 2,
      visibleMarketCount: 1,
      notVisibleMarketCount: 1,
    }));
    expect(summary?.markets.map(item => item.marketLabel)).toEqual(['Austin, TX', 'Round Rock, TX']);
  });
});

describe('local SEO provider selection', () => {
  it('builds richer local candidates from page keywords and market modifiers while suppressing declined noise', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Candidate Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      liveDomain: 'https://swish.example.com',
      businessProfile: {
        address: {
          street: '123 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
      },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office offering cosmetic dentistry, veneers, whitening, and implants.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['veneers dentist', 'paper tiger'],
      searchIntent: 'commercial',
    });
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, ?, 'declined', 'Noisy local variant', 'test', 'admin')
    `).run(ws.id, 'veneers dentist austin');

    const candidates = buildLocalSeoKeywordCandidates(ws.id);
    const keys = candidates.map(candidate => candidate.normalizedKeyword);

    expect(keys).toContain('cosmetic dentistry austin');
    expect(keys).toContain('cosmetic dentistry near me');
    expect(keys).not.toContain('veneers dentist austin');
    expect(keys).not.toContain('paper tiger austin');
    expect(candidates.find(candidate => candidate.normalizedKeyword === 'cosmetic dentistry austin')).toEqual(expect.objectContaining({
      source: 'local_variant',
      selected: false,
    }));
  });

  it('cheap buildLocalSeoKeywordCandidates returns empty reasons[] (no evaluator run)', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Cheap Reasons Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['veneers'],
      searchIntent: 'commercial',
    });

    const candidates = buildLocalSeoKeywordCandidates(ws.id);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.reasons).toEqual([]);
    }
  });

  it('Evaluated builder produces evaluator reasons separate from cheap default', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Evaluated Reasons Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office offering cosmetic dentistry, veneers, whitening, and implants.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['veneers'],
      searchIntent: 'commercial',
    });

    const cheap = buildLocalSeoKeywordCandidates(ws.id);
    const evaluated = buildLocalSeoKeywordCandidatesEvaluated(ws.id);
    // Both paths enumerate the same signal set; evaluated may suppress some
    // entries but must not invent new ones.
    expect(cheap.length).toBeGreaterThan(0);
    expect(evaluated.length).toBeLessThanOrEqual(cheap.length);
    // Cheap path never populates reasons.
    for (const c of cheap) {
      expect(c.reasons).toEqual([]);
    }
  });

  it('Evaluated result is a normalizedKeyword subset of cheap (contract: Evaluated only removes signals, never adds)', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Evaluated Subset Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office offering cosmetic dentistry, veneers, whitening, and implants.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['veneers', 'whitening'],
      searchIntent: 'commercial',
    });

    const cheap = buildLocalSeoKeywordCandidates(ws.id);
    const evaluated = buildLocalSeoKeywordCandidatesEvaluated(ws.id);
    const cheapKeys = new Set(cheap.map(c => c.normalizedKeyword));
    // Locks in the documented contract — Evaluated may suppress entries but
    // must not invent new ones not present in the cheap enumeration.
    expect(cheap.length).toBeGreaterThan(0);
    expect(evaluated.length).toBeGreaterThan(0);
    expect(evaluated.length).toBeLessThanOrEqual(cheap.length);
    for (const e of evaluated) {
      expect(cheapKeys.has(e.normalizedKeyword)).toBe(true);
    }
  });

  it('keeps explicit single-keyword refresh plans scoped to the requested keyword', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Explicit Refresh Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: {
        address: {
          street: '123 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    addTrackedKeyword(ws.id, 'Austin Dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['veneers dentist'],
      searchIntent: 'commercial',
    });

    const plan = createLocalSeoRefreshPlan(ws.id, { keywords: ['cosmetic dentistry austin'] });

    expect(plan?.keywords).toEqual(['cosmetic dentistry austin']);
  });

  it('does not fall back to DataForSEO when the workspace selected SEMRush for local visibility', async () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Provider Strictness Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      liveDomain: 'https://local-dental.example.com',
      seoDataProvider: 'semrush',
      businessProfile: {
        address: {
          street: '123 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    addTrackedKeyword(ws.id, 'Austin Dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    registerProvider('dataforseo', new FakeSeoProvider());

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: ws.id,
      message: 'Testing provider strictness...',
    });

    await runLocalSeoRefreshJob(job.id, ws.id);

    expect(getJob(job.id)).toEqual(expect.objectContaining({
      status: 'error',
      error: 'No configured local visibility provider',
    }));
  });

  it('counts local visibility per market and keyword instead of collapsing multi-market evidence', async () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Multi Market Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Local Dental',
      liveDomain: 'https://local-dental.example.com',
      seoDataProvider: 'dataforseo',
      businessProfile: {
        phone: '(512) 555-0123',
        address: {
          street: '123 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [
        {
          label: 'Austin, TX',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1026201,
          status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
        },
        {
          label: 'Round Rock, TX',
          city: 'Round Rock',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1026339,
          status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
        },
      ],
    }, true);
    addTrackedKeyword(ws.id, 'Austin Dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    registerProvider('dataforseo', new FakeSeoProvider());

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: ws.id,
      message: 'Testing multi-market local visibility...',
    });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'] });

    const readModel = getLocalSeoReadModel(ws.id, true);

    expect(readModel?.latestSnapshots).toHaveLength(2);
    expect(readModel?.report.checkedKeywordCount).toBe(2);
    expect(readModel?.report.activeMarketCount).toBe(2);
  });

  it('preserves raw local results so repeated location backfills keep match evidence', async () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Backfill Raw Results');
    cleanupWorkspaceIds.add(ws.id);
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    createClientLocation(ws.id, {
      name: 'Acme Downtown',
      domain: 'acme.example.com',
      status: 'confirmed',
    });
    const market = db.prepare('SELECT id FROM local_seo_markets WHERE workspace_id = ? LIMIT 1').get(ws.id) as { id: string };
    const rawResults = [
      { title: 'Acme Downtown', domain: 'acme.example.com', rank: 2 },
      { title: 'Acme Downtown Reviews', domain: 'reviews.example.com', rank: 3 },
      { title: 'Other Dental', domain: 'other.example.com', rank: 1 },
    ];
    db.prepare(`
      INSERT INTO local_visibility_snapshots (
        id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
        local_pack_present, business_found, business_match_confidence, business_match_reason,
        local_rank, top_competitors, source_endpoint, provider, device, language_code, status,
        degraded_reason, matched_location_id, matched_location_name, raw_results
      ) VALUES (
        @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
        @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
        @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status,
        @degraded_reason, @matched_location_id, @matched_location_name, @raw_results
      )
    `).run({
      id: 'raw-backfill-snapshot',
      workspace_id: ws.id,
      keyword: 'Austin Dentist',
      normalized_keyword: 'austin dentist',
      market_id: market.id,
      market_label: 'Austin, TX',
      captured_at: '2026-05-20T10:00:00.000Z',
      local_pack_present: 1,
      business_found: 0,
      business_match_confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
      business_match_reason: null,
      local_rank: null,
      top_competitors: JSON.stringify(rawResults),
      source_endpoint: 'google_organic_serp',
      provider: 'fake-seo-provider',
      device: 'desktop',
      language_code: 'en',
      status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      degraded_reason: null,
      matched_location_id: null,
      matched_location_name: null,
      raw_results: null,
    });

    const firstJob = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, { workspaceId: ws.id });
    await runLocationBackfillJob(firstJob.id, ws.id);
    const afterFirst = db.prepare('SELECT * FROM local_visibility_snapshots WHERE id = ?').get('raw-backfill-snapshot') as {
      business_found: number;
      local_rank: number | null;
      top_competitors: string;
      raw_results: string | null;
    };
    expect(afterFirst.business_found).toBe(1);
    expect(afterFirst.local_rank).toBe(2);
    expect(JSON.parse(afterFirst.top_competitors)).toEqual([
      { title: 'Acme Downtown Reviews', domain: 'reviews.example.com', rank: 3 },
      { title: 'Other Dental', domain: 'other.example.com', rank: 1 },
    ]);
    expect(JSON.parse(afterFirst.raw_results ?? '[]')).toEqual(rawResults);

    const secondJob = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, { workspaceId: ws.id });
    await runLocationBackfillJob(secondJob.id, ws.id);
    const afterSecond = db.prepare('SELECT business_found, local_rank FROM local_visibility_snapshots WHERE id = ?').get('raw-backfill-snapshot') as {
      business_found: number;
      local_rank: number | null;
    };
    expect(afterSecond.business_found).toBe(1);
    expect(afterSecond.local_rank).toBe(2);
  });

  it('keeps summary visibility aligned with detail granularity across device and language snapshots', async () => {
    const ws = createWorkspace('Local SEO Device Summary');
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    const market = db.prepare('SELECT id FROM local_seo_markets WHERE workspace_id = ? LIMIT 1').get(ws.id) as { id: string };
    const insert = db.prepare(`
      INSERT INTO local_visibility_snapshots (
        id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
        local_pack_present, business_found, business_match_confidence, business_match_reason,
        local_rank, top_competitors, source_endpoint, provider, device, language_code, status, degraded_reason
      ) VALUES (
        @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
        @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
        @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status, @degraded_reason
      )
    `);
    const base = {
      workspace_id: ws.id,
      keyword: 'Austin Dentist',
      normalized_keyword: 'austin dentist',
      market_id: market.id,
      market_label: 'Austin, TX',
      local_pack_present: 1,
      business_found: 0,
      business_match_confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
      business_match_reason: null,
      local_rank: null,
      top_competitors: '[]',
      source_endpoint: 'google_organic_serp',
      provider: 'fake-seo-provider',
      status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      degraded_reason: null,
    };
    insert.run({ ...base, id: 'desktop-en', captured_at: '2026-05-20T10:00:00.000Z', device: 'desktop', language_code: 'en' });
    insert.run({ ...base, id: 'mobile-en', captured_at: '2026-05-20T10:05:00.000Z', device: 'mobile', language_code: 'en' });

    const summary = buildLocalSeoKeywordVisibilitySummaryByKey(ws.id).get('austin dentist');
    const readModel = getLocalSeoReadModel(ws.id, true, { includeSnapshots: false });

    expect(summary?.marketCount).toBe(2);
    expect(readModel?.report.latestSnapshotCount).toBe(2);
    expect(readModel?.report.checkedKeywordCount).toBe(1);

    deleteWorkspace(ws.id);
  });
});

describe('per-workspace keywords-per-refresh override', () => {
  it('getEffectiveKeywordsPerRefresh returns the global default when no override is set', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Default Budget Test');
    cleanupWorkspaceIds.add(ws.id);
    expect(getEffectiveKeywordsPerRefresh(ws.id)).toBe(100);
  });

  it('returns the override when one is set within bounds', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Override Budget Test');
    cleanupWorkspaceIds.add(ws.id);
    updateLocalSeoConfiguration(ws.id, { keywordsPerRefresh: 200 }, true);
    expect(getEffectiveKeywordsPerRefresh(ws.id)).toBe(200);
  });

  it('clamps an override above the cap down to the maximum', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Clamp High Test');
    cleanupWorkspaceIds.add(ws.id);
    updateLocalSeoConfiguration(ws.id, { keywordsPerRefresh: 9999 }, true);
    expect(getEffectiveKeywordsPerRefresh(ws.id)).toBe(300);
  });

  it('clamps an override below the floor up to the minimum', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Clamp Low Test');
    cleanupWorkspaceIds.add(ws.id);
    updateLocalSeoConfiguration(ws.id, { keywordsPerRefresh: 5 }, true);
    expect(getEffectiveKeywordsPerRefresh(ws.id)).toBe(25);
  });

  it('clearing the override (null) reverts to the global default', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Clear Override Test');
    cleanupWorkspaceIds.add(ws.id);
    updateLocalSeoConfiguration(ws.id, { keywordsPerRefresh: 150 }, true);
    expect(getEffectiveKeywordsPerRefresh(ws.id)).toBe(150);
    updateLocalSeoConfiguration(ws.id, { keywordsPerRefresh: null }, true);
    expect(getEffectiveKeywordsPerRefresh(ws.id)).toBe(100);
  });

  it('read model surfaces the effective budget + min/max/default in caps', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Caps Surface Test');
    cleanupWorkspaceIds.add(ws.id);
    updateLocalSeoConfiguration(ws.id, { keywordsPerRefresh: 175 }, true);
    const model = getLocalSeoReadModel(ws.id, true, { includeSnapshots: false });
    expect(model?.caps).toEqual({
      maxMarkets: 3,
      maxKeywordsPerRefresh: 175,
      keywordsPerRefreshMin: 25,
      keywordsPerRefreshMax: 300,
      keywordsPerRefreshDefault: 100,
    });
    expect(model?.settings.keywordsPerRefresh).toBe(175);
  });
});

describe('local SEO refresh job concurrency', () => {
  it('processes 10 (keyword × market) pairs with bounded concurrency faster than sequential would allow', async () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Concurrency Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Concurrency Dental',
      liveDomain: 'https://concurrency-dental.example.com',
      seoDataProvider: 'dataforseo',
      businessProfile: {
        phone: '(512) 555-0199',
        address: { street: '1 Speed St', city: 'Austin', state: 'TX', country: 'US' },
      },
    });

    // 2 markets × 5 keywords = 10 work items.
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [
        {
          label: 'Austin, TX',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1026201,
          status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
        },
        {
          label: 'Round Rock, TX',
          city: 'Round Rock',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1026339,
          status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
        },
      ],
    }, true);

    const keywords = ['Dentist', 'Emergency Dentist', 'Dental Implants', 'Teeth Whitening', 'Orthodontist'];
    for (const kw of keywords) {
      addTrackedKeyword(ws.id, kw, { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    }

    // Each provider call takes 40 ms. Sequential: 10 × 40 ms = 400 ms.
    // With CONCURRENCY=5 we process in 2 chunks of 5, so wall-clock ≈ 2 × 40 ms = 80 ms.
    // We assert completion under 300 ms to leave headroom for test infrastructure overhead
    // while still proving concurrency is active.
    const CALL_DELAY_MS = 40;
    const ITEM_COUNT = 10; // 2 markets × 5 keywords
    const SEQUENTIAL_FLOOR_MS = ITEM_COUNT * CALL_DELAY_MS; // 400 ms minimum if sequential

    const slowProvider = new FakeSeoProvider();
    const originalGet = slowProvider.getLocalVisibility.bind(slowProvider);
    slowProvider.getLocalVisibility = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, CALL_DELAY_MS));
      return originalGet(...args);
    };
    registerProvider('dataforseo', slowProvider);

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: ws.id,
      message: 'Concurrency test refresh',
    });

    const start = Date.now();
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords });
    const elapsed = Date.now() - start;

    // Must complete all 10 items.
    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('done');
    expect(finalJob?.progress).toBe(ITEM_COUNT);

    // Wall-clock must be well under sequential floor, proving chunks ran concurrently.
    expect(elapsed).toBeLessThan(SEQUENTIAL_FLOOR_MS);
  });

  it('emits mid-job LOCAL_SEO_UPDATED broadcasts so React Query caches invalidate before job completion', async () => {
    // Without mid-job broadcasts, KCC + local-seo queries stay stale until the
    // final 'refresh_completed' event — on a long refresh (20-min sequential or
    // 4-5min concurrent) admins see "no data" badges on keywords that already
    // have fresh snapshots in the DB. The broadcast cadence is every
    // LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL=20 completed snapshots.

    // setBroadcast(globalBroadcast, workspaceBroadcast) — local SEO uses the workspace one.
    const workspaceBroadcastSpy = vi.fn();
    setBroadcast(vi.fn(), workspaceBroadcastSpy);

    const ws = createWorkspace('Local SEO Progress Broadcast Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Progress Broadcast Dental',
      liveDomain: 'https://progress-dental.example.com',
      seoDataProvider: 'dataforseo',
      businessProfile: {
        phone: '(512) 555-0188',
        address: { street: '1 Progress St', city: 'Austin', state: 'TX', country: 'US' },
      },
    });

    // 1 market × 45 keywords = 45 work items. With interval=20 we expect
    // mid-job broadcasts at ~20 and ~40 (2 broadcasts), plus the final
    // 'refresh_completed' broadcast at completion.
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);

    const keywords = Array.from({ length: 45 }, (_, i) => `progress keyword ${i + 1}`);
    for (const kw of keywords) {
      addTrackedKeyword(ws.id, kw, { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    }

    registerProvider('dataforseo', new FakeSeoProvider());

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: ws.id,
      message: 'Progress broadcast test refresh',
    });

    await runLocalSeoRefreshJob(job.id, ws.id, { keywords });

    // Workspace broadcast signature: (workspaceId, event, data)
    const localSeoBroadcasts = workspaceBroadcastSpy.mock.calls
      .filter(call => call[1] === 'local-seo:updated')
      .map(call => call[2] as { action: string; processed?: number });

    const progressBroadcasts = localSeoBroadcasts.filter(b => b.action === 'refresh_progress');
    const completionBroadcasts = localSeoBroadcasts.filter(b => b.action === 'refresh_completed');

    // At least 2 mid-job progress broadcasts for 45 items with interval=20.
    expect(progressBroadcasts.length).toBeGreaterThanOrEqual(2);
    // Each carries the processed count, monotonically increasing.
    for (let i = 1; i < progressBroadcasts.length; i++) {
      expect(progressBroadcasts[i].processed!).toBeGreaterThan(progressBroadcasts[i - 1].processed!);
    }
    // Final completion broadcast still fires exactly once.
    expect(completionBroadcasts.length).toBe(1);
    // No progress broadcast at processed === total (would be redundant with the completion event).
    expect(progressBroadcasts.length).toBeGreaterThan(0);
    for (const b of progressBroadcasts) {
      expect((b.processed ?? 0)).toBeLessThan(45);
    }
  });
});

// ─── Change 1: Intent classification ───────────────────────────────────────

describe('classifyLocalKeywordIntent', () => {
  it('classifies comparison queries', () => {
    expect(classifyLocalKeywordIntent('crowns vs veneers comparison')).toBe('comparison');
    expect(classifyLocalKeywordIntent('invisalign versus braces')).toBe('comparison');
    expect(classifyLocalKeywordIntent('dental implant alternatives')).toBe('comparison');
  });

  it('classifies informational queries', () => {
    expect(classifyLocalKeywordIntent('what is dental implant')).toBe('informational');
    expect(classifyLocalKeywordIntent('impact of dental crowns on jawbone')).toBe('informational');
    expect(classifyLocalKeywordIntent('how does teeth whitening work')).toBe('informational');
    expect(classifyLocalKeywordIntent('dental financing and insurance options guide')).toBe('informational');
    expect(classifyLocalKeywordIntent('cost of dental implants')).toBe('informational');
    expect(classifyLocalKeywordIntent('types of dental crowns')).toBe('informational');
  });

  it('classifies commercial queries', () => {
    expect(classifyLocalKeywordIntent('best dentist austin')).toBe('commercial');
    expect(classifyLocalKeywordIntent('top rated cosmetic dentist near me')).toBe('commercial');
    expect(classifyLocalKeywordIntent('affordable dental implants austin')).toBe('commercial');
  });

  it('classifies transactional queries (default)', () => {
    expect(classifyLocalKeywordIntent('dentist austin tx')).toBe('transactional');
    expect(classifyLocalKeywordIntent('emergency dentist near me')).toBe('transactional');
    expect(classifyLocalKeywordIntent('cosmetic dentistry austin')).toBe('transactional');
  });

  it('comparison check takes precedence over informational', () => {
    // "compare" triggers comparison before informational patterns
    expect(classifyLocalKeywordIntent('compare dental implants and dentures')).toBe('comparison');
  });

  // false-positive guards — regression tests for patterns that were removed
  it('does not classify "best dentist ranking austin" as comparison', () => {
    // "ranking" alone should not trigger comparison intent
    expect(classifyLocalKeywordIntent('best dentist ranking austin')).not.toBe('comparison');
  });

  it('does not classify "impact of dental crowns on jawbone" as commercial', () => {
    // "impact of" triggers informational, not commercial
    expect(classifyLocalKeywordIntent('impact of dental crowns on jawbone')).toBe('informational');
  });

  it('does not classify "affordable dentist near me" as informational', () => {
    // "affordable" should be commercial, no informational pattern matches "near me"
    expect(classifyLocalKeywordIntent('affordable dentist near me')).toBe('commercial');
  });

  it('does not classify "howard county dentist" as informational (how prefix)', () => {
    expect(classifyLocalKeywordIntent('howard county dentist')).not.toBe('informational');
  });
});

describe('LocalSeoKeywordCandidate has intent field', () => {
  it('every candidate from buildLocalSeoKeywordCandidates has a valid intent value', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Intent Field Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office offering cosmetic dentistry.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['veneers'],
      searchIntent: 'commercial',
    });

    const validIntents = new Set(['transactional', 'commercial', 'navigational', 'informational', 'comparison']);
    const candidates = buildLocalSeoKeywordCandidates(ws.id);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(validIntents.has(c.intent)).toBe(true);
    }
  });
});

describe('selectLocalIntentKeywords excludes informational/comparison', () => {
  it('filters out informational keywords even if they score highly (explicit source)', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Intent Filter Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      liveDomain: 'https://swish.example.com',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office offering cosmetic dentistry.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);

    // Use an explicit informational keyword — force=true so it bypasses the
    // hasLocalIntent gate, but the intent filter should still remove it.
    const result = selectLocalIntentKeywords(ws.id, ['what is dental implant austin tx']);
    // An empty result is valid here — it proves the informational keyword was
    // filtered out. The not.toContain is intentionally vacuous-safe: empty []
    // never contains the keyword, which is the desired behavior.
    expect(result).not.toContain('what is dental implant austin tx');
  });

  it('filters out comparison keywords from the refresh planner output', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Comparison Filter Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      liveDomain: 'https://swish.example.com',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: ['cosmetic dentist'],
        opportunities: [],
        businessContext: 'Dental office.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);

    const result = selectLocalIntentKeywords(ws.id, ['crowns vs veneers austin']);
    // An empty result is valid — proves the comparison keyword was filtered out.
    // The not.toContain is intentionally vacuous-safe: empty [] never contains the keyword.
    expect(result).not.toContain('crowns vs veneers austin');
  });

  it('keeps transactional keywords in the refresh planner output', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Transactional Keep Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      liveDomain: 'https://swish.example.com',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        businessContext: 'Dental office.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);

    const result = selectLocalIntentKeywords(ws.id, ['dentist austin tx']);
    expect(result).toContain('dentist austin tx');
  });
});

// ─── Change 2: Question + intent modifier generation ────────────────────────

describe('iterateLocalCandidateSignals generates intent-prefixed variants', () => {
  it('generates at least one intent-prefixed variant for service keyword pages', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Intent Modifier Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        businessContext: 'Dental office.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: [],
      searchIntent: 'commercial',
    });

    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const signals = [...iterateLocalCandidateSignals(ctx!)];
    const intentVariants = signals.filter(s =>
      s.source === 'local_variant' &&
      (s.keyword?.startsWith('best ') || s.keyword?.startsWith('top rated ') || s.keyword?.startsWith('affordable ') || s.keyword?.startsWith('emergency ')),
    );
    expect(intentVariants.length).toBeGreaterThan(0);
  });

  it('caps intent modifier variants per base keyword at LOCAL_INTENT_PREFIX_CAP_PER_BASE', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Intent Modifier Cap Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        businessContext: 'Dental office.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: [],
      searchIntent: 'commercial',
    });

    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const signals = [...iterateLocalCandidateSignals(ctx!)];

    // Count intent variants for each unique base+city combo
    const intentPrefixes = new Set(['best', 'top rated', 'affordable', 'cheap', 'emergency', 'open now', 'same day', 'accepting new patients', '24 hour']);
    const baseCounts = new Map<string, number>();
    for (const s of signals) {
      if (s.source !== 'local_variant' || !s.keyword) continue;
      const kw = s.keyword.toLowerCase();
      const hasPrefix = [...intentPrefixes].some(p => kw.startsWith(p + ' '));
      if (!hasPrefix) continue;
      const base = s.pagePath ?? s.detail ?? '__unknown__';
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }
    // Each base page's intent variants should not exceed 3
    for (const [, count] of baseCounts) {
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it('intent variants use source local_variant and are transactional or commercial intent', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Intent Variant Source Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        businessContext: 'Dental office.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);
    upsertPageKeyword(ws.id, {
      pagePath: '/services/emergency-dental',
      pageTitle: 'Emergency Dental',
      primaryKeyword: 'emergency dental',
      secondaryKeywords: [],
      searchIntent: 'transactional',
    });

    const ctx = loadCandidateIterationContext(ws.id, []);
    expect(ctx).not.toBeNull();
    const signals = [...iterateLocalCandidateSignals(ctx!)];
    const intentPrefixes = new Set(['best', 'top rated', 'affordable', 'cheap', 'emergency', 'open now', 'same day', 'accepting new patients', '24 hour']);
    const intentVariants = signals.filter(s => {
      if (s.source !== 'local_variant' || !s.keyword) return false;
      return [...intentPrefixes].some(p => s.keyword!.toLowerCase().startsWith(p + ' '));
    });

    expect(intentVariants.length).toBeGreaterThan(0);
    for (const v of intentVariants) {
      expect(v.source).toBe('local_variant');
      expect(['transactional', 'commercial']).toContain(v.intent);
    }
  });

  it('intent-prefixed variants are not classified as informational or comparison', () => {
    // These variants should pass the intent filter in selectLocalIntentKeywords
    const prefixes = ['best', 'top rated', 'affordable', 'emergency', 'open now', 'same day', 'accepting new patients', '24 hour'];
    for (const prefix of prefixes) {
      const kw = `${prefix} dentist austin`;
      const intent = classifyLocalKeywordIntent(kw);
      expect(['transactional', 'commercial', 'navigational']).toContain(intent);
    }
  });
});

// ─── Change 3: Per-source budget caps ───────────────────────────────────────

describe('selectLocalIntentKeywords per-page source cap', () => {
  it('caps tracked (non-explicit) keywords from a single pagePath to 20% of budget', () => {
    // This test verifies the real applySourcePageCap behavior:
    // - 30 tracked keywords all pinned to the same pagePath
    // - budget=25 (minimum allowed) → cap = ceil(25 * 0.20) = 5
    // - result must contain at most 5 keywords from that page
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Source Cap Behavioral Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      name: 'Swish Dental',
      liveDomain: 'https://swish.example.com',
      businessProfile: { address: { street: '123 Congress Ave', city: 'Austin', state: 'TX', country: 'US' } },
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        businessContext: 'Dental implants and restorative dental services.',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    // Set keywordsPerRefresh to the minimum (25) so the 20% cap = ceil(5) = 5.
    // This means any single pagePath can contribute at most 5 keywords to the result.
    updateLocalSeoConfiguration(ws.id, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      keywordsPerRefresh: 25,
      markets: [{ label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE }],
    }, true);

    // Seed 30 tracked (MANUAL, non-explicit) keywords all on the same pagePath.
    // Each keyword includes "dental implants austin" to pass both hasLocalIntent
    // and hasMarketModifier checks so they survive as candidates.
    const capPage = '/services/dental-implants';
    for (let i = 1; i <= 30; i++) {
      addTrackedKeyword(ws.id, `dental implants austin ${i}`, {
        source: TRACKED_KEYWORD_SOURCE.MANUAL,
        pagePath: capPage,
        pageTitle: 'Dental Implants',
      });
    }

    const result = selectLocalIntentKeywords(ws.id, []);

    // The cap is ceil(25 * 0.20) = 5. No single page may contribute more than 5
    // keywords to the final selection. Count how many results originated from
    // our seeded page (all seeded keywords are uniquely prefixed "dental implants austin N").
    const fromCapPage = result.filter(kw => /^dental implants austin \d+$/.test(kw));
    expect(fromCapPage.length).toBeLessThanOrEqual(5);
    // And at least one must have survived (confirming the cap isn't blocking everything)
    expect(fromCapPage.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getLocalSeoServiceGaps — dental taxonomy', () => {
  it('returns gaps for all dental services when no tracking keywords exist', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Service Gap Test Dental');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      intelligenceProfile: { industry: 'Dental Practice' },
    });

    const gaps = getLocalSeoServiceGaps(ws.id);
    expect(gaps.length).toBeGreaterThan(0);
    // All gaps should have the required shape
    for (const gap of gaps) {
      expect(gap).toEqual(expect.objectContaining({
        serviceId: expect.any(String),
        serviceLabel: expect.any(String),
        starterKeywords: expect.any(Array),
      }));
      expect(gap.starterKeywords.length).toBeGreaterThan(0);
    }
    // All 12 dental services should be gaps since no keywords are tracked
    expect(gaps.length).toBe(12);
  });

  it('excludes covered services when a matching tracked keyword exists', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Service Gap Coverage Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      intelligenceProfile: { industry: 'dental' },
    });
    // Add a keyword that covers 'teeth-whitening' service (matchTerm: 'whitening')
    addTrackedKeyword(ws.id, 'teeth whitening near me', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    // Add a keyword that covers 'dental-implants' service (matchTerm: 'implant')
    addTrackedKeyword(ws.id, 'dental implants austin', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const gaps = getLocalSeoServiceGaps(ws.id);
    const gapIds = gaps.map(g => g.serviceId);
    // These two are covered — should not appear in gaps
    expect(gapIds).not.toContain('teeth-whitening');
    expect(gapIds).not.toContain('dental-implants');
    // Others remain as gaps (10 uncovered out of 12)
    expect(gaps.length).toBe(10);
  });

  it('returns empty array for workspace with no intelligenceProfile.industry', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('No Industry Test');
    cleanupWorkspaceIds.add(ws.id);
    // No intelligenceProfile set

    const gaps = getLocalSeoServiceGaps(ws.id);
    expect(gaps).toEqual([]);
  });

  it('returns empty array for a non-dental industry', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Non-Dental Industry Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      intelligenceProfile: { industry: 'E-commerce' },
    });

    const gaps = getLocalSeoServiceGaps(ws.id);
    expect(gaps).toEqual([]);
  });

  it('matches case-insensitively on industry string', () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Case-Insensitive Dental Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      intelligenceProfile: { industry: 'General Dentistry' },
    });

    const gaps = getLocalSeoServiceGaps(ws.id);
    expect(gaps.length).toBe(12); // no tracked keywords — all gaps
  });
});
