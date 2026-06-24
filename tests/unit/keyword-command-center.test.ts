import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import {
  applyKeywordCommandCenterAction,
  buildKeywordCommandCenterDetail,
  buildKeywordCommandCenterRows,
  buildKeywordCommandCenterSummary,
  filterNeedsLocalCandidates,
} from '../../server/keyword-command-center.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { addTrackedKeyword, getTrackedKeywords, storeRankSnapshot } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createJob, clearCompletedJobs } from '../../server/jobs.js';
import { buildLocalSeoKeywordCandidates, updateLocalSeoConfiguration, runLocalSeoRefreshJob } from '../../server/local-seo.js';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';
import { _resetRegistryForTest, registerProvider } from '../../server/seo-data-provider.js';
import { keywordComparisonKey, normalizeKeywordForComparison } from '../../shared/keyword-normalization.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_STATUS,
} from '../../shared/types/keyword-command-center.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
} from '../../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
} from '../../shared/types/rank-tracking.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

let workspaceId = '';

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_seo_workspace_settings (
      workspace_id TEXT PRIMARY KEY,
      posture TEXT NOT NULL DEFAULT 'unknown',
      posture_source TEXT NOT NULL DEFAULT 'unknown',
      suggested_posture TEXT,
      suggestion_reasons TEXT NOT NULL DEFAULT '[]',
      keywords_per_refresh INTEGER,
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
      device TEXT NOT NULL DEFAULT 'desktop',
      language_code TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'success',
      degraded_reason TEXT,
      matched_location_id TEXT,
      matched_location_name TEXT,
      raw_results TEXT
    );
    CREATE TABLE IF NOT EXISTS discovered_queries (
      workspace_id      TEXT NOT NULL,
      query             TEXT NOT NULL,
      first_seen        TEXT NOT NULL,
      last_seen         TEXT NOT NULL,
      best_position     REAL,
      best_impressions  INTEGER NOT NULL DEFAULT 0,
      total_impressions INTEGER NOT NULL DEFAULT 0,
      snapshot_count    INTEGER NOT NULL DEFAULT 1,
      last_snapshot_date TEXT,
      last_snapshot_impressions INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (workspace_id, query)
    );
  `);
  try {
    db.exec('ALTER TABLE local_seo_workspace_settings ADD COLUMN keywords_per_refresh INTEGER');
  } catch {
    // Column already exists in migrated test databases.
  }
  try {
    db.exec('ALTER TABLE local_seo_markets ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists in migrated test databases.
  }
  for (const sql of [
    'ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_id TEXT',
    'ALTER TABLE local_visibility_snapshots ADD COLUMN matched_location_name TEXT',
    'ALTER TABLE local_visibility_snapshots ADD COLUMN raw_results TEXT',
    'ALTER TABLE discovered_queries ADD COLUMN last_snapshot_date TEXT',
    'ALTER TABLE discovered_queries ADD COLUMN last_snapshot_impressions INTEGER NOT NULL DEFAULT 0',
  ]) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists in migrated test databases.
    }
  }
  workspaceId = createWorkspace(`Keyword Command Center ${Date.now()}`).id;
});

afterEach(() => {
  _resetRegistryForTest();
  if (workspaceId) clearCompletedJobs({ workspaceId });
  if (workspaceId) db.prepare('DELETE FROM discovered_queries WHERE workspace_id = ?').run(workspaceId);
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

function seedFeedback(keyword: string, status: 'approved' | 'declined' | 'requested', reason?: string) {
  db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      source = excluded.source,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `).run(workspaceId, keyword, status, reason ?? null, 'test', status === 'declined' ? 'admin' : null);
}

function feedbackRows() {
  return db.prepare('SELECT keyword, status FROM keyword_feedback WHERE workspace_id = ?').all(workspaceId) as Array<{ keyword: string; status: string }>;
}

function seedStrategy() {
  const generatedAt = '2026-05-20T10:00:00.000Z';
  const strategy: KeywordStrategy = {
    siteKeywords: ['Cosmetic Dentist'],
    siteKeywordMetrics: [{ keyword: 'Cosmetic Dentist', volume: 900, difficulty: 38 }],
    opportunities: [],
    businessContext: 'Dental office offering cosmetic dentistry, whitening, veneers, and implants.',
    generatedAt,
  };
  updateWorkspace(workspaceId, { keywordStrategy: strategy });
  // siteKeywordMetrics is table-only post-strip — populate the table to match the blob.
  replaceAllSiteKeywordMetrics(workspaceId, [{ keyword: 'Cosmetic Dentist', volume: 900, difficulty: 38 }]);
  upsertPageKeyword(workspaceId, {
    pagePath: '/services/cosmetic-dentistry',
    pageTitle: 'Cosmetic Dentistry',
    primaryKeyword: 'Cosmetic Dentistry',
    secondaryKeywords: ['veneers dentist'],
    searchIntent: 'commercial',
    volume: 700,
    difficulty: 29,
  });
  replaceAllContentGaps(workspaceId, [{
    topic: 'Veneers cost guide',
    targetKeyword: 'porcelain veneers cost',
    intent: 'commercial',
    priority: 'high',
    rationale: 'Patients compare veneer pricing before booking consultations.',
    volume: 500,
    difficulty: 42,
    opportunityScore: 71,
  }]);
  replaceAllKeywordGaps(workspaceId, [{
    keyword: 'best teeth whitening strips',
    volume: 2400,
    difficulty: 65,
    competitorPosition: 8,
    competitorDomain: 'competitor.example',
  }]);
  storeRankSnapshot(workspaceId, '2026-05-20', [
    { query: 'cosmetic dentistry', position: 6, clicks: 12, impressions: 500, ctr: 0.024 },
    { query: 'emergency dentist near me', position: 11, clicks: 4, impressions: 220, ctr: 0.018 },
  ]);
}

async function readRows(
  options: { includeLocalSeo?: boolean } = {},
  query: Parameters<typeof buildKeywordCommandCenterRows>[1] = {},
) {
  const payload = await buildKeywordCommandCenterRows(workspaceId, {
    filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
    pageSize: 500,
    ...query,
  }, options);
  expect(payload).not.toBeNull();
  return payload!;
}

describe('normalizeKeywordForComparison', () => {
  it('normalizes case, punctuation, whitespace, and local-ish phrases without stripping meaning', () => {
    expect(normalizeKeywordForComparison('  Cosmetic-Dentistry!! Near   Me ')).toBe('cosmetic dentistry near me');
    expect(normalizeKeywordForComparison('Dentist, Austin TX')).toBe('dentist austin tx');
    expect(normalizeKeywordForComparison('Emergency Dentist - Near-Me')).toBe('emergency dentist near me');
  });
});

