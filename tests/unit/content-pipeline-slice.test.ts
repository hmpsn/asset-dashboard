import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getContentPipelineSummary: vi.fn(),
  getWorkspace: vi.fn(),
  listBriefs: vi.fn(),
  listContentSubscriptions: vi.fn(),
  getSchemaPlan: vi.fn(),
  listPendingSchemas: vi.fn(),
  listMatrices: vi.fn(),
  detectMatrixCannibalization: vi.fn(),
  loadDecayAnalysis: vi.fn(),
  listSuggestedBriefs: vi.fn(),
  parseJsonSafe: vi.fn(),
  sectionCountsAll: vi.fn(),
  entryCountsAll: vi.fn(),
  lastBatchJobGet: vi.fn(),
  activePatternCountGet: vi.fn(),
  prepare: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../server/workspace-data.js', () => ({
  getContentPipelineSummary: mocks.getContentPipelineSummary,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../../server/content-brief.js', () => ({
  listBriefs: mocks.listBriefs,
}));

vi.mock('../../server/content-subscriptions.js', () => ({
  listContentSubscriptions: mocks.listContentSubscriptions,
}));

vi.mock('../../server/schema-store.js', () => ({
  getSchemaPlan: mocks.getSchemaPlan,
}));

vi.mock('../../server/schema-queue.js', () => ({
  listPendingSchemas: mocks.listPendingSchemas,
}));

vi.mock('../../server/content-matrices.js', () => ({
  listMatrices: mocks.listMatrices,
}));

vi.mock('../../server/cannibalization-detection.js', () => ({
  detectMatrixCannibalization: mocks.detectMatrixCannibalization,
}));

vi.mock('../../server/content-decay.js', () => ({
  loadDecayAnalysis: mocks.loadDecayAnalysis,
}));

vi.mock('../../server/suggested-briefs-store.js', () => ({
  listSuggestedBriefs: mocks.listSuggestedBriefs,
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafe: mocks.parseJsonSafe,
}));

