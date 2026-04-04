import { describe, it, expect } from 'vitest';
import {
  createClientSignal,
  listClientSignals,
  getSignalById,
  updateSignalStatus,
  countNewSignals,
} from '../../server/client-signals-store.js';

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