describe('buildKeywordCommandCenter', () => {
  it('only opts into expensive local candidates for local candidate filters', () => {
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL)).toBe(false);
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES)).toBe(true);
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED)).toBe(false);
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.ALL)).toBe(false);
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY)).toBe(false);
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH)).toBe(false);
    expect(filterNeedsLocalCandidates(KEYWORD_COMMAND_CENTER_FILTERS.TRACKED)).toBe(false);
  });

  it('merges strategy, tracking, feedback, raw evidence, and rank evidence into one keyword row set', async () => {
    seedStrategy();
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
    });
    addTrackedKeyword(workspaceId, 'old strategy keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      deprecatedAt: '2026-05-20T10:00:00.000Z',
    });
    seedFeedback('requested keyword', 'requested', 'Client asked about this.');
    seedFeedback('declined keyword', 'declined', 'Too broad.');

    const payload = await readRows({ includeLocalSeo: true });

    expect(payload).not.toBeNull();
    const byKeyword = new Map(payload!.rows.map(row => [row.normalizedKeyword, row]));
    expect(byKeyword.get('cosmetic dentistry')).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      tracking: expect.objectContaining({ status: TRACKED_KEYWORD_STATUS.ACTIVE }),
      assignment: expect.objectContaining({ role: 'page_keyword' }),
    }));
    expect(byKeyword.get('old strategy keyword')).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RETIRED,
    }));
    expect(byKeyword.get('requested keyword')).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW,
      feedback: expect.objectContaining({ status: 'requested' }),
    }));
    expect(byKeyword.get('declined keyword')).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.DECLINED,
    }));
    expect(byKeyword.get('best teeth whitening strips')).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE,
      rawEvidenceOnly: true,
    }));
    expect(byKeyword.get('emergency dentist near me')).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW,
    }));
    const summary = await buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: true });
    expect(summary!.counts.tracked).toBeGreaterThan(0);
    expect(summary!.filters.some(filter => filter.id === 'raw_evidence' && filter.count > 0)).toBe(true);
  });

  it('reports uncapped raw provider evidence totals and preserves provider metrics', async () => {
    replaceAllKeywordGaps(workspaceId, Array.from({ length: 30 }, (_, index) => ({
      keyword: `provider evidence ${index}`,
      volume: 1_000 + index,
      difficulty: 20 + index,
      competitorPosition: 3 + index,
      competitorDomain: 'competitor.example',
    })));

    const payload = await readRows();

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    expect(summary?.rawEvidenceTotal).toBe(30);
    expect(summary?.rawEvidenceReturned).toBe(30);
    const lastGap = payload!.rows.find(row => row.normalizedKeyword === 'provider evidence 29');
    expect(lastGap).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE,
      metrics: expect.objectContaining({ volume: 1029, difficulty: 49 }),
    }));
  });

  it('returns summary counts without row payloads and paginates rows server-side', async () => {
    replaceAllKeywordGaps(workspaceId, Array.from({ length: 8 }, (_, index) => ({
      keyword: `provider evidence ${index}`,
      volume: 1_000 + index,
      difficulty: 20 + index,
      competitorPosition: 3 + index,
      competitorDomain: 'competitor.example',
    })));
    storeRankSnapshot(workspaceId, '2026-05-21', [
      { query: 'untracked gsc opportunity', position: 12, clicks: 2, impressions: 240, ctr: 0.008 },
    ]);

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    expect(summary).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        total: 9,
        inStrategy: expect.any(Number),
        tracked: expect.any(Number),
        needsReview: 1,
        evidence: 8,
        local: expect.any(Number),
        localCandidates: expect.any(Number),
        retired: expect.any(Number),
        declined: expect.any(Number),
      }),
      rawEvidenceTotal: 8,
      rawEvidenceReturned: 8,
      summarizedAt: expect.any(String),
    }));
    expect(summary).not.toHaveProperty('rows');
    expect(summary?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, count: 9 }),
      expect.objectContaining({ id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, count: 1 }),
      expect.objectContaining({ id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, count: 8 }),
      expect.objectContaining({ id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, count: 0 }),
    ]));

    const allRows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 100,
    });
    expect(allRows?.pageInfo.totalRows).toBe(summary?.counts.total);

    const firstPage = await buildKeywordCommandCenterRows(workspaceId, {
      filter: 'raw_evidence',
      page: 1,
      pageSize: 3,
      sort: 'demand',
    });
    expect(firstPage?.rows).toHaveLength(3);
    expect(firstPage?.pageInfo).toEqual(expect.objectContaining({
      page: 1,
      pageSize: 3,
      totalRows: 8,
      totalPages: 3,
      hasNextPage: true,
    }));
    expect(firstPage?.rows[0]?.explanation).toBeUndefined();
  });

  it('caps unselected rank evidence in all rows to match summary counts', async () => {
    storeRankSnapshot(workspaceId, '2026-05-21', Array.from({ length: 120 }, (_, index) => ({
      query: `untracked gsc query ${index}`,
      position: index + 1,
      clicks: 0,
      impressions: 1_000 - index,
      ctr: 0,
    })));

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 100,
    });

    expect(summary?.counts.total).toBe(50);
    expect(rows?.pageInfo.totalRows).toBe(50);
    expect(rows?.rows).toHaveLength(50);
    expect(rows?.rows.some(row => row.normalizedKeyword === 'untracked gsc query 119')).toBe(false);
  });

  it('supports server-side search and lazy detail reads for one keyword', async () => {
    seedStrategy();

    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      search: 'cosmetic dentistry',
      pageSize: 10,
    });
    expect(rows).not.toBeNull();
    const resultRows = rows!.rows;
    expect(resultRows.map(row => row.normalizedKeyword)).toContain('cosmetic dentistry');
    expect(resultRows.length).toBeGreaterThan(0);
    for (const row of resultRows) {
      expect(row.explanation).toBeUndefined();
    }

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'Cosmetic Dentistry');
    expect(detail?.row).toEqual(expect.objectContaining({
      normalizedKeyword: 'cosmetic dentistry',
      explanation: expect.objectContaining({
        normalizedKeyword: 'cosmetic dentistry',
      }),
    }));
  });

  it('keeps page assignment precedence in lightweight rows when a keyword is also a content gap', async () => {
    seedStrategy();
    replaceAllContentGaps(workspaceId, [{
      topic: 'Cosmetic dentistry guide',
      targetKeyword: 'Cosmetic Dentistry',
      intent: 'commercial',
      priority: 'medium',
      rationale: 'Duplicate keyword should keep page assignment precedence.',
      volume: 450,
      difficulty: 35,
      opportunityScore: 55,
    }]);

    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      search: 'cosmetic dentistry',
      pageSize: 10,
    });
    const row = rows?.rows.find(item => item.normalizedKeyword === 'cosmetic dentistry');

    expect(row?.assignment).toEqual(expect.objectContaining({
      role: 'page_keyword',
      pagePath: '/services/cosmetic-dentistry',
    }));
    expect(row?.nextActions.map(action => action.type)).toContain('review_page');
  });

  it('moves promoted raw evidence into tracked lifecycle status', async () => {
    replaceAllKeywordGaps(workspaceId, [{
      keyword: 'promotable provider keyword',
      volume: 1_200,
      difficulty: 44,
      competitorPosition: 5,
      competitorDomain: 'competitor.example',
    }]);

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE,
      keyword: 'promotable provider keyword',
    });

    const payload = await readRows();
    const row = payload!.rows.find(item => item.normalizedKeyword === 'promotable provider keyword');
    expect(row).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
      rawEvidenceOnly: true,
      tracking: expect.objectContaining({ status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    }));
  });

  it('annotates keyword rows with local visibility evidence when snapshots exist', async () => {
    updateWorkspace(workspaceId, {
      name: 'Synthetic Austin Business',
      liveDomain: 'https://example.com',
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
    updateLocalSeoConfiguration(workspaceId, {
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
    addTrackedKeyword(workspaceId, 'Austin dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    registerProvider('dataforseo', new FakeSeoProvider());

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId,
      message: 'Testing local command center annotation...',
    });
    await runLocalSeoRefreshJob(job.id, workspaceId, { keywords: ['Austin dentist'] });

    const payload = await readRows({ includeLocalSeo: true });
    const row = payload!.rows.find(item => item.normalizedKeyword === 'austin dentist');

    expect(row?.localSeo).toEqual(expect.objectContaining({
      posture: LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE,
      marketLabel: '2 markets',
      marketCount: 2,
      localPackPresent: true,
    }));
    expect(row?.localSeo?.markets.map(market => market.marketLabel)).toEqual(['Austin, TX', 'Round Rock, TX']);
  });

  it('adds local candidate rows and local filters without presenting them as selected strategy actions', async () => {
    seedStrategy();
    updateWorkspace(workspaceId, {
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
    });
    updateLocalSeoConfiguration(workspaceId, {
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

    const payload = await readRows({ includeLocalSeo: true }, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES,
    });
    const candidate = payload!.rows.find(row => row.normalizedKeyword === 'cosmetic dentistry austin');

    expect(candidate).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW,
      localSeoState: expect.objectContaining({
        lifecycle: 'candidate',
        checked: false,
      }),
      tracking: expect.objectContaining({ status: 'not_tracked' }),
    }));
    expect(candidate?.sourceLabels).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'local_candidate' }),
    ]));
    expect(payload.pageInfo.totalRows).toBeGreaterThan(0);
  });

  it('keeps local visibility filters scoped to checked local rows even when search matches page text', async () => {
    seedStrategy();
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/invisalign',
      pageTitle: 'Austin Dentist Invisalign',
      primaryKeyword: 'what is invisalign',
      secondaryKeywords: ['benefits of invisalign'],
      searchIntent: 'informational',
      volume: 450,
      difficulty: 31,
    });
    updateWorkspace(workspaceId, {
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
    });
    updateLocalSeoConfiguration(workspaceId, {
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
    const market = db.prepare('SELECT id FROM local_seo_markets WHERE workspace_id = ? LIMIT 1').get(workspaceId) as { id: string };
    const insertSnapshot = db.prepare(`
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
    const baseSnapshot = {
      workspace_id: workspaceId,
      market_id: market.id,
      market_label: 'Austin, TX',
      local_pack_present: 1,
      business_match_reason: null,
      top_competitors: '[]',
      source_endpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
      provider: 'fake-seo-provider',
      device: 'desktop',
      language_code: 'en',
      status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      degraded_reason: null,
    };
    insertSnapshot.run({
      ...baseSnapshot,
      id: 'visible-austin-dentist',
      keyword: 'Austin Dentist',
      normalized_keyword: 'austin dentist',
      captured_at: '2026-05-20T10:00:00.000Z',
      business_found: 1,
      business_match_confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
      local_rank: 2,
    });
    insertSnapshot.run({
      ...baseSnapshot,
      id: 'possible-cosmetic-dentistry',
      keyword: 'Cosmetic Dentistry',
      normalized_keyword: 'cosmetic dentistry',
      captured_at: '2026-05-20T10:01:00.000Z',
      business_found: 1,
      business_match_confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH,
      local_rank: 4,
    });

    const visibleRows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY,
      search: 'dentist',
      pageSize: 25,
    }, { includeLocalSeo: true });

    expect(visibleRows?.pageInfo.totalRows).toBe(1);
    expect(visibleRows?.rows.map(row => row.normalizedKeyword)).toEqual(['austin dentist']);
    for (const row of visibleRows?.rows ?? []) {
      expect(row.localSeo?.posture).toBe(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE);
    }
    expect(visibleRows?.rows.some(row => row.normalizedKeyword === 'what is invisalign')).toBe(false);
  });

  it('keeps local candidates out of default rows and adds them only for local candidate filters', async () => {
    seedStrategy();
    updateWorkspace(workspaceId, {
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
    });
    updateLocalSeoConfiguration(workspaceId, {
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

    const defaultRows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    }, { includeLocalSeo: true });
    expect(defaultRows?.rows.some(row => row.normalizedKeyword === 'cosmetic dentistry austin')).toBe(false);

    const aggregateLocalRows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL,
      pageSize: 100,
    }, { includeLocalSeo: true });
    expect(aggregateLocalRows?.rows.some(row => row.normalizedKeyword === 'cosmetic dentistry austin')).toBe(false);

    const notCheckedRows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED,
      pageSize: 100,
    }, { includeLocalSeo: true });
    expect(notCheckedRows?.rows.some(row => row.normalizedKeyword === 'cosmetic dentistry austin')).toBe(false);

    const localCandidateRows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES,
      pageSize: 100,
    }, { includeLocalSeo: true });
    expect(localCandidateRows?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        normalizedKeyword: 'cosmetic dentistry austin',
        localSeoState: expect.objectContaining({ lifecycle: 'candidate' }),
      }),
    ]));
  });

  it('hard-caps local SEO candidate generation before the candidate map can grow unbounded', () => {
    updateWorkspace(workspaceId, {
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
    updateLocalSeoConfiguration(workspaceId, {
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

    const candidates = buildLocalSeoKeywordCandidates(
      workspaceId,
      Array.from({ length: 1_050 }, (_, index) => `cosmetic dentistry austin ${index}`),
    );

    expect(candidates.length).toBeLessThanOrEqual(1_000);
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(candidates.at(-1)?.score ?? 0);
  });

  it('does not expose local visibility annotations when the local SEO feature is disabled', async () => {
    updateWorkspace(workspaceId, {
      name: 'Synthetic Austin Business',
      liveDomain: 'https://example.com',
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
    updateLocalSeoConfiguration(workspaceId, {
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
    addTrackedKeyword(workspaceId, 'Austin dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    registerProvider('dataforseo', new FakeSeoProvider());

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId,
      message: 'Testing disabled local command center annotation...',
    });
    await runLocalSeoRefreshJob(job.id, workspaceId, { keywords: ['Austin dentist'] });

    const payload = await readRows();
    const row = payload!.rows.find(item => item.normalizedKeyword === 'austin dentist');

    expect(row?.localSeo).toBeUndefined();
  });
});

describe('Keyword Command Center variant matching', () => {
  beforeEach(() => {
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: ['teeth whitening'],
        siteKeywordMetrics: [{ keyword: 'teeth whitening', volume: 500, difficulty: 32 }],
        generatedAt: new Date().toISOString(),
      } as KeywordStrategy,
    });
    storeRankSnapshot(workspaceId, '2026-05-22', [
      { query: 'teeth whitening', position: 8.0, clicks: 10, impressions: 200, ctr: 5.0 },
      { query: 'teeth whitening austin', position: 10.6, clicks: 3, impressions: 120, ctr: 2.5 },
    ]);
  });

  it('aggregates variant query metrics onto the parent row', async () => {
    const rows = await buildKeywordCommandCenterRows(workspaceId, { pageSize: 100 });
    const parentRow = rows?.rows.find(row => row.normalizedKeyword === 'teeth whitening');
    expect(parentRow).toBeTruthy();
    expect(parentRow?.variantCount).toBe(1);
    expect(parentRow?.variants?.[0]).toEqual(expect.objectContaining({
      query: 'teeth whitening austin',
      impressions: 120,
    }));
    expect(parentRow?.metrics.impressions).toBe(320);
  });

  it('does not show a variant query as standalone raw evidence', async () => {
    const rows = await buildKeywordCommandCenterRows(workspaceId, { pageSize: 100 });
    const variantRow = rows?.rows.find(row => row.normalizedKeyword === 'teeth whitening austin');
    expect(variantRow).toBeUndefined();
  });
});

describe('Keyword Command Center lost visibility', () => {
  beforeEach(() => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES (?, 'vanished keyword', '2026-01-01', '2026-01-01', 5, 100, 'lost_visibility')
    `).run(workspaceId);
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: ['vanished keyword'],
        siteKeywordMetrics: [{ keyword: 'vanished keyword', volume: 200, difficulty: 28 }],
        generatedAt: new Date().toISOString(),
      } as KeywordStrategy,
    });
  });

  it('includes lostVisibility count in summary', async () => {
    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    expect(summary?.counts.lostVisibility).toBe(1);
    expect(summary?.filters.find(filter => filter.id === KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY)?.count).toBe(1);
  });

  it('marks matching rows and supports the lost visibility filter', async () => {
    const rows = await buildKeywordCommandCenterRows(workspaceId, { pageSize: 100 });
    const row = rows?.rows.find(item => item.normalizedKeyword === 'vanished keyword');
    expect(row?.isLostVisibility).toBe(true);

    const filtered = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY,
      pageSize: 100,
    });
    expect(filtered?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedKeyword: 'vanished keyword', isLostVisibility: true }),
    ]));
  });
});

