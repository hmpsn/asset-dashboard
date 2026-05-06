import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import type { ClientAction } from '../../shared/types/client-actions.js';

const ctx = createTestContext(13332); // port-ok: 13201-13331 already allocated in integration suite
const { api, postJson, patchJson, clearCookies } = ctx;

let wsId = '';
let privateWsId = '';
let otherWsId = '';

beforeAll(async () => {
  await ctx.startServer();

  const ws = createWorkspace('Client Actions Routes');
  wsId = ws.id;

  const privateWs = createWorkspace('Client Actions Private');
  privateWsId = privateWs.id;
  updateWorkspace(privateWsId, { clientPassword: 'client-action-test' });

  const otherWs = createWorkspace('Client Actions Other');
  otherWsId = otherWs.id;
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?, ?)').run(wsId, privateWsId, otherWsId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id IN (?, ?, ?)').run(wsId, privateWsId, otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(privateWsId);
  deleteWorkspace(otherWsId);
  await ctx.stopServer();
});

describe('client action routes', () => {
  async function listActions(workspaceId: string) {
    const res = await api(`/api/client-actions/${workspaceId}`);
    expect(res.status).toBe(200);
    return await res.json() as ClientAction[];
  }

  function countSentActivitiesForAction(workspaceId: string, actionId: string): number {
    return countActivitiesForAction(workspaceId, actionId, 'client_action_sent');
  }

  function countActivitiesForAction(workspaceId: string, actionId: string, type: string): number {
    const row = db.prepare(`
      SELECT COALESCE(COUNT(*), 0) AS count
      FROM activity_log
      WHERE workspace_id = ?
        AND type = ?
        AND metadata LIKE ?
    `).get(workspaceId, type, `%"actionId":"${actionId}"%`) as { count: number };
    return row.count;
  }

  it('creates and lists a client action from the admin API', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId: 'internal-links:test',
      title: 'Review internal links',
      summary: 'Approve these internal link recommendations.',
      priority: 'high',
      payload: { suggestions: [{ fromPage: '/a', toPage: '/b', anchorText: 'B' }] },
    });

    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.id).toMatch(/^ca_/);
    expect(created.status).toBe('pending');

    const listRes = await api(`/api/client-actions/${wsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.some((a: { id: string }) => a.id === created.id)).toBe(true);
  });

  it('rejects invalid create input without inserting a client action', async () => {
    const before = await listActions(wsId);

    const invalidSourceRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'not_a_real_source',
      title: 'Invalid action',
      summary: 'This should not persist.',
    });
    expect(invalidSourceRes.status).toBe(400);

    const invalidPriorityRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      title: 'Invalid priority',
      summary: 'This should not persist either.',
      priority: 'urgent',
    });
    expect(invalidPriorityRes.status).toBe(400);

    const unsupportedStatusRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      title: 'Unsupported status',
      summary: 'Create must not accept workflow state from callers.',
      status: 'completed',
    });
    expect(unsupportedStatusRes.status).toBe(400);

    const after = await listActions(wsId);
    expect(after).toHaveLength(before.length);
  });

  it('deduplicates active actions by source type and source id', async () => {
    const sourceId = `internal-links:dedupe:${Date.now()}`;
    const firstRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId,
      title: 'Review internal links',
      summary: 'Approve these internal link recommendations.',
    });
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json();
    expect(countSentActivitiesForAction(wsId, first.id)).toBe(1);

    const secondRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId,
      title: 'Review internal links again',
      summary: 'This duplicate should return the existing action.',
    });
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json();
    expect(second.id).toBe(first.id);
    expect(second.title).toBe(first.title);
    expect(countSentActivitiesForAction(wsId, first.id)).toBe(1);

    const listRes = await api(`/api/client-actions/${wsId}`);
    const list = await listRes.json();
    expect(list.filter((a: { sourceId?: string }) => a.sourceId === sourceId)).toHaveLength(1);
  });

  it('keeps action IDs scoped to their workspace for admin reads and updates', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'keyword_strategy',
      title: 'Workspace-scoped action',
      summary: 'This action belongs to the primary workspace only.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const otherList = await listActions(privateWsId);
    expect(otherList.some(action => action.id === created.id)).toBe(false);

    const crossPatchRes = await patchJson(`/api/client-actions/${privateWsId}/${created.id}`, {
      status: 'completed',
    });
    expect(crossPatchRes.status).toBe(404);

    const ownerList = await listActions(wsId);
    const stored = ownerList.find(action => action.id === created.id);
    expect(stored?.status).toBe('pending');
  });

  it('lets admin update action details without creating completion activity', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      sourceId: `internal-links:edit:${Date.now()}`,
      title: 'Original action title',
      summary: 'Original summary for client review.',
      priority: 'low',
      payload: { suggestions: [{ fromPage: '/old', toPage: '/target' }] },
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as ClientAction;

    const patchRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, {
      title: 'Updated action title',
      summary: 'Updated summary for the client.',
      priority: 'high',
      clientNote: 'Follow-up note carried on the action.',
      payload: {
        suggestions: [{ fromPage: '/new', toPage: '/target', anchorText: 'Target' }],
        reviewedBy: 'coverage-test',
      },
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json() as ClientAction;
    expect(updated).toMatchObject({
      id: created.id,
      title: 'Updated action title',
      summary: 'Updated summary for the client.',
      priority: 'high',
      status: 'pending',
      clientNote: 'Follow-up note carried on the action.',
    });
    expect(updated.payload).toEqual({
      suggestions: [{ fromPage: '/new', toPage: '/target', anchorText: 'Target' }],
      reviewedBy: 'coverage-test',
    });

    const stored = (await listActions(wsId)).find(action => action.id === created.id);
    expect(stored).toMatchObject({
      title: 'Updated action title',
      summary: 'Updated summary for the client.',
      priority: 'high',
      status: 'pending',
      clientNote: 'Follow-up note carried on the action.',
    });
    expect(stored?.payload).toEqual(updated.payload);
    expect(countSentActivitiesForAction(wsId, created.id)).toBe(1);
    expect(countActivitiesForAction(wsId, created.id, 'client_action_completed')).toBe(0);
  });

  it('allows a client to approve a pending action, then blocks duplicate responses', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      title: 'Refresh declining page',
      summary: 'This page needs a refresh.',
    });
    const created = await createRes.json();

    const respondRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'approved',
      clientNote: 'Looks good.',
    });
    expect(respondRes.status).toBe(200);
    const approved = await respondRes.json();
    expect(approved.status).toBe('approved');
    expect(approved.clientNote).toBe('Looks good.');

    const duplicateRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'changes_requested',
      clientNote: 'Actually no.',
    });
    expect(duplicateRes.status).toBe(409);
  });

  it('rejects invalid public responses without mutating the pending action', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      title: 'Invalid public response',
      summary: 'This action should remain pending.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const invalidRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'completed',
      clientNote: 'Trying to skip approval.',
    });
    expect(invalidRes.status).toBe(400);

    const stored = (await listActions(wsId)).find(action => action.id === created.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.clientNote).toBeUndefined();
  });

  it('does not let public routes respond to an action through the wrong workspace', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      title: 'Cross-workspace public response',
      summary: 'This must not be answerable through another workspace.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const crossRespondRes = await patchJson(`/api/public/client-actions/${otherWsId}/${created.id}/respond`, {
      status: 'approved',
      clientNote: 'Cross-workspace probe.',
    });
    expect(crossRespondRes.status).toBe(404);

    const stored = (await listActions(wsId)).find(action => action.id === created.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.clientNote).toBeUndefined();
  });

  it('treats changes requested as a client-side terminal response until admin reopens it', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO change',
      summary: 'Review this AEO recommendation.',
    });
    const created = await createRes.json();

    const changesRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'changes_requested',
      clientNote: 'Please revise the recommendation.',
    });
    expect(changesRes.status).toBe(200);
    const changes = await changesRes.json() as ClientAction;
    expect(changes.status).toBe('changes_requested');
    expect(changes.clientNote).toBe('Please revise the recommendation.');
    expect(countActivitiesForAction(wsId, created.id, 'client_action_changes_requested')).toBe(1);

    const publicListRes = await api(`/api/public/client-actions/${wsId}`);
    expect(publicListRes.status).toBe(200);
    const publicList = await publicListRes.json() as ClientAction[];
    const publicAction = publicList.find(action => action.id === created.id);
    expect(publicAction?.status).toBe('changes_requested');
    expect(publicAction?.clientNote).toBe('Please revise the recommendation.');

    const approveAfterChangesRes = await patchJson(`/api/public/client-actions/${wsId}/${created.id}/respond`, {
      status: 'approved',
    });
    expect(approveAfterChangesRes.status).toBe(409);

    const reopenRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'pending' });
    expect(reopenRes.status).toBe(200);
    expect((await reopenRes.json()).status).toBe('pending');
  });

  it('lets admin complete and archive actions', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Redirect proposals',
      summary: 'Review redirect CSV before implementation.',
    });
    const created = await createRes.json();

    const completedRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(completedRes.status).toBe(200);
    expect((await completedRes.json()).status).toBe('completed');

    const archivedRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'archived' });
    expect(archivedRes.status).toBe(200);
    expect((await archivedRes.json()).status).toBe('archived');
  });

  it('rejects invalid admin status transitions', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'keyword_strategy',
      title: 'Keyword strategy',
      summary: 'Review the strategy.',
    });
    const created = await createRes.json();

    const completedRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'completed' });
    expect(completedRes.status).toBe(200);

    const reopenCompletedRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, { status: 'pending' });
    expect(reopenCompletedRes.status).toBe(409);
  });

  it('rejects invalid admin update values without mutating', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      title: 'Invalid update values',
      summary: 'This action should keep its original priority and status.',
      priority: 'low',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    const before = (await listActions(wsId)).find(action => action.id === created.id);
    expect(before).toBeDefined();

    const badStatusRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, {
      status: 'not_a_status',
    });
    expect(badStatusRes.status).toBe(400);

    const badPriorityRes = await patchJson(`/api/client-actions/${wsId}/${created.id}`, {
      priority: 'urgent',
    });
    expect(badPriorityRes.status).toBe(400);

    const after = (await listActions(wsId)).find(action => action.id === created.id);
    expect(after?.status).toBe(before?.status);
    expect(after?.priority).toBe(before?.priority);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it('requires client auth for password-protected public action reads', async () => {
    const res = await api(`/api/public/client-actions/${privateWsId}`);
    expect(res.status).toBe(401);
  });

  it('requires client auth before responding to a password-protected action', async () => {
    const createRes = await postJson(`/api/client-actions/${privateWsId}`, {
      sourceType: 'content_decay',
      title: 'Protected client response',
      summary: 'This action can only be answered after client login.',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    clearCookies();
    const unauthenticatedRes = await patchJson(`/api/public/client-actions/${privateWsId}/${created.id}/respond`, {
      status: 'approved',
      clientNote: 'This should not be saved.',
    });
    expect(unauthenticatedRes.status).toBe(401);

    const beforeLogin = (await listActions(privateWsId)).find(action => action.id === created.id);
    expect(beforeLogin?.status).toBe('pending');
    expect(beforeLogin?.clientNote).toBeUndefined();
    expect(countActivitiesForAction(privateWsId, created.id, 'client_action_approved')).toBe(0);

    const loginRes = await postJson(`/api/public/auth/${privateWsId}`, {
      password: 'client-action-test',
    });
    expect(loginRes.status).toBe(200);

    const authenticatedRes = await patchJson(`/api/public/client-actions/${privateWsId}/${created.id}/respond`, {
      status: 'approved',
      clientNote: 'Approved after login.',
    });
    expect(authenticatedRes.status).toBe(200);
    const approved = await authenticatedRes.json();
    expect(approved.status).toBe('approved');
    expect(approved.clientNote).toBe('Approved after login.');
    expect(countActivitiesForAction(privateWsId, created.id, 'client_action_approved')).toBe(1);
  });
});
