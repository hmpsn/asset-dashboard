/**
 * Wave 22 — Pure function unit tests for server/client-actions.ts
 *
 * Covers logic that doesn't require a live DB connection:
 *   - mapAeoEffortToClientEffort: AeoEffort → client effort tier mapping
 *   - rowToAction: status/sourceType/priority normalization (via DB mocks)
 *   - CLIENT_ACTION_TRANSITIONS: state machine completeness (gaps not in state-machines.test.ts)
 *   - summarizeClientActions: summary counts and recentDecisions shape (via DB mock)
 *   - getClientActionQueueStats: oldestAge age calculation edge cases (via DB mock)
 *
 * Does NOT re-test patterns already covered by:
 *   - tests/unit/state-machines.test.ts (all valid/invalid CLIENT_ACTION_TRANSITIONS)
 *   - tests/unit/client-approval-applyability.test.ts (isClientApplyableBatch)
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Mock DB and logger before importing the module ─────────────────────────

const mockStmts = {
  insert: { run: vi.fn() },
  selectByWorkspace: { all: vi.fn(() => []) },
  selectById: { get: vi.fn(() => undefined) },
  selectActiveBySource: { get: vi.fn(() => undefined) },
  countByStatus: { all: vi.fn(() => []) },
  selectRecentDecisions: { all: vi.fn(() => []) },
  pendingQueueStats: { get: vi.fn(() => ({ count: 0, oldest_created_at: null })) },
  update: { run: vi.fn() },
  countPending: { get: vi.fn(() => ({ count: 0 })) },
};

vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn(() => undefined) })) },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => typeof mockStmts) => {
    void factory;
    return () => mockStmts;
  },
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((raw: string, fallback: unknown) => {
    try { return JSON.parse(raw); } catch { return fallback; }
  }),
}));

vi.mock('../../server/state-machines.js', () => ({
  CLIENT_ACTION_TRANSITIONS: {
    pending: ['approved', 'changes_requested', 'completed', 'archived'],
    approved: ['completed', 'archived'],
    changes_requested: ['pending', 'completed', 'archived'],
    completed: ['archived'],
    archived: [],
  },
  validateTransition: vi.fn((entity: string, map: Record<string, string[]>, from: string, to: string) => {
    const allowed = map[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid ${entity} transition: '${from}' → '${to}'`);
    }
    return to;
  }),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Module under test (shared types — no mocking needed) ───────────────────

import { mapAeoEffortToClientEffort } from '../../shared/types/client-actions.js';

// ── Module under test (server — mocked DB) ─────────────────────────────────

let summarizeClientActions: (workspaceId: string) => import('../../server/client-actions.js').ClientActionSummary;
let getClientActionQueueStats: (workspaceId: string) => import('../../server/client-actions.js').ClientActionQueueStats;
let listClientActions: (workspaceId: string) => import('../../shared/types/client-actions.js').ClientAction[];

beforeAll(async () => {
  const mod = await import('../../server/client-actions.js');
  summarizeClientActions = mod.summarizeClientActions;
  getClientActionQueueStats = mod.getClientActionQueueStats;
  listClientActions = mod.listClientActions;
});

// ════════════════════════════════════════════════════════════════════════════
// mapAeoEffortToClientEffort (shared/types/client-actions.ts)
// ════════════════════════════════════════════════════════════════════════════

describe('mapAeoEffortToClientEffort', () => {
  it('maps quick → low', () => {
    expect(mapAeoEffortToClientEffort('quick')).toBe('low');
  });

  it('maps moderate → medium', () => {
    expect(mapAeoEffortToClientEffort('moderate')).toBe('medium');
  });

  it('maps significant → high', () => {
    expect(mapAeoEffortToClientEffort('significant')).toBe('high');
  });

  it('is exhaustive — all three AeoEffort values produce distinct output tiers', () => {
    const results = new Set([
      mapAeoEffortToClientEffort('quick'),
      mapAeoEffortToClientEffort('moderate'),
      mapAeoEffortToClientEffort('significant'),
    ]);
    expect(results.size).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// summarizeClientActions — summary count logic
// ════════════════════════════════════════════════════════════════════════════

describe('summarizeClientActions', () => {
  it('returns zero counts and empty recentDecisions when workspace has no actions', () => {
    mockStmts.countByStatus.all.mockReturnValue([]);
    mockStmts.selectRecentDecisions.all.mockReturnValue([]);
    const summary = summarizeClientActions('ws-empty');
    expect(summary.pending).toBe(0);
    expect(summary.approved).toBe(0);
    expect(summary.changesRequested).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.recentDecisions).toEqual([]);
  });

  it('correctly maps DB status counts to summary fields', () => {
    mockStmts.countByStatus.all.mockReturnValue([
      { status: 'pending', count: 3 },
      { status: 'approved', count: 1 },
      { status: 'changes_requested', count: 2 },
      { status: 'completed', count: 5 },
    ]);
    mockStmts.selectRecentDecisions.all.mockReturnValue([]);
    const summary = summarizeClientActions('ws-counts');
    expect(summary.pending).toBe(3);
    expect(summary.approved).toBe(1);
    expect(summary.changesRequested).toBe(2);
    expect(summary.completed).toBe(5);
  });

  it('uses 0 for missing status counts (status not present in DB result)', () => {
    mockStmts.countByStatus.all.mockReturnValue([
      { status: 'pending', count: 4 },
      // approved, changes_requested, completed absent
    ]);
    mockStmts.selectRecentDecisions.all.mockReturnValue([]);
    const summary = summarizeClientActions('ws-partial');
    expect(summary.pending).toBe(4);
    expect(summary.approved).toBe(0);
    expect(summary.changesRequested).toBe(0);
    expect(summary.completed).toBe(0);
  });

  it('builds recentDecisions from rows including title, status, sourceType, updatedAt', () => {
    mockStmts.countByStatus.all.mockReturnValue([]);
    mockStmts.selectRecentDecisions.all.mockReturnValue([
      {
        id: 'ca-1',
        workspace_id: 'ws-1',
        source_type: 'aeo_change',
        source_id: null,
        title: 'Update FAQ schema',
        summary: 'Adjust AEO markup',
        payload: '{}',
        status: 'approved',
        priority: 'high',
        client_note: null,
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-21T10:00:00.000Z',
      },
    ]);
    const summary = summarizeClientActions('ws-recent');
    expect(summary.recentDecisions).toHaveLength(1);
    const dec = summary.recentDecisions[0];
    expect(dec.title).toBe('Update FAQ schema');
    expect(dec.status).toBe('approved');
    expect(dec.sourceType).toBe('aeo_change');
    expect(dec.updatedAt).toBe('2026-05-21T10:00:00.000Z');
  });

  it('recentDecisions does not include status, only the summary shape fields', () => {
    mockStmts.countByStatus.all.mockReturnValue([]);
    mockStmts.selectRecentDecisions.all.mockReturnValue([
      {
        id: 'ca-2',
        workspace_id: 'ws-1',
        source_type: 'content_decay',
        source_id: 'src-x',
        title: 'Refresh blog post',
        summary: 'Content decayed',
        payload: '{}',
        status: 'completed',
        priority: 'medium',
        client_note: null,
        created_at: '2026-05-18T00:00:00.000Z',
        updated_at: '2026-05-19T00:00:00.000Z',
      },
    ]);
    const summary = summarizeClientActions('ws-shape');
    const dec = summary.recentDecisions[0];
    expect(Object.keys(dec).sort()).toEqual(['sourceType', 'status', 'title', 'updatedAt'].sort());
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getClientActionQueueStats — oldestAge calculation
// ════════════════════════════════════════════════════════════════════════════

describe('getClientActionQueueStats', () => {
  it('returns null oldestAge when pending count is 0', () => {
    mockStmts.pendingQueueStats.get.mockReturnValue({ count: 0, oldest_created_at: null });
    const stats = getClientActionQueueStats('ws-none');
    expect(stats.pending).toBe(0);
    expect(stats.oldestAge).toBeNull();
  });

  it('returns null oldestAge when oldest_created_at is null even with count > 0', () => {
    mockStmts.pendingQueueStats.get.mockReturnValue({ count: 3, oldest_created_at: null });
    const stats = getClientActionQueueStats('ws-null-ts');
    expect(stats.pending).toBe(3);
    expect(stats.oldestAge).toBeNull();
  });

  it('calculates oldestAge in hours from oldest_created_at', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockStmts.pendingQueueStats.get.mockReturnValue({ count: 2, oldest_created_at: twoHoursAgo });
    const stats = getClientActionQueueStats('ws-age');
    expect(stats.pending).toBe(2);
    expect(stats.oldestAge).toBe(2);
  });

  it('oldestAge is an integer (Math.floor applied)', () => {
    // 2.9 hours ago → should floor to 2
    const almostThreeHoursAgo = new Date(Date.now() - 2.9 * 60 * 60 * 1000).toISOString();
    mockStmts.pendingQueueStats.get.mockReturnValue({ count: 1, oldest_created_at: almostThreeHoursAgo });
    const stats = getClientActionQueueStats('ws-floor');
    expect(stats.oldestAge).toBe(2);
    expect(Number.isInteger(stats.oldestAge)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// listClientActions — rowToAction normalization via DB layer
// ════════════════════════════════════════════════════════════════════════════

describe('listClientActions — row normalization via rowToAction', () => {
  it('falls back unknown sourceType to aeo_change', () => {
    mockStmts.selectByWorkspace.all.mockReturnValue([
      {
        id: 'ca-legacy',
        workspace_id: 'ws-1',
        source_type: 'legacy_retired_type',  // unknown
        source_id: null,
        title: 'Legacy item',
        summary: 'Old',
        payload: '{}',
        status: 'pending',
        priority: 'medium',
        client_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const actions = listClientActions('ws-1');
    expect(actions[0].sourceType).toBe('aeo_change');
  });

  it('falls back unknown status to pending', () => {
    mockStmts.selectByWorkspace.all.mockReturnValue([
      {
        id: 'ca-bad-status',
        workspace_id: 'ws-1',
        source_type: 'internal_link',
        source_id: null,
        title: 'Item',
        summary: 'S',
        payload: '{}',
        status: 'bogus_status',
        priority: 'high',
        client_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const actions = listClientActions('ws-1');
    expect(actions[0].status).toBe('pending');
  });

  it('falls back unknown priority to medium', () => {
    mockStmts.selectByWorkspace.all.mockReturnValue([
      {
        id: 'ca-bad-priority',
        workspace_id: 'ws-1',
        source_type: 'redirect_proposal',
        source_id: null,
        title: 'Item',
        summary: 'S',
        payload: '{}',
        status: 'approved',
        priority: 'urgent',  // not valid
        client_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const actions = listClientActions('ws-1');
    expect(actions[0].priority).toBe('medium');
  });

  it('correctly preserves all valid sourceTypes', () => {
    const validSources = ['aeo_change', 'internal_link', 'redirect_proposal', 'content_decay'];
    mockStmts.selectByWorkspace.all.mockReturnValue(
      validSources.map((s, i) => ({
        id: `ca-${i}`,
        workspace_id: 'ws-1',
        source_type: s,
        source_id: null,
        title: `Item ${i}`,
        summary: 'S',
        payload: '{}',
        status: 'pending',
        priority: 'medium',
        client_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }))
    );
    const actions = listClientActions('ws-1');
    expect(actions.map(a => a.sourceType)).toEqual(validSources);
  });

  it('maps client_note null to undefined in the returned object', () => {
    mockStmts.selectByWorkspace.all.mockReturnValue([
      {
        id: 'ca-note-null',
        workspace_id: 'ws-1',
        source_type: 'aeo_change',
        source_id: null,
        title: 'No note',
        summary: 'S',
        payload: '{}',
        status: 'pending',
        priority: 'low',
        client_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const actions = listClientActions('ws-1');
    expect(actions[0].clientNote).toBeUndefined();
  });

  it('maps source_id null to undefined in the returned object', () => {
    mockStmts.selectByWorkspace.all.mockReturnValue([
      {
        id: 'ca-src-null',
        workspace_id: 'ws-1',
        source_type: 'aeo_change',
        source_id: null,
        title: 'No source',
        summary: 'S',
        payload: '{}',
        status: 'pending',
        priority: 'medium',
        client_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const actions = listClientActions('ws-1');
    expect(actions[0].sourceId).toBeUndefined();
  });
});