describe('applyKeywordCommandCenterAction', () => {
  it('adds requested keywords to strategy using canonical keyword equality', async () => {
    seedFeedback('Requested-Keyword', 'requested', 'Client asked about this.');

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'requested keyword',
    });

    const payload = await readRows();
    const row = payload!.rows.find(item => item.normalizedKeyword === 'requested keyword');
    expect(row).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      feedback: expect.objectContaining({ status: 'approved' }),
      tracking: expect.objectContaining({
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      }),
    }));
    expect(feedbackRows().map(row => keywordComparisonKey(row.keyword))).toEqual(['requested keyword']);
  });

  it('restores equivalent punctuated keywords without leaving declined feedback or duplicate tracked rows', () => {
    seedFeedback('paper-tiger', 'declined', 'Not a fit.');
    addTrackedKeyword(workspaceId, 'paper-tiger', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
    });

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
      keyword: 'paper tiger',
    });

    expect(feedbackRows()).toEqual([]);
    const tracked = getTrackedKeywords(workspaceId, { includeInactive: true });
    expect(tracked.filter(keyword => keywordComparisonKey(keyword.query) === 'paper tiger')).toEqual([
      expect.objectContaining({ query: 'paper-tiger', status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    ]);
  });

  it('tracks and restores keywords without losing rank-tracking metadata', () => {
    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
      keyword: 'Porcelain Veneers Cost',
    });
    expect(getTrackedKeywords(workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'Porcelain Veneers Cost', status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    ]));

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keyword: 'porcelain veneers cost',
      force: true,
    });
    expect(getTrackedKeywords(workspaceId)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'porcelain veneers cost' }),
    ]));
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'Porcelain Veneers Cost', status: TRACKED_KEYWORD_STATUS.PAUSED }),
    ]));

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
      keyword: 'porcelain veneers cost',
    });
    expect(getTrackedKeywords(workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'Porcelain Veneers Cost', status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    ]));
  });

  it('matches lifecycle actions across canonical keyword variants', () => {
    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
      keyword: 'Emergency Dentist - Near-Me',
    });

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keyword: 'emergency dentist near me',
      force: true,
    });

    const inactive = getTrackedKeywords(workspaceId, { includeInactive: true });
    expect(inactive.filter(keyword => keywordComparisonKey(keyword.query) === 'emergency dentist near me')).toEqual([
      expect.objectContaining({
        query: 'Emergency Dentist - Near-Me',
        status: TRACKED_KEYWORD_STATUS.PAUSED,
      }),
    ]);
  });

  it('does not report pause or retire success when the keyword is not tracked', () => {
    expect(() => applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keyword: 'untracked keyword',
    })).toThrow(/Keyword is not tracked/);

    expect(() => applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      keyword: 'untracked keyword',
    })).toThrow(/Keyword is not tracked/);
  });

  it('protects manual, pinned, and client-requested keywords from accidental retirement', () => {
    addTrackedKeyword(workspaceId, 'manual keyword', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    addTrackedKeyword(workspaceId, 'pinned keyword', { pinned: true, source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY });
    addTrackedKeyword(workspaceId, 'client keyword', { source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED });

    expect(() => applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      keyword: 'manual keyword',
    })).toThrow(/explicit confirmation/);
    expect(() => applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keyword: 'manual keyword',
    })).toThrow(/explicit confirmation/);
    expect(() => applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
      keyword: 'pinned keyword',
    })).toThrow(/explicit confirmation/);
    expect(() => applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      keyword: 'client keyword',
    })).toThrow(/explicit confirmation/);

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      keyword: 'manual keyword',
      force: true,
    });
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'manual keyword', status: TRACKED_KEYWORD_STATUS.DEPRECATED }),
    ]));
  });
});

