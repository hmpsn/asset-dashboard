import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentMatrix, ContentTopicRequest, GeneratedPost } from '../../shared/types/content.js';
import type { OutcomeReadback } from '../../shared/types/outcome-tracking.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { OutcomeReadbacks } from '../../server/outcome-tracking.js';

const mocks = vi.hoisted(() => ({
  getBrief: vi.fn(),
  getGA4LandingPages: vi.fn(),
  getAllGscPages: vi.fn(),
  getPageTrend: vi.fn(),
  getScoredOutcomeReadbacks: vi.fn(),
  getWorkspace: vi.fn(),
  listContentRequests: vi.fn(),
  listMatrices: vi.fn(),
  listPosts: vi.fn(),
}));

vi.mock('../../server/content-brief.js', () => ({
  getBrief: mocks.getBrief,
}));

vi.mock('../../server/content-matrices.js', () => ({
  listMatrices: mocks.listMatrices,
}));

vi.mock('../../server/content-requests.js', () => ({
  listContentRequests: mocks.listContentRequests,
}));

vi.mock('../../server/content-posts.js', () => ({
  listPosts: mocks.listPosts,
}));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4LandingPages: mocks.getGA4LandingPages,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getScoredOutcomeReadbacks: mocks.getScoredOutcomeReadbacks,
}));

