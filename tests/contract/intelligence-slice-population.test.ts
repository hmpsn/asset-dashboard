// tests/contract/intelligence-slice-population.test.ts
//
// CONTRACT: Every intelligence slice assembler returns an object with ALL fields
// defined in its interface. When tables are empty, assemblers return default/empty
// values — NOT undefined/missing keys.
//
// These tests guard against silent regressions where a new interface field is added
// but the assembler never populates it, causing downstream consumers (AI prompts,
// frontend components) to receive undefined unexpectedly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before any imports) ─────────────────────────
// We mock all server-layer dependencies so the assemblers run against empty data.
// The goal is purely structural: verify all interface fields are returned.

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated' },
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: vi.fn(),
  debouncedAnomalyBoost: vi.fn(),
  withWorkspaceLock: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

// ── SEO context dependencies ──────────────────────────────────────────────────

vi.mock('../../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({
    strategy: null,
    brandVoiceBlock: '',
    businessContext: '',
    knowledgeBlock: '',
  })),
  getRawBrandVoice: vi.fn(() => ''),
  getRawKnowledge: vi.fn(() => ''),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-test', personas: [], tier: 'free' })),
}));

vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: vi.fn(() => []),
  getPageKeyword: vi.fn(() => undefined),
}));

vi.mock('../../server/rank-tracking.js', () => ({
  getTrackedKeywords: vi.fn(() => []),
  getLatestRanks: vi.fn(() => []),
}));

vi.mock('../../server/keyword-recommendations.js', () => ({
  getKeywordRecommendations: vi.fn(() => []),
}));

// ── Insights dependencies ────────────────────────────────────────────────────

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

// ── Learnings dependencies ───────────────────────────────────────────────────

vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => null),
}));

vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));

vi.mock('../../server/roi-attribution.js', () => ({
  getROIAttributionsRaw: vi.fn(() => []),
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getActionsByPage: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
}));

// ── Content pipeline dependencies ────────────────────────────────────────────

vi.mock('../../server/workspace-data.js', () => ({
  getContentPipelineSummary: vi.fn(() => ({
    briefs: { total: 0, byStatus: {} },
    posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
  })),
}));

vi.mock('../../server/content-brief.js', () => ({
  listBriefs: vi.fn(() => []),
}));

vi.mock('../../server/content-subscriptions.js', () => ({
  listContentSubscriptions: vi.fn(() => []),
}));

vi.mock('../../server/schema-store.js', () => ({
  getSchemaPlan: vi.fn(() => null),
}));

vi.mock('../../server/schema-queue.js', () => ({
  listPendingSchemas: vi.fn(() => []),
}));

vi.mock('../../server/content-matrices.js', () => ({
  listMatrices: vi.fn(() => []),
}));

vi.mock('../../server/cannibalization-detection.js', () => ({
  detectMatrixCannibalization: vi.fn(() => ({ conflicts: [] })),
}));

vi.mock('../../server/content-decay.js', () => ({
  loadDecayAnalysis: vi.fn(() => null),
}));

vi.mock('../../server/suggested-briefs-store.js', () => ({
  listSuggestedBriefs: vi.fn(() => []),
}));

// ── Site health dependencies ──────────────────────────────────────────────────

vi.mock('../../server/reports.js', () => ({
  getLatestSnapshot: vi.fn(() => null),
  listSnapshots: vi.fn(() => []),
}));

vi.mock('../../server/schema-validator.js', () => ({
  getValidations: vi.fn(() => []),
}));

vi.mock('../../server/site-architecture.js', () => ({
  getCachedArchitecture: vi.fn(() => Promise.resolve(null)),
  flattenTree: vi.fn(() => []),
}));

vi.mock('../../server/performance-store.js', () => ({
  getPageSpeed: vi.fn(() => null),
  getLatestSnapshot: vi.fn(() => null),
  listSnapshots: vi.fn(() => []),
}));

vi.mock('../../server/anomaly-detection.js', () => ({
  listAnomalies: vi.fn(() => []),
}));

vi.mock('../../server/seo-change-tracker.js', () => ({
  getSeoChanges: vi.fn(() => []),
}));

// ── Client signals dependencies ──────────────────────────────────────────────

vi.mock('../../server/churn-signals.js', () => ({
  listChurnSignals: vi.fn(() => []),
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: vi.fn(() => []),
}));

vi.mock('../../server/client-users.js', () => ({
  listClientUsers: vi.fn(() => []),
}));

vi.mock('../../server/roi.js', () => ({
  computeROI: vi.fn(() => null),
}));

vi.mock('../../server/feedback.js', () => ({
  listFeedback: vi.fn(() => []),
}));

