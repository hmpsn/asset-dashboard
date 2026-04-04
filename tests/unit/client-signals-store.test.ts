import { describe, it, expect } from 'vitest';
import {
  createClientSignal,
  listClientSignals,
  getSignalById,
  updateSignalStatus,
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
});
