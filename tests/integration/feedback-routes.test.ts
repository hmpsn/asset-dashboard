/**
 * Integration tests for feedback API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/feedback (list all)
 * - GET /api/feedback/:workspaceId (list by workspace)
 * - PATCH /api/feedback/:workspaceId/:id (update status)
 * - POST /api/feedback/:workspaceId/:id/reply (add reply)
 * - DELETE /api/feedback/:workspaceId/:id (delete)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestContext } from './helpers.js';
import { createFeedback, deleteFeedback } from '../../server/feedback.js';
import { listActivity } from '../../server/activity-log.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13220);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
let protectedWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Feedback Test Workspace');
  testWsId = ws.id;
  const protectedWs = createWorkspace('Protected Feedback Test Workspace');
  protectedWsId = protectedWs.id;
  updateWorkspace(protectedWsId, { clientPassword: await bcrypt.hash('feedback-secret', 12) });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  deleteWorkspace(protectedWsId);
  await ctx.stopServer();
});

describe('Feedback — list', () => {
  it('GET /api/feedback returns array', async () => {
    const res = await api('/api/feedback');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/feedback/:workspaceId returns array', async () => {
    const res = await api(`/api/feedback/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Feedback — update status validation', () => {
  it('PATCH without status returns 400', async () => {
    const res = await patchJson(`/api/feedback/${testWsId}/fb_fake`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid status');
  });

  it('PATCH with invalid status returns 400', async () => {
    const res = await patchJson(`/api/feedback/${testWsId}/fb_fake`, {
      status: 'bad_status',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid status');
  });

  it('PATCH with valid status but bad id returns 404', async () => {
    const res = await patchJson(`/api/feedback/${testWsId}/fb_nonexistent`, {
      status: 'acknowledged',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

describe('Feedback — reply validation', () => {
  it('POST reply without content returns 400', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/fb_fake/reply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content required');
  });

  it('POST reply with empty content returns 400', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/fb_fake/reply`, {
      content: '   ',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content required');
  });

  it('POST reply with bad id returns 404', async () => {
    const res = await postJson(`/api/feedback/${testWsId}/fb_nonexistent/reply`, {
      content: 'Thanks for the feedback!',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

describe('Feedback — delete', () => {
  it('DELETE with bad id returns 404', async () => {
    const res = await del(`/api/feedback/${testWsId}/fb_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('DELETE broadcasts feedback update for the workspace', async () => {
    const workspaceBroadcast = vi.fn();
    setBroadcast(vi.fn(), workspaceBroadcast);
    try {
      const item = createFeedback(testWsId, {
        type: 'general',
        title: 'Delete broadcast regression',
        description: 'Deleting feedback should refresh other open dashboards.',
      });

      const deleted = deleteFeedback(testWsId, item.id);
      expect(deleted).toBe(true);

      const activity = listActivity(testWsId).find(entry => entry.title === `Deleted feedback: ${item.title}`);
      expect(activity).toEqual(expect.objectContaining({
        type: 'note',
        metadata: expect.objectContaining({ feedbackId: item.id }),
      }));

      expect(workspaceBroadcast).toHaveBeenCalledWith(
        testWsId,
        WS_EVENTS.FEEDBACK_UPDATE,
        expect.objectContaining({ id: item.id, deleted: true }),
      );
    } finally {
      setBroadcast(vi.fn(), vi.fn());
    }
  });
});

describe('Public Feedback — client portal auth and workspace checks', () => {
  it('rejects protected workspace feedback submission without a client session', async () => {
    ctx.clearCookies();
    const res = await postJson(`/api/public/feedback/${protectedWsId}`, {
      type: 'bug',
      title: 'Unauthenticated submission',
      description: 'This should not be accepted without a session.',
    });
    expect(res.status).toBe(401);
  });

  it('rejects protected workspace feedback replies without a client session', async () => {
    ctx.clearCookies();
    const res = await postJson(`/api/public/feedback/${protectedWsId}/fb_fake/reply`, {
      content: 'Unauthenticated reply',
    });
    expect(res.status).toBe(401);
  });

  it('allows protected workspace feedback after client portal login', async () => {
    ctx.clearCookies();
    const loginRes = await postJson(`/api/public/auth/${protectedWsId}`, { password: 'feedback-secret' });
    expect(loginRes.status).toBe(200);

    const submitRes = await postJson(`/api/public/feedback/${protectedWsId}`, {
      type: 'feature',
      title: 'Authenticated feedback',
      description: 'This should be stored after login.',
    });
    expect(submitRes.status).toBe(200);
    const item = await submitRes.json();
    expect(item.workspaceId).toBe(protectedWsId);

    const listRes = await api(`/api/public/feedback/${protectedWsId}`);
    expect(listRes.status).toBe(200);
    const items = await listRes.json();
    expect(items.some((row: { id: string }) => row.id === item.id)).toBe(true);
  });

  it('returns 404 for unknown public feedback workspaces instead of creating orphan rows', async () => {
    ctx.clearCookies();
    const res = await postJson('/api/public/feedback/ws_missing_feedback', {
      type: 'general',
      title: 'Orphan feedback',
      description: 'Unknown workspaces should not get feedback rows.',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });

  it('returns 404 for unknown public feedback list requests', async () => {
    ctx.clearCookies();
    const res = await api('/api/public/feedback/ws_missing_feedback');
    expect(res.status).toBe(404);
  });
});
