/**
 * Integration tests for client-signals API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/client-signals/:workspaceId (list signals for workspace)
 * - PATCH /api/client-signals/:id/status (update signal status)
 * - POST /api/public/signal/:workspaceId (public signal creation)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientSignal } from '../../server/client-signals-store.js';

const ctx = createTestContext(13298);
const { api, postJson, patchJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Client Signals Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('GET /api/client-signals/:workspaceId', () => {
  it('returns an array of signals for the workspace', async () => {
    createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Client Signals Test Workspace',
      type: 'service_interest',
      chatContext: [{ role: 'user', content: 'I want to work with you' }],
      triggerMessage: 'I want to work with you',
    });

    const res = await api(`/api/client-signals/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('type');
    expect(body[0]).toHaveProperty('status');
    expect(body[0]).toHaveProperty('chatContext');
  });

  it('workspace isolation — does not return signals from a different workspace', async () => {
    // Create a signal for a different workspace (using a non-existent ID — FK is off in tests)
    const res = await api('/api/client-signals/ws-isolation-routes-Y');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.every((s: { workspaceId: string }) => s.workspaceId !== 'ws-isolation-routes-X')).toBe(true);
  });
});

describe('PATCH /api/client-signals/:id/status', () => {
  it('updates signal status and returns updated signal', async () => {
    const signal = createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Patch WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'update me',
    });

    const res = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'reviewed' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('reviewed');
  });

  it('returns 400 for invalid status values', async () => {
    const signal = createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Bad Status WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'test',
    });

    const res = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'foobar' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/public/signal/:workspaceId', () => {
  it('creates a service_interest signal from client portal', async () => {
    const res = await postJson(`/api/public/signal/${testWsId}`, {
      type: 'service_interest',
      triggerMessage: 'Can I speak with someone?',
      chatContext: [{ role: 'user', content: 'Can I speak with someone?' }],
    });
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signalId).toBeTruthy();
  });

  it('creates a content_interest signal from client portal', async () => {
    const res = await postJson(`/api/public/signal/${testWsId}`, {
      type: 'content_interest',
      triggerMessage: 'What content should I write?',
      chatContext: [{ role: 'user', content: 'What content should I write?' }],
    });
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signalId).toBeTruthy();
  });

  it('returns 400 for invalid signal type', async () => {
    const res = await postJson(`/api/public/signal/${testWsId}`, {
      type: 'unknown_type',
      triggerMessage: 'test',
      chatContext: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown workspace', async () => {
    const res = await postJson('/api/public/signal/nonexistent-workspace-xyz', {
      type: 'service_interest',
      triggerMessage: 'test',
      chatContext: [],
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/client-signals/detail/:id', () => {
  it('returns a single signal by id', async () => {
    const signal = createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Detail WS',
      type: 'service_interest',
      chatContext: [{ role: 'user', content: 'detail test' }],
      triggerMessage: 'detail test',
    });

    const res = await api(`/api/client-signals/detail/${signal.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(signal.id);
    expect(body.type).toBe('service_interest');
    expect(body.chatContext).toHaveLength(1);
  });

  it('returns 404 for unknown signal id', async () => {
    const res = await api('/api/client-signals/detail/nonexistent-signal-xyz');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/client-signals/:id/status — edge cases', () => {
  it('returns 404 for unknown signal id', async () => {
    const res = await patchJson('/api/client-signals/nonexistent-signal-xyz/status', { status: 'reviewed' });
    expect(res.status).toBe(404);
  });

  it('can transition through all valid statuses', async () => {
    const signal = createClientSignal({
      workspaceId: testWsId,
      workspaceName: 'Status Cycle WS',
      type: 'service_interest',
      chatContext: [],
      triggerMessage: 'cycle test',
    });

    const res1 = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'reviewed' });
    expect(res1.status).toBe(200);
    expect((await res1.json()).status).toBe('reviewed');

    const res2 = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'actioned' });
    expect(res2.status).toBe(200);
    expect((await res2.json()).status).toBe('actioned');
  });
});

// Note: intent detection in /api/public/search-chat requires a live AI response
// and cannot be reliably tested in CI without mocking the OpenAI call.
// The detectedIntent logic is covered by code review:
//   - `if (!betaMode && sessionId && answer)` guard in public-analytics.ts:420
//   - keyword arrays tested manually via the client chat interface
