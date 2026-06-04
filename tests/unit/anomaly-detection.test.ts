/**
 * Unit tests for server/anomaly-detection.ts
 * Covers: listAnomalies, getAnomalyById, dismissAnomaly, acknowledgeAnomaly,
 * reverseAnomalyBoostIfNoneRemain, clearOldAnomalies
 *
 * Uses real SQLite DB via workspace-seed fixture for workspace isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

// --- Hoist mock function references so they are available before vi.mock hoisting ---
const {
  mockGetInsights,
  mockUpsertInsight,
  mockCloneInsightParams,
  mockGetInsight,
  mockUpsertAnomalyDigestInsight,
  mockApplyScoreAdjustment,
  mockInvalidateIntelligenceCache,
} = vi.hoisted(() => ({
  mockGetInsights: vi.fn().mockReturnValue([]),
  mockUpsertInsight: vi.fn(),
  mockCloneInsightParams: vi.fn((i: unknown) => ({ ...(i as object) })),
  mockGetInsight: vi.fn(),
  mockUpsertAnomalyDigestInsight: vi.fn(),
  mockApplyScoreAdjustment: vi.fn().mockReturnValue({ data: {}, adjustedScore: 50 }),
  mockInvalidateIntelligenceCache: vi.fn(),
}));

// --- Mock all side-effecting dependencies BEFORE importing the module under test ---
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: vi.fn() }));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: {} }));
vi.mock('../../server/email.js', () => ({ notifyAnomalyAlert: vi.fn() }));
vi.mock('../../server/ai.js', () => ({ callAI: vi.fn() }));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mockGetInsights,
  upsertInsight: mockUpsertInsight,
  cloneInsightParams: mockCloneInsightParams,
  getInsight: mockGetInsight,
  upsertAnomalyDigestInsight: mockUpsertAnomalyDigestInsight,
}));
vi.mock('../../server/insight-score-adjustments.js', () => ({
  applyScoreAdjustment: mockApplyScoreAdjustment,
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: mockInvalidateIntelligenceCache,
  buildWorkspaceIntelligence: vi.fn(),
  buildIntelPrompt: vi.fn(),
}));
vi.mock('../../server/bridge-infrastructure.js', () => ({
  debouncedAnomalyBoost: vi.fn(),
  withWorkspaceLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
}));

import {
  listAnomalies,
  getAnomalyById,
  dismissAnomaly,
  acknowledgeAnomaly,
  reverseAnomalyBoostIfNoneRemain,
  clearOldAnomalies,
} from '../../server/anomaly-detection.js';

// ─── Helper: insert anomaly row directly (createAnomaly is private) ───────────

interface InsertAnomalyOpts {
  type?: string;
  severity?: string;
  dismissedAt?: string | null;
  acknowledgedAt?: string | null;
  detectedAt?: string;
  source?: string;
  changePct?: number;
}

function insertAnomaly(wsId: string, opts: InsertAnomalyOpts = {}): string {
  const id = `anm_${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO anomalies
      (id, workspace_id, workspace_name, type, severity, title, description,
       metric, current_value, previous_value, change_pct, ai_summary,
       detected_at, dismissed_at, acknowledged_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    id,
    wsId,
    'Test WS',
    opts.type ?? 'traffic_drop',
    opts.severity ?? 'critical',
    'Test title',
    'Test description',
    'clicks',
    80,
    100,
    opts.changePct ?? -20,
    opts.detectedAt ?? now,
    opts.dismissedAt !== undefined ? opts.dismissedAt : null,
    opts.acknowledgedAt !== undefined ? opts.acknowledgedAt : null,
    opts.source ?? 'gsc',
  );
  return id;
}

function cleanAnomalies(wsId: string) {
  db.prepare('DELETE FROM anomalies WHERE workspace_id = ?').run(wsId);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let ws: SeededFullWorkspace;
let wsA: SeededFullWorkspace;
let wsB: SeededFullWorkspace;

beforeAll(() => {
  ws = seedWorkspace();
  wsA = seedWorkspace();
  wsB = seedWorkspace();
});

afterAll(() => {
  cleanAnomalies(ws.workspaceId);
  cleanAnomalies(wsA.workspaceId);
  cleanAnomalies(wsB.workspaceId);
  ws.cleanup();
  wsA.cleanup();
  wsB.cleanup();
});

beforeEach(() => {
  cleanAnomalies(ws.workspaceId);
  cleanAnomalies(wsA.workspaceId);
  cleanAnomalies(wsB.workspaceId);
  vi.clearAllMocks();
  mockGetInsights.mockReturnValue([]);
  mockApplyScoreAdjustment.mockReturnValue({ data: {}, adjustedScore: 50 });
  mockCloneInsightParams.mockImplementation((i: unknown) => ({ ...(i as object) }));
});

// ═══════════════════════════════════════════════════════════
// listAnomalies
// ═══════════════════════════════════════════════════════════

describe('listAnomalies', () => {
  it('returns empty array for a workspace with no anomalies', () => {
    const result = listAnomalies(ws.workspaceId);
    expect(result).toEqual([]);
  });

  it('returns anomalies belonging to the workspace', () => {
    insertAnomaly(ws.workspaceId);
    insertAnomaly(ws.workspaceId);

    const result = listAnomalies(ws.workspaceId);
    expect(result).toHaveLength(2);
    expect(result.length).toBeGreaterThan(0); // every-ok guard
    expect(result.every(a => a.workspaceId === ws.workspaceId)).toBe(true); // every-ok: length guarded by toHaveLength(2) above
  });

  it('excludes dismissed anomalies by default (includeDismissed = false)', () => {
    const dismissedId = insertAnomaly(ws.workspaceId, { dismissedAt: new Date().toISOString() });
    const activeId = insertAnomaly(ws.workspaceId);

    const result = listAnomalies(ws.workspaceId, false);
    const ids = result.map(a => a.id);
    expect(ids).not.toContain(dismissedId);
    expect(ids).toContain(activeId);
  });

  it('includes dismissed anomalies when includeDismissed = true', () => {
    const dismissedId = insertAnomaly(ws.workspaceId, { dismissedAt: new Date().toISOString() });
    const activeId = insertAnomaly(ws.workspaceId);

    const result = listAnomalies(ws.workspaceId, true);
    const ids = result.map(a => a.id);
    expect(ids).toContain(dismissedId);
    expect(ids).toContain(activeId);
  });

  it('filters out the __last_scan__ internal marker row', () => {
    // Insert the internal scan marker with the special sentinel ID
    db.prepare(`
      INSERT INTO anomalies
        (id, workspace_id, workspace_name, type, severity, title, description,
         metric, current_value, previous_value, change_pct, ai_summary,
         detected_at, dismissed_at, acknowledged_at, source)
      VALUES ('__last_scan__', ?, 'scan', 'traffic_drop', 'critical',
              'scan', 'scan', 'clicks', 0, 0, 0, NULL,
              ?, NULL, NULL, 'gsc')
    `).run(ws.workspaceId, new Date().toISOString());

    const result = listAnomalies(ws.workspaceId, true);
    expect(result.find(a => a.id === '__last_scan__')).toBeUndefined();

    // Cleanup marker
    db.prepare("DELETE FROM anomalies WHERE id = '__last_scan__'").run();
  });

  it('returns anomalies from all workspaces when workspaceId is undefined', () => {
    insertAnomaly(wsA.workspaceId, { type: 'traffic_drop' });
    insertAnomaly(wsB.workspaceId, { type: 'ctr_drop' });

    const result = listAnomalies(undefined, false);
    const workspaceIds = result.map(a => a.workspaceId);
    expect(workspaceIds).toContain(wsA.workspaceId);
    expect(workspaceIds).toContain(wsB.workspaceId);
  });

  it('excludes dismissed when listing all workspaces (includeDismissed = false)', () => {
    const dismissedId = insertAnomaly(wsA.workspaceId, { dismissedAt: new Date().toISOString() });
    const activeId = insertAnomaly(wsA.workspaceId);

    const result = listAnomalies(undefined, false);
    const ids = result.map(a => a.id);
    expect(ids).not.toContain(dismissedId);
    expect(ids).toContain(activeId);
  });

  it('enforces workspace isolation — workspace A anomalies not visible when listing workspace B', () => {
    insertAnomaly(wsA.workspaceId);
    insertAnomaly(wsA.workspaceId);

    const result = listAnomalies(wsB.workspaceId);
    // wsB has no anomalies — result must be empty, proving no cross-workspace leakage
    expect(result).toHaveLength(0);
    const wsAIds = result.filter(a => a.workspaceId === wsA.workspaceId);
    expect(wsAIds).toHaveLength(0);
  });

  it('maps row fields to camelCase Anomaly interface correctly', () => {
    const detectedAt = new Date(Date.now() - 1000).toISOString();
    const id = insertAnomaly(ws.workspaceId, {
      type: 'traffic_drop',
      severity: 'critical',
      source: 'gsc',
      changePct: -30,
      detectedAt,
    });

    const result = listAnomalies(ws.workspaceId);
    const anomaly = result.find(a => a.id === id);
    expect(anomaly).toBeDefined();
    expect(anomaly!.type).toBe('traffic_drop');
    expect(anomaly!.severity).toBe('critical');
    expect(anomaly!.source).toBe('gsc');
    expect(anomaly!.changePct).toBe(-30);
    expect(anomaly!.workspaceId).toBe(ws.workspaceId);
    expect(anomaly!.detectedAt).toBe(detectedAt);
    // numeric fields
    expect(anomaly!.currentValue).toBe(80);
    expect(anomaly!.previousValue).toBe(100);
  });

  it('returns anomalies sorted by detected_at descending (newest first)', () => {
    const older = insertAnomaly(ws.workspaceId, {
      detectedAt: new Date(Date.now() - 10000).toISOString(),
    });
    const newer = insertAnomaly(ws.workspaceId, {
      detectedAt: new Date(Date.now() - 1000).toISOString(),
    });

    const result = listAnomalies(ws.workspaceId, false);
    const ids = result.map(a => a.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  });
});

// ═══════════════════════════════════════════════════════════
// getAnomalyById
// ═══════════════════════════════════════════════════════════

describe('getAnomalyById', () => {
  it('returns anomaly for a known ID', () => {
    const id = insertAnomaly(ws.workspaceId);
    const result = getAnomalyById(id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
    expect(result!.workspaceId).toBe(ws.workspaceId);
  });

  it('returns null for an unknown ID', () => {
    const result = getAnomalyById('anm_does_not_exist');
    expect(result).toBeNull();
  });

  it('returns a dismissed anomaly (no filter applied by getAnomalyById)', () => {
    const id = insertAnomaly(ws.workspaceId, { dismissedAt: new Date().toISOString() });
    const result = getAnomalyById(id);
    expect(result).not.toBeNull();
    expect(result!.dismissedAt).toBeDefined();
  });

  it('returns anomaly with all expected fields populated', () => {
    const id = insertAnomaly(ws.workspaceId, {
      type: 'ctr_drop',
      severity: 'warning',
      source: 'gsc',
      changePct: -18,
    });
    const result = getAnomalyById(id);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ctr_drop');
    expect(result!.severity).toBe('warning');
    expect(result!.source).toBe('gsc');
    expect(result!.changePct).toBe(-18);
    expect(result!.metric).toBe('clicks');
    expect(result!.currentValue).toBe(80);
    expect(result!.previousValue).toBe(100);
    expect(result!.title).toBe('Test title');
    expect(result!.description).toBe('Test description');
  });
});

// ═══════════════════════════════════════════════════════════
// dismissAnomaly
// ═══════════════════════════════════════════════════════════

describe('dismissAnomaly', () => {
  it('returns true and sets dismissed_at when anomaly belongs to workspace', () => {
    const id = insertAnomaly(ws.workspaceId);
    const before = new Date().toISOString();

    const result = dismissAnomaly(ws.workspaceId, id);

    expect(result).toBe(true);
    const row = db.prepare('SELECT dismissed_at FROM anomalies WHERE id = ?').get(id) as { dismissed_at: string | null };
    expect(row.dismissed_at).not.toBeNull();
    expect(row.dismissed_at! >= before).toBe(true);
  });

  it('returns false when anomaly ID does not exist', () => {
    const result = dismissAnomaly(ws.workspaceId, 'anm_nonexistent');
    expect(result).toBe(false);
  });

  it('cross-workspace: returns false when anomaly belongs to workspace A but called with workspace B ID', () => {
    const idA = insertAnomaly(wsA.workspaceId);

    const result = dismissAnomaly(wsB.workspaceId, idA);

    expect(result).toBe(false);

    // Verify the anomaly was NOT dismissed
    const row = db.prepare('SELECT dismissed_at FROM anomalies WHERE id = ?').get(idA) as { dismissed_at: string | null };
    expect(row.dismissed_at).toBeNull();
  });

  it('dismissed anomaly no longer appears in default listAnomalies (includeDismissed = false)', () => {
    const id = insertAnomaly(ws.workspaceId);

    dismissAnomaly(ws.workspaceId, id);

    const result = listAnomalies(ws.workspaceId, false);
    expect(result.find(a => a.id === id)).toBeUndefined();
  });

  it('dismissed anomaly DOES appear in listAnomalies with includeDismissed = true', () => {
    const id = insertAnomaly(ws.workspaceId);

    dismissAnomaly(ws.workspaceId, id);

    const result = listAnomalies(ws.workspaceId, true);
    const anomaly = result.find(a => a.id === id);
    expect(anomaly).toBeDefined();
    expect(anomaly!.dismissedAt).toBeDefined();
  });

  it('dismissing a row that already has dismissed_at set still returns true (workspace_id matches)', () => {
    const id = insertAnomaly(ws.workspaceId, { dismissedAt: new Date().toISOString() });
    const result = dismissAnomaly(ws.workspaceId, id);
    expect(result).toBe(true);
  });

  it('does not dismiss anomalies from other workspaces in the same call', () => {
    const idA = insertAnomaly(wsA.workspaceId);
    const idB = insertAnomaly(wsB.workspaceId);

    dismissAnomaly(wsA.workspaceId, idA);

    const rowB = db.prepare('SELECT dismissed_at FROM anomalies WHERE id = ?').get(idB) as { dismissed_at: string | null };
    expect(rowB.dismissed_at).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// acknowledgeAnomaly
// ═══════════════════════════════════════════════════════════

describe('acknowledgeAnomaly', () => {
  it('returns true and sets acknowledged_at when anomaly belongs to workspace', () => {
    const id = insertAnomaly(ws.workspaceId);
    const before = new Date().toISOString();

    const result = acknowledgeAnomaly(ws.workspaceId, id);

    expect(result).toBe(true);
    const row = db.prepare('SELECT acknowledged_at FROM anomalies WHERE id = ?').get(id) as { acknowledged_at: string | null };
    expect(row.acknowledged_at).not.toBeNull();
    expect(row.acknowledged_at! >= before).toBe(true);
  });

  it('returns false when anomaly ID does not exist', () => {
    const result = acknowledgeAnomaly(ws.workspaceId, 'anm_no_exist');
    expect(result).toBe(false);
  });

  it('cross-workspace isolation: returns false when anomaly belongs to workspace A but called with workspace B ID', () => {
    const idA = insertAnomaly(wsA.workspaceId);

    const result = acknowledgeAnomaly(wsB.workspaceId, idA);

    expect(result).toBe(false);

    // Verify acknowledged_at was NOT set
    const row = db.prepare('SELECT acknowledged_at FROM anomalies WHERE id = ?').get(idA) as { acknowledged_at: string | null };
    expect(row.acknowledged_at).toBeNull();
  });

  it('does not affect dismissed_at', () => {
    const id = insertAnomaly(ws.workspaceId);
    acknowledgeAnomaly(ws.workspaceId, id);

    const row = db.prepare('SELECT dismissed_at, acknowledged_at FROM anomalies WHERE id = ?').get(id) as { dismissed_at: string | null; acknowledged_at: string | null };
    expect(row.dismissed_at).toBeNull();
    expect(row.acknowledged_at).not.toBeNull();
  });

  it('acknowledged anomaly still appears in listAnomalies (acknowledged != dismissed)', () => {
    const id = insertAnomaly(ws.workspaceId);
    acknowledgeAnomaly(ws.workspaceId, id);

    const result = listAnomalies(ws.workspaceId, false);
    expect(result.find(a => a.id === id)).toBeDefined();
  });

  it('cross-workspace: anomaly from wsA is not acknowledged when using wsB', () => {
    const idA = insertAnomaly(wsA.workspaceId);

    acknowledgeAnomaly(wsB.workspaceId, idA);

    const anomaly = getAnomalyById(idA);
    expect(anomaly!.acknowledgedAt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// reverseAnomalyBoostIfNoneRemain
// ═══════════════════════════════════════════════════════════

describe('reverseAnomalyBoostIfNoneRemain', () => {
  it('returns 0 when there is a recent undismissed anomaly (within last 24h)', () => {
    // 23h ago — within 24h window, should block reversal
    const recentDetectedAt = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
    insertAnomaly(ws.workspaceId, { detectedAt: recentDetectedAt });

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
    // getInsights should never be called since guard fires first
    expect(mockGetInsights).not.toHaveBeenCalled();
  });

  it('proceeds past 24h guard when only old undismissed anomaly exists (>24h ago)', () => {
    // 25h ago — outside 24h window, should NOT block reversal
    const oldDetectedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    insertAnomaly(ws.workspaceId, { detectedAt: oldDetectedAt });

    // No insights to reverse, but function should proceed past the guard
    reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(mockGetInsights).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('returns 0 when workspace has no insights to reverse', () => {
    mockGetInsights.mockReturnValue([]);

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
  });

  it('skips resolved insights — does not count them or call upsertInsight', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_resolved',
        workspaceId: ws.workspaceId,
        resolutionStatus: 'resolved',
        impactScore: 60,
        data: { _scoreAdjustments: { anomaly: 10 } },
      },
    ]);

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
    expect(mockUpsertInsight).not.toHaveBeenCalled();
  });

  it('skips insights whose _scoreAdjustments does not contain the anomaly key', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_no_anomaly_key',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 50,
        data: { _scoreAdjustments: { outcome: 5 } }, // 'anomaly' key absent
      },
    ]);

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
    expect(mockUpsertInsight).not.toHaveBeenCalled();
  });

  it('skips insights where _scoreAdjustments is missing entirely', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_no_adj',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 50,
        data: {}, // no _scoreAdjustments
      },
    ]);

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
    expect(mockUpsertInsight).not.toHaveBeenCalled();
  });

  it('reverses boost and returns count when insight has anomaly key and adjustedScore changes', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_with_boost',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 60,
        data: { _scoreAdjustments: { anomaly: 10 } },
      },
    ]);
    // Simulate removal of anomaly boost — score drops from 60 to 50
    mockApplyScoreAdjustment.mockReturnValue({ data: { _scoreAdjustments: {} }, adjustedScore: 50 });

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(1);
    expect(mockUpsertInsight).toHaveBeenCalledWith(
      expect.objectContaining({ anomalyLinked: false, impactScore: 50 })
    );
  });

  it('does not call upsertInsight when adjustedScore is unchanged after applyScoreAdjustment', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_same_score',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 60,
        data: { _scoreAdjustments: { anomaly: 10 } },
      },
    ]);
    // Same score — no actual change, should skip upsert
    mockApplyScoreAdjustment.mockReturnValue({ data: {}, adjustedScore: 60 });

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
    expect(mockUpsertInsight).not.toHaveBeenCalled();
  });

  it('24h boundary: anomaly at exactly 23h59m blocks reversal', () => {
    const justUnder24h = new Date(Date.now() - (24 * 3600 * 1000 - 60 * 1000)).toISOString();
    insertAnomaly(ws.workspaceId, { detectedAt: justUnder24h });

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(0);
    expect(mockGetInsights).not.toHaveBeenCalled();
  });

  it('24h boundary: anomaly at exactly 25h does NOT block reversal', () => {
    const over24h = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    insertAnomaly(ws.workspaceId, { detectedAt: over24h });

    reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    // Guard passed — getInsights called
    expect(mockGetInsights).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('dismissed recent anomaly does NOT block reversal (listAnomalies excludes dismissed rows)', () => {
    // Dismissed anomaly within 24h — dismissed_at IS SET, so listAnomalies(_, false) excludes it
    const recentDetectedAt = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    insertAnomaly(ws.workspaceId, {
      detectedAt: recentDetectedAt,
      dismissedAt: new Date().toISOString(),
    });

    // Guard should pass because dismissed anomaly is excluded from listAnomalies(_, false)
    reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(mockGetInsights).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('invalidates intelligence cache when at least one insight is reversed', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_cache_check',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 60,
        data: { _scoreAdjustments: { anomaly: 10 } },
      },
    ]);
    mockApplyScoreAdjustment.mockReturnValue({ data: {}, adjustedScore: 50 });

    reverseAnomalyBoostIfNoneRemain(ws.workspaceId);

    expect(mockInvalidateIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('does NOT invalidate intelligence cache when no insights are reversed', () => {
    mockGetInsights.mockReturnValue([]);

    reverseAnomalyBoostIfNoneRemain(ws.workspaceId);

    expect(mockInvalidateIntelligenceCache).not.toHaveBeenCalled();
  });

  it('counts multiple reversed insights correctly', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_1',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 60,
        data: { _scoreAdjustments: { anomaly: 10 } },
      },
      {
        id: 'ins_2',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 70,
        data: { _scoreAdjustments: { anomaly: 15 } },
      },
    ]);
    // Both return different adjusted scores
    mockApplyScoreAdjustment
      .mockReturnValueOnce({ data: {}, adjustedScore: 50 })
      .mockReturnValueOnce({ data: {}, adjustedScore: 55 });

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(2);
    expect(mockUpsertInsight).toHaveBeenCalledTimes(2);
  });

  it('mixes resolved and active insights — only reverses active ones with anomaly key', () => {
    mockGetInsights.mockReturnValue([
      {
        id: 'ins_resolved',
        workspaceId: ws.workspaceId,
        resolutionStatus: 'resolved',
        impactScore: 60,
        data: { _scoreAdjustments: { anomaly: 10 } },
      },
      {
        id: 'ins_active',
        workspaceId: ws.workspaceId,
        resolutionStatus: null,
        impactScore: 55,
        data: { _scoreAdjustments: { anomaly: 5 } },
      },
    ]);
    mockApplyScoreAdjustment.mockReturnValue({ data: {}, adjustedScore: 50 });

    const result = reverseAnomalyBoostIfNoneRemain(ws.workspaceId);
    expect(result).toBe(1); // only the active one
    expect(mockUpsertInsight).toHaveBeenCalledTimes(1);
    expect(mockUpsertInsight).toHaveBeenCalledWith(
      expect.objectContaining({ anomalyLinked: false })
    );
  });
});

// ═══════════════════════════════════════════════════════════
// clearOldAnomalies
// ═══════════════════════════════════════════════════════════

describe('clearOldAnomalies', () => {
  it('deletes anomaly older than default 60 days', () => {
    const old = new Date(Date.now() - 61 * 24 * 3600 * 1000).toISOString();
    const id = insertAnomaly(ws.workspaceId, { detectedAt: old });

    const count = clearOldAnomalies();

    expect(count).toBeGreaterThanOrEqual(1);
    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(id)).toBeUndefined();
  });

  it('keeps anomaly younger than 60 days', () => {
    const recent = new Date(Date.now() - 59 * 24 * 3600 * 1000).toISOString();
    const id = insertAnomaly(ws.workspaceId, { detectedAt: recent });

    clearOldAnomalies();

    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(id)).toBeDefined();
  });

  it('deletes anomaly older than custom threshold (7 days)', () => {
    const old8days = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const id = insertAnomaly(ws.workspaceId, { detectedAt: old8days });

    const count = clearOldAnomalies(7);

    expect(count).toBeGreaterThanOrEqual(1);
    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(id)).toBeUndefined();
  });

  it('keeps anomaly newer than custom threshold (7 days)', () => {
    const new6days = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString();
    const id = insertAnomaly(ws.workspaceId, { detectedAt: new6days });

    clearOldAnomalies(7);

    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(id)).toBeDefined();
  });

  it('returns the count of deleted rows', () => {
    const old = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    insertAnomaly(ws.workspaceId, { detectedAt: old });
    insertAnomaly(ws.workspaceId, { detectedAt: old });
    insertAnomaly(wsA.workspaceId, { detectedAt: old });

    const count = clearOldAnomalies(60);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('returns 0 when no anomalies are old enough to delete', () => {
    insertAnomaly(ws.workspaceId, { detectedAt: new Date().toISOString() });

    const count = clearOldAnomalies(60);
    expect(count).toBe(0);
  });

  it('deletes across all workspaces (global retention sweep)', () => {
    const old = new Date(Date.now() - 61 * 24 * 3600 * 1000).toISOString();
    const idA = insertAnomaly(wsA.workspaceId, { detectedAt: old });
    const idB = insertAnomaly(wsB.workspaceId, { detectedAt: old });

    clearOldAnomalies(60);

    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(idA)).toBeUndefined();
    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(idB)).toBeUndefined();
  });

  it('exactly at cutoff boundary: anomaly 1s older than threshold is deleted', () => {
    // 60 days + 1 second = strictly older than 60 days
    const exactlyOld = new Date(Date.now() - (60 * 24 * 3600 * 1000 + 1000)).toISOString();
    const id = insertAnomaly(ws.workspaceId, { detectedAt: exactlyOld });

    clearOldAnomalies(60);

    expect(db.prepare('SELECT id FROM anomalies WHERE id = ?').get(id)).toBeUndefined();
  });
});
