import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { createRequest, getRequest, listRequests } from '../../server/requests.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13346); // port-ok: 13201-13345 already allocated in integration suite
const { api, postJson, patchJson } = ctx;

let workspaceId = '';
let otherWorkspaceId = '';

function clearRequests(): void {
  db.prepare('DELETE FROM requests WHERE workspace_id IN (?, ?)').run(workspaceId, otherWorkspaceId);
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Requests Route Coverage Workspace').id;
  otherWorkspaceId = createWorkspace('Requests Route Coverage Other Workspace').id;
}, 25_000);

beforeEach(() => {
  clearRequests();
});

afterAll(async () => {
  clearRequests();
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await ctx.stopServer();
});

describe('requests routes', () => {
  it('rejects invalid admin create values before storing malformed requests', async () => {
    const res = await postJson('/api/requests', {
      workspaceId,
      title: 'Malformed request',
      description: 'This should not be stored',
      category: 'not-a-category',
      priority: 'drop-everything',
    });

    expect(res.status).toBe(400);
    expect(listRequests(workspaceId)).toHaveLength(0);
  });

  it('rejects malformed batch items without partially creating valid rows', async () => {
    const res = await postJson('/api/requests/batch', {
      workspaceId,
      items: [
        {
          title: 'Valid task',
          description: 'This would be valid on its own',
          category: 'seo',
          priority: 'medium',
        },
        {
          title: 'Invalid task',
          description: 'Missing a valid category should reject the whole batch',
          category: 'invalid',
          priority: 'high',
        },
      ],
    });

    expect(res.status).toBe(400);
    expect(listRequests(workspaceId)).toHaveLength(0);
  });

  it('rejects invalid status updates without mutating the request', async () => {
    const request = createRequest(workspaceId, {
      title: 'Status guard',
      description: 'Only known request statuses should persist',
      category: 'seo',
    });

    const res = await patchJson(`/api/requests/${request.id}`, { status: 'done-ish' });

    expect(res.status).toBe(400);
    expect(getRequest(request.id)?.status).toBe('new');
  });

  it('rejects public request categories outside the client-facing category set', async () => {
    const res = await postJson(`/api/public/requests/${workspaceId}`, {
      title: 'Client submitted malformed category',
      description: 'The client portal should not create unknown filter values',
      category: 'billing',
    });

    expect(res.status).toBe(400);
    expect(listRequests(workspaceId)).toHaveLength(0);
  });

  it('creates a request, accepts a team note, and exposes it through the client read path', async () => {
    const createRes = await postJson('/api/requests', {
      workspaceId,
      title: 'Update homepage copy',
      description: 'Please refresh the hero section',
      category: 'content',
      priority: 'high',
      pageUrl: '/home',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const noteRes = await postJson(`/api/requests/${created.id}/notes`, {
      content: 'We are drafting the update now.',
    });
    expect(noteRes.status).toBe(200);

    const publicRes = await api(`/api/public/requests/${workspaceId}/${created.id}`);
    expect(publicRes.status).toBe(200);
    const body = await publicRes.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0]).toMatchObject({
      author: 'team',
      content: 'We are drafting the update now.',
    });
    expect(body.category).toBe('content');
    expect(body.priority).toBe('high');
  });

  it('keeps public workspace scoping on single request reads', async () => {
    const request = createRequest(otherWorkspaceId, {
      title: 'Other workspace request',
      description: 'Should not leak via the wrong workspace URL',
      category: 'seo',
    });

    const res = await api(`/api/public/requests/${workspaceId}/${request.id}`);

    expect(res.status).toBe(404);
  });
});
