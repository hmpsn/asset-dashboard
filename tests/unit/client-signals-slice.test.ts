import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    approvedRows: [] as Array<{ keyword: string }>,
    declinedRows: [] as Array<{ keyword: string; reason?: string }>,
    contentGapRows: [] as Array<{ keyword: string; cnt: number }>,
    prioritiesRow: undefined as { priorities: string } | undefined,
  };

  return {
    state,
    parseJsonSafeArray: vi.fn(),
    listChurnSignals: vi.fn(),
    readApprovalBatchesForIntelligence: vi.fn(),
    listClientUsers: vi.fn(),
    getMonthlyConversationCount: vi.fn(),
    listSessions: vi.fn(),
    getClientActivitySummary: vi.fn(),
    countActivityByType: vi.fn(),
    computeROI: vi.fn(),
    listRequests: vi.fn(),
    listClientSignals: vi.fn(),
    countNewSignals: vi.fn(),
    countAllSignals: vi.fn(),
    dbPrepare: vi.fn((sql: string) => {
      if (sql.includes('keyword_feedback') && sql.includes('status = ?') && sql.includes('reason')) {
        return { all: vi.fn(() => mocks.state.declinedRows) };
      }
      if (sql.includes('keyword_feedback') && sql.includes('status = ?')) {
        return { all: vi.fn(() => mocks.state.approvedRows) };
      }
      if (sql.includes('content_gap_votes')) {
        return { all: vi.fn(() => mocks.state.contentGapRows) };
      }
      if (sql.includes('client_business_priorities')) {
        return { get: vi.fn(() => mocks.state.prioritiesRow) };
      }
      return { all: vi.fn(() => []), get: vi.fn(() => undefined) };
    }),
  };
});

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mocks.dbPrepare,
  },
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafeArray: mocks.parseJsonSafeArray,
}));

vi.mock('../../server/churn-signals.js', () => ({
  listChurnSignals: mocks.listChurnSignals,
}));

vi.mock('../../server/approvals.js', () => ({
  readApprovalBatchesForIntelligence: mocks.readApprovalBatchesForIntelligence,
}));

vi.mock('../../server/client-users.js', () => ({
  listClientUsers: mocks.listClientUsers,
}));

vi.mock('../../server/chat-memory.js', () => ({
  getMonthlyConversationCount: mocks.getMonthlyConversationCount,
  listSessions: mocks.listSessions,
}));

vi.mock('../../server/activity-log.js', () => ({
  getClientActivitySummary: mocks.getClientActivitySummary,
  countActivityByType: mocks.countActivityByType,
}));

vi.mock('../../server/roi.js', () => ({
  computeROI: mocks.computeROI,
}));

vi.mock('../../server/requests.js', () => ({
  listRequests: mocks.listRequests,
}));

vi.mock('../../server/client-signals-store.js', () => ({
  listClientSignals: mocks.listClientSignals,
  countNewSignals: mocks.countNewSignals,
  countAllSignals: mocks.countAllSignals,
}));

const { assembleClientSignals } = await import('../../server/intelligence/client-signals-slice.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

  mocks.state.approvedRows = [];
  mocks.state.declinedRows = [];
  mocks.state.contentGapRows = [];
  mocks.state.prioritiesRow = undefined;

  mocks.parseJsonSafeArray.mockReturnValue([]);
  mocks.listChurnSignals.mockReturnValue([]);
  mocks.readApprovalBatchesForIntelligence.mockReturnValue([]);
  mocks.listClientUsers.mockReturnValue([]);
  mocks.getMonthlyConversationCount.mockReturnValue(0);
  mocks.listSessions.mockReturnValue([]);
  mocks.getClientActivitySummary.mockReturnValue(null);
  mocks.countActivityByType.mockReturnValue(0);
  mocks.computeROI.mockReturnValue(null);
  mocks.listRequests.mockReturnValue([]);
  mocks.listClientSignals.mockReturnValue([]);
  mocks.countNewSignals.mockReturnValue(0);
  mocks.countAllSignals.mockReturnValue(0);
});