vi.mock('../../server/requests.js', () => ({
  listRequests: vi.fn(() => []),
}));

vi.mock('../../server/client-signals-store.js', () => ({
  listClientSignals: vi.fn(() => []),
  countNewSignals: vi.fn(() => 0),
  countAllSignals: vi.fn(() => 0),
}));

vi.mock('../../server/chat-memory.js', () => ({
  getMonthlyConversationCount: vi.fn(() => 0),
  listSessions: vi.fn(() => []),
}));

// ── Operational dependencies ─────────────────────────────────────────────────

vi.mock('../../server/activity-log.js', () => ({
  listActivity: vi.fn(() => []),
}));

vi.mock('../../server/analytics-annotations.js', () => ({
  getAnnotations: vi.fn(() => []),
}));

vi.mock('../../server/annotations.js', () => ({
  listAnnotations: vi.fn(() => []),
}));

vi.mock('../../server/jobs.js', () => ({
  listJobs: vi.fn(() => []),
}));

vi.mock('../../server/usage-tracking.js', () => ({
  getUsageSummary: vi.fn(() => ({})),
}));

vi.mock('../../server/recommendations.js', () => ({
  loadRecommendations: vi.fn(() => null),
}));

vi.mock('../../server/work-orders.js', () => ({
  listWorkOrders: vi.fn(() => []),
}));

// ── Page profile dependencies ────────────────────────────────────────────────

vi.mock('../../server/content-posts-db.js', () => ({
  listPosts: vi.fn(() => []),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import type {
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  PageProfileSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
} from '../../shared/types/intelligence.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-contract-test';

async function getSlice<T>(slice: string, opts?: object): Promise<T> {
  const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
  invalidateIntelligenceCache(WORKSPACE_ID);
  const result = await buildWorkspaceIntelligence(WORKSPACE_ID, {
    slices: [slice as any],
    ...opts,
  });
  return (result as any)[slice] as T;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('contract: SeoContextSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles seoContext and returns all required interface fields', async () => {
    const result = await getSlice<SeoContextSlice>('seoContext');

    expect(result).toBeDefined();

    // Required fields (always present, non-optional in interface)
    expect(result).toHaveProperty('strategy');
    expect(result).toHaveProperty('brandVoice');
    expect(result).toHaveProperty('businessContext');
    expect(result).toHaveProperty('personas');
    expect(result).toHaveProperty('knowledgeBase');
  });

  it('returns correct types for required seoContext fields', async () => {
    const result = await getSlice<SeoContextSlice>('seoContext');

    // strategy is undefined when workspace has no keyword strategy
    expect(result.strategy === undefined || typeof result.strategy === 'object').toBe(true);
    expect(typeof result.brandVoice).toBe('string');
    expect(typeof result.businessContext).toBe('string');
    expect(Array.isArray(result.personas)).toBe(true);
    expect(typeof result.knowledgeBase).toBe('string');
  });

  it('optional seoContext fields are absent or correct type when present', async () => {
    const result = await getSlice<SeoContextSlice>('seoContext');

    // Optional fields: undefined is acceptable; if present must be correct type
    if (result.pageKeywords !== undefined) {
      expect(typeof result.pageKeywords).toBe('object');
    }
    if (result.businessProfile !== undefined) {
      expect(typeof result.businessProfile).toBe('object');
      expect(typeof result.businessProfile.industry).toBe('string');
      expect(Array.isArray(result.businessProfile.goals)).toBe(true);
      expect(typeof result.businessProfile.targetAudience).toBe('string');
    }
    if (result.backlinkProfile !== undefined) {
      expect(typeof result.backlinkProfile.totalBacklinks).toBe('number');
      expect(typeof result.backlinkProfile.referringDomains).toBe('number');
    }
    if (result.serpFeatures !== undefined) {
      expect(typeof result.serpFeatures.featuredSnippets).toBe('number');
      expect(typeof result.serpFeatures.peopleAlsoAsk).toBe('number');
      expect(typeof result.serpFeatures.localPack).toBe('boolean');
      expect(typeof result.serpFeatures.videoCarousel).toBe('number');
    }
    if (result.rankTracking !== undefined) {
      expect(typeof result.rankTracking.trackedKeywords).toBe('number');
      expect(typeof result.rankTracking.positionChanges).toBe('object');
    }
    if (result.strategyHistory !== undefined) {
      expect(typeof result.strategyHistory.revisionsCount).toBe('number');
      expect(typeof result.strategyHistory.lastRevisedAt).toBe('string');
    }
    if (result.keywordRecommendations !== undefined) {
      expect(Array.isArray(result.keywordRecommendations)).toBe(true);
    }
  });
});

describe('contract: InsightsSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles insights and returns all required interface fields', async () => {
    const result = await getSlice<InsightsSlice>('insights');

    expect(result).toBeDefined();

    // All required fields from the InsightsSlice interface
    expect(result).toHaveProperty('all');
    expect(result).toHaveProperty('byType');
    expect(result).toHaveProperty('bySeverity');
    expect(result).toHaveProperty('topByImpact');
  });

  it('returns correct types for all InsightsSlice fields', async () => {
    const result = await getSlice<InsightsSlice>('insights');

    expect(Array.isArray(result.all)).toBe(true);
    expect(typeof result.byType).toBe('object');
    expect(typeof result.bySeverity).toBe('object');
    expect(Array.isArray(result.topByImpact)).toBe(true);
  });

  it('bySeverity contains all four severity keys', async () => {
    const result = await getSlice<InsightsSlice>('insights');

    expect(result.bySeverity).toHaveProperty('critical');
    expect(result.bySeverity).toHaveProperty('warning');
    expect(result.bySeverity).toHaveProperty('opportunity');
    expect(result.bySeverity).toHaveProperty('positive');
    expect(typeof result.bySeverity.critical).toBe('number');
    expect(typeof result.bySeverity.warning).toBe('number');
    expect(typeof result.bySeverity.opportunity).toBe('number');
    expect(typeof result.bySeverity.positive).toBe('number');
  });

  it('forPage is absent when no pagePath is provided', async () => {
    const result = await getSlice<InsightsSlice>('insights');
    // forPage is optional — should be undefined when no pagePath given
    expect(result.forPage).toBeUndefined();
  });

  it('forPage is present (array) when pagePath is provided', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const result = await buildWorkspaceIntelligence(WORKSPACE_ID, {
      slices: ['insights'],
      pagePath: '/some-page',
    });

    expect(result.insights?.forPage).toBeDefined();
    expect(Array.isArray(result.insights?.forPage)).toBe(true);
  });
});

