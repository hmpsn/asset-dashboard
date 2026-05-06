import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { id?: string; replies?: unknown[] } }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { id?: string; replies?: unknown[] }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { createFeedback, getFeedbackItem, listFeedback } from '../../server/feedback.js';
import { listActivity } from '../../server/activity-log.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let otherWsId = '';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function feedbackBroadcasts() {
  return broadcastState.calls.filter(
    call => call.event === WS_EVENTS.FEEDBACK_NEW || call.event === WS_EVENTS.FEEDBACK_UPDATE,
  );
}

function clearFeedbackRows(): void {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  db.prepare('DELETE FROM feedback WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
}

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Public Feedback Broadcasts').id;
  otherWsId = createWorkspace('Public Feedback Broadcasts Other Workspace').id;
});

beforeEach(() => {
  broadcastState.calls = [];
  clearFeedbackRows();
});

afterAll(async () => {
  clearFeedbackRows();
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('public feedback workflow broadcasts', () => {
  it('broadcasts new feedback and records internal activity for public submissions', async () => {
    const res = await postJson(`/api/public/feedback/${wsId}`, {
      type: 'feature',
      title: 'Add export filters',
      description: 'It would help to filter exports by client priority.',
      context: { currentTab: 'reports', url: '/client/ws/reports' },
      submittedBy: 'Client User',
    });
    expect(res.status).toBe(200);
    const created = await res.json() as { id: string; title: string; status: string };

    expect(created.status).toBe('new');
    expect(listFeedback(wsId).map(item => item.id)).toContain(created.id);
    expect(listActivity(wsId)).toContainEqual(expect.objectContaining({
      type: 'note',
      title: 'Feedback: Add export filters',
      metadata: expect.objectContaining({ feedbackId: created.id, feedbackType: 'feature' }),
    }));
    expect(feedbackBroadcasts()).toHaveLength(1);
    expect(feedbackBroadcasts()[0]).toEqual({
      workspaceId: wsId,
      event: WS_EVENTS.FEEDBACK_NEW,
      payload: expect.objectContaining({ id: created.id, title: 'Add export filters' }),
    });
  });

  it('broadcasts public replies exactly once for the owning workspace', async () => {
    const item = createFeedback(wsId, {
      type: 'general',
      title: 'Reply broadcast',
      description: 'Client replies should refresh admin feedback views.',
    });
    broadcastState.calls = [];

    const res = await postJson(`/api/public/feedback/${wsId}/${item.id}/reply`, {
      content: 'Adding a little more detail from the client.',
    });
    expect(res.status).toBe(200);
    const updated = await res.json() as { id: string; replies: Array<{ author: string; content: string }> };

    expect(updated.replies).toEqual([
      expect.objectContaining({
        author: 'client',
        content: 'Adding a little more detail from the client.',
      }),
    ]);
    expect(feedbackBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.FEEDBACK_UPDATE,
        payload: expect.objectContaining({
          id: item.id,
          replies: [
            expect.objectContaining({
              author: 'client',
              content: 'Adding a little more detail from the client.',
            }),
          ],
        }),
      },
    ]);
  });

  it('rejects malformed public replies without mutating or broadcasting', async () => {
    const item = createFeedback(wsId, {
      type: 'bug',
      title: 'Malformed reply guard',
      description: 'Bad public replies should stop before storage.',
    });
    broadcastState.calls = [];

    const res = await postJson(`/api/public/feedback/${wsId}/${item.id}/reply`, {
      content: { text: 'This should not persist.' },
    });
    expect(res.status).toBe(400);

    expect(getFeedbackItem(wsId, item.id)?.replies).toHaveLength(0);
    expect(feedbackBroadcasts()).toHaveLength(0);
  });

  it('does not broadcast or mutate replies through the wrong workspace', async () => {
    const item = createFeedback(otherWsId, {
      type: 'general',
      title: 'Cross workspace feedback reply',
      description: 'A feedback id should not be usable through another workspace.',
    });
    broadcastState.calls = [];

    const res = await postJson(`/api/public/feedback/${wsId}/${item.id}/reply`, {
      content: 'Wrong workspace reply.',
    });
    expect(res.status).toBe(404);

    expect(getFeedbackItem(otherWsId, item.id)?.replies).toHaveLength(0);
    expect(feedbackBroadcasts()).toHaveLength(0);
  });
});
