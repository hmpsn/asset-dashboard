import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import {
  applyKeywordCommandCenterAction,
  buildKeywordCommandCenter,
} from '../../server/keyword-command-center.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { addTrackedKeyword, getTrackedKeywords, storeRankSnapshot } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey, normalizeKeywordForComparison } from '../../shared/keyword-normalization.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_STATUS,
} from '../../shared/types/keyword-command-center.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
} from '../../shared/types/rank-tracking.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

let workspaceId = '';

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  workspaceId = createWorkspace(`Keyword Command Center ${Date.now()}`).id;
});

afterEach(() => {
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

describe('normalizeKeywordForComparison', () => {
  it('normalizes case, punctuation, whitespace, and local-ish phrases without stripping meaning', () => {
    expect(normalizeKeywordForComparison('  Cosmetic-Dentistry!! Near   Me ')).toBe('cosmetic dentistry near me');
    expect(normalizeKeywordForComparison('Dentist, Austin TX')).toBe('dentist austin tx');
    expect(normalizeKeywordForComparison('Emergency Dentist - Near-Me')).toBe('emergency dentist near me');
  });
});

describe('buildKeywordCommandCenter', () => {
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

    const payload = await buildKeywordCommandCenter(workspaceId);

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
    expect(payload!.counts.tracked).toBeGreaterThan(0);
    expect(payload!.filters.some(filter => filter.id === 'raw_evidence' && filter.count > 0)).toBe(true);
  });

  it('reports uncapped raw provider evidence totals and preserves provider metrics', async () => {
    replaceAllKeywordGaps(workspaceId, Array.from({ length: 30 }, (_, index) => ({
      keyword: `provider evidence ${index}`,
      volume: 1_000 + index,
      difficulty: 20 + index,
      competitorPosition: 3 + index,
      competitorDomain: 'competitor.example',
    })));

    const payload = await buildKeywordCommandCenter(workspaceId);

    expect(payload?.rawEvidenceTotal).toBe(30);
    expect(payload?.rawEvidenceReturned).toBe(30);
    const lastGap = payload!.rows.find(row => row.normalizedKeyword === 'provider evidence 29');
    expect(lastGap).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE,
      metrics: expect.objectContaining({ volume: 1029, difficulty: 49 }),
    }));
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

    const payload = await buildKeywordCommandCenter(workspaceId);
    const row = payload!.rows.find(item => item.normalizedKeyword === 'promotable provider keyword');
    expect(row).toEqual(expect.objectContaining({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
      rawEvidenceOnly: true,
      tracking: expect.objectContaining({ status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    }));
  });
});

describe('applyKeywordCommandCenterAction', () => {
  it('adds requested keywords to strategy using canonical keyword equality', async () => {
    seedFeedback('Requested-Keyword', 'requested', 'Client asked about this.');

    applyKeywordCommandCenterAction(workspaceId, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'requested keyword',
    });

    const payload = await buildKeywordCommandCenter(workspaceId);
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