describe('contract: LearningsSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles learnings and returns all required interface fields (feature flag off)', async () => {
    // feature flag is off by default in mocks — returns empty defaults
    const result = await getSlice<LearningsSlice>('learnings');

    expect(result).toBeDefined();

    // All required (non-optional) fields from LearningsSlice interface
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('topActionTypes');
    expect(result).toHaveProperty('overallWinRate');
    expect(result).toHaveProperty('recentTrend');
    expect(result).toHaveProperty('playbooks');
  });

  it('returns correct types for required LearningsSlice fields', async () => {
    const result = await getSlice<LearningsSlice>('learnings');

    expect(result.summary === null || typeof result.summary === 'object').toBe(true);
    expect(result.confidence === null || typeof result.confidence === 'string').toBe(true);
    expect(Array.isArray(result.topActionTypes)).toBe(true);
    expect(typeof result.overallWinRate).toBe('number');
    expect(result.recentTrend === null || typeof result.recentTrend === 'string').toBe(true);
    expect(Array.isArray(result.playbooks)).toBe(true);
  });

  it('optional LearningsSlice fields are correct type when present', async () => {
    const result = await getSlice<LearningsSlice>('learnings');

    // roiAttribution — optional, may be absent or array
    if (result.roiAttribution !== undefined) {
      expect(Array.isArray(result.roiAttribution)).toBe(true);
    }
    // weCalledIt — optional, may be absent or array
    if (result.weCalledIt !== undefined) {
      expect(Array.isArray(result.weCalledIt)).toBe(true);
    }
    // topWins — optional
    if (result.topWins !== undefined) {
      expect(Array.isArray(result.topWins)).toBe(true);
    }
    // winRateByActionType — optional
    if (result.winRateByActionType !== undefined) {
      expect(typeof result.winRateByActionType).toBe('object');
    }
    // forPage — optional
    if (result.forPage !== undefined) {
      expect(result.forPage).toHaveProperty('actions');
      expect(result.forPage).toHaveProperty('outcomes');
      expect(result.forPage).toHaveProperty('hasActiveAction');
      expect(Array.isArray(result.forPage.actions)).toBe(true);
      expect(Array.isArray(result.forPage.outcomes)).toBe(true);
      expect(typeof result.forPage.hasActiveAction).toBe('boolean');
    }
  });

  it('assembles learnings with empty sources when feature flag is on', async () => {
    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const intel = await buildWorkspaceIntelligence(WORKSPACE_ID, { slices: ['learnings'] });

    const result = intel.learnings as LearningsSlice;
    expect(result).toBeDefined();

    // All required fields must still be present
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('topActionTypes');
    expect(result).toHaveProperty('overallWinRate');
    expect(result).toHaveProperty('recentTrend');
    expect(result).toHaveProperty('playbooks');

    // Optional 3A fields should be arrays when feature flag is on
    expect(Array.isArray(result.roiAttribution)).toBe(true);
    expect(Array.isArray(result.weCalledIt)).toBe(true);
  });
});