describe('assembleClientSignals', () => {
  it('uses countAllSignals for totalCount and list cap only for recentTypes', async () => {
    mocks.listClientSignals.mockReturnValue([
      { type: 'first' },
      { type: 'second' },
      { type: 'third' },
      { type: 'fourth' },
      { type: 'fifth' },
      { type: 'sixth' },
    ]);
    mocks.countNewSignals.mockReturnValue(3);
    mocks.countAllSignals.mockReturnValue(124);

    const result = await assembleClientSignals('ws-signals');

    expect(result.intentSignals).toEqual({
      newCount: 3,
      totalCount: 124,
      recentTypes: ['first', 'second', 'third', 'fourth', 'fifth'],
    });
  });

  it('formats business priorities and filters blank/whitespace entries', async () => {
    mocks.state.prioritiesRow = { priorities: '["ignored-by-mock"]' };
    mocks.parseJsonSafeArray.mockReturnValue([
      '  Increase demos  ',
      { text: '  Grow branded traffic ', category: ' Revenue ' },
      { text: '   ' },
      { text: 'Improve activation', category: '  ' },
    ]);

    const result = await assembleClientSignals('ws-priorities');

    expect(result.businessPriorities).toEqual([
      'Increase demos',
      '[Revenue] Grow branded traffic',
      'Improve activation',
    ]);
  });

  it('computes compositeHealthScore with normalized available weights (churn + engagement)', async () => {
    mocks.listChurnSignals.mockReturnValue([
      {
        type: 'login_dropoff',
        severity: 'warning',
        detectedAt: '2026-05-20T00:00:00.000Z',
        title: 'Login dropoff',
        description: 'Usage declined',
      },
    ]);
    mocks.listClientUsers.mockReturnValue([
      { lastLoginAt: '2026-05-24T12:00:00.000Z' },
    ]);

    const result = await assembleClientSignals('ws-health');

    expect(result.churnRisk).toBe('low');
    expect(result.engagement?.loginFrequency).toBe('daily');
    expect(result.compositeHealthScore).toBe(77);
    expect(result.compositeHealthBreakdown?.rows).toEqual([
      expect.objectContaining({ id: 'retention', score: 60, weight: 57 }),
      expect.objectContaining({ id: 'engagement', score: 100, weight: 43 }),
    ]);
    expect(result.compositeHealthBreakdown?.rows.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
  });

  it('returns null compositeHealthScore when only one component is available', async () => {
    mocks.listChurnSignals.mockReturnValue([
      {
        type: 'critical_signal',
        severity: 'critical',
        detectedAt: '2026-05-20T00:00:00.000Z',
        title: 'Critical',
        description: 'Critical issue',
      },
    ]);

    const result = await assembleClientSignals('ws-single-component');

    expect(result.churnRisk).toBe('high');
    expect(result.compositeHealthScore).toBeNull();
    expect(result.compositeHealthBreakdown).toBeNull();
  });

  it('maps login frequency boundaries consistently', async () => {
    mocks.listClientUsers.mockReturnValue([
      { lastLoginAt: '2026-05-23T13:00:00.000Z' },
    ]);
    let result = await assembleClientSignals('ws-daily');
    expect(result.engagement?.loginFrequency).toBe('daily');

    mocks.listClientUsers.mockReturnValue([
      { lastLoginAt: '2026-05-17T13:00:00.000Z' },
    ]);
    result = await assembleClientSignals('ws-weekly');
    expect(result.engagement?.loginFrequency).toBe('weekly');

    mocks.listClientUsers.mockReturnValue([
      { lastLoginAt: '2026-04-22T13:00:00.000Z' },
    ]);
    result = await assembleClientSignals('ws-monthly');
    expect(result.engagement?.loginFrequency).toBe('monthly');

    mocks.listClientUsers.mockReturnValue([
      { lastLoginAt: '2026-04-19T13:00:00.000Z' },
    ]);
    result = await assembleClientSignals('ws-inactive');
    expect(result.engagement?.loginFrequency).toBe('inactive');
  });

  it('maps client-originated approval and content review activity into portal feature usage', async () => {
    mocks.getClientActivitySummary.mockReturnValue({
      distinctDays: 3,
      lastActive: '2026-05-25T10:00:00.000Z',
    });
    mocks.countActivityByType.mockImplementation((_workspaceId: string, type: string) => {
      if (type === 'client_action_approved') return 1;
      if (type === 'post_client_edit') return 1;
      return 0;
    });

    const result = await assembleClientSignals('ws-client-engagement');

    expect(result.engagement?.portalUsage?.featuresUsed).toEqual(['decisions', 'content_review']);
    expect(mocks.countActivityByType).not.toHaveBeenCalledWith(
      'ws-client-engagement',
      'client_action_sent',
      expect.any(Number),
    );
  });
});