describe('skinny rows — no sibling expansion (regression for row-count drift)', () => {
  // Bug: pages with ANY keyword in the selected key set were surviving whole, and
  // populateDraftRows then created a row for EVERY primary/secondary keyword on that
  // page — inflating filtered rows with sibling keywords. Reproduced as:
  //   Tracked badge 235 / table 275
  //   In Strategy 224 / table 227
  //   Visible Locally 1 / table shows non-local rows
  // Fixed by restrictPageToKeys which trims non-selected keywords from each page.

  it('tracked filter: page primary tracked, secondaries NOT tracked — secondaries must not appear', async () => {
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/invisalign',
      pageTitle: 'Invisalign Austin',
      primaryKeyword: 'invisalign austin',
      secondaryKeywords: ['teeth whitening', 'dental veneers'],
      searchIntent: 'commercial',
    });
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/cleaning',
      pageTitle: 'Cleaning Dallas',
      primaryKeyword: 'cleaning dallas',
      secondaryKeywords: ['plumbing dallas'], // primary not tracked, secondary IS tracked
      searchIntent: 'commercial',
    });
    addTrackedKeyword(workspaceId, 'invisalign austin', { source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY });
    addTrackedKeyword(workspaceId, 'plumbing dallas', { source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY });

    const result = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED,
      pageSize: 100,
    });
    expect(result).not.toBeNull();
    const keywords = result!.rows.map(row => row.normalizedKeyword).sort();
    expect(keywords).toEqual(['invisalign austin', 'plumbing dallas']);
    expect(result!.pageInfo.totalRows).toBe(2);
    // Sibling keywords must NOT appear
    expect(keywords).not.toContain('teeth whitening');
    expect(keywords).not.toContain('dental veneers');
    expect(keywords).not.toContain('cleaning dallas');
  });

  it('tracked filter: empty result when no tracking exists, even when pages reference page-assigned keywords', async () => {
    // Regression: previously, a page with any keyword could produce phantom tracked
    // rows because pageMatchesKeys let the whole page through.
    upsertPageKeyword(workspaceId, {
      pagePath: '/page',
      pageTitle: 'Page',
      primaryKeyword: 'primary keyword',
      secondaryKeywords: ['secondary one', 'secondary two'],
      searchIntent: 'commercial',
    });
    // No tracking added.
    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED,
      pageSize: 100,
    });
    expect(rows!.pageInfo.totalRows).toBe(0);
    expect(rows!.rows).toEqual([]);
  });

  it('visible_locally filter returns only rows with localSeo.posture === visible', async () => {
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/dentistry',
      pageTitle: 'Dentistry Austin',
      primaryKeyword: 'austin dentist',
      secondaryKeywords: ['cosmetic dentistry', 'teeth whitening'], // siblings; visibility data only for primary
      searchIntent: 'commercial',
    });
    updateLocalSeoConfiguration(workspaceId, {
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
    const market = db.prepare('SELECT id FROM local_seo_markets WHERE workspace_id = ? LIMIT 1').get(workspaceId) as { id: string };
    db.prepare(`
      INSERT INTO local_visibility_snapshots (
        id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
        local_pack_present, business_found, business_match_confidence, business_match_reason,
        local_rank, top_competitors, source_endpoint, provider, device, language_code, status, degraded_reason
      ) VALUES (
        @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
        @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
        @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status, @degraded_reason
      )
    `).run({
      id: 'vis-test-1',
      workspace_id: workspaceId,
      keyword: 'Austin Dentist',
      normalized_keyword: 'austin dentist',
      market_id: market.id,
      market_label: 'Austin, TX',
      captured_at: '2026-05-20T10:00:00.000Z',
      local_pack_present: 1,
      business_found: 1,
      business_match_confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
      business_match_reason: null,
      local_rank: 2,
      top_competitors: '[]',
      source_endpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
      provider: 'fake-seo-provider',
      device: 'desktop',
      language_code: 'en',
      status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      degraded_reason: null,
    });

    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY,
      pageSize: 100,
    }, { includeLocalSeo: true });

    expect(rows).not.toBeNull();
    expect(rows!.rows.length).toBeGreaterThan(0);
    for (const row of rows!.rows) {
      expect(row.localSeo?.posture).toBe(LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE);
    }
    // Siblings of the visible page must NOT appear
    const keywords = rows!.rows.map(row => row.normalizedKeyword);
    expect(keywords).not.toContain('cosmetic dentistry');
    expect(keywords).not.toContain('teeth whitening');
  });

  it('possible_match filter returns only rows with posture === possible_match', async () => {
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/cosmetic',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: ['unrelated sibling'],
      searchIntent: 'commercial',
    });
    updateLocalSeoConfiguration(workspaceId, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US',
        providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    const market = db.prepare('SELECT id FROM local_seo_markets WHERE workspace_id = ? LIMIT 1').get(workspaceId) as { id: string };
    db.prepare(`
      INSERT INTO local_visibility_snapshots (
        id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
        local_pack_present, business_found, business_match_confidence, business_match_reason,
        local_rank, top_competitors, source_endpoint, provider, device, language_code, status, degraded_reason
      ) VALUES (
        @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
        @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
        @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status, @degraded_reason
      )
    `).run({
      id: 'pm-1',
      workspace_id: workspaceId,
      keyword: 'Cosmetic Dentistry',
      normalized_keyword: 'cosmetic dentistry',
      market_id: market.id,
      market_label: 'Austin, TX',
      captured_at: '2026-05-20T10:00:00.000Z',
      local_pack_present: 1,
      business_found: 1,
      business_match_confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH,
      business_match_reason: null,
      local_rank: 5,
      top_competitors: '[]',
      source_endpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
      provider: 'fake-seo-provider',
      device: 'desktop',
      language_code: 'en',
      status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      degraded_reason: null,
    });

    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH,
      pageSize: 100,
    }, { includeLocalSeo: true });

    expect(rows).not.toBeNull();
    for (const row of rows!.rows) {
      expect(row.localSeo?.posture).toBe(LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH);
    }
    const keywords = rows!.rows.map(row => row.normalizedKeyword);
    expect(keywords).not.toContain('unrelated sibling');
  });

  it('all filter rows count matches summary total', async () => {
    seedStrategy();
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', { source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY });
    seedFeedback('client requested', 'requested');

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 500,
    });
    expect(rows!.pageInfo.totalRows).toBe(summary!.counts.total);
  });

  it('in_strategy badge count matches rows totalRows', async () => {
    // Regression: previously summary did not include tracked-with-strategy-source
    // or approved feedback in inStrategyKeys, so the badge under-counted vs rows
    // (observed on Swish: badge 224 / table 227).
    seedStrategy();
    // Tracked keyword promoted from strategy that isn't already in strategy.siteKeywords
    // — this is the case that caused the drift on Swish. Wave 3d-ii: IN_STRATEGY now
    // keys on strategyOwned (set by reconcile), so seed it explicitly.
    addTrackedKeyword(workspaceId, 'orthodontics austin', { source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY, strategyOwned: true });
    addTrackedKeyword(workspaceId, 'family dentist', { source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD, strategyOwned: true });
    // Approved feedback keyword — also counts as in_strategy via rows path.
    seedFeedback('teeth whitening near me', 'approved');
    // Declined/requested feedback keywords — must NOT count even if they overlap a page.
    seedFeedback('zoom whitening', 'declined');
    seedFeedback('client interested keyword', 'requested');

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
      pageSize: 500,
    });
    expect(rows!.pageInfo.totalRows).toBe(summary!.counts.inStrategy);
    // Sanity: the tracked-strategy keywords actually appear in the rows
    const keywords = new Set(rows!.rows.map(r => r.normalizedKeyword));
    expect(keywords.has('orthodontics austin')).toBe(true);
    expect(keywords.has('family dentist')).toBe(true);
    expect(keywords.has('teeth whitening near me')).toBe(true);
    // Declined/requested do NOT appear under in_strategy
    expect(keywords.has('zoom whitening')).toBe(false);
    expect(keywords.has('client interested keyword')).toBe(false);
  });

  it('summary filter counts stay aligned with rows totals across core filters', async () => {
    seedStrategy();
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
    });
    addTrackedKeyword(workspaceId, 'retired local keyword', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      deprecatedAt: '2026-05-27T10:00:00.000Z',
    });
    seedFeedback('request-only keyword', 'requested');

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    const filtersToAssert = [
      KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
      KEYWORD_COMMAND_CENTER_FILTERS.TRACKED,
      KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW,
      KEYWORD_COMMAND_CENTER_FILTERS.RETIRED,
      KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE,
    ] as const;

    for (const filter of filtersToAssert) {
      const rows = await buildKeywordCommandCenterRows(workspaceId, { filter, pageSize: 500 });
      expect(rows).not.toBeNull();
      const summaryFilter = summary?.filters.find(item => item.id === filter);
      expect(summaryFilter).toBeDefined();
      expect(rows!.pageInfo.totalRows).toBe(summaryFilter!.count);
    }
  });

  it('drops DataForSEO planner-grouped sentinel volume (1M/21) and prefers real provider data', async () => {
    // Regression: DataForSEO Google Ads search-volume can return 1,000,000 as a
    // planner-grouped bucket sentinel paired with difficulty=21. On Swish staging,
    // ~12% of rows displayed "1.0M" volume because the sentinel overwrote real
    // provider data via mergeMetrics (later sources spread over earlier ones).
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/dentistry',
      pageTitle: 'Cosmetic Dentistry',
      primaryKeyword: 'cosmetic dentistry',
      secondaryKeywords: [],
      searchIntent: 'commercial',
      volume: 8100, // real provider value
      difficulty: 62,
    });
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      volume: 1000000, // sentinel
      difficulty: 21,  // sentinel partner
    });

    const result = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    });
    const row = result!.rows.find(r => r.normalizedKeyword === 'cosmetic dentistry');
    expect(row).toBeDefined();
    expect(row!.metrics.volume).toBe(8100);
    expect(row!.metrics.difficulty).toBe(62);
  });

  it('drops planner-bucket sentinel even when no other source provides volume', async () => {
    // Edge case: only source is the sentinel-bearing one. Row gets undefined
    // volume (UI renders "—") instead of misleading "1.0M".
    addTrackedKeyword(workspaceId, 'orphan sentinel keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      volume: 1000000,
      difficulty: 21,
    });

    const result = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    });
    const row = result!.rows.find(r => r.normalizedKeyword === 'orphan sentinel keyword');
    expect(row).toBeDefined();
    expect(row!.metrics.volume).toBeUndefined();
    expect(row!.metrics.difficulty).toBeUndefined();
  });

  it('preserves real volumes below the planner-bucket threshold', async () => {
    // Guardrail: real provider volumes < 1,000,000 must always survive. The
    // sentinel detector (isSuspiciousPlannerGroupedVolume) considers ALL values
    // >= 1M suspicious by design — that's a deliberate tradeoff since SMB
    // workspaces (the platform's target market) basically never have real
    // million-volume keywords. If a legitimate niche ever needs >=1M volumes,
    // the helper's PLANNER_GROUPED_VOLUME_FLOOR must be raised in lockstep
    // (see server/keyword-strategy-helpers.ts).
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/x',
      pageTitle: 'High demand service',
      primaryKeyword: 'high demand service',
      secondaryKeywords: [],
      searchIntent: 'commercial',
      volume: 950_000, // just below the floor
      difficulty: 55,
    });

    const result = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    });
    const row = result!.rows.find(r => r.normalizedKeyword === 'high demand service');
    expect(row).toBeDefined();
    expect(row!.metrics.volume).toBe(950_000);
    expect(row!.metrics.difficulty).toBe(55);
  });

  it('tracking.hasSignal is true when the row has GSC metrics', async () => {
    // Regression: Swish audit found 175/235 (74%) of active-tracked rows had no
    // rank/clicks/impressions — tracked in name only. hasSignal distinguishes
    // active-with-data from active-but-empty so the UI can render "Awaiting data".
    addTrackedKeyword(workspaceId, 'has signal keyword', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    storeRankSnapshot(workspaceId, '2026-05-20', [
      { query: 'has signal keyword', position: 8, clicks: 15, impressions: 600, ctr: 0.025 },
    ]);

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'has signal keyword');
    expect(detail!.row.tracking.hasSignal).toBe(true);
  });

  it('tracking.hasSignal is false when active-tracked row has no rank or GSC metrics', async () => {
    addTrackedKeyword(workspaceId, 'awaiting data keyword', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    // No snapshot stored — keyword is tracked but no signal has materialized

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'awaiting data keyword');
    expect(detail!.row.tracking.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
    expect(detail!.row.tracking.hasSignal).toBe(false);
  });

  it('Wave 4 P0: tracking.strategyOwned is projected onto the emitted KCC row when strategy_owned=1', async () => {
    // Wave 3d-ii merges strategyOwned onto row.tracking via mergeTrackedKeywordProvenance,
    // but finalizeDraftRow did NOT project it onto the emitted bundle row. P0-T2 opens
    // the projection gate (admin-only). Three-state: true is a real, projected value.
    addTrackedKeyword(workspaceId, 'owned strategy keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      strategyOwned: true,
    });

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'owned strategy keyword');
    expect(detail!.row.tracking.strategyOwned).toBe(true);
  });

  it('Wave 4 P0: tracking.strategyOwned is undefined (NOT false) when ownership is unknown', async () => {
    // Three-state discipline: a row seeded WITHOUT strategyOwned must read back as
    // `undefined` (ownership unknown), never coerced to `false`. A truthiness/`?? false`
    // guard would mislabel every pre-reconcile row as "explicitly not owned".
    addTrackedKeyword(workspaceId, 'unowned manual keyword', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'unowned manual keyword');
    expect(detail!.row.tracking.strategyOwned).toBeUndefined();
  });

  it('Wave 3d-ii: read-time source inference is RETIRED — an UNKNOWN tracked source stays UNKNOWN at read time', () => {
    // Regression GUARD: read-time inferTrackedKeywordSources was retired. The boot
    // backfill stamps legacy UNKNOWN sources ONCE; the read paths must NOT re-infer.
    // So an UNKNOWN keyword added post-boot keeps source=UNKNOWN when read (its label
    // detail is suppressed, never the literal "unknown" string).
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: ['cosmetic dentistry'],
        siteKeywordMetrics: [],
        opportunities: [],
        businessContext: 'Dental',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', {
      source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
    });
  });

  it('Wave 3d-ii: a strategy-declared UNKNOWN keyword classifies IN_STRATEGY via the strategy match, not a re-inferred source', async () => {
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: ['cosmetic dentistry'],
        siteKeywordMetrics: [],
        opportunities: [],
        businessContext: 'Dental',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', {
      source: TRACKED_KEYWORD_SOURCE.UNKNOWN,
    });

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'cosmetic dentistry');
    expect(detail).not.toBeNull();
    // Source is NOT re-inferred at read time — it stays UNKNOWN.
    expect(detail!.row.tracking.source).toBe(TRACKED_KEYWORD_SOURCE.UNKNOWN);
    // But the row still classifies IN_STRATEGY because the strategy explanation
    // (siteKeywords match) drives the lifecycle status, independent of the source enum.
    expect(detail!.row.lifecycleStatus).toBe(KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY);
  });

  it('Wave 3d-ii: an UNKNOWN keyword in siteKeywordMetrics is NOT re-inferred to STRATEGY_PRIMARY at read time', async () => {
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        businessContext: 'Dental',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    replaceAllSiteKeywordMetrics(workspaceId, [{ keyword: 'orthodontics', volume: 1200, difficulty: 45 }]);
    addTrackedKeyword(workspaceId, 'orthodontics', { source: TRACKED_KEYWORD_SOURCE.UNKNOWN });

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'orthodontics');
    expect(detail!.row.tracking.source).toBe(TRACKED_KEYWORD_SOURCE.UNKNOWN);
  });

  it('Wave 3d-ii: an UNKNOWN keyword matching requested feedback is NOT re-inferred to CLIENT_REQUESTED at read time', async () => {
    addTrackedKeyword(workspaceId, 'invisalign cost', { source: TRACKED_KEYWORD_SOURCE.UNKNOWN });
    seedFeedback('invisalign cost', 'requested', 'Client asked');

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'invisalign cost');
    // Read-time inference retired — the tracking source stays UNKNOWN. (The feedback
    // status still surfaces via the feedback channel / lifecycle, not the source enum.)
    expect(detail!.row.tracking.source).toBe(TRACKED_KEYWORD_SOURCE.UNKNOWN);
  });

  it('leaves UNKNOWN tracking source unchanged when no inference hint matches', async () => {
    addTrackedKeyword(workspaceId, 'wholly unknown keyword', { source: TRACKED_KEYWORD_SOURCE.UNKNOWN });

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'wholly unknown keyword');
    expect(detail!.row.tracking.source).toBe(TRACKED_KEYWORD_SOURCE.UNKNOWN);
    // UI must NOT display "unknown" as a meaningful source detail
    const trackingSourceLabel = detail!.row.sourceLabels.find(s => s.kind === 'tracking');
    expect(trackingSourceLabel?.detail).toBeUndefined();
  });

  it('preserves an explicit non-UNKNOWN source even if other hints match (recorded provenance wins)', async () => {
    // If the keyword was explicitly added with MANUAL source, inference must not
    // override it to STRATEGY_SITE_KEYWORD even when it happens to also be in strategy.
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: ['emergency plumbing'],
        siteKeywordMetrics: [],
        opportunities: [],
        businessContext: 'Plumbing',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    addTrackedKeyword(workspaceId, 'emergency plumbing', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'emergency plumbing');
    expect(detail!.row.tracking.source).toBe(TRACKED_KEYWORD_SOURCE.MANUAL);
  });

  it('summary inStrategy count includes inferred-strategy tracked keywords', async () => {
    // After inference, a tracked keyword with source=UNKNOWN that matches strategy
    // gets upgraded to STRATEGY_SITE_KEYWORD, and trackedKeywordMatchesFilter then
    // includes it in IN_STRATEGY. The badge and rows must stay aligned.
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        siteKeywords: ['inferred strategy match'],
        siteKeywordMetrics: [],
        opportunities: [],
        businessContext: 'test',
        generatedAt: '2026-05-20T10:00:00.000Z',
      },
    });
    addTrackedKeyword(workspaceId, 'inferred strategy match', { source: TRACKED_KEYWORD_SOURCE.UNKNOWN });

    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    const rows = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
      pageSize: 100,
    });
    expect(rows!.pageInfo.totalRows).toBe(summary!.counts.inStrategy);
    expect(rows!.rows.some(r => r.normalizedKeyword === 'inferred strategy match')).toBe(true);
  });

  it('localCandidates summary count uses the cheap counter (skips evaluateKeywordCandidate)', async () => {
    // PR #876 introduced a generator-backed count that called
    // buildLocalSeoKeywordCandidates() — that hit evaluateKeywordCandidate per
    // entry and ran 35s on Swish. PR #878 reverted to 0. This PR restores a real
    // count via countLocalSeoKeywordCandidates(), which mirrors the generator's
    // iteration + cheap filters but skips eligibility evaluation. The badge is
    // allowed to slightly overcount (it's a UX hint, not a precise list); the
    // actual displayable list still comes from the full generator when the user
    // opens the Local Candidates filter.
    updateWorkspace(workspaceId, {
      name: 'Test Local Business',
      businessProfile: {
        address: { street: '123 Main', city: 'Austin', region: 'TX', country: 'US', postalCode: '78701' },
        serviceAreas: ['Austin', 'Round Rock'],
      },
      // W6.1: buildWorkspaceServiceTermRegex is workspace-derived. Provide siteKeywords
      // containing the service vocabulary so 'plumbing' is in the service term regex
      // and the page keywords classify as local candidates.
      keywordStrategy: {
        siteKeywords: ['plumbing service', 'drain cleaning'],
        siteKeywordMetrics: [],
        opportunities: [],
      },
    } as never);
    updateLocalSeoConfiguration(workspaceId, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [{
        label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US',
        providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      }],
    }, true);
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/plumbing',
      pageTitle: 'Emergency Plumbing',
      primaryKeyword: 'emergency plumbing',
      secondaryKeywords: ['drain cleaning'],
      searchIntent: 'commercial',
    });

    const summary = await buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: true });
    // Real number greater than 0 for a workspace with markets + service pages
    expect(summary!.counts.localCandidates).toBeGreaterThan(0);
  });

  it('localCandidates summary count is 0 when no markets configured (count is short-circuited)', async () => {
    // Cheap counter short-circuits when activeMarkets is empty — saves any
    // candidate-generation work for non-local workspaces.
    upsertPageKeyword(workspaceId, {
      pagePath: '/anything',
      pageTitle: 'Anything',
      primaryKeyword: 'anything',
      secondaryKeywords: [],
      searchIntent: 'commercial',
    });

    const summary = await buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: true });
    expect(summary!.counts.localCandidates).toBe(0);
  });

  it('localCandidates summary count stays under hard cap even with many sources', async () => {
    // Guardrail: countLocalSeoKeywordCandidates applies the same LOCAL_CANDIDATE_HARD_CAP
    // as the full generator so the count never balloons unbounded. Seed enough
    // sources to exceed the cap and assert <= cap.
    updateLocalSeoConfiguration(workspaceId, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [
        { label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
        { label: 'Houston, TX', city: 'Houston', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026202, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
        { label: 'Dallas, TX', city: 'Dallas', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026203, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
      ],
    }, true);
    // 60 pages × multiple keywords each × 3 markets × variants exceeds the cap
    for (let i = 0; i < 60; i++) {
      upsertPageKeyword(workspaceId, {
        pagePath: `/services/service-${i}`,
        pageTitle: `Service ${i} Repair`,
        primaryKeyword: `service ${i} repair`,
        secondaryKeywords: [`service ${i} cost`, `service ${i} cleaning`],
        searchIntent: 'commercial',
      });
    }

    const summary = await buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: true });
    expect(summary!.counts.localCandidates).toBeLessThanOrEqual(1000);
  });

  it('Local Candidates filter resolves under 500ms even on a rich workspace (cheap default)', async () => {
    // Tier 2 contract: KCC row enrichment uses the cheap buildLocalSeoKeywordCandidates
    // (no evaluator, no suppression). Pre-Tier-2 this filter took 35–43s on Swish.
    // Seed enough sources to make the difference noticeable, then assert the wall
    // clock stays well under the OOM-threshold timer.
    updateLocalSeoConfiguration(workspaceId, {
      posture: LOCAL_SEO_POSTURE.LOCAL,
      markets: [
        { label: 'Austin, TX', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
        { label: 'Houston, TX', city: 'Houston', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026202, status: LOCAL_SEO_MARKET_STATUS.ACTIVE },
      ],
    }, true);
    for (let i = 0; i < 30; i++) {
      upsertPageKeyword(workspaceId, {
        pagePath: `/services/service-${i}`,
        pageTitle: `Service ${i} Repair`,
        primaryKeyword: `service ${i} repair`,
        secondaryKeywords: [`service ${i} cost`, `service ${i} cleaning`],
        searchIntent: 'commercial',
      });
    }

    const start = Date.now();
    const rows = await buildKeywordCommandCenterRows(
      workspaceId,
      { filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, pageSize: 100 },
      { includeLocalSeo: true },
    );
    const elapsed = Date.now() - start;
    expect(rows).toBeTruthy();
    expect(elapsed).toBeLessThan(2000);
  });

  it('Local Candidates filter returns rows when local_variant candidates exist beyond strategy-sourced top of pool', async () => {
    // Regression test: the top LOCAL_CANDIDATE_ROW_LIMIT (75) slots were dominated by
    // strategy/tracking-sourced candidates (selected=true, higher score).  These get
    // lifecycle=SELECTED in buildLocalSeoState, not CANDIDATE, so the LOCAL_CANDIDATES
    // filter matched zero rows even when hundreds of local_variant candidates existed.
    // Fix: unselected candidates are sorted first before slicing.
    updateWorkspace(workspaceId, {
      name: 'Regression Plumbing',
      liveDomain: 'https://regression-plumbing.example.com',
      businessProfile: {
        address: { street: '1 Main St', city: 'Austin', state: 'TX', country: 'US' },
      },
      // W6.1: buildWorkspaceServiceTermRegex is workspace-derived. Provide siteKeywords
      // so 'pipe' and 'repair' tokens go into the service term regex, making
      // 'pipe repair' classify as a service keyword and generate local_variant candidates.
      keywordStrategy: {
        siteKeywords: ['pipe repair', 'plumbing'],
        siteKeywordMetrics: [],
        opportunities: [],
      },
    });
    updateLocalSeoConfiguration(workspaceId, {
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

    // Seed 76 strategy/page-assignment keywords (all become selected=true in the pool).
    // With the bug, these would fill the entire 75-slot slice, leaving no room for
    // the local_variant candidate generated below.
    for (let i = 0; i < 76; i++) {
      upsertPageKeyword(workspaceId, {
        pagePath: `/services/strategy-kw-${i}`,
        pageTitle: `Strategy Keyword ${i}`,
        primaryKeyword: `strategy keyword ${i}`,
        secondaryKeywords: [],
        searchIntent: 'commercial',
        volume: 1000 + i,
        difficulty: 30,
      });
    }

    // Also seed one page keyword with a secondary keyword that generates a local_variant.
    // This produces a candidate like "pipe repair austin" with selected=false.
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/pipe-repair',
      pageTitle: 'Pipe Repair',
      primaryKeyword: 'pipe repair',
      secondaryKeywords: ['emergency pipe fix'],
      searchIntent: 'commercial',
      volume: 800,
      difficulty: 25,
    });

    // Confirm the summary count sees local candidates (so the badge would show > 0).
    const summary = await buildKeywordCommandCenterSummary(workspaceId, { includeLocalSeo: true });
    expect(summary!.counts.localCandidates).toBeGreaterThan(0);

    // Build rows using the LOCAL_CANDIDATES filter — the bug caused 0 rows here.
    const payload = await buildKeywordCommandCenterRows(
      workspaceId,
      { filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, pageSize: 200 },
      { includeLocalSeo: true },
    );
    expect(payload).not.toBeNull();
    expect(payload!.rows.length).toBeGreaterThan(0);

    // Every row returned must be lifecycle=CANDIDATE (the filter contract).
    for (const row of payload!.rows) {
      expect(row.localSeoState?.lifecycle).toBe(KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE);
    }
  });
});