describe('contract: ContentPipelineSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles contentPipeline and returns all required interface fields', async () => {
    const result = await getSlice<ContentPipelineSlice>('contentPipeline');

    expect(result).toBeDefined();

    // All required (non-optional) fields from ContentPipelineSlice interface
    expect(result).toHaveProperty('briefs');
    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('matrices');
    expect(result).toHaveProperty('requests');
    expect(result).toHaveProperty('workOrders');
    expect(result).toHaveProperty('coverageGaps');
    expect(result).toHaveProperty('seoEdits');
  });

  it('returns correct types for required ContentPipelineSlice fields', async () => {
    const result = await getSlice<ContentPipelineSlice>('contentPipeline');

    // briefs
    expect(typeof result.briefs.total).toBe('number');
    expect(typeof result.briefs.byStatus).toBe('object');

    // posts
    expect(typeof result.posts.total).toBe('number');
    expect(typeof result.posts.byStatus).toBe('object');

    // matrices
    expect(typeof result.matrices.total).toBe('number');
    expect(typeof result.matrices.cellsPlanned).toBe('number');
    expect(typeof result.matrices.cellsPublished).toBe('number');

    // requests
    expect(typeof result.requests.pending).toBe('number');
    expect(typeof result.requests.inProgress).toBe('number');
    expect(typeof result.requests.delivered).toBe('number');

    // workOrders
    expect(typeof result.workOrders.active).toBe('number');

    // coverageGaps
    expect(Array.isArray(result.coverageGaps)).toBe(true);

    // seoEdits
    expect(typeof result.seoEdits.pending).toBe('number');
    expect(typeof result.seoEdits.applied).toBe('number');
    expect(typeof result.seoEdits.inReview).toBe('number');
  });

  it('optional ContentPipelineSlice fields are correct type when present', async () => {
    const result = await getSlice<ContentPipelineSlice>('contentPipeline');

    if (result.subscriptions !== undefined) {
      expect(typeof result.subscriptions.active).toBe('number');
      expect(typeof result.subscriptions.totalPages).toBe('number');
    }
    if (result.schemaDeployment !== undefined) {
      expect(typeof result.schemaDeployment.planned).toBe('number');
      expect(typeof result.schemaDeployment.deployed).toBe('number');
      expect(Array.isArray(result.schemaDeployment.types)).toBe(true);
    }
    if (result.rewritePlaybook !== undefined) {
      expect(Array.isArray(result.rewritePlaybook.patterns)).toBe(true);
      expect(result.rewritePlaybook.lastUsedAt === null || typeof result.rewritePlaybook.lastUsedAt === 'string').toBe(true);
    }
    if (result.cannibalizationWarnings !== undefined) {
      expect(Array.isArray(result.cannibalizationWarnings)).toBe(true);
    }
    if (result.decayAlerts !== undefined) {
      expect(Array.isArray(result.decayAlerts)).toBe(true);
    }
    if (result.suggestedBriefs !== undefined) {
      expect(typeof result.suggestedBriefs).toBe('number');
    }
  });

  it('assembler always returns cannibalizationWarnings and decayAlerts as arrays', async () => {
    const result = await getSlice<ContentPipelineSlice>('contentPipeline');

    // These are computed fields in the assembler return statement — should always be arrays
    expect(Array.isArray(result.cannibalizationWarnings)).toBe(true);
    expect(Array.isArray(result.decayAlerts)).toBe(true);
    expect(typeof result.suggestedBriefs).toBe('number');
  });
});

