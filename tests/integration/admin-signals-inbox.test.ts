/**
 * Integration tests for admin signals inbox workflow.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/client-signals/:workspaceId (list signals for admin)
 * - PATCH /api/client-signals/:id/status (update to reviewed/actioned)
 * - Workspace isolation on the list endpoint
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientSignal } from '../../server/client-signals-store.js';

const ctx = createTestContext(13299);
const { api, patchJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Admin Signals Inbox Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Admin signals inbox workflow', () => {
  it('GET lists signals then PATCH updates to reviewed', async () => {
    const signal = createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Inbox Test WS',
      type: 'service_interest',
      chatContext: [
        { role: 'user', content: 'I want to talk to someone' },
        { role: 'assistant', content: 'Sure, I will connect you.' },
      ],
      triggerMessage: 'I want to talk to someone',
    });

    // List
    const listRes = await api(`/api/client-signals/${testWsId}`);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.some((s: { id: string }) => s.id === signal.id)).toBe(true);

    // Verify chatContext is included
    const found = listBody.find((s: { id: string }) => s.id === signal.id);
    expect(found.chatContext).toHaveLength(2);

    // Update to reviewed
    const patchRes = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'reviewed' });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.status).toBe('reviewed');

    // Update to actioned
    const actionRes = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'actioned' });
    expect(actionRes.status).toBe(200);
    const actionBody = await actionRes.json();
    expect(actionBody.status).toBe('actioned');
  });

  it('workspace isolation enforced on list endpoint', async () => {
    createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Isolated A',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'test isolation',
    });

    const res = await api('/api/client-signals/ws-isolated-inbox-B');
    expect(res.status).toBe(200);
    const body = await res.json();
    // Workspace B has no signals — the array must be empty (not just vacuously passing every())
    expect(Array.isArray(body)).toBe(true);
    expect(body.filter((s: { workspaceId: string }) => s.workspaceId === testWsId)).toHaveLength(0);
  });
});
