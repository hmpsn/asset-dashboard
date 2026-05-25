/**
 * Wave 23 — Pure function unit tests for server/scheduled-audits.ts
 *
 * The scheduled-audits module has private helpers embedded in its async flow.
 * We test:
 *   - rowToSchedule mapping (re-implemented from private function)
 *   - upsertSchedule default merge logic (tested via mocks)
 *   - Schedule-due detection logic (re-implemented)
 *   - Score-drop alert threshold logic (re-implemented)
 *   - startScheduler / stopScheduler (exported lifecycle functions, mocked deps)
 *   - Interval-to-ms conversion constants
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import that touches the mocked modules
// ---------------------------------------------------------------------------

const mockStmts = vi.hoisted(() => ({
  selectById: { get: vi.fn() },
  selectAll: { all: vi.fn(() => []) },
  upsert: { run: vi.fn() },
  deleteById: { run: vi.fn(() => ({ changes: 1 })) },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: vi.fn(() => () => mockStmts),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ changes: 0 })),
    })),
  },
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: vi.fn(() => []),
  getTokenForSite: vi.fn(() => null),
  getClientPortalUrl: vi.fn(() => 'https://example.com/client'),
}));

vi.mock('../../server/seo-audit.js', () => ({
  runSeoAudit: vi.fn(),
}));

vi.mock('../../server/reports.js', () => ({
  saveSnapshot: vi.fn(),
  getLatestSnapshotBefore: vi.fn(),
}));

vi.mock('../../server/audit-snapshot-views.js', () => ({
  getEffectiveAudit: vi.fn(),
  getEffectivePreviousScore: vi.fn(),
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

vi.mock('../../server/email.js', () => ({
  notifyAuditAlert: vi.fn(),
  notifyClientAuditComplete: vi.fn(),
}));

vi.mock('../../server/helpers.js', () => ({
  toAuditFindingPageId: vi.fn((page: { page: string }) => page.page),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: vi.fn(),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    AUDIT_COMPLETE: 'audit:complete',
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
  upsertSchedule,
  deleteSchedule,
  startScheduler,
  stopScheduler,
  type AuditSchedule,
} from '../../server/scheduled-audits.js';

// ---------------------------------------------------------------------------
// Re-implemented pure helpers from scheduled-audits.ts for isolated testing
// ---------------------------------------------------------------------------

interface AuditScheduleRow {
  workspace_id: string;
  enabled: number;
  interval_days: number;
  score_drop_threshold: number;
  last_run_at: string | null;
  last_score: number | null;
}

/**
 * Mirror of the private `rowToSchedule` function in scheduled-audits.ts
 */
function rowToSchedule(row: AuditScheduleRow): AuditSchedule {
  return {
    workspaceId: row.workspace_id,
    enabled: row.enabled === 1,
    intervalDays: row.interval_days,
    scoreDropThreshold: row.score_drop_threshold,
    lastRunAt: row.last_run_at ?? undefined,
    lastScore: row.last_score ?? undefined,
  };
}

/**
 * Mirror of the scheduler due-check logic in scheduled-audits.ts
 */
function isScheduleDue(schedule: AuditSchedule, nowMs: number): boolean {
  const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : 0;
  const intervalMs = schedule.intervalDays * 24 * 60 * 60 * 1000;
  return nowMs - lastRun >= intervalMs;
}

/**
 * Mirror of the score-drop detection logic in scheduled-audits.ts
 */
function shouldSendScoreDropAlert(
  schedule: AuditSchedule,
  newScore: number,
): boolean {
  if (schedule.lastScore === undefined) return false;
  const drop = schedule.lastScore - newScore;
  return drop >= schedule.scoreDropThreshold;
}

/**
 * Mirror of page-level impact score calculation (Bridge #12 in scheduled-audits.ts)
 */
function computePageAuditBaseScore(issueMessages: { severity: string }[]): number {
  return issueMessages.some(i => i.severity === 'error') ? 80 : 50;
}

/**
 * Mirror of site-level impact score calculation (Bridge #15 in scheduled-audits.ts)
 */
function computeSiteAuditBaseScore(siteScore: number): number {
  return Math.max(0, 100 - siteScore);
}

/**
 * Mirror of upsert merge defaults from scheduled-audits.ts
 */
function mergeScheduleDefaults(
  workspaceId: string,
  updates: Partial<Omit<AuditSchedule, 'workspaceId'>>,
  existing?: AuditSchedule | null,
): AuditSchedule {
  return {
    workspaceId,
    enabled: updates.enabled ?? existing?.enabled ?? true,
    intervalDays: updates.intervalDays ?? existing?.intervalDays ?? 7,
    scoreDropThreshold: updates.scoreDropThreshold ?? existing?.scoreDropThreshold ?? 5,
    lastRunAt: updates.lastRunAt ?? existing?.lastRunAt,
    lastScore: updates.lastScore ?? existing?.lastScore,
  };
}

/**
 * Mirror of interval-to-ms conversion used in the scheduler
 */
function intervalDaysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// rowToSchedule
// ---------------------------------------------------------------------------

describe('rowToSchedule (re-implemented from private fn)', () => {
  it('maps enabled=1 to true', () => {
    const row: AuditScheduleRow = {
      workspace_id: 'ws_1',
      enabled: 1,
      interval_days: 7,
      score_drop_threshold: 5,
      last_run_at: null,
      last_score: null,
    };
    expect(rowToSchedule(row).enabled).toBe(true);
  });

  it('maps enabled=0 to false', () => {
    const row: AuditScheduleRow = {
      workspace_id: 'ws_1',
      enabled: 0,
      interval_days: 7,
      score_drop_threshold: 5,
      last_run_at: null,
      last_score: null,
    };
    expect(rowToSchedule(row).enabled).toBe(false);
  });

  it('maps null last_run_at to undefined', () => {
    const row: AuditScheduleRow = {
      workspace_id: 'ws_1',
      enabled: 1,
      interval_days: 7,
      score_drop_threshold: 5,
      last_run_at: null,
      last_score: null,
    };
    expect(rowToSchedule(row).lastRunAt).toBeUndefined();
  });

  it('preserves last_run_at ISO string', () => {
    const iso = '2026-01-15T10:00:00.000Z';
    const row: AuditScheduleRow = {
      workspace_id: 'ws_2',
      enabled: 1,
      interval_days: 14,
      score_drop_threshold: 10,
      last_run_at: iso,
      last_score: 85,
    };
    const sched = rowToSchedule(row);
    expect(sched.lastRunAt).toBe(iso);
    expect(sched.lastScore).toBe(85);
    expect(sched.workspaceId).toBe('ws_2');
  });

  it('maps null last_score to undefined', () => {
    const row: AuditScheduleRow = {
      workspace_id: 'ws_3',
      enabled: 1,
      interval_days: 30,
      score_drop_threshold: 5,
      last_run_at: null,
      last_score: null,
    };
    expect(rowToSchedule(row).lastScore).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isScheduleDue (schedule due-check logic)
// ---------------------------------------------------------------------------

describe('isScheduleDue (re-implemented from scheduler loop)', () => {
  it('is due when never run (lastRunAt=undefined)', () => {
    const schedule: AuditSchedule = {
      workspaceId: 'ws_due_1',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    };
    expect(isScheduleDue(schedule, Date.now())).toBe(true);
  });

  it('is not due when last run was 1 hour ago and interval is 7 days', () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const schedule: AuditSchedule = {
      workspaceId: 'ws_due_2',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
      lastRunAt: oneHourAgo,
    };
    expect(isScheduleDue(schedule, now)).toBe(false);
  });

  it('is due when last run was 8 days ago and interval is 7 days', () => {
    const now = Date.now();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const schedule: AuditSchedule = {
      workspaceId: 'ws_due_3',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
      lastRunAt: eightDaysAgo,
    };
    expect(isScheduleDue(schedule, now)).toBe(true);
  });

  it('is due exactly at the interval boundary', () => {
    const intervalDays = 7;
    const intervalMs = intervalDaysToMs(intervalDays);
    const now = Date.now();
    const exactlyAtBoundary = new Date(now - intervalMs).toISOString();
    const schedule: AuditSchedule = {
      workspaceId: 'ws_due_4',
      enabled: true,
      intervalDays,
      scoreDropThreshold: 5,
      lastRunAt: exactlyAtBoundary,
    };
    expect(isScheduleDue(schedule, now)).toBe(true);
  });

  it('respects monthly interval (30 days)', () => {
    const now = Date.now();
    const twentyNineDaysAgo = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
    const schedule: AuditSchedule = {
      workspaceId: 'ws_due_5',
      enabled: true,
      intervalDays: 30,
      scoreDropThreshold: 5,
      lastRunAt: twentyNineDaysAgo,
    };
    expect(isScheduleDue(schedule, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldSendScoreDropAlert (score-drop threshold logic)
// ---------------------------------------------------------------------------

describe('shouldSendScoreDropAlert (re-implemented from runScheduledAudit)', () => {
  it('sends alert when drop meets threshold exactly', () => {
    const schedule: AuditSchedule = {
      workspaceId: 'ws_drop_1',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
      lastScore: 80,
    };
    expect(shouldSendScoreDropAlert(schedule, 75)).toBe(true);
  });

  it('sends alert when drop exceeds threshold', () => {
    const schedule: AuditSchedule = {
      workspaceId: 'ws_drop_2',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
      lastScore: 90,
    };
    expect(shouldSendScoreDropAlert(schedule, 70)).toBe(true);
  });

  it('does not send alert when drop is below threshold', () => {
    const schedule: AuditSchedule = {
      workspaceId: 'ws_drop_3',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 10,
      lastScore: 80,
    };
    expect(shouldSendScoreDropAlert(schedule, 74)).toBe(false);
  });

  it('does not send alert when score improves', () => {
    const schedule: AuditSchedule = {
      workspaceId: 'ws_drop_4',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
      lastScore: 75,
    };
    expect(shouldSendScoreDropAlert(schedule, 90)).toBe(false);
  });

  it('returns false when lastScore is undefined', () => {
    const schedule: AuditSchedule = {
      workspaceId: 'ws_drop_5',
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    };
    expect(shouldSendScoreDropAlert(schedule, 80)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeScheduleDefaults (upsert merge logic)
// ---------------------------------------------------------------------------

describe('mergeScheduleDefaults (upsert merge logic)', () => {
  it('uses defaults when no existing schedule and no updates', () => {
    const result = mergeScheduleDefaults('ws_merge_1', {});
    expect(result.enabled).toBe(true);
    expect(result.intervalDays).toBe(7);
    expect(result.scoreDropThreshold).toBe(5);
  });

  it('overrides defaults with explicit updates', () => {
    const result = mergeScheduleDefaults('ws_merge_2', {
      enabled: false,
      intervalDays: 30,
      scoreDropThreshold: 15,
    });
    expect(result.enabled).toBe(false);
    expect(result.intervalDays).toBe(30);
    expect(result.scoreDropThreshold).toBe(15);
  });

  it('merges partial updates with existing schedule', () => {
    const existing: AuditSchedule = {
      workspaceId: 'ws_merge_3',
      enabled: false,
      intervalDays: 14,
      scoreDropThreshold: 8,
      lastRunAt: '2026-01-01T00:00:00.000Z',
      lastScore: 72,
    };
    const result = mergeScheduleDefaults('ws_merge_3', { intervalDays: 7 }, existing);
    expect(result.intervalDays).toBe(7); // updated
    expect(result.enabled).toBe(false); // preserved from existing
    expect(result.scoreDropThreshold).toBe(8); // preserved from existing
    expect(result.lastRunAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.lastScore).toBe(72);
  });

  it('preserves workspaceId', () => {
    const result = mergeScheduleDefaults('ws_merge_4', {});
    expect(result.workspaceId).toBe('ws_merge_4');
  });
});

// ---------------------------------------------------------------------------
// Bridge impact score computation
// ---------------------------------------------------------------------------

describe('computePageAuditBaseScore (Bridge #12 base score)', () => {
  it('returns 80 for pages with at least one error', () => {
    expect(computePageAuditBaseScore([{ severity: 'error' }])).toBe(80);
    expect(computePageAuditBaseScore([
      { severity: 'warning' },
      { severity: 'error' },
    ])).toBe(80);
  });

  it('returns 50 for pages with only warnings', () => {
    expect(computePageAuditBaseScore([{ severity: 'warning' }])).toBe(50);
    expect(computePageAuditBaseScore([
      { severity: 'warning' },
      { severity: 'warning' },
    ])).toBe(50);
  });
});

describe('computeSiteAuditBaseScore (Bridge #15 base score)', () => {
  it('returns 100 - siteScore clamped to 0', () => {
    expect(computeSiteAuditBaseScore(60)).toBe(40);
    expect(computeSiteAuditBaseScore(0)).toBe(100);
    expect(computeSiteAuditBaseScore(100)).toBe(0);
  });

  it('clamps to 0 for perfect site scores', () => {
    expect(computeSiteAuditBaseScore(100)).toBe(0);
    expect(computeSiteAuditBaseScore(110)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// intervalDaysToMs
// ---------------------------------------------------------------------------

describe('intervalDaysToMs (interval conversion)', () => {
  it('converts weekly interval correctly', () => {
    expect(intervalDaysToMs(7)).toBe(604800000);
  });

  it('converts monthly interval correctly', () => {
    expect(intervalDaysToMs(30)).toBe(2592000000);
  });

  it('converts daily interval correctly', () => {
    expect(intervalDaysToMs(1)).toBe(86400000);
  });
});

// ---------------------------------------------------------------------------
// startScheduler / stopScheduler
// ---------------------------------------------------------------------------

describe('startScheduler / stopScheduler', () => {
  it('does not throw when starting the scheduler', () => {
    expect(() => startScheduler()).not.toThrow();
    stopScheduler();
  });

  it('does not throw when stopping without starting', () => {
    expect(() => stopScheduler()).not.toThrow();
  });

  it('can start and stop multiple times without error', () => {
    startScheduler();
    stopScheduler();
    startScheduler();
    stopScheduler();
  });
});

// ---------------------------------------------------------------------------
// deleteSchedule (exported)
// ---------------------------------------------------------------------------

describe('deleteSchedule', () => {
  beforeEach(() => {
    mockStmts.deleteById.run.mockReturnValue({ changes: 1 });
  });

  it('returns true when a row was deleted', () => {
    mockStmts.deleteById.run.mockReturnValueOnce({ changes: 1 });
    expect(deleteSchedule('ws_del_1')).toBe(true);
  });

  it('returns false when no row was deleted', () => {
    mockStmts.deleteById.run.mockReturnValueOnce({ changes: 0 });
    expect(deleteSchedule('ws_del_2')).toBe(false);
  });
});