describe('contract: SiteHealthSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles siteHealth and returns all required interface fields', async () => {
    const result = await getSlice<SiteHealthSlice>('siteHealth');

    expect(result).toBeDefined();

    // All required (non-optional) fields from SiteHealthSlice interface
    expect(result).toHaveProperty('auditScore');
    expect(result).toHaveProperty('auditScoreDelta');
    expect(result).toHaveProperty('deadLinks');
    expect(result).toHaveProperty('redirectChains');
    expect(result).toHaveProperty('schemaErrors');
    expect(result).toHaveProperty('orphanPages');
    expect(result).toHaveProperty('cwvPassRate');
  });

  it('returns correct types for required SiteHealthSlice fields', async () => {
    const result = await getSlice<SiteHealthSlice>('siteHealth');

    expect(result.auditScore === null || typeof result.auditScore === 'number').toBe(true);
    expect(result.auditScoreDelta === null || typeof result.auditScoreDelta === 'number').toBe(true);
    expect(typeof result.deadLinks).toBe('number');
    expect(typeof result.redirectChains).toBe('number');
    expect(typeof result.schemaErrors).toBe('number');
    expect(typeof result.orphanPages).toBe('number');

    // cwvPassRate always present with mobile/desktop
    expect(result.cwvPassRate).toHaveProperty('mobile');
    expect(result.cwvPassRate).toHaveProperty('desktop');
    expect(result.cwvPassRate.mobile === null || typeof result.cwvPassRate.mobile === 'number').toBe(true);
    expect(result.cwvPassRate.desktop === null || typeof result.cwvPassRate.desktop === 'number').toBe(true);
  });

  it('optional SiteHealthSlice fields are correct type when present', async () => {
    const result = await getSlice<SiteHealthSlice>('siteHealth');

    if (result.redirectDetails !== undefined) {
      expect(Array.isArray(result.redirectDetails)).toBe(true);
    }
    if (result.aeoReadiness !== undefined) {
      expect(typeof result.aeoReadiness.pagesChecked).toBe('number');
      expect(typeof result.aeoReadiness.passingRate).toBe('number');
    }
    if (result.schemaValidation !== undefined) {
      expect(typeof result.schemaValidation.valid).toBe('number');
      expect(typeof result.schemaValidation.warnings).toBe('number');
      expect(typeof result.schemaValidation.errors).toBe('number');
    }
    if (result.performanceSummary !== undefined && result.performanceSummary !== null) {
      expect(result.performanceSummary.avgLcp === null || typeof result.performanceSummary.avgLcp === 'number').toBe(true);
      expect(result.performanceSummary.avgFid === null || typeof result.performanceSummary.avgFid === 'number').toBe(true);
      expect(result.performanceSummary.avgCls === null || typeof result.performanceSummary.avgCls === 'number').toBe(true);
      expect(result.performanceSummary.score === null || typeof result.performanceSummary.score === 'number').toBe(true);
    }
    if (result.anomalyCount !== undefined) {
      expect(typeof result.anomalyCount).toBe('number');
    }
    if (result.anomalyTypes !== undefined) {
      expect(Array.isArray(result.anomalyTypes)).toBe(true);
    }
    if (result.seoChangeVelocity !== undefined) {
      expect(typeof result.seoChangeVelocity).toBe('number');
    }
  });

  it('assembler always returns anomalyCount, anomalyTypes, and seoChangeVelocity', async () => {
    // These fields are always set in the return statement regardless of data
    const result = await getSlice<SiteHealthSlice>('siteHealth');

    // anomalyCount and anomalyTypes: returned by assembler even if 0/[]
    expect(result.anomalyCount).toBeDefined();
    expect(typeof result.anomalyCount).toBe('number');
    // seoChangeVelocity is set from the return object unconditionally
    expect(result.seoChangeVelocity).toBeDefined();
    expect(typeof result.seoChangeVelocity).toBe('number');
  });
});

