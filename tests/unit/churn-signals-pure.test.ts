/**
 * Unit tests for server/churn-signals.ts — pure / DB-backed logic
 * that can be exercised without a running HTTP server.
 *
 * Covers:
 *  - listChurnSignals() — all active signals
 *  - listChurnSignals(workspaceId) — workspace-scoped filter
 *  - getSignal(id) — lookup by id
 *  - dismissSignal(workspaceId, id) — mark dismissed, return true/false
 *  - workspace isolation — each workspace only sees its own signals
 *  - dismissed signals are excluded from active lists
 *  - severity and type values are preserved correctly
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  listChurnSignals,
  dismissSignal,
  getSignal,
  type ChurnSignal,
  type SignalType,
  type SignalSeverity,
} from '../../server/churn-signals.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let insertedIds: string[] = [];

/**
 * Insert a churn signal row directly into the DB so we can test the read/dismiss
 * functions without triggering a full runChurnCheck() which requires real
 * workspace data, client users, and AI scoring infrastructure.
 */
function seedSignal(
  overrides: Partial<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    type: SignalType;
    severity: SignalSeverity;
    title: string;
    description: string;
    detectedAt: string;
    dismissedAt: string | null;
  }> = {},
): string {
  const id = overrides.id ?? `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO churn_signals
      (id, workspace_id, workspace_name, type, severity, title, description, detected_at, dismissed_at)
    VALUES
      (@id, @workspace_id, @workspace_name, @type, @severity, @title, @description, @detected_at, @dismissed_at)
  `).run({
    id,
    workspace_id: overrides.workspaceId ?? 'ws_unit_default',
    workspace_name: overrides.workspaceName ?? 'Unit Test Workspace',
    type: overrides.type ?? 'no_login_14d',
    severity: overrides.severity ?? 'warning',
    title: overrides.title ?? 'Test signal',
    description: overrides.description ?? 'Unit test signal description',
    detected_at: overrides.detectedAt ?? new Date().toISOString(),
    dismissed_at: overrides.dismissedAt ?? null,
  });
  insertedIds.push(id);
  return id;
}