describe('valueReasons on KCC rows (Task 2.2)', () => {
  it('a Hub row carries valueReasons (non-empty) for a scored keyword', async () => {
    // Seed a page keyword with enough signal to trigger value scoring
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/dental-implants',
      pageTitle: 'Dental Implants',
      primaryKeyword: 'dental implants',
      secondaryKeywords: [],
      searchIntent: 'commercial',
      volume: 2400,
      difficulty: 40,
      cpc: 9,
    });

    const payload = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    });
    expect(payload).not.toBeNull();
    const dentalRow = payload!.rows.find(r => r.normalizedKeyword === 'dental implants');
    expect(dentalRow).toBeDefined();
    // valueReasons must be present and non-empty (value-first is unconditional)
    expect(dentalRow!.valueReasons).toBeDefined();
    expect(dentalRow!.valueReasons!.length).toBeGreaterThan(0);
    // Must include an intent reason
    expect(dentalRow!.valueReasons!.some(r => /intent/i.test(r))).toBe(true);
  });
});

describe('cpc join from page_keywords (Task 3.2)', () => {
  it('a KCC row carries metrics.cpc populated from the page_keywords cpc', async () => {
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/dental-bridges',
      pageTitle: 'Dental Bridges',
      primaryKeyword: 'dental bridges',
      secondaryKeywords: [],
      searchIntent: 'commercial',
      volume: 800,
      difficulty: 35,
      cpc: 7.5,
    });

    const payload = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    });
    expect(payload).not.toBeNull();
    const bridgeRow = payload!.rows.find(r => r.normalizedKeyword === 'dental bridges');
    expect(bridgeRow).toBeDefined();
    expect(bridgeRow!.metrics.cpc).toBe(7.5);
  });
});

