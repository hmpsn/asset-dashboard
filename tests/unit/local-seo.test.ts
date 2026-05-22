import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  buildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordCandidatesEvaluated,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  createLocalSeoRefreshPlan,
  evaluateLocalBusinessMatch,
  getLocalSeoReadModel,
  runLocalSeoRefreshJob,
  updateLocalSeoConfiguration,
} from '../../server/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
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
      device TEXT NOT NULL DEFAULT 'desktop',
      language_code TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'success',
      degraded_reason TEXT
    );
  `);
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
    const match = evaluateLocalBusinessMatch(workspace, [{
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
    const match = evaluateLocalBusinessMatch(workspace, [{
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
    const match = evaluateLocalBusinessMatch(workspace, [{
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
    const match = evaluateLocalBusinessMatch(workspace, [{
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
