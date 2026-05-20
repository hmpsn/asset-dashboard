import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTrackedKeyword, getTrackedKeywords } from '../../server/rank-tracking.js';
import { buildKeywordStrategyRefreshSummary, buildKeywordStrategyUxPayload } from '../../server/keyword-strategy-ux.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';
import type { ContentGap, KeywordGapItem, KeywordStrategy, PageKeywordMap } from '../../shared/types/workspace.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`Keyword Strategy UX ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

function strategy(overrides: Partial<KeywordStrategy> = {}): KeywordStrategy {
  return {
    siteKeywords: ['cosmetic dentist'],
    siteKeywordMetrics: [{ keyword: 'cosmetic dentist', volume: 900, difficulty: 38 }],
    opportunities: [],
    businessContext: 'Cosmetic dental office offering veneers, whitening, and implants.',
    generatedAt: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

function page(overrides: Partial<PageKeywordMap> = {}): PageKeywordMap {
  return {
    pagePath: '/services/cosmetic-dentistry',
    pageTitle: 'Cosmetic Dentistry',
    primaryKeyword: 'cosmetic dentistry',
    secondaryKeywords: [],
    currentPosition: 12,
    impressions: 450,
    volume: 700,
    difficulty: 29,
    ...overrides,
  };
}

function contentGap(overrides: Partial<ContentGap> = {}): ContentGap {
  return {
    topic: 'Veneers guide',
    targetKeyword: 'porcelain veneers cost',
    intent: 'commercial',
    priority: 'high',
    rationale: 'Patients compare veneer cost before booking cosmetic dentistry consults.',
    volume: 500,
    difficulty: 42,
    opportunityScore: 71,
    competitorProof: 'example-dentist.com ranks #4',
    ...overrides,
  };
}

function keywordGap(overrides: Partial<KeywordGapItem> = {}): KeywordGapItem {
  return {
    keyword: 'best teeth whitening strips',
    volume: 2400,
    difficulty: 65,
    competitorDomain: 'competitor.example',
    competitorPosition: 8,
    ...overrides,
  };
}

describe('buildKeywordStrategyRefreshSummary', () => {
  it('counts added, retained, reassigned, retired, and preserved keyword states', () => {
    addTrackedKeyword(workspaceId, 'old strategy keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      deprecatedAt: '2026-05-20T10:00:00.000Z',
    });
    addTrackedKeyword(workspaceId, 'older strategy keyword', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      status: TRACKED_KEYWORD_STATUS.DEPRECATED,
      deprecatedAt: '2026-05-10T10:00:00.000Z',
    });
    addTrackedKeyword(workspaceId, 'client requested keyword', {
      source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
    });

    const summary = buildKeywordStrategyRefreshSummary({
      previousGeneratedAt: '2026-05-19T10:00:00.000Z',
      currentGeneratedAt: '2026-05-20T10:00:00.000Z',
      previousSiteKeywords: ['cosmetic dentist'],
      currentSiteKeywords: ['cosmetic dentist', 'dental implants'],
      previousContentGapKeywords: ['old blog topic'],
      currentContentGapKeywords: ['porcelain veneers cost'],
      previousPageMap: [{ pagePath: '/services/cosmetic-dentistry', primaryKeyword: 'cosmetic dentistry' }],
      currentPageMap: [{ pagePath: '/services/cosmetic-dentistry', primaryKeyword: 'veneers dentist' }],
      trackedKeywords: getTrackedKeywords(workspaceId, { includeInactive: true }),
    });

    expect(summary).toEqual(expect.objectContaining({
      added: 1,
      retained: 1,
      reassigned: 1,
      deprecated: 1,
      preserved: 1,
      newContentGaps: 1,
      resolvedContentGaps: 1,
    }));
  });
});

describe('buildKeywordStrategyUxPayload', () => {
  it('maps strategy keywords to explanations with tracking state and safe next actions', async () => {
    addTrackedKeyword(workspaceId, 'cosmetic dentistry', {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: '/services/cosmetic-dentistry',
      pageTitle: 'Cosmetic Dentistry',
      baselinePosition: 12,
    });

    const payload = await buildKeywordStrategyUxPayload({
      workspaceId,
      strategy: strategy(),
      pageMap: [page()],
      contentGaps: [contentGap()],
      keywordGaps: [keywordGap()],
      surface: 'admin',
    });

    const pageExplanation = payload.explanations.find(explanation => explanation.normalizedKeyword === 'cosmetic dentistry');
    const contentExplanation = payload.explanations.find(explanation => explanation.normalizedKeyword === 'porcelain veneers cost');
    const rawEvidence = payload.explanations.find(explanation => explanation.normalizedKeyword === 'best teeth whitening strips');

    expect(pageExplanation).toEqual(expect.objectContaining({
      role: 'page_keyword',
      surfaceLabel: 'Page opportunity',
      nextAction: expect.objectContaining({ type: 'optimize_page' }),
      tracking: expect.objectContaining({ status: TRACKED_KEYWORD_STATUS.ACTIVE }),
    }));
    expect(pageExplanation?.sourceEvidence).toEqual(expect.arrayContaining(['Mapped to Cosmetic Dentistry']));
    expect(contentExplanation).toEqual(expect.objectContaining({
      role: 'content_gap',
      opportunityScore: 71,
      nextAction: expect.objectContaining({
        type: 'generate_brief',
        label: 'Request content',
        targetTab: 'content-plan',
      }),
    }));
    expect(rawEvidence).toEqual(expect.objectContaining({
      role: 'competitor_gap',
      rawEvidenceOnly: true,
      nextAction: expect.objectContaining({ type: 'review_evidence' }),
    }));
    expect(payload.rawEvidenceNote).toMatch(/Raw provider evidence/);
  });

  it('prefers page explanations over overlapping site-keyword explanations', async () => {
    const payload = await buildKeywordStrategyUxPayload({
      workspaceId,
      strategy: strategy({ siteKeywords: ['cosmetic dentistry'] }),
      pageMap: [page()],
      contentGaps: [contentGap()],
      keywordGaps: [],
      surface: 'client',
    });

    const explanation = payload.explanations.find(item => item.normalizedKeyword === 'cosmetic dentistry');
    expect(explanation).toEqual(expect.objectContaining({
      role: 'page_keyword',
      pagePath: '/services/cosmetic-dentistry',
      nextAction: expect.objectContaining({ type: 'optimize_page' }),
    }));
  });

  it('keeps raw competitor gaps out of client-facing explanations', async () => {
    const payload = await buildKeywordStrategyUxPayload({
      workspaceId,
      strategy: strategy(),
      pageMap: [page()],
      contentGaps: [contentGap()],
      keywordGaps: [keywordGap()],
      surface: 'client',
    });

    expect(payload.explanations.length).toBeGreaterThan(0);
    expect(payload.explanations.some(explanation => explanation.role === 'competitor_gap')).toBe(false);
    expect(payload.explanations.filter(explanation => explanation.rawEvidenceOnly)).toEqual([]);
    expect(payload.rawEvidenceNote).toBeUndefined();
  });
});