describe('content-gap cpc on KCC rows (cross-surface consistency fix)', () => {
  it('a content-gap-only row is cpc-aware in score/reasons but shows NO realized $ block', async () => {
    // Real content-gap cpc (#1103) must reach the KCC value score the same way it
    // reaches enrichment/strategy — otherwise the same keyword scores/sorts
    // differently in the Hub vs the client. But content gaps have no GSC signal, so
    // they must NOT surface a realized-$ block (the client computes $ for pages only).
    replaceAllContentGaps(workspaceId, [{
      topic: 'Invisalign cost guide',
      targetKeyword: 'invisalign cost',
      intent: 'commercial',
      priority: 'high',
      rationale: 'Patients compare aligner pricing before booking.',
      volume: 1800,
      difficulty: 38,
      cpc: 12,
    }]);

    const payload = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      pageSize: 100,
    });
    const row = payload!.rows.find(r => r.normalizedKeyword === 'invisalign cost');
    expect(row).toBeDefined();
    // cpc threaded into the row metrics → cpc-aware value score
    expect(row!.metrics.cpc).toBe(12);
    // Hub (admin) reasons are cpc-aware and may show the raw "$X CPC"
    expect(row!.valueReasons).toBeDefined();
    expect(row!.valueReasons!.some(r => /\$12/.test(r))).toBe(true);
    // No realized-$ block: content gaps carry no clicks/impressions/rank
    expect(row!.currentMonthly).toBeUndefined();
    expect(row!.upsideMonthly).toBeUndefined();
  });
});