vi.mock('../../server/middleware/validate.js', () => ({
  z: {
    object: () => ({}),
    number: () => ({}),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => {
    let cache: unknown;
    return () => {
      if (!cache) cache = factory();
      return cache;
    };
  },
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mocks.prepare.mockImplementation((sql: string) => {
      if (
        sql.includes('FROM copy_sections') &&
        sql.includes('GROUP BY status')
      ) {
        return { all: mocks.sectionCountsAll };
      }
      if (
        sql.includes('FROM copy_sections') &&
        sql.includes('GROUP BY entry_id')
      ) {
        return { all: mocks.entryCountsAll };
      }
      if (sql.includes('FROM copy_batch_jobs')) {
        return { get: mocks.lastBatchJobGet };
      }
      if (sql.includes('FROM copy_intelligence')) {
        return { get: mocks.activePatternCountGet };
      }
      throw new Error(`Unexpected SQL in test: ${sql.slice(0, 80)}`);
    }),
  },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: mocks.logWarn,
    debug: mocks.logDebug,
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const { assembleContentPipeline } =
  await import('../../server/intelligence/content-pipeline-slice.js');

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getContentPipelineSummary.mockReturnValue({
    briefs: { total: 12, byStatus: { draft: 5, approved: 7 } },
    posts: { total: 4, byStatus: { scheduled: 2, published: 2 } },
    matrices: { total: 2, cellsPlanned: 30, cellsPublished: 11 },
    requests: { pending: 3, inProgress: 2, delivered: 1 },
    workOrders: { active: 2, pending: 1 },
    seoEdits: { pending: 1, applied: 8, inReview: 2 },
  });

  mocks.getWorkspace.mockReturnValue({
    keywordStrategy: {
      siteKeywords: [
        'SEO Services!',
        { keyword: 'Local SEO' },
        'Technical SEO',
      ],
    },
    webflowSiteId: 'site_1',
    rewritePlaybook: 'Keep intros concise\n\nAdd proof early',
    contentPricing: {
      briefPrice: 149,
      fullPostPrice: 499,
      currency: 'USD',
      briefLabel: 'Brief',
      fullPostLabel: 'Post',
    },
  });

  mocks.listBriefs.mockReturnValue([
    { targetKeyword: 'seo services' },
    { targetKeyword: 'LOCAL SEO' },
  ]);

  mocks.listContentSubscriptions.mockReturnValue([
    { status: 'active', postsPerMonth: 10 },
    { status: 'active', postsPerMonth: 6 },
    { status: 'paused', postsPerMonth: 20 },
  ]);

  mocks.getSchemaPlan.mockReturnValue({
    pageRoles: [
      { primaryType: 'Article' },
      { primaryType: 'FAQPage' },
      { primaryType: 'Article' },
    ],
  });
  mocks.listPendingSchemas.mockReturnValue([{ id: 's1' }]);

  mocks.listMatrices.mockReturnValue([{ id: 'matrix_1' }]);
  mocks.detectMatrixCannibalization.mockReturnValue({
    conflicts: [
      {
        keyword: 'seo services',
        sourceId: '/services',
        conflictsWith: { identifier: '/seo-services' },
        severity: 'high',
      },
    ],
  });

  mocks.loadDecayAnalysis.mockReturnValue({
    analyzedAt: '2026-05-24T09:00:00.000Z',
    decayingPages: [
      {
        page: '/blog/old-guide',
        clickDeclinePct: 38,
        refreshRecommendation: 'Update stats',
        isRepeatDecay: true,
      },
    ],
  });

  mocks.listSuggestedBriefs.mockReturnValue([
    { status: 'pending' },
    { status: 'pending' },
    { status: 'accepted' },
  ]);

  mocks.sectionCountsAll.mockReturnValue([
    { status: 'approved', cnt: 8, first_version_cnt: 5 },
    { status: 'draft', cnt: 3, first_version_cnt: 0 },
    { status: 'client_review', cnt: 2, first_version_cnt: 0 },
    { status: 'pending', cnt: 1, first_version_cnt: 0 },
    { status: 'revision_requested', cnt: 2, first_version_cnt: 0 },
  ]);
  mocks.entryCountsAll.mockReturnValue([
    { entry_id: 'e1', total: 2, approved: 2 },
    { entry_id: 'e2', total: 3, approved: 1 },
  ]);
  mocks.lastBatchJobGet.mockReturnValue({
    status: 'running',
    progress_json: JSON.stringify({
      total: 20,
      generated: 8,
      reviewed: 4,
      approved: 3,
    }),
    created_at: '2026-05-24T08:00:00.000Z',
  });
  mocks.activePatternCountGet.mockReturnValue({ cnt: 4 });

  mocks.parseJsonSafe.mockImplementation(
    (raw: string, _schema: unknown, fallback: unknown) => {
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
  );
});

describe('assembleContentPipeline', () => {
  it('assembles full content-pipeline shape and preserves graceful optional joins', async () => {
    const result = await assembleContentPipeline('ws_1');

    expect(result.briefs).toEqual({
      total: 12,
      byStatus: { draft: 5, approved: 7 },
    });
    expect(result.posts).toEqual({
      total: 4,
      byStatus: { scheduled: 2, published: 2 },
    });
    expect(result.matrices).toEqual({
      total: 2,
      cellsPlanned: 30,
      cellsPublished: 11,
    });
    expect(result.requests).toEqual({
      pending: 3,
      inProgress: 2,
      delivered: 1,
    });
    expect(result.workOrders).toEqual({ active: 2, pending: 1 });
    expect(result.seoEdits).toEqual({ pending: 1, applied: 8, inReview: 2 });

    expect(result.coverageGaps).toEqual(['Technical SEO']);
    expect(result.subscriptions).toEqual({ active: 2, totalPages: 16 });
    expect(result.schemaDeployment).toEqual({
      planned: 3,
      deployed: 2,
      types: ['Article', 'FAQPage'],
    });

    expect(result.cannibalizationWarnings).toEqual([
      {
        keyword: 'seo services',
        pages: ['/services', '/seo-services'],
        severity: 'high',
      },
    ]);

    expect(result.decayAlerts).toEqual([
      {
        pageUrl: '/blog/old-guide',
        clickDrop: 38,
        detectedAt: '2026-05-24T09:00:00.000Z',
        hasRefreshBrief: true,
        isRepeatDecay: true,
      },
    ]);

    expect(result.suggestedBriefs).toBe(2);
    expect(result.rewritePlaybook).toEqual({
      patterns: ['Keep intros concise', 'Add proof early'],
      lastUsedAt: null,
    });
    expect(result.contentPricing).toEqual({
      briefPrice: 149,
      fullPostPrice: 499,
      currency: 'USD',
      briefLabel: 'Brief',
      fullPostLabel: 'Post',
    });

    expect(result.copyPipeline).toEqual({
      totalSections: 16,
      approvedSections: 8,
      draftSections: 3,
      clientReviewSections: 2,
      pendingSections: 1,
      revisionSections: 2,
      approvalRate: 50,
      firstTryApprovalRate: 63,
      activePatternsCount: 4,
      lastBatchJob: {
        status: 'running',
        completionRate: 40,
        createdAt: '2026-05-24T08:00:00.000Z',
      },
      entriesWithCompleteCopy: 1,
      entriesWithPendingCopy: 1,
    });
  });

  it('degrades to stable defaults when providers fail', async () => {
    mocks.getContentPipelineSummary.mockImplementation(() => {
      throw new Error('summary unavailable');
    });
    mocks.getWorkspace.mockImplementation(() => {
      throw new Error('workspace unavailable');
    });
    mocks.listBriefs.mockImplementation(() => {
      throw new Error('brief store unavailable');
    });
    mocks.listContentSubscriptions.mockImplementation(() => {
      throw new Error('subscriptions unavailable');
    });
    mocks.getSchemaPlan.mockImplementation(() => {
      throw new Error('schema unavailable');
    });
    mocks.listMatrices.mockImplementation(() => {
      throw new Error('matrix store unavailable');
    });
    mocks.loadDecayAnalysis.mockImplementation(() => {
      throw new Error('decay unavailable');
    });
    mocks.listSuggestedBriefs.mockImplementation(() => {
      throw new Error('suggested briefs unavailable');
    });
    mocks.sectionCountsAll.mockImplementation(() => {
      throw new Error('copy sections unavailable');
    });

    const result = await assembleContentPipeline('ws_degraded');

    expect(result).toEqual({
      briefs: { total: 0, byStatus: {} },
      posts: { total: 0, byStatus: {} },
      matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
      requests: { pending: 0, inProgress: 0, delivered: 0 },
      workOrders: { active: 0, pending: 0 },
      coverageGaps: [],
      seoEdits: { pending: 0, applied: 0, inReview: 0 },
      subscriptions: undefined,
      schemaDeployment: undefined,
      cannibalizationWarnings: [],
      decayAlerts: [],
      suggestedBriefs: 0,
      copyPipeline: undefined,
      rewritePlaybook: undefined,
      contentPricing: undefined,
    });
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('omits copyPipeline when workspace has no copy sections', async () => {
    mocks.sectionCountsAll.mockReturnValue([]);

    const result = await assembleContentPipeline('ws_no_copy');

    expect(result.copyPipeline).toBeUndefined();
  });

  it('keeps optional provider failures at debug level with stable fallbacks', async () => {
    mocks.listSuggestedBriefs.mockImplementation(() => {
      throw new Error('suggested briefs unavailable');
    });

    const result = await assembleContentPipeline('ws_optional_error');

    expect(result.suggestedBriefs).toBe(0);
    expect(mocks.logDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_optional_error',
        err: expect.any(Error),
      }),
      'assembleContentPipeline: suggested briefs optional, degrading gracefully',
    );
  });

  it('keeps programming errors on the same debug fallback path in this slice', async () => {
    mocks.listSuggestedBriefs.mockImplementation(() => {
      throw new TypeError('wrong export');
    });

    const result = await assembleContentPipeline('ws_programming_error');

    expect(result.suggestedBriefs).toBe(0);
    expect(mocks.logDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_programming_error',
        err: expect.any(TypeError),
      }),
      'assembleContentPipeline: suggested briefs optional, degrading gracefully',
    );
    expect(mocks.logWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      'assembleContentPipeline: suggested briefs programming error',
    );
  });
});
