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
  KEYWORD_COMMAND_CENTER_STATUS,
} from '../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_POSTURE, LOCAL_SEO_VISIBILITY_POSTURE } from '../../shared/types/local-seo.js';
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
  workspaceId = createWorkspace(`Keyword Command Center ${Date.now()}`).id;
});

afterEach(() => {
  _resetRegistryForTest();
  if (workspaceId) clearCompletedJobs({ workspaceId });
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
