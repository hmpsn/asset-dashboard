/**
 * Integration tests — Admin request CRUD lifecycle.
 *
 * Covers: create, list, get, update status/priority, add team note,
 * delete, and bulk update — verifying response shape, DB state,
 * activity log entries, and broadcast stubs at each step.
 *
 * The existing requests-routes.test.ts (port 13346) focuses on
 * validation failures. This file focuses on the happy-path lifecycle.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyClientTeamResponse: vi.fn(),
    notifyClientStatusChange: vi.fn(),
    notifyTeamNewRequest: vi.fn(),
    notifyTeamActionApproved: vi.fn(),
    notifyTeamContentRequest: vi.fn(),
    notifyTeamChangesRequested: vi.fn(),
    notifyTeamPaymentReceived: vi.fn(),
    notifyTeamChurnSignal: vi.fn(),
    notifyTeamClientSignal: vi.fn(),
  };
});

import { createTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createRequest, getRequest, listRequests } from '../../server/requests.js';

const ctx = createTestContext(13852); // port-ok: unique in integration suite
const { postJson, patchJson, del, api } = ctx;

let workspaceId = '';
let otherWorkspaceId = '';

function clearWorkspaceData(wsId: string): void {
  db.prepare('DELETE FROM requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Requests Lifecycle Workspace').id;
  otherWorkspaceId = createWorkspace('Requests Lifecycle Other Workspace').id;
}, 25_000);

beforeEach(() => {
  clearWorkspaceData(workspaceId);
  clearWorkspaceData(otherWorkspaceId);
});

afterAll(async () => {
  clearWorkspaceData(workspaceId);
  clearWorkspaceData(otherWorkspaceId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await ctx.stopServer();
}, 15_000);

// ── POST /api/requests — create ────────────────────────────────────────────

describe('POST /api/requests — create', () => {
  it('creates a request and returns it with id, title, category, and status=new', async () => {
    const res = await postJson('/api/requests', {
      workspaceId,
      title: 'Fix homepage meta description',
      description: 'The meta description is missing on the homepage.',
      category: 'seo',
      priority: 'high',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeTruthy();
    expect(body.title).toBe('Fix homepage meta description');
    expect(body.category).toBe('seo');
    expect(body.priority).toBe('high');
    expect(body.status).toBe('new');
    expect(body.workspaceId).toBe(workspaceId);

    // Verify persisted in DB
    const stored = getRequest(body.id as string);
    expect(stored).toBeDefined();
    expect(stored?.title).toBe('Fix homepage meta description');
  });

  it('returns 400 for missing title', async () => {
    const res = await postJson('/api/requests', {
      workspaceId,
      description: 'No title provided.',
      category: 'seo',
    });

    expect(res.status).toBe(400);
    expect(listRequests(workspaceId)).toHaveLength(0);
  });

  it('returns 400 for missing description', async () => {
    const res = await postJson('/api/requests', {
      workspaceId,
      title: 'Title without description',
      category: 'bug',
    });

    expect(res.status).toBe(400);
    expect(listRequests(workspaceId)).toHaveLength(0);
  });
});

// ── GET /api/requests — list ───────────────────────────────────────────────

describe('GET /api/requests — list', () => {
  it('returns all requests for a workspace after seeding two', async () => {
    createRequest(workspaceId, {
      title: 'Request alpha',
      description: 'First request',
      category: 'seo',
    });
    createRequest(workspaceId, {
      title: 'Request beta',
      description: 'Second request',
      category: 'content',
    });

    const res = await api(`/api/requests?workspaceId=${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(2);
  });

  it('does not return requests belonging to another workspace', async () => {
    createRequest(workspaceId, {
      title: 'Workspace A request',
      description: 'Belongs to workspaceId',
      category: 'design',
    });
    createRequest(otherWorkspaceId, {
      title: 'Workspace B request',
      description: 'Belongs to otherWorkspaceId',
      category: 'feature',
    });

    const res = await api(`/api/requests?workspaceId=${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Workspace A request');
    const ids = body.map(r => r.id);
    const otherRequests = listRequests(otherWorkspaceId);
    for (const r of otherRequests) {
      expect(ids).not.toContain(r.id);
    }
  });

  it('GET /api/requests/:id returns a single request with expected fields', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Single request fetch',
      description: 'Should be returned with all fields',
      category: 'bug',
      priority: 'medium',
    });

    const res = await api(`/api/requests/${seeded.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(seeded.id);
    expect(body.title).toBe('Single request fetch');
    expect(body.category).toBe('bug');
    expect(body.priority).toBe('medium');
    expect(body.status).toBe('new');
    expect(body.workspaceId).toBe(workspaceId);
    expect(Array.isArray(body.notes)).toBe(true);
  });

  it('GET /api/requests/:id returns 404 for unknown id', async () => {
    const res = await api('/api/requests/req_nonexistent_999');
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/requests/:id — update ──────────────────────────────────────

describe('PATCH /api/requests/:id — update', () => {
  it('updates status from new to in_progress and returns updated request', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Status update test',
      description: 'Status should change',
      category: 'seo',
    });

    const res = await patchJson(`/api/requests/${seeded.id}`, { status: 'in_progress' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('in_progress');
    expect(body.id).toBe(seeded.id);

    // Verify persisted
    expect(getRequest(seeded.id)?.status).toBe('in_progress');
  });

  it('updates priority and returns the updated value', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Priority update test',
      description: 'Priority should change',
      category: 'design',
      priority: 'low',
    });

    const res = await patchJson(`/api/requests/${seeded.id}`, { priority: 'urgent' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.priority).toBe('urgent');

    expect(getRequest(seeded.id)?.priority).toBe('urgent');
  });

  it('returns 404 for unknown request id', async () => {
    const res = await patchJson('/api/requests/req_nonexistent_xyz', { status: 'in_review' });
    expect(res.status).toBe(404);
  });

  // M1: an illegal status transition (closed → new, the B24 bug) returns 409 with the machine's
  // message — distinct from the 404 reserved for genuine not-found — and does NOT mutate the row.
  it('returns 409 for an illegal status transition (closed → new)', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Illegal transition test',
      description: 'closed is terminal',
      category: 'seo',
    });
    // new → closed is legal
    const closeRes = await patchJson(`/api/requests/${seeded.id}`, { status: 'closed' });
    expect(closeRes.status).toBe(200);

    // closed → new is illegal → 409
    const res = await patchJson(`/api/requests/${seeded.id}`, { status: 'new' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/transition/i);

    // Row stays closed — the illegal move did not partially apply.
    expect(getRequest(seeded.id)?.status).toBe('closed');
  });

  it('logs activity when status transitions to completed', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Completion activity log test',
      description: 'Completing this should add an activity entry',
      category: 'seo',
    });

    const activityBefore = db.prepare(
      'SELECT COUNT(*) as n FROM activity_log WHERE workspace_id = ?'
    ).get(workspaceId) as { n: number };

    const res = await patchJson(`/api/requests/${seeded.id}`, { status: 'completed' });
    expect(res.status).toBe(200);

    const activityAfter = db.prepare(
      'SELECT COUNT(*) as n FROM activity_log WHERE workspace_id = ?'
    ).get(workspaceId) as { n: number };

    expect(activityAfter.n).toBeGreaterThan(activityBefore.n);

    const entry = db.prepare(
      "SELECT * FROM activity_log WHERE workspace_id = ? AND type = 'request_resolved' ORDER BY created_at DESC LIMIT 1"
    ).get(workspaceId) as Record<string, unknown> | undefined;
    expect(entry).toBeDefined();
  });
});

// ── POST /api/requests/:id/notes — team note ──────────────────────────────

describe('POST /api/requests/:id/notes — team note', () => {
  it('adds a team note and returns updated request with notes array containing it', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Note target request',
      description: 'We will add a note to this',
      category: 'content',
    });

    const res = await postJson(`/api/requests/${seeded.id}/notes`, {
      content: 'Team is working on this issue.',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.notes)).toBe(true);
    const notes = body.notes as Array<Record<string, unknown>>;
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('Team is working on this issue.');
    expect(notes[0].author).toBe('team');
  });

  it('note contains id and createdAt fields', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Note fields test',
      description: 'Note should have metadata fields',
      category: 'bug',
    });

    const res = await postJson(`/api/requests/${seeded.id}/notes`, {
      content: 'Investigating the root cause.',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const notes = body.notes as Array<Record<string, unknown>>;
    expect(notes[0].id).toBeTruthy();
    expect(notes[0].createdAt).toBeTruthy();
  });

  it('returns 400 when note content is empty', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Empty note guard',
      description: 'Empty note should be rejected',
      category: 'seo',
    });

    const res = await postJson(`/api/requests/${seeded.id}/notes`, {
      content: '   ',
    });

    expect(res.status).toBe(400);
    expect(getRequest(seeded.id)?.notes).toHaveLength(0);
  });

  it('returns 404 for note on unknown request', async () => {
    const res = await postJson('/api/requests/req_nonexistent_note/notes', {
      content: 'No request exists.',
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/requests/:id ────────────────────────────────────────────────

describe('DELETE /api/requests/:id', () => {
  it('deletes the request and returns ok:true', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'To be deleted',
      description: 'This request will be removed',
      category: 'feature',
    });

    const res = await del(`/api/requests/${seeded.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('subsequent GET returns 404 after deletion', async () => {
    const seeded = createRequest(workspaceId, {
      title: 'Gone after delete',
      description: 'Should not be found after deletion',
      category: 'other',
    });

    const deleteRes = await del(`/api/requests/${seeded.id}`);
    expect(deleteRes.status).toBe(200);

    // Verify it's gone via DB helper
    expect(getRequest(seeded.id)).toBeUndefined();

    // Verify via HTTP
    const getRes = await api(`/api/requests/${seeded.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting a nonexistent request', async () => {
    const res = await del('/api/requests/req_does_not_exist');
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/requests/bulk — bulk update ──────────────────────────────────

describe('PATCH /api/requests/bulk — bulk update', () => {
  it('updates multiple requests status in one call and returns updated count', async () => {
    const r1 = createRequest(workspaceId, {
      title: 'Bulk target 1',
      description: 'Will be bulk-updated',
      category: 'seo',
    });
    const r2 = createRequest(workspaceId, {
      title: 'Bulk target 2',
      description: 'Will be bulk-updated',
      category: 'content',
    });
    const r3 = createRequest(workspaceId, {
      title: 'Bulk target 3',
      description: 'Will be bulk-updated',
      category: 'design',
    });

    const res = await patchJson('/api/requests/bulk', {
      ids: [r1.id, r2.id, r3.id],
      status: 'in_review',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.updated).toBe(3);
    expect(body.total).toBe(3);

    // Verify all three are updated in DB
    expect(getRequest(r1.id)?.status).toBe('in_review');
    expect(getRequest(r2.id)?.status).toBe('in_review');
    expect(getRequest(r3.id)?.status).toBe('in_review');
  });

  it('returns updated count of only existing requests (skips unknown ids)', async () => {
    const r1 = createRequest(workspaceId, {
      title: 'Partial bulk target',
      description: 'One valid, one invalid id',
      category: 'seo',
    });

    const res = await patchJson('/api/requests/bulk', {
      ids: [r1.id, 'req_nonexistent_bulk_001'],
      status: 'on_hold',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Only the existing request should be updated
    expect(body.updated).toBe(1);
    expect(body.total).toBe(2);
    expect(getRequest(r1.id)?.status).toBe('on_hold');
  });

  it('returns 400 when neither status nor priority is provided', async () => {
    const r1 = createRequest(workspaceId, {
      title: 'Bulk no-op guard',
      description: 'Bulk update requires at least one field',
      category: 'other',
    });

    const res = await patchJson('/api/requests/bulk', {
      ids: [r1.id],
    });

    expect(res.status).toBe(400);
    // Status unchanged
    expect(getRequest(r1.id)?.status).toBe('new');
  });

  it('bulk updates priority when provided instead of status', async () => {
    const r1 = createRequest(workspaceId, {
      title: 'Priority bulk target',
      description: 'Priority will be bulk-updated',
      category: 'seo',
      priority: 'low',
    });
    const r2 = createRequest(workspaceId, {
      title: 'Priority bulk target 2',
      description: 'Priority will be bulk-updated',
      category: 'design',
      priority: 'low',
    });

    const res = await patchJson('/api/requests/bulk', {
      ids: [r1.id, r2.id],
      priority: 'high',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.updated).toBe(2);
    expect(getRequest(r1.id)?.priority).toBe('high');
    expect(getRequest(r2.id)?.priority).toBe('high');
  });
});