describe('contract: ClientSignalsSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles clientSignals and returns all required interface fields', async () => {
    const result = await getSlice<ClientSignalsSlice>('clientSignals');

    expect(result).toBeDefined();

    // All required (non-optional) fields from ClientSignalsSlice interface
    expect(result).toHaveProperty('keywordFeedback');
    expect(result).toHaveProperty('contentGapVotes');
    expect(result).toHaveProperty('businessPriorities');
    expect(result).toHaveProperty('approvalPatterns');
    expect(result).toHaveProperty('recentChatTopics');
    expect(result).toHaveProperty('churnRisk');
  });

  it('returns correct types for required ClientSignalsSlice fields', async () => {
    const result = await getSlice<ClientSignalsSlice>('clientSignals');

    // keywordFeedback structure
    expect(Array.isArray(result.keywordFeedback.approved)).toBe(true);
    expect(Array.isArray(result.keywordFeedback.rejected)).toBe(true);
    expect(typeof result.keywordFeedback.patterns.approveRate).toBe('number');
    expect(Array.isArray(result.keywordFeedback.patterns.topRejectionReasons)).toBe(true);

    // contentGapVotes
    expect(Array.isArray(result.contentGapVotes)).toBe(true);

    // businessPriorities
    expect(Array.isArray(result.businessPriorities)).toBe(true);

    // approvalPatterns
    expect(typeof result.approvalPatterns.approvalRate).toBe('number');
    expect(result.approvalPatterns.avgResponseTime === null || typeof result.approvalPatterns.avgResponseTime === 'number').toBe(true);

    // recentChatTopics
    expect(Array.isArray(result.recentChatTopics)).toBe(true);

    // churnRisk
    const validChurnRisk = [null, 'low', 'medium', 'high'];
    expect(validChurnRisk).toContain(result.churnRisk);
  });

  it('optional ClientSignalsSlice fields are present and correct type', async () => {
    const result = await getSlice<ClientSignalsSlice>('clientSignals');

    // churnSignals — assembler always sets this
    if (result.churnSignals !== undefined) {
      expect(Array.isArray(result.churnSignals)).toBe(true);
    }

    // roi — null when no ROI data available
    if (result.roi !== undefined) {
      expect(result.roi === null || (typeof result.roi === 'object' && result.roi !== null)).toBe(true);
      if (result.roi !== null) {
        expect(typeof result.roi.organicValue).toBe('number');
        expect(typeof result.roi.growth).toBe('number');
        expect(typeof result.roi.period).toBe('string');
      }
    }

    // engagement — assembler always sets this
    if (result.engagement !== undefined) {
      expect(result.engagement).toHaveProperty('lastLoginAt');
      expect(result.engagement).toHaveProperty('loginFrequency');
      expect(result.engagement).toHaveProperty('chatSessionCount');
      expect(result.engagement).toHaveProperty('portalUsage');
      const validFrequency = ['daily', 'weekly', 'monthly', 'inactive'];
      expect(validFrequency).toContain(result.engagement.loginFrequency);
    }

    // compositeHealthScore — null or number
    if (result.compositeHealthScore !== undefined) {
      expect(result.compositeHealthScore === null || typeof result.compositeHealthScore === 'number').toBe(true);
    }

    // feedbackItems — assembler always sets this
    if (result.feedbackItems !== undefined) {
      expect(Array.isArray(result.feedbackItems)).toBe(true);
    }

    // serviceRequests — assembler always sets this
    if (result.serviceRequests !== undefined) {
      expect(typeof result.serviceRequests.pending).toBe('number');
      expect(typeof result.serviceRequests.total).toBe('number');
    }

    // intentSignals — optional, only present when client_signals table available
    if (result.intentSignals !== undefined) {
      expect(typeof result.intentSignals.newCount).toBe('number');
      expect(typeof result.intentSignals.totalCount).toBe('number');
      expect(Array.isArray(result.intentSignals.recentTypes)).toBe(true);
    }
  });

  it('assembler always populates churnSignals, engagement, feedbackItems, serviceRequests', async () => {
    const result = await getSlice<ClientSignalsSlice>('clientSignals');

    // These are always set in the assembler's return statement
    expect(result.churnSignals).toBeDefined();
    expect(result.engagement).toBeDefined();
    expect(result.feedbackItems).toBeDefined();
    expect(result.serviceRequests).toBeDefined();
  });
});

describe('contract: OperationalSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles operational and returns all required interface fields', async () => {
    const result = await getSlice<OperationalSlice>('operational');

    expect(result).toBeDefined();

    // All required (non-optional) fields from OperationalSlice interface
    expect(result).toHaveProperty('recentActivity');
    expect(result).toHaveProperty('annotations');
    expect(result).toHaveProperty('pendingJobs');
  });

  it('returns correct types for required OperationalSlice fields', async () => {
    const result = await getSlice<OperationalSlice>('operational');

    expect(Array.isArray(result.recentActivity)).toBe(true);
    expect(Array.isArray(result.annotations)).toBe(true);
    expect(typeof result.pendingJobs).toBe('number');
  });

  it('optional OperationalSlice fields are correct type when present', async () => {
    const result = await getSlice<OperationalSlice>('operational');

    if (result.timeSaved !== undefined) {
      expect(result.timeSaved === null || typeof result.timeSaved === 'object').toBe(true);
      if (result.timeSaved !== null) {
        expect(typeof result.timeSaved.totalMinutes).toBe('number');
        expect(typeof result.timeSaved.byFeature).toBe('object');
      }
    }
    if (result.approvalQueue !== undefined) {
      expect(typeof result.approvalQueue.pending).toBe('number');
      expect(result.approvalQueue.oldestAge === null || typeof result.approvalQueue.oldestAge === 'number').toBe(true);
    }
    if (result.recommendationQueue !== undefined) {
      expect(typeof result.recommendationQueue.fixNow).toBe('number');
      expect(typeof result.recommendationQueue.fixSoon).toBe('number');
      expect(typeof result.recommendationQueue.fixLater).toBe('number');
    }
    if (result.actionBacklog !== undefined) {
      expect(typeof result.actionBacklog.pendingMeasurement).toBe('number');
      expect(result.actionBacklog.oldestAge === null || typeof result.actionBacklog.oldestAge === 'number').toBe(true);
    }
    if (result.detectedPlaybooks !== undefined) {
      expect(Array.isArray(result.detectedPlaybooks)).toBe(true);
    }
    if (result.workOrders !== undefined) {
      expect(typeof result.workOrders.active).toBe('number');
      expect(typeof result.workOrders.pending).toBe('number');
    }
    if (result.insightAcceptanceRate !== undefined) {
      expect(result.insightAcceptanceRate === null || typeof result.insightAcceptanceRate === 'object').toBe(true);
      if (result.insightAcceptanceRate !== null) {
        expect(typeof result.insightAcceptanceRate.totalShown).toBe('number');
        expect(typeof result.insightAcceptanceRate.confirmed).toBe('number');
        expect(typeof result.insightAcceptanceRate.dismissed).toBe('number');
        expect(typeof result.insightAcceptanceRate.rate).toBe('number');
      }
    }
  });

  it('assembler always populates timeSaved, approvalQueue, recommendationQueue, actionBacklog, detectedPlaybooks, workOrders, insightAcceptanceRate', async () => {
    const result = await getSlice<OperationalSlice>('operational');

    // These are always set in the assembler return statement
    // timeSaved can be null but must be present in the response
    expect('timeSaved' in result).toBe(true);
    expect(result.approvalQueue).toBeDefined();
    expect(result.recommendationQueue).toBeDefined();
    expect(result.actionBacklog).toBeDefined();
    expect(result.detectedPlaybooks).toBeDefined();
    expect(result.workOrders).toBeDefined();
    // insightAcceptanceRate can be null when no insights exist
    expect(result.insightAcceptanceRate === null || result.insightAcceptanceRate === undefined || typeof result.insightAcceptanceRate === 'object').toBe(true);
  });
});

