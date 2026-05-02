import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13332); // port-ok: 13201-13331 already allocated in integration suite
const { api, postJson, patchJson } = ctx;

let wsId = '';
let privateWsId = '';

beforeAll(async () => {
  await ctx.startServer();

  const ws = createWorkspace('Client Actions Routes');
  wsId = ws.id;

  const privateWs = createWorkspace('Client Actions Private');
  privateWsId = privateWs.id;
  updateWorkspace(privateWsId, { clientPassword: 'client-action-test' });
});

afterAll(() => {
  db.prepare('DELETE FROM client_actions WHERE workspace_id IN (?, ?)').run(wsId, privateWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(privateWsId);
  ctx.stopServer();
});

describe('client action routes', () => {
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

    const listRes = await api(`/api/client-actions/${wsId}`);
    const list = await listRes.json();
    expect(list.filter((a: { sourceId?: string }) => a.sourceId === sourceId)).toHaveLength(1);
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
    expect((await changesRes.json()).status).toBe('changes_requested');

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

  it('requires client auth for password-protected public action reads', async () => {
    const res = await api(`/api/public/client-actions/${privateWsId}`);
    expect(res.status).toBe(401);
  });
});