vi.mock('../../server/search-console.js', () => ({
  getAllGscPages: mocks.getAllGscPages,
  getPageTrend: mocks.getPageTrend,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

import { getContentPerformance, getContentPerformanceTrend } from '../../server/domains/content/content-performance.js';

function makeWorkspace(): Workspace {
  return {
    id: 'ws-content-performance',
    name: 'Content Performance Workspace',
  };
}

function makeRequest(overrides: Partial<ContentTopicRequest> = {}): ContentTopicRequest {
  return {
    id: 'req-content',
    workspaceId: 'ws-content-performance',
    topic: 'Emergency dentist cost guide',
    targetKeyword: 'Emergency Dentist Cost',
    intent: 'informational',
    priority: 'high',
    rationale: 'Create a useful cost guide.',
    status: 'published',
    requestedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-content',
    workspaceId: 'ws-content-performance',
    briefId: 'brief-content',
    targetKeyword: 'Emergency Dentist Cost',
    title: 'Emergency Dentist Cost Guide',
    metaDescription: 'Emergency dentist cost ranges and next steps.',
    introduction: '<p>Emergency dentist cost depends on treatment.</p>',
    sections: [],
    conclusion: '<p>Ask for a treatment estimate.</p>',
    totalWordCount: 600,
    targetWordCount: 1200,
    status: 'approved',
    publishedAt: '2026-06-15T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<OutcomeReadback> = {}): OutcomeReadback {
  return {
    actionId: 'action-content',
    actionType: 'content_published',
    score: 'win',
    checkpointDays: 90,
    primaryMetric: 'position',
    direction: 'improved',
    baselineValue: 14,
    currentValue: 6,
    baselinePosition: 14,
    currentPosition: 6,
    baselineClicks: null,
    currentClicks: null,
    measuredAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReadbacks(overrides: Partial<OutcomeReadbacks> = {}): OutcomeReadbacks {
  return {
    bySource: new Map(),
    byKeyword: new Map(),
    byPage: new Map(),
    ...overrides,
  };
}

describe('getContentPerformance outcome readbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockReturnValue(makeWorkspace());
    mocks.getBrief.mockReturnValue(undefined);
    mocks.listContentRequests.mockReturnValue([]);
    mocks.listMatrices.mockReturnValue([]);
    mocks.listPosts.mockReturnValue([]);
    mocks.getScoredOutcomeReadbacks.mockReturnValue(makeReadbacks());
  });

  it('attaches outcome from the resolved post source-id before keyword fallback', async () => {
    const sourceOutcome = makeOutcome({ actionId: 'source-action', score: 'strong_win' });
    const keywordOutcome = makeOutcome({ actionId: 'keyword-action', score: 'loss', direction: 'declined' });

    mocks.listContentRequests.mockReturnValue([
      makeRequest({ id: 'req-source', postId: 'post-source', targetKeyword: 'Emergency Dentist Cost' }),
    ]);
    mocks.listPosts.mockReturnValue([
      makePost({ id: 'post-source', targetKeyword: 'Emergency Dentist Cost' }),
    ]);
    mocks.getScoredOutcomeReadbacks.mockReturnValue(makeReadbacks({
      bySource: new Map([['post::post-source', sourceOutcome]]),
      byKeyword: new Map([['emergency dentist cost', keywordOutcome]]),
    }));

    const response = await getContentPerformance('ws-content-performance');

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ itemId: 'req-source', requestId: 'req-source', source: 'request' });
    expect(response.items[0].joinback?.postId).toBe('post-source');
    expect(response.items[0].outcome).toBe(sourceOutcome);
    expect(response.items[0].outcome?.actionId).toBe('source-action');
    expect(response.summary).toMatchObject({
      piecesTracked: 1,
      piecesPublished: 1,
      piecesDelivered: 0,
      measuredOutcomes: 1,
      wins: 1,
      averagePositionGain: 8,
    });
    expect(mocks.getScoredOutcomeReadbacks).toHaveBeenCalledTimes(1);
  });

  it('attaches outcome via normalized targetKeyword fallback when no post source exists', async () => {
    const keywordOutcome = makeOutcome({ actionId: 'keyword-action', score: 'neutral', direction: 'stable' });

    mocks.listContentRequests.mockReturnValue([
      makeRequest({ id: 'req-keyword', targetKeyword: '  Emergency Dentist Cost  ' }),
    ]);
    mocks.getScoredOutcomeReadbacks.mockReturnValue(makeReadbacks({
      byKeyword: new Map([['emergency dentist cost', keywordOutcome]]),
    }));

    const response = await getContentPerformance('ws-content-performance');

    expect(response.items).toHaveLength(1);
    expect(response.items[0].joinback).toBeUndefined();
    expect(response.items[0].outcome).toBe(keywordOutcome);
  });

  it('leaves outcome absent when no scored action readback matches', async () => {
    mocks.listContentRequests.mockReturnValue([
      makeRequest({ id: 'req-none', postId: 'post-none', targetKeyword: 'No Scored Action' }),
    ]);
    mocks.listPosts.mockReturnValue([
      makePost({ id: 'post-none', targetKeyword: 'No Scored Action' }),
    ]);

    const response = await getContentPerformance('ws-content-performance');

    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items.every(item => item.outcome === undefined)).toBe(true); // every-ok — length asserted on the line above
  });

  it('resolves a published matrix item trend without a request lookup', async () => {
    mocks.getWorkspace.mockReturnValue({
      ...makeWorkspace(),
      webflowSiteId: 'site-1',
      gscPropertyUrl: 'sc-domain:example.com',
    });
    const matrix: ContentMatrix = {
      id: 'matrix-1',
      workspaceId: 'ws-content-performance',
      name: 'Locations',
      templateId: 'template-1',
      dimensions: [],
      urlPattern: '/locations/{city}',
      keywordPattern: '{city} dentist',
      cells: [{
        id: 'cell-1',
        variableValues: { city: 'Austin' },
        targetKeyword: 'austin dentist',
        plannedUrl: '/locations/austin',
        status: 'published',
      }],
      stats: { total: 1, planned: 0, briefGenerated: 0, drafted: 0, reviewed: 0, published: 1 },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    };
    mocks.listMatrices.mockReturnValue([matrix]);
    mocks.getPageTrend.mockResolvedValue([{ date: '2026-06-16', clicks: 3, impressions: 40, ctr: 7.5, position: 5 }]);

    const result = await getContentPerformanceTrend('ws-content-performance', 'cell-1');

    expect(result?.availability).toBe('available');
    expect(result?.trend).toHaveLength(1);
    expect(mocks.getPageTrend).toHaveBeenCalledWith(
      'site-1',
      'sc-domain:example.com',
      'https://example.com/locations/austin',
      90,
      expect.objectContaining({ startDate: '2026-06-15' }),
    );
  });
});
