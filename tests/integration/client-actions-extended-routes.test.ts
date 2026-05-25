/**
 * Extended integration tests for client-actions API endpoints.
 *
 * Covers paths NOT tested in client-actions-routes.test.ts:
 * - GET admin list returns empty array for fresh workspace
 * - GET public list returns 200 for open (no-password) workspace
 * - PATCH unknown action → 404
 * - POST missing required fields (title/summary) → 400
 * - PATCH public /respond with unknown action → 404
 * - Workspace isolation: admin list does not leak actions across workspaces
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import type { ClientAction } from '../../shared/types/client-actions.js';

const ctx = createTestContext(13697);
const { api, postJson, patchJson } = ctx;

let wsId = '';
let otherWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Client Actions Extended WS 13697');
  wsId = ws.id;
  const otherWs = createWorkspace('Client Actions Extended Other WS');
  otherWsId = otherWs.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM client_actions WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await ctx.stopServer();
});

describe('Client actions extended — GET list on fresh workspace', () => {
  it('GET /api/client-actions/:workspaceId returns empty array for new workspace', async () => {
    const res = await api(`/api/client-actions/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /api/public/client-actions/:workspaceId returns 200 for open workspace', async () => {
    const res = await api(`/api/public/client-actions/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Client actions extended — POST validation', () => {
  it('POST without title returns 400', async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      summary: 'Some summary',
    });
    expect(res.status).toBe(400);
  });

  it('POST without summary returns 400', async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      title: 'Some title',
    });
    expect(res.status).toBe(400);
  });

  it('POST without sourceType returns 400', async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      title: 'Some title',
      summary: 'Some summary',
    });
    expect(res.status).toBe(400);
  });

  it('POST with empty body returns 400', async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {});
    expect(res.status).toBe(400);
  });

  it('POST does not insert any action on validation failure', async () => {
    const before = await api(`/api/client-actions/${wsId}`);
    const beforeList = await before.json() as ClientAction[];
    const beforeCount = beforeList.length;

    await postJson(`/api/client-actions/${wsId}`, { sourceType: 'internal_link' });

    const after = await api(`/api/client-actions/${wsId}`);
    const afterList = await after.json() as ClientAction[];
    expect(afterList).toHaveLength(beforeCount);
  });
});

describe('Client actions extended — PATCH unknown action', () => {
  it('PATCH /api/client-actions/:workspaceId/:actionId with unknown id returns 404', async () => {
    const res = await patchJson(`/api/client-actions/${wsId}/ca_nonexistent_action_id`, {
      status: 'completed',
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/public/client-actions/:workspaceId/:actionId/respond with unknown id returns 404', async () => {
    const res = await patchJson(
      `/api/public/client-actions/${wsId}/ca_nonexistent_action_id/respond`,
      { status: 'approved' },
    );
    expect(res.status).toBe(404);
  });
});

describe('Client actions extended — workspace isolation (admin list)', () => {
  let actionInWs = '';

  beforeAll(async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      title: 'Isolation test action',
      summary: 'This action must not appear in the other workspace list.',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    actionInWs = body.id;
  });

  it('GET admin list for other workspace does not include actions from wsId', async () => {
    const res = await api(`/api/client-actions/${otherWsId}`);
    expect(res.status).toBe(200);
    const list = await res.json() as ClientAction[];
    expect(list.some(a => a.id === actionInWs)).toBe(false);
  });

  it('GET admin list for wsId includes the created action', async () => {
    const res = await api(`/api/client-actions/${wsId}`);
    expect(res.status).toBe(200);
    const list = await res.json() as ClientAction[];
    expect(list.some(a => a.id === actionInWs)).toBe(true);
  });

  it('GET public list for other workspace does not include actions from wsId', async () => {
    const res = await api(`/api/public/client-actions/${otherWsId}`);
    expect(res.status).toBe(200);
    const list = await res.json() as ClientAction[];
    expect(list.some(a => a.id === actionInWs)).toBe(false);
  });
});

describe('Client actions extended — public respond on open workspace', () => {
  let actionId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      title: 'Open workspace respond test',
      summary: 'A client can respond without a password.',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    actionId = body.id;
  });

  it('PATCH /api/public/client-actions respond with invalid status returns 400', async () => {
    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${actionId}/respond`,
      { status: 'completed' },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH /api/public/client-actions respond with approved returns 200', async () => {
    const res = await patchJson(
      `/api/public/client-actions/${wsId}/${actionId}/respond`,
      { status: 'approved', clientNote: 'Looks good to me.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(body.clientNote).toBe('Looks good to me.');
  });
});

describe('Client actions extended — PATCH admin update validation', () => {
  let actionId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Admin update validation test',
      summary: 'Checking that invalid patch inputs are rejected.',
      priority: 'medium',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    actionId = body.id;
  });

  it('PATCH with extra unknown field returns 400 (strict schema)', async () => {
    const res = await patchJson(`/api/client-actions/${wsId}/${actionId}`, {
      unknownField: 'should be rejected',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH with empty title string returns 400', async () => {
    const res = await patchJson(`/api/client-actions/${wsId}/${actionId}`, {
      title: '',
    });
    expect(res.status).toBe(400);
  });
});
