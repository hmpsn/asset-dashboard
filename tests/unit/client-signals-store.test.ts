import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createClientSignal,
  listClientSignals,
  getSignalById,
  updateSignalStatus,
  countNewSignals,
  countAllSignals,
  hasRecentSignal,
} from '../../server/client-signals-store.js';
import db from '../../server/db/index.js';

describe('client-signals-store', () => {
  it('createClientSignal inserts a row and returns a ClientSignal', () => {
    const signal = createClientSignal({
      workspaceId: 'ws-test-signals-1',
      workspaceName: 'Test Workspace',
      type: 'service_interest',
      chatContext: [
        { role: 'user', content: 'I want to get in touch' },
        { role: 'assistant', content: 'Great, I can help with that.' },
      ],
      triggerMessage: 'I want to get in touch',
    });
    expect(signal.id).toBeTruthy();
    expect(signal.workspaceId).toBe('ws-test-signals-1');
    expect(signal.type).toBe('service_interest');
    expect(signal.status).toBe('new');
    expect(signal.chatContext).toHaveLength(2);
    expect(signal.createdAt).toBeTruthy();
  });

  it('listClientSignals returns only signals for the given workspace', () => {
    createClientSignal({
      workspaceId: 'ws-isolation-A',
      workspaceName: 'Workspace A',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'What content should I create?',
    });
    createClientSignal({
      workspaceId: 'ws-isolation-B',
      workspaceName: 'Workspace B',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'Can I talk to someone?',
    });
    const results = listClientSignals('ws-isolation-A');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(s => s.workspaceId === 'ws-isolation-A')).toBe(true);
  });

  it('updateSignalStatus persists the new status', () => {
    const signal = createClientSignal({
      workspaceId: 'ws-status-test',
      workspaceName: 'Status Workspace',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'Help me',
    });
    updateSignalStatus(signal.id, 'reviewed');
    const updated = getSignalById(signal.id);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('reviewed');
  });

  it('listClientSignals returns newest first', () => {
    const wsId = 'ws-order-test';
    createClientSignal({ workspaceId: wsId, workspaceName: 'Order WS', type: 'content_interest', chatContext: [], triggerMessage: 'first' });
    createClientSignal({ workspaceId: wsId, workspaceName: 'Order WS', type: 'service_interest', chatContext: [], triggerMessage: 'second' });
    const results = listClientSignals(wsId);
    expect(results.length).toBeGreaterThan(1);
    expect(new Date(results[0].createdAt) >= new Date(results[1].createdAt)).toBe(true);
  });

  it('getSignalById returns the correct signal', () => {
    const signal = createClientSignal({
      workspaceId: 'ws-getbyid-test',
      workspaceName: 'GetById WS',
      type: 'content_interest',
      chatContext: [{ role: 'user', content: 'hello' }],
      triggerMessage: 'hello',
    });
    const found = getSignalById(signal.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(signal.id);
    expect(found!.workspaceId).toBe('ws-getbyid-test');
    expect(found!.chatContext).toHaveLength(1);
  });

  it('getSignalById returns null for unknown id', () => {
    const result = getSignalById('nonexistent-id-xyz');
    expect(result).toBeNull();
  });

  it('listClientSignals with no workspaceId returns signals from all workspaces', () => {
    createClientSignal({ workspaceId: 'ws-all-A', workspaceName: 'All A', type: 'content_interest', chatContext: [], triggerMessage: 'a' });
    createClientSignal({ workspaceId: 'ws-all-B', workspaceName: 'All B', type: 'service_interest', chatContext: [], triggerMessage: 'b' });
    const all = listClientSignals();
    const wsIds = new Set(all.map(s => s.workspaceId));
    expect(wsIds.has('ws-all-A')).toBe(true);
    expect(wsIds.has('ws-all-B')).toBe(true);
  });

  it('countNewSignals returns count of new signals for workspace', () => {
    const wsId = 'ws-count-test';
    createClientSignal({ workspaceId: wsId, workspaceName: 'Count WS', type: 'service_interest', chatContext: [], triggerMessage: 'count me' });
    createClientSignal({ workspaceId: wsId, workspaceName: 'Count WS', type: 'content_interest', chatContext: [], triggerMessage: 'count me too' });
    const count = countNewSignals(wsId);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('countNewSignals decrements when status changes from new', () => {
    const wsId = 'ws-count-decrement';
    const signal = createClientSignal({ workspaceId: wsId, workspaceName: 'Decrement WS', type: 'service_interest', chatContext: [], triggerMessage: 'test' });
    const before = countNewSignals(wsId);
    expect(before).toBeGreaterThan(0);
    updateSignalStatus(signal.id, 'reviewed');
    const after = countNewSignals(wsId);
    expect(after).toBe(before - 1);
  });

  it('updateSignalStatus returns false for unknown id', () => {
    const result = updateSignalStatus('nonexistent-id-xyz', 'reviewed');
    expect(result).toBe(false);
  });
});

describe('hasRecentSignal', () => {
  it('returns false when no signals exist for workspace', () => {
    const result = hasRecentSignal('ws-hrsig-empty', 'service_interest', 60_000);
    expect(result).toBe(false);
  });

  it('returns true when a signal was created within the time window', () => {
    const wsId = 'ws-hrsig-within';
    createClientSignal({
      workspaceId: wsId,
      workspaceName: 'HasRecent WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'recent signal',
    });
    // 60 seconds is more than enough to cover the just-inserted row
    expect(hasRecentSignal(wsId, 'service_interest', 60_000)).toBe(true);
  });

  it('returns false when signal was created outside the time window', () => {
    const wsId = 'ws-hrsig-outside';
    createClientSignal({
      workspaceId: wsId,
      workspaceName: 'HasRecent Outside WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'signal that will be outside window',
    });
    // withinMs: 0 means the cutoff is Date.now(), so nothing created before this instant qualifies
    expect(hasRecentSignal(wsId, 'service_interest', 0)).toBe(false);
  });

  it('is type-specific — content_interest signal does not suppress service_interest', () => {
    const wsId = 'ws-hrsig-type-specific';
    createClientSignal({
      workspaceId: wsId,
      workspaceName: 'Type Specific WS',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'I like your content',
    });
    // content_interest was created, but service_interest should still return false
    expect(hasRecentSignal(wsId, 'service_interest', 60_000)).toBe(false);
    // while content_interest should return true
    expect(hasRecentSignal(wsId, 'content_interest', 60_000)).toBe(true);
  });

  it('is workspace-scoped — signal in workspace A does not suppress workspace B', () => {
    const wsA = 'ws-hrsig-scope-A';
    const wsB = 'ws-hrsig-scope-B';
    createClientSignal({
      workspaceId: wsA,
      workspaceName: 'Scope A',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'signal in A',
    });
    expect(hasRecentSignal(wsA, 'service_interest', 60_000)).toBe(true);
    expect(hasRecentSignal(wsB, 'service_interest', 60_000)).toBe(false);
  });
});

describe('countAllSignals', () => {
  it('returns 0 for workspace with no signals', () => {
    expect(countAllSignals('ws-countall-empty')).toBe(0);
  });

  it('counts signals across all statuses', () => {
    const wsId = 'ws-countall-statuses';
    const s1 = createClientSignal({
      workspaceId: wsId,
      workspaceName: 'CountAll WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'first',
    });
    const s2 = createClientSignal({
      workspaceId: wsId,
      workspaceName: 'CountAll WS',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'second',
    });
    updateSignalStatus(s1.id, 'reviewed');
    updateSignalStatus(s2.id, 'actioned');
    // Both signals should still be counted even though neither is 'new'
    expect(countAllSignals(wsId)).toBeGreaterThanOrEqual(2);
  });

  it('is workspace-isolated — does not count signals from other workspaces', () => {
    const wsTarget = 'ws-countall-isolated-target';
    const wsOther = 'ws-countall-isolated-other';
    createClientSignal({
      workspaceId: wsTarget,
      workspaceName: 'Isolated Target',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'only in target',
    });
    createClientSignal({
      workspaceId: wsOther,
      workspaceName: 'Isolated Other',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'only in other',
    });
    const targetCount = countAllSignals(wsTarget);
    const otherCount = countAllSignals(wsOther);
    // Each workspace should only see its own signals
    expect(targetCount).toBeGreaterThanOrEqual(1);
    expect(otherCount).toBeGreaterThanOrEqual(1);
    // The counts must not bleed across workspaces
    expect(countAllSignals('ws-countall-empty-check')).toBe(0);
  });
});

describe('rowToSignal resilience', () => {
  // The DB enforces CHECK constraints on `type` and `status`, so invalid enum values
  // are rejected at the storage layer — the Zod .catch() fallbacks in rowToSignal are
  // defense-in-depth for data corrupted outside normal write paths (manual DB edits,
  // schema rollbacks, imported data). These tests verify:
  //   (a) the CHECK constraint is the primary guard (correct behavior)
  //   (b) the chatContext JSON fallback works (no DB constraint exists on TEXT columns)

  it('DB CHECK constraint rejects invalid type — primary guard is at storage layer', () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    expect(() => {
      db.prepare(`
        INSERT INTO client_signals
          (id, workspace_id, workspace_name, type, status, chat_context, trigger_message, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'ws-constraint-type', 'Constraint WS', 'totally_invalid_type', 'new', '[]', 'trigger', now, now);
    }).toThrow(/CHECK constraint failed/);
  });

  it('DB CHECK constraint rejects invalid status — primary guard is at storage layer', () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    expect(() => {
      db.prepare(`
        INSERT INTO client_signals
          (id, workspace_id, workspace_name, type, status, chat_context, trigger_message, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'ws-constraint-status', 'Constraint WS', 'service_interest', 'garbage_status', '[]', 'trigger', now, now);
    }).toThrow(/CHECK constraint failed/);
  });

  it('invalid chatContext JSON falls back to empty array', () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO client_signals
        (id, workspace_id, workspace_name, type, status, chat_context, trigger_message, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'ws-zod-ctx', 'Zod WS', 'content_interest', 'new', 'not valid json at all', 'trigger', now, now);
    const signal = getSignalById(id);
    expect(signal).not.toBeNull();
    expect(signal!.chatContext).toEqual([]);
  });
});