function cleanupSeededSignals(): void {
  if (insertedIds.length === 0) return;
  const placeholders = insertedIds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM churn_signals WHERE id IN (${placeholders})`).run(...insertedIds);
  insertedIds = [];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanupSeededSignals();
});

describe('listChurnSignals() — all workspaces', () => {
  it('returns an array (possibly empty)', () => {
    const signals = listChurnSignals();
    expect(Array.isArray(signals)).toBe(true);
  });

  it('includes newly seeded signals', () => {
    const id = seedSignal({ workspaceId: 'ws_list_all', type: 'payment_failed', severity: 'critical' });
    const signals = listChurnSignals();
    const found = signals.find(s => s.id === id);
    expect(found).toBeDefined();
    expect(found?.type).toBe('payment_failed');
    expect(found?.severity).toBe('critical');
  });

  it('excludes dismissed signals', () => {
    const id = seedSignal({
      workspaceId: 'ws_list_dismissed',
      type: 'no_login_14d',
      dismissedAt: new Date().toISOString(),
    });
    const signals = listChurnSignals();
    expect(signals.find(s => s.id === id)).toBeUndefined();
  });

  it('returns signals ordered newest first (detected_at DESC)', () => {
    const older = seedSignal({
      workspaceId: 'ws_order_test',
      detectedAt: '2026-01-01T00:00:00.000Z',
      title: 'Older signal',
    });
    const newer = seedSignal({
      workspaceId: 'ws_order_test',
      detectedAt: '2026-06-01T00:00:00.000Z',
      title: 'Newer signal',
    });

    const signals = listChurnSignals();
    const olderIdx = signals.findIndex(s => s.id === older);
    const newerIdx = signals.findIndex(s => s.id === newer);
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe('listChurnSignals(workspaceId) — scoped', () => {
  it('returns empty array for a workspace with no signals', () => {
    const signals = listChurnSignals('ws_no_signals_ever_xyz');
    expect(signals).toEqual([]);
  });

  it('returns only active signals for the requested workspace', () => {
    const wsA = 'ws_isolation_a';
    const wsB = 'ws_isolation_b';

    const idA = seedSignal({ workspaceId: wsA, type: 'trial_ending', title: 'Workspace A signal' });
    const idB = seedSignal({ workspaceId: wsB, type: 'chat_dropoff', title: 'Workspace B signal' });

    const signalsA = listChurnSignals(wsA);
    const signalsB = listChurnSignals(wsB);

    expect(signalsA.some(s => s.id === idA)).toBe(true);
    expect(signalsA.some(s => s.id === idB)).toBe(false);

    expect(signalsB.some(s => s.id === idB)).toBe(true);
    expect(signalsB.some(s => s.id === idA)).toBe(false);
  });

  it('excludes dismissed signals for a workspace', () => {
    const wsId = 'ws_dismissed_scope';
    const activeId = seedSignal({ workspaceId: wsId, type: 'health_score_drop' });
    seedSignal({
      workspaceId: wsId,
      type: 'no_requests_30d',
      dismissedAt: new Date().toISOString(),
    });

    const signals = listChurnSignals(wsId);
    const ids = signals.map(s => s.id);
    expect(ids).toContain(activeId);
    // dismissed one must not appear
    expect(signals.filter(s => s.workspaceId === wsId)).toHaveLength(1);
  });
});

describe('getSignal(id)', () => {
  it('returns undefined for an unknown signal id', () => {
    const result = getSignal('cs_does_not_exist');
    expect(result).toBeUndefined();
  });

  it('returns the correct ChurnSignal for a known id', () => {
    const id = seedSignal({
      workspaceId: 'ws_get_signal',
      workspaceName: 'Get Signal Workspace',
      type: 'high_engagement',
      severity: 'positive',
      title: 'Highly engaged',
      description: 'User is engaging well',
    });

    const signal = getSignal(id);
    expect(signal).toBeDefined();
    expect(signal?.id).toBe(id);
    expect(signal?.workspaceId).toBe('ws_get_signal');
    expect(signal?.workspaceName).toBe('Get Signal Workspace');
    expect(signal?.type).toBe('high_engagement');
    expect(signal?.severity).toBe('positive');
    expect(signal?.title).toBe('Highly engaged');
    expect(signal?.description).toBe('User is engaging well');
    expect(signal?.detectedAt).toBeDefined();
  });

  it('returns a dismissed signal (getSignal does not filter by dismissedAt)', () => {
    const dismissedAt = new Date().toISOString();
    const id = seedSignal({
      workspaceId: 'ws_get_dismissed',
      type: 'payment_failed',
      severity: 'critical',
      dismissedAt,
    });

    const signal = getSignal(id);
    expect(signal).toBeDefined();
    expect(signal?.dismissedAt).toBe(dismissedAt);
  });

  it('maps all ChurnSignal fields correctly from DB row', () => {
    const detectedAt = '2026-05-01T12:00:00.000Z';
    const id = seedSignal({
      workspaceId: 'ws_field_map',
      workspaceName: 'Field Map WS',
      type: 'no_requests_30d',
      severity: 'warning',
      title: 'No requests',
      description: 'No requests for 30 days',
      detectedAt,
      dismissedAt: null,
    });

    const signal = getSignal(id) as ChurnSignal;
    expect(signal.id).toBe(id);
    expect(signal.workspaceId).toBe('ws_field_map');
    expect(signal.workspaceName).toBe('Field Map WS');
    expect(signal.type).toBe('no_requests_30d');
    expect(signal.severity).toBe('warning');
    expect(signal.title).toBe('No requests');
    expect(signal.description).toBe('No requests for 30 days');
    expect(signal.detectedAt).toBe(detectedAt);
    expect(signal.dismissedAt).toBeUndefined(); // null maps to undefined
  });
});

describe('dismissSignal(workspaceId, signalId)', () => {
  it('returns false for a non-existent signal id', () => {
    const result = dismissSignal('ws_any', 'cs_nonexistent_signal');
    expect(result).toBe(false);
  });

  it('returns false when signalId belongs to a different workspace', () => {
    const id = seedSignal({ workspaceId: 'ws_dismiss_owner' });
    const result = dismissSignal('ws_dismiss_other', id);
    expect(result).toBe(false);
  });

  it('returns true and marks the signal as dismissed', () => {
    const wsId = 'ws_dismiss_success';
    const id = seedSignal({ workspaceId: wsId, type: 'trial_ending' });

    // Confirm active before dismissal
    expect(listChurnSignals(wsId).some(s => s.id === id)).toBe(true);

    const result = dismissSignal(wsId, id);
    expect(result).toBe(true);

    // Must not appear in active list after dismissal
    expect(listChurnSignals(wsId).some(s => s.id === id)).toBe(false);
  });

  it('sets a dismissedAt timestamp on the row', () => {
    const wsId = 'ws_dismiss_timestamp';
    const id = seedSignal({ workspaceId: wsId });

    const before = new Date();
    dismissSignal(wsId, id);
    const after = new Date();

    const row = db.prepare('SELECT dismissed_at FROM churn_signals WHERE id = ?').get(id) as
      | { dismissed_at: string }
      | undefined;
    expect(row?.dismissed_at).toBeDefined();
    const dismissedAt = new Date(row!.dismissed_at);
    expect(dismissedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(dismissedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('dismissed signal is absent from the active list even after a second dismiss call', () => {
    const wsId = 'ws_double_dismiss';
    const id = seedSignal({ workspaceId: wsId });

    const first = dismissSignal(wsId, id);
    expect(first).toBe(true);

    // Signal must not appear in the active list regardless of a redundant second call
    expect(listChurnSignals(wsId).some(s => s.id === id)).toBe(false);
    dismissSignal(wsId, id); // idempotent — no throw
    expect(listChurnSignals(wsId).some(s => s.id === id)).toBe(false);
  });
});

describe('ChurnSignal type exhaustiveness', () => {
  const allTypes: SignalType[] = [
    'no_login_14d',
    'chat_dropoff',
    'no_requests_30d',
    'health_score_drop',
    'trial_ending',
    'payment_failed',
    'traffic_up',
    'high_engagement',
  ];

  const allSeverities: SignalSeverity[] = ['critical', 'warning', 'positive'];

  it.each(allTypes)('signal type "%s" can be stored and retrieved', (type) => {
    const id = seedSignal({ workspaceId: 'ws_type_check', type });
    const signal = getSignal(id);
    expect(signal?.type).toBe(type);
  });

  it.each(allSeverities)('signal severity "%s" can be stored and retrieved', (severity) => {
    const id = seedSignal({ workspaceId: 'ws_severity_check', severity });
    const signal = getSignal(id);
    expect(signal?.severity).toBe(severity);
  });
});
