/**
 * Unit tests for server/intelligence/client-signals-slice.ts
 *
 * Strategy:
 *  - Real in-process DB for direct-SQL queries (keyword_feedback,
 *    content_gap_votes, client_business_priorities) — tables created by
 *    migrations run in tests/db-setup.ts.
 *  - vi.mock for all dynamic-import subsystems so every test runs in < 10 ms
 *    and does not depend on external state.
 *
 * Coverage targets (quality over completeness):
 *  1. Zero-baseline shape — every required field present with safe defaults.
 *  2. keywordFeedback approveRate + topRejectionReasons (real DB rows).
 *  3. churnRisk mapping — all four severity combinations + positive signal edge case.
 *  4. compositeHealthScore formula — ≥2 component requirement, exact math.
 *  5. loginFrequency boundaries — all four buckets.
 *  6. businessPriorities formatting — string, object+category, no-category, empty-text.
 *  7. serviceRequests pending count — only new/in_review; closed excluded.
 *  8. Graceful degradation — churn failure, users failure, shape still valid.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ── Module mocks (must appear before any real imports) ─────────────────────
// The slice uses `await import(...)` to lazy-load these subsystems. Vitest
// hoists vi.mock() calls to the top of the module so they intercept the
// dynamic imports too.

vi.mock('../../server/churn-signals.js', () => ({
  listChurnSignals: vi.fn(() => []),
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: vi.fn(() => []),
}));

vi.mock('../../server/client-users.js', () => ({
  listClientUsers: vi.fn(() => []),
}));

vi.mock('../../server/chat-memory.js', () => ({
  getMonthlyConversationCount: vi.fn(() => 0),
  listSessions: vi.fn(() => []),
}));

vi.mock('../../server/activity-log.js', () => ({
  getClientActivitySummary: vi.fn(() => null),
  countActivityByType: vi.fn(() => 0),
}));

vi.mock('../../server/roi.js', () => ({
  computeROI: vi.fn(() => null),
}));

vi.mock('../../server/requests.js', () => ({
  listRequests: vi.fn(() => []),
}));

vi.mock('../../server/client-signals-store.js', () => ({
  listClientSignals: vi.fn(() => []),
  countNewSignals: vi.fn(() => 0),
  countAllSignals: vi.fn(() => 0),
}));

vi.mock('../../server/briefing-store.js', () => ({
  getLatestPublishedBriefing: vi.fn(() => null),
}));

vi.mock('../../server/client-actions.js', () => ({
  summarizeClientActions: vi.fn(() => undefined),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Real imports (after mocks) ──────────────────────────────────────────────

import db from '../../server/db/index.js';
import { assembleClientSignals } from '../../server/intelligence/client-signals-slice.js';
import type { ClientSignalsSlice } from '../../shared/types/intelligence.js';

// ── Test workspace IDs ──────────────────────────────────────────────────────

const WS = 'test-client-signals-slice';
const WS_OTHER = 'test-client-signals-other'; // cross-workspace isolation check

// ── DB cleanup helpers ──────────────────────────────────────────────────────

function clearTestRows() {
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(WS_OTHER);
  db.prepare('DELETE FROM content_gap_votes WHERE workspace_id = ?').run(WS);
  db.prepare('DELETE FROM client_business_priorities WHERE workspace_id = ?').run(WS);
}

beforeAll(() => { clearTestRows(); });
afterAll(() => { clearTestRows(); });
beforeEach(() => {
  clearTestRows();
  vi.clearAllMocks();
});

// ── Test helpers ────────────────────────────────────────────────────────────

function makeISODaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function insertKeywordFeedback(keyword: string, status: 'approved' | 'declined', reason?: string) {
  db.prepare(
    'INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(WS, keyword, status, reason ?? null, new Date().toISOString());
}

function insertBusinessPriorities(priorities: unknown[]) {
  db.prepare(
    'INSERT INTO client_business_priorities (workspace_id, priorities, updated_at) VALUES (?, ?, ?)',
  ).run(WS, JSON.stringify(priorities), new Date().toISOString());
}

// ── 1. Zero-baseline shape ──────────────────────────────────────────────────

describe('assembleClientSignals — zero-baseline shape', () => {
  it('returns a complete ClientSignalsSlice with safe defaults', async () => {
    const result = await assembleClientSignals(WS);

    // All required top-level fields must be present
    expect(result).toHaveProperty('keywordFeedback');
    expect(result).toHaveProperty('contentGapVotes');
    expect(result).toHaveProperty('businessPriorities');
    expect(result).toHaveProperty('approvalPatterns');
    expect(result).toHaveProperty('recentChatTopics');
    expect(result).toHaveProperty('churnRisk');

    // Default empty-data values
    expect(result.keywordFeedback.approved).toEqual([]);
    expect(result.keywordFeedback.rejected).toEqual([]);
    expect(result.keywordFeedback.patterns.approveRate).toBe(0);
    expect(result.keywordFeedback.patterns.topRejectionReasons).toEqual([]);
    expect(result.contentGapVotes).toEqual([]);
    expect(result.businessPriorities).toEqual([]);
    expect(result.approvalPatterns.approvalRate).toBe(0);
    expect(result.approvalPatterns.avgResponseTime).toBeNull();
    expect(result.recentChatTopics).toEqual([]);
    expect(result.churnRisk).toBeNull();
    expect(result.serviceRequests).toEqual({ pending: 0, total: 0 });
    // compositeHealthScore null when < 2 components are present
    expect(result.compositeHealthScore).toBeNull();
  });

  it('returns churnSignals as empty array by default', async () => {
    const result = await assembleClientSignals(WS);
    expect(result.churnSignals).toEqual([]);
  });

  it('returns roi as null by default', async () => {
    const result = await assembleClientSignals(WS);
    expect(result.roi).toBeNull();
  });

  it('returns engagement with inactive loginFrequency by default', async () => {
    const result = await assembleClientSignals(WS);
    expect(result.engagement).toBeDefined();
    expect(result.engagement?.loginFrequency).toBe('inactive');
    expect(result.engagement?.lastLoginAt).toBeNull();
    expect(result.engagement?.chatSessionCount).toBe(0);
  });
});

// ── 2. keywordFeedback from real DB rows ────────────────────────────────────

describe('assembleClientSignals — keywordFeedback DB reads', () => {
  it('computes approveRate = 0.5 with 3 approved and 3 declined', async () => {
    insertKeywordFeedback('keyword-a', 'approved');
    insertKeywordFeedback('keyword-b', 'approved');
    insertKeywordFeedback('keyword-c', 'approved');
    insertKeywordFeedback('keyword-d', 'declined', 'too_broad');
    insertKeywordFeedback('keyword-e', 'declined', 'too_broad');
    insertKeywordFeedback('keyword-f', 'declined', 'irrelevant');

    const result = await assembleClientSignals(WS);

    expect(result.keywordFeedback.approved).toHaveLength(3);
    expect(result.keywordFeedback.rejected).toHaveLength(3);
    expect(result.keywordFeedback.patterns.approveRate).toBeCloseTo(0.5, 10);
  });

  it('sorts topRejectionReasons by count descending', async () => {
    insertKeywordFeedback('kw-1', 'declined', 'too_broad');
    insertKeywordFeedback('kw-2', 'declined', 'too_broad');
    insertKeywordFeedback('kw-3', 'declined', 'irrelevant');

    const result = await assembleClientSignals(WS);

    // too_broad (2) must come before irrelevant (1)
    expect(result.keywordFeedback.patterns.topRejectionReasons[0]).toBe('too_broad');
    expect(result.keywordFeedback.patterns.topRejectionReasons[1]).toBe('irrelevant');
  });

  it('populates approved and rejected keyword arrays correctly', async () => {
    insertKeywordFeedback('seo-tools', 'approved');
    insertKeywordFeedback('cheap-traffic', 'declined', 'too_broad');

    const result = await assembleClientSignals(WS);

    expect(result.keywordFeedback.approved).toContain('seo-tools');
    expect(result.keywordFeedback.rejected).toContain('cheap-traffic');
  });

  it('returns approveRate = 1.0 when all feedback is approved', async () => {
    insertKeywordFeedback('best-keyword', 'approved');
    insertKeywordFeedback('good-keyword', 'approved');

    const result = await assembleClientSignals(WS);

    expect(result.keywordFeedback.patterns.approveRate).toBe(1);
    expect(result.keywordFeedback.patterns.topRejectionReasons).toEqual([]);
  });

  it('ignores rows from other workspaces', async () => {
    // Insert a row for a DIFFERENT workspace — should NOT appear in WS result
    db.prepare(
      'INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(WS_OTHER, 'other-ws-keyword', 'approved', null, new Date().toISOString());

    insertKeywordFeedback('our-keyword', 'approved');

    const result = await assembleClientSignals(WS);

    expect(result.keywordFeedback.approved).toEqual(['our-keyword']);
    expect(result.keywordFeedback.approved).not.toContain('other-ws-keyword');
  });

  it('handles declined keywords with no reason (reason = null)', async () => {
    insertKeywordFeedback('no-reason-kw', 'declined', undefined);

    const result = await assembleClientSignals(WS);

    // Declined but no reason — topRejectionReasons should be empty (null filtered out)
    expect(result.keywordFeedback.rejected).toContain('no-reason-kw');
    expect(result.keywordFeedback.patterns.topRejectionReasons).toEqual([]);
  });
});

// ── 3. churnRisk computation ────────────────────────────────────────────────

describe('assembleClientSignals — churnRisk computation', () => {
  it('returns churnRisk = "high" when any signal has severity = "critical"', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-1', workspaceId: WS, workspaceName: 'Test', type: 'no_login_14d' as any,
        severity: 'critical', title: 'No login', description: 'Client not logged in',
        detectedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.churnRisk).toBe('high');
  });

  it('returns churnRisk = "medium" when there are 2+ warning signals', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-2', workspaceId: WS, workspaceName: 'Test', type: 'chat_dropoff' as any,
        severity: 'warning', title: 'Chat dropoff', description: 'Chat usage dropped',
        detectedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'cs-3', workspaceId: WS, workspaceName: 'Test', type: 'no_requests_30d' as any,
        severity: 'warning', title: 'No requests', description: 'No requests in 30 days',
        detectedAt: '2026-01-02T00:00:00Z',
      },
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.churnRisk).toBe('medium');
  });

  it('returns churnRisk = "low" when there is exactly 1 warning signal', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-4', workspaceId: WS, workspaceName: 'Test', type: 'no_requests_30d' as any,
        severity: 'warning', title: 'No requests', description: 'No requests in 30 days',
        detectedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.churnRisk).toBe('low');
  });

  it('returns churnRisk = null when only "positive" signals are present', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-5', workspaceId: WS, workspaceName: 'Test', type: 'consistent_login' as any,
        severity: 'positive', title: 'Consistent login', description: 'Client logs in regularly',
        detectedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await assembleClientSignals(WS);
    // positive signals must NOT elevate churnRisk
    expect(result.churnRisk).toBeNull();
  });

  it('returns churnRisk = null when signal list is empty', async () => {
    // vi.clearAllMocks() in beforeEach already reset the mock to [] — this tests the default
    const result = await assembleClientSignals(WS);
    expect(result.churnRisk).toBeNull();
  });

  it('critical signal overrides multiple warnings — result is "high" not "medium"', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-6', workspaceId: WS, workspaceName: 'Test', type: 'no_login_14d' as any,
        severity: 'critical', title: 'No login', description: '',
        detectedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'cs-7', workspaceId: WS, workspaceName: 'Test', type: 'chat_dropoff' as any,
        severity: 'warning', title: 'Chat dropoff', description: '',
        detectedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.churnRisk).toBe('high');
  });

  it('maps churnSignals array — type and severity surfaced correctly', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-8', workspaceId: WS, workspaceName: 'Test', type: 'no_login_14d' as any,
        severity: 'critical', title: 'No login in 14d', description: 'Critical churn signal',
        detectedAt: '2026-03-01T00:00:00Z',
      },
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.churnSignals).toHaveLength(1);
    expect(result.churnSignals![0].type).toBe('no_login_14d');
    expect(result.churnSignals![0].severity).toBe('critical');
    expect(result.churnSignals![0].title).toBe('No login in 14d');
  });
});

// ── 4. compositeHealthScore computation ────────────────────────────────────

describe('assembleClientSignals — compositeHealthScore', () => {
  it('returns null when only 1 component is available (engagement only)', async () => {
    // engagement = weekly (score 70), no roi, churn fetch fails so no churn component
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockImplementationOnce(() => { throw new Error('churn unavailable'); });

    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(5) } as any,
    ]);

    const result = await assembleClientSignals(WS);
    // Only 1 component (engagement) — compositeHealthScore must be null
    expect(result.compositeHealthScore).toBeNull();
  });

  it('computes score from 2 components (churn + engagement) with normalized weights', async () => {
    // churnRisk = 'high' → churnScore = 0
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'cs-h', workspaceId: WS, workspaceName: 'Test', type: 'no_login_14d' as any,
        severity: 'critical', title: 'No login', description: '',
        detectedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    // loginFrequency = 'weekly' → engagementScore = 70
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(5) } as any,
    ]);

    // roi stays null — only 2 components

    const result = await assembleClientSignals(WS);

    // formula: (0*0.4 + 70*0.3) / (0.4+0.3) = 21/0.7 = 30
    expect(result.compositeHealthScore).not.toBeNull();
    expect(result.compositeHealthScore).toBe(30);
  });

  it('computes score = 100 when all three components are perfect', async () => {
    // churnRisk = null → churnScore = 100
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([]);

    // loginFrequency = 'daily' → engagementScore = 100
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any,
    ]);

    // roi.growth = 15 → roiScore = 100 (growth > 10)
    const { computeROI } = await import('../../server/roi.js');
    vi.mocked(computeROI).mockReturnValueOnce({
      organicTrafficValue: 5000, adSpendEquivalent: 3000, growthPercent: 15,
      pageBreakdown: [], totalClicks: 100, totalImpressions: 1000, avgCPC: 1.5,
      trackedPages: 10, contentROI: null, contentItems: [],
    } as any);

    const result = await assembleClientSignals(WS);

    // formula: (100*0.4 + 100*0.3 + 100*0.3) / (0.4+0.3+0.3) = 100/1.0 = 100
    expect(result.compositeHealthScore).toBe(100);
  });

  it('excludes failed churn fetch from denominator but still scores 2 remaining components', async () => {
    // churn fetch throws → churnFetchSucceeded = false → not counted in components
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockImplementationOnce(() => { throw new Error('db down'); });

    // roi present: growth = 8 → roiScore = 70 (0 < growth <= 10)
    const { computeROI } = await import('../../server/roi.js');
    vi.mocked(computeROI).mockReturnValueOnce({
      organicTrafficValue: 2000, adSpendEquivalent: 1000, growthPercent: 8,
      pageBreakdown: [], totalClicks: 50, totalImpressions: 500, avgCPC: 1.0,
      trackedPages: 5, contentROI: null, contentItems: [],
    } as any);

    // engagement: loginFrequency = 'daily' → engagementScore = 100
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any,
    ]);

    const result = await assembleClientSignals(WS);

    // components = 2 (roi + engagement), denominator = 0.3+0.3 = 0.6
    // score = (70*0.3 + 100*0.3) / 0.6 = 51/0.6 = 85
    expect(result.compositeHealthScore).not.toBeNull();
    expect(result.compositeHealthScore).toBe(85);
  });

  it('uses correct roiScore buckets: growth=0 → 40, growth=-5 → 0', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([]); // churnScore = 100

    const { computeROI } = await import('../../server/roi.js');
    vi.mocked(computeROI).mockReturnValueOnce({
      organicTrafficValue: 1000, adSpendEquivalent: 500, growthPercent: 0,
      pageBreakdown: [], totalClicks: 20, totalImpressions: 200, avgCPC: 0.5,
      trackedPages: 2, contentROI: null, contentItems: [],
    } as any);

    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any, // daily → 100
    ]);

    const result = await assembleClientSignals(WS);
    // churn=100(w=0.4), roi=40(w=0.3), eng=100(w=0.3)
    // = (100*0.4 + 40*0.3 + 100*0.3) / 1.0 = (40 + 12 + 30) / 1 = 82
    expect(result.compositeHealthScore).toBe(82);
  });

  it('churnScore = 30 when churnRisk = medium', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'w1', workspaceId: WS, workspaceName: 'Test', type: 'chat_dropoff' as any,
        severity: 'warning', title: 'W1', description: '', detectedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'w2', workspaceId: WS, workspaceName: 'Test', type: 'no_requests_30d' as any,
        severity: 'warning', title: 'W2', description: '', detectedAt: '2026-01-02T00:00:00Z',
      },
    ]); // 2 warnings → churnRisk='medium' → churnScore=30

    // only 1 other component so we need a second
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any, // daily → engagementScore=100
    ]);

    const result = await assembleClientSignals(WS);

    // churn=30(w=0.4), engagement=100(w=0.3)  → (30*0.4 + 100*0.3) / 0.7 = (12+30)/0.7 = 42/0.7 = 60
    expect(result.compositeHealthScore).toBe(60);
  });

  it('churnScore = 60 when churnRisk = low', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockReturnValueOnce([
      {
        id: 'w3', workspaceId: WS, workspaceName: 'Test', type: 'no_requests_30d' as any,
        severity: 'warning', title: 'Low', description: '', detectedAt: '2026-01-01T00:00:00Z',
      },
    ]); // 1 warning → churnRisk='low' → churnScore=60

    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any, // daily → engagementScore=100
    ]);

    const result = await assembleClientSignals(WS);

    // churn=60(w=0.4), engagement=100(w=0.3) → (60*0.4 + 100*0.3) / 0.7 = (24+30)/0.7 = 54/0.7 ≈ 77.14 → 77
    expect(result.compositeHealthScore).toBe(77);
  });
});

// ── 5. loginFrequency boundaries ───────────────────────────────────────────

describe('assembleClientSignals — loginFrequency', () => {
  it('returns "daily" when last login was 1 day ago (≤2 days)', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('daily');
  });

  it('returns "daily" at the exact 2-day boundary (≤2)', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    // Exactly 2 days ago — should still be 'daily'
    const twodays = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 60_000).toISOString();
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: twodays } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('daily');
  });

  it('returns "weekly" when last login was 5 days ago (>2 and ≤8)', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(5) } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('weekly');
  });

  it('returns "monthly" when last login was 20 days ago (>8 and ≤35)', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(20) } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('monthly');
  });

  it('returns "inactive" when last login was 40 days ago (>35)', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(40) } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('inactive');
  });

  it('returns "inactive" and lastLoginAt = null when there are no users', async () => {
    // vi.clearAllMocks resets listClientUsers to return [] — default

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('inactive');
    expect(result.engagement?.lastLoginAt).toBeNull();
  });

  it('picks the most recent login across multiple users', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    const recentLogin = makeISODaysAgo(1);
    const oldLogin = makeISODaysAgo(30);
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: oldLogin } as any,
      { id: 'u2', lastLoginAt: recentLogin } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.loginFrequency).toBe('daily');
    expect(result.engagement?.lastLoginAt).toBe(recentLogin);
  });

  it('ignores users with null lastLoginAt when finding latest login', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    const knownLogin = makeISODaysAgo(10);
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: null } as any,
      { id: 'u2', lastLoginAt: knownLogin } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.engagement?.lastLoginAt).toBe(knownLogin);
    expect(result.engagement?.loginFrequency).toBe('monthly');
  });
});

// ── 6. businessPriorities formatting ───────────────────────────────────────

describe('assembleClientSignals — businessPriorities formatting', () => {
  it('formats plain string priorities with trim', async () => {
    insertBusinessPriorities(['  grow organic traffic  ']);

    const result = await assembleClientSignals(WS);
    expect(result.businessPriorities).toEqual(['grow organic traffic']);
  });

  it('formats object with category as "[category] text"', async () => {
    insertBusinessPriorities([{ text: 'expand to EU', category: 'growth' }]);

    const result = await assembleClientSignals(WS);
    expect(result.businessPriorities).toEqual(['[growth] expand to EU']);
  });

  it('formats object without category as plain text', async () => {
    insertBusinessPriorities([{ text: 'fix Core Web Vitals' }]);

    const result = await assembleClientSignals(WS);
    expect(result.businessPriorities).toEqual(['fix Core Web Vitals']);
  });

  it('filters out objects whose text is blank after trim', async () => {
    insertBusinessPriorities([{ text: '   ', category: 'other' }]);

    const result = await assembleClientSignals(WS);
    expect(result.businessPriorities).toEqual([]);
  });

  it('handles mixed items — strings, objects with/without category, blank text', async () => {
    insertBusinessPriorities([
      'grow organic traffic',
      { text: 'expand to EU', category: 'growth' },
      { text: 'fix Core Web Vitals' },
      { text: '  ', category: 'other' },
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.businessPriorities).toEqual([
      'grow organic traffic',
      '[growth] expand to EU',
      'fix Core Web Vitals',
      // blank text entry filtered out
    ]);
  });

  it('returns empty array when no business priorities are stored', async () => {
    // No rows inserted in this test

    const result = await assembleClientSignals(WS);
    expect(result.businessPriorities).toEqual([]);
  });
});

// ── 7. serviceRequests pending count ───────────────────────────────────────

describe('assembleClientSignals — serviceRequests', () => {
  it('counts new and in_review as pending; closed as total only', async () => {
    const { listRequests } = await import('../../server/requests.js');
    vi.mocked(listRequests).mockReturnValueOnce([
      { id: 'r1', status: 'new' } as any,
      { id: 'r2', status: 'in_review' } as any,
      { id: 'r3', status: 'closed' } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.serviceRequests?.pending).toBe(2);
    expect(result.serviceRequests?.total).toBe(3);
  });

  it('counts zero pending when all requests are closed', async () => {
    const { listRequests } = await import('../../server/requests.js');
    vi.mocked(listRequests).mockReturnValueOnce([
      { id: 'r1', status: 'closed' } as any,
      { id: 'r2', status: 'closed' } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.serviceRequests?.pending).toBe(0);
    expect(result.serviceRequests?.total).toBe(2);
  });

  it('returns { pending: 0, total: 0 } when list is empty', async () => {
    // Default mock already returns []
    const result = await assembleClientSignals(WS);
    expect(result.serviceRequests).toEqual({ pending: 0, total: 0 });
  });

  it('does not count "completed" status as pending', async () => {
    const { listRequests } = await import('../../server/requests.js');
    vi.mocked(listRequests).mockReturnValueOnce([
      { id: 'r1', status: 'new' } as any,
      { id: 'r2', status: 'completed' } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.serviceRequests?.pending).toBe(1); // only 'new'
    expect(result.serviceRequests?.total).toBe(2);
  });
});

// ── 8. Graceful degradation ─────────────────────────────────────────────────

describe('assembleClientSignals — graceful degradation', () => {
  it('churn fetch failure → churnRisk null, churnSignals empty, slice still valid', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockImplementationOnce(() => {
      throw new Error('churn db unavailable');
    });

    const result: ClientSignalsSlice = await assembleClientSignals(WS);

    expect(result.churnRisk).toBeNull();
    expect(result.churnSignals).toEqual([]);
    // Other fields still populated
    expect(result.keywordFeedback).toBeDefined();
    expect(result.serviceRequests).toEqual({ pending: 0, total: 0 });
  });

  it('listClientUsers failure → engagement defaults to inactive shape', async () => {
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockImplementationOnce(() => {
      throw new Error('users table down');
    });

    const result: ClientSignalsSlice = await assembleClientSignals(WS);

    expect(result.engagement?.lastLoginAt).toBeNull();
    expect(result.engagement?.loginFrequency).toBe('inactive');
    expect(result.engagement?.chatSessionCount).toBe(0);
    expect(result.engagement?.portalUsage).toBeNull();
  });

  it('listRequests failure → serviceRequests stays { pending: 0, total: 0 }', async () => {
    const { listRequests } = await import('../../server/requests.js');
    vi.mocked(listRequests).mockImplementationOnce(() => {
      throw new Error('requests table down');
    });

    const result: ClientSignalsSlice = await assembleClientSignals(WS);

    expect(result.serviceRequests).toEqual({ pending: 0, total: 0 });
    // rest of slice still assembled
    expect(result.keywordFeedback).toBeDefined();
    expect(result.approvalPatterns).toBeDefined();
  });

  it('computeROI failure → roi stays null, slice still has valid shape', async () => {
    const { computeROI } = await import('../../server/roi.js');
    vi.mocked(computeROI).mockImplementationOnce(() => {
      throw new Error('roi computation failed');
    });

    const result: ClientSignalsSlice = await assembleClientSignals(WS);

    expect(result.roi).toBeNull();
    expect(result.keywordFeedback).toBeDefined();
    expect(result.churnRisk).toBeNull();
  });

  it('all dynamic imports throw → returns complete slice with empty defaults', async () => {
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    const { listBatches } = await import('../../server/approvals.js');
    const { listClientUsers } = await import('../../server/client-users.js');
    const { computeROI } = await import('../../server/roi.js');
    const { listRequests } = await import('../../server/requests.js');

    vi.mocked(listChurnSignals).mockImplementationOnce(() => { throw new Error('down'); });
    vi.mocked(listBatches).mockImplementationOnce(() => { throw new Error('down'); });
    vi.mocked(listClientUsers).mockImplementationOnce(() => { throw new Error('down'); });
    vi.mocked(computeROI).mockImplementationOnce(() => { throw new Error('down'); });
    vi.mocked(listRequests).mockImplementationOnce(() => { throw new Error('down'); });

    const result: ClientSignalsSlice = await assembleClientSignals(WS);

    // Shape must be complete even when every subsystem fails
    expect(result.keywordFeedback.approved).toEqual([]);
    expect(result.keywordFeedback.rejected).toEqual([]);
    expect(result.keywordFeedback.patterns.approveRate).toBe(0);
    expect(result.churnRisk).toBeNull();
    expect(result.churnSignals).toEqual([]);
    expect(result.roi).toBeNull();
    expect(result.engagement?.loginFrequency).toBe('inactive');
    expect(result.serviceRequests).toEqual({ pending: 0, total: 0 });
    expect(result.approvalPatterns.approvalRate).toBe(0);
    expect(result.compositeHealthScore).toBeNull();
  });

  it('churn failure + engagement + roi present → 2 components still produce a score', async () => {
    // churn fetch fails — churnFetchSucceeded stays false → excluded from computation
    const { listChurnSignals } = await import('../../server/churn-signals.js');
    vi.mocked(listChurnSignals).mockImplementationOnce(() => { throw new Error('churn down'); });

    // roi growth = 15 → roiScore = 100
    const { computeROI } = await import('../../server/roi.js');
    vi.mocked(computeROI).mockReturnValueOnce({
      organicTrafficValue: 3000, adSpendEquivalent: 1500, growthPercent: 15,
      pageBreakdown: [], totalClicks: 60, totalImpressions: 600, avgCPC: 1.0,
      trackedPages: 6, contentROI: null, contentItems: [],
    } as any);

    // loginFrequency = 'daily' → engagementScore = 100
    const { listClientUsers } = await import('../../server/client-users.js');
    vi.mocked(listClientUsers).mockReturnValueOnce([
      { id: 'u1', lastLoginAt: makeISODaysAgo(1) } as any,
    ]);

    const result = await assembleClientSignals(WS);

    // roi(w=0.3) + engagement(w=0.3): score = (100*0.3 + 100*0.3) / 0.6 = 100
    expect(result.compositeHealthScore).not.toBeNull();
    expect(result.compositeHealthScore).toBe(100);
  });
});

// ── 9. approvalPatterns from listBatches ────────────────────────────────────

describe('assembleClientSignals — approvalPatterns', () => {
  it('computes approvalRate as approved-items / total-items across all batches', async () => {
    const { listBatches } = await import('../../server/approvals.js');
    vi.mocked(listBatches).mockReturnValueOnce([
      {
        id: 'b1',
        createdAt: null,
        updatedAt: null,
        items: [
          { status: 'approved' },
          { status: 'approved' },
          { status: 'pending' },
        ],
      } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.approvalPatterns.approvalRate).toBeCloseTo(2 / 3, 5);
  });

  it('computes avgResponseTime for fully resolved batches', async () => {
    const { listBatches } = await import('../../server/approvals.js');
    const createdAt = '2026-01-01T00:00:00.000Z';
    const updatedAt = '2026-01-01T01:00:00.000Z'; // 1 hour later = 3600000 ms

    vi.mocked(listBatches).mockReturnValueOnce([
      {
        id: 'b2',
        createdAt,
        updatedAt,
        items: [{ status: 'approved' }, { status: 'applied' }],
      } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.approvalPatterns.avgResponseTime).toBe(3600000);
  });

  it('returns avgResponseTime = null when no batches are fully resolved', async () => {
    const { listBatches } = await import('../../server/approvals.js');
    vi.mocked(listBatches).mockReturnValueOnce([
      {
        id: 'b3',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T01:00:00.000Z',
        items: [{ status: 'approved' }, { status: 'pending' }], // NOT fully resolved
      } as any,
    ]);

    const result = await assembleClientSignals(WS);
    expect(result.approvalPatterns.avgResponseTime).toBeNull();
  });
});