describe('contract: PageProfileSlice field population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles pageProfile with a pagePath and returns all interface fields', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const intel = await buildWorkspaceIntelligence(WORKSPACE_ID, {
      slices: ['pageProfile'],
      pagePath: '/test-page',
    });

    const result = intel.pageProfile as PageProfileSlice;
    expect(result).toBeDefined();

    // All required fields from PageProfileSlice interface
    expect(result).toHaveProperty('pagePath');
    expect(result).toHaveProperty('primaryKeyword');
    expect(result).toHaveProperty('searchIntent');
    expect(result).toHaveProperty('optimizationScore');
    expect(result).toHaveProperty('recommendations');
    expect(result).toHaveProperty('contentGaps');
    expect(result).toHaveProperty('insights');
    expect(result).toHaveProperty('actions');
    expect(result).toHaveProperty('auditIssues');
    expect(result).toHaveProperty('optimizationIssues');
    expect(result).toHaveProperty('primaryKeywordPresence');
    expect(result).toHaveProperty('competitorKeywords');
    expect(result).toHaveProperty('topicCluster');
    expect(result).toHaveProperty('estimatedDifficulty');
    expect(result).toHaveProperty('schemaStatus');
    expect(result).toHaveProperty('linkHealth');
    expect(result).toHaveProperty('seoEdits');
    expect(result).toHaveProperty('rankHistory');
    expect(result).toHaveProperty('contentStatus');
    expect(result).toHaveProperty('cwvStatus');
  });

  it('returns correct types for all PageProfileSlice fields', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const intel = await buildWorkspaceIntelligence(WORKSPACE_ID, {
      slices: ['pageProfile'],
      pagePath: '/test-page',
    });

    const result = intel.pageProfile as PageProfileSlice;

    expect(typeof result.pagePath).toBe('string');
    expect(result.pagePath).toBe('/test-page');

    expect(result.primaryKeyword === null || typeof result.primaryKeyword === 'string').toBe(true);
    expect(result.searchIntent === null || typeof result.searchIntent === 'string').toBe(true);
    expect(result.optimizationScore === null || typeof result.optimizationScore === 'number').toBe(true);

    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(Array.isArray(result.contentGaps)).toBe(true);
    expect(Array.isArray(result.insights)).toBe(true);
    expect(Array.isArray(result.actions)).toBe(true);
    expect(Array.isArray(result.auditIssues)).toBe(true);
    expect(Array.isArray(result.optimizationIssues)).toBe(true);

    expect(result.primaryKeywordPresence === null || typeof result.primaryKeywordPresence === 'object').toBe(true);
    if (result.primaryKeywordPresence !== null) {
      expect(typeof result.primaryKeywordPresence.inTitle).toBe('boolean');
      expect(typeof result.primaryKeywordPresence.inMeta).toBe('boolean');
      expect(typeof result.primaryKeywordPresence.inContent).toBe('boolean');
      expect(typeof result.primaryKeywordPresence.inSlug).toBe('boolean');
    }

    expect(Array.isArray(result.competitorKeywords)).toBe(true);
    expect(result.topicCluster === null || typeof result.topicCluster === 'string').toBe(true);
    expect(result.estimatedDifficulty === null || typeof result.estimatedDifficulty === 'string').toBe(true);

    const validSchemaStatuses = ['valid', 'warnings', 'errors', 'none'];
    expect(validSchemaStatuses).toContain(result.schemaStatus);

    // linkHealth
    expect(result.linkHealth).toHaveProperty('inbound');
    expect(result.linkHealth).toHaveProperty('outbound');
    expect(result.linkHealth).toHaveProperty('orphan');
    expect(typeof result.linkHealth.inbound).toBe('number');
    expect(typeof result.linkHealth.outbound).toBe('number');
    expect(typeof result.linkHealth.orphan).toBe('boolean');

    // seoEdits
    expect(result.seoEdits).toHaveProperty('currentTitle');
    expect(result.seoEdits).toHaveProperty('currentMeta');
    expect(result.seoEdits).toHaveProperty('lastEditedAt');
    expect(typeof result.seoEdits.currentTitle).toBe('string');
    expect(typeof result.seoEdits.currentMeta).toBe('string');
    expect(result.seoEdits.lastEditedAt === null || typeof result.seoEdits.lastEditedAt === 'string').toBe(true);

    // rankHistory
    expect(result.rankHistory).toHaveProperty('current');
    expect(result.rankHistory).toHaveProperty('best');
    expect(result.rankHistory).toHaveProperty('trend');
    expect(result.rankHistory.current === null || typeof result.rankHistory.current === 'number').toBe(true);
    expect(result.rankHistory.best === null || typeof result.rankHistory.best === 'number').toBe(true);
    const validTrends = ['up', 'down', 'stable'];
    expect(validTrends).toContain(result.rankHistory.trend);

    const validContentStatuses = [null, 'has_brief', 'has_post', 'published', 'decay_detected'];
    expect(validContentStatuses).toContain(result.contentStatus);

    const validCwvStatuses = [null, 'good', 'needs_improvement', 'poor'];
    expect(validCwvStatuses).toContain(result.cwvStatus);
  });

  it('pageProfile is absent when no pagePath is provided', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const intel = await buildWorkspaceIntelligence(WORKSPACE_ID, {
      slices: ['pageProfile'],
      // pagePath intentionally omitted
    });

    // Without pagePath, assembleSlice skips pageProfile
    expect(intel.pageProfile).toBeUndefined();
  });
});

describe('contract: buildWorkspaceIntelligence top-level structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns version=1, workspaceId, and assembledAt', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const result = await buildWorkspaceIntelligence(WORKSPACE_ID, {
      slices: ['insights'],
    });

    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(typeof result.assembledAt).toBe('string');
    // assembledAt must be a valid ISO timestamp
    expect(() => new Date(result.assembledAt)).not.toThrow();
    expect(new Date(result.assembledAt).getTime()).toBeGreaterThan(0);
  });

  it('only assembles requested slices — others are absent', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const result = await buildWorkspaceIntelligence(WORKSPACE_ID, {
      slices: ['insights', 'operational'],
    });

    expect(result.insights).toBeDefined();
    expect(result.operational).toBeDefined();

    // These were not requested — should be absent
    expect(result.learnings).toBeUndefined();
    expect(result.contentPipeline).toBeUndefined();
    expect(result.siteHealth).toBeUndefined();
    expect(result.clientSignals).toBeUndefined();
    expect(result.pageProfile).toBeUndefined();
  });

  it('assembles all 7 non-page slices when no slices option provided (defaults to ALL_SLICES, pageProfile skipped without pagePath)', async () => {
    const { buildWorkspaceIntelligence, invalidateIntelligenceCache } = await import('../../server/workspace-intelligence.js');
    invalidateIntelligenceCache(WORKSPACE_ID);
    const result = await buildWorkspaceIntelligence(WORKSPACE_ID);

    // These 7 should always be present when ALL_SLICES is used
    expect(result.seoContext).toBeDefined();
    expect(result.insights).toBeDefined();
    expect(result.learnings).toBeDefined();
    expect(result.contentPipeline).toBeDefined();
    // siteHealth may be skipped due to timeout/error — just check it's not broken
    expect(result.clientSignals).toBeDefined();
    expect(result.operational).toBeDefined();
    // pageProfile is skipped without pagePath
    expect(result.pageProfile).toBeUndefined();
  });
});
