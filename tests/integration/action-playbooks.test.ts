/**
 * Integration tests for the Action Playbooks Resolution feature.
 *
 * Covers the key behaviors introduced in the feature:
 * - Client respond endpoint approves/changes-requested actions
 * - Approving a content_decay action enqueues an action-playbook-execute job
 * - Duplicate responses are rejected with 409
 * - Admin mark-complete flow transitions approved → completed
 * - Invalid admin transitions (completed → pending) are rejected with 409
 * - Approved actions appear in the admin list
 *
 * Port: 13352
 *
 * NOTE: The public respond endpoint is accessible without auth for workspaces
 * that do not have a clientPassword set. The existing auth-guard tests
 * are covered in client-actions-routes.test.ts (password-protected workspace).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import type { ClientAction } from '../../shared/types/client-actions.js';
import type { Job } from '../../server/jobs.js';

const ctx = createTestContext(13352); // port-ok: 13201-13351 already allocated in integration suite
const { api, postJson, patchJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Action Playbooks Test');
  wsId = ws.id;
}, 30_000);

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─── Client respond endpoint ──────────────────────────────────────────────────

describe('Action Playbooks — client respond endpoint', () => {
  it('approving an action returns 200 with status=approved and clientNote', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'internal_link',
      title: 'Add internal link',
      summary: 'Link from blog post to service page.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    const respondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved', clientNote: 'Looks great!' },
    );
    expect(respondRes.status).toBe(200);
    const updated = await respondRes.json() as ClientAction;
    expect(updated.status).toBe('approved');
    expect(updated.clientNote).toBe('Looks great!');
  });

  it('changes_requested response returns 200 with status=changes_requested', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'keyword_strategy',
      title: 'Target local SEO',
      summary: 'Add to strategy.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    const respondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'changes_requested', clientNote: 'Please revise.' },
    );
    expect(respondRes.status).toBe(200);
    const updated = await respondRes.json() as ClientAction;
    expect(updated.status).toBe('changes_requested');
    expect(updated.clientNote).toBe('Please revise.');
  });

  it('returns 409 when the action is already approved (not pending)', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO header rewrite',
      summary: 'Add FAQ section.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    // First approve
    const firstRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(firstRes.status).toBe(200);

    // Second response — should 409 because action is no longer pending
    const secondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(secondRes.status).toBe(409);
  });

  it('rejects an invalid public status (completed) with 400 and leaves action pending', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Redirect old page',
      summary: 'Client approved redirect.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    const badRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'completed' },
    );
    expect(badRes.status).toBe(400);

    // Verify action remains pending
    const listRes = await api(`/api/client-actions/${wsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as ClientAction[];
    const stored = list.find(a => a.id === action.id);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('pending');
  });
});

// ─── Playbook job enqueueing ──────────────────────────────────────────────────

describe('Action Playbooks — job enqueueing on content_decay approval', () => {
  it('approving a content_decay action enqueues an action-playbook-execute job', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'content_decay',
      title: 'Refresh: /blog/old-post',
      summary: 'Traffic down 40% in 90 days.',
      payload: { pageUrl: '/blog/old-post', targetKeyword: 'seo tips' },
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    const respondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(respondRes.status).toBe(200);

    // Job is created synchronously before the async brief generation
    const jobsRes = await api(`/api/jobs?workspaceId=${wsId}`);
    expect(jobsRes.status).toBe(200);
    const jobs = await jobsRes.json() as Job[];
    expect(jobs.length).toBeGreaterThan(0);
    const playbookJob = jobs.find(j => j.type === 'action-playbook-execute' && j.workspaceId === wsId);
    expect(playbookJob).toBeDefined();
  });

  it('approving a non-content_decay action does NOT enqueue a playbook job', async () => {
    // Get baseline job count before the approve
    const beforeRes = await api(`/api/jobs?workspaceId=${wsId}`);
    const beforeJobs = await beforeRes.json() as Job[];
    const beforePlaybookCount = beforeJobs.filter(j => j.type === 'action-playbook-execute').length;

    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO: Add FAQ block',
      summary: 'Add FAQ schema to service page.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    const respondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(respondRes.status).toBe(200);

    const afterRes = await api(`/api/jobs?workspaceId=${wsId}`);
    const afterJobs = await afterRes.json() as Job[];
    const afterPlaybookCount = afterJobs.filter(j => j.type === 'action-playbook-execute').length;

    // No new playbook job created for aeo_change
    expect(afterPlaybookCount).toBe(beforePlaybookCount);
  });
});

// ─── Admin mark-complete flow ─────────────────────────────────────────────────

describe('Action Playbooks — admin mark-complete flow', () => {
  it('admin PATCH to completed transitions an approved action', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'redirect_proposal',
      title: 'Redirect old page',
      summary: 'Client approved redirect.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    // Client approves first
    const respondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(respondRes.status).toBe(200);

    // Admin marks complete
    const completeRes = await patchJson(`/api/client-actions/${wsId}/${action.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json() as ClientAction;
    expect(completed.status).toBe('completed');
  });

  it('returns 409 when transitioning completed → pending (invalid)', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'keyword_strategy',
      title: 'Keyword: target local seo',
      summary: 'Add to strategy.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    // Complete it directly (pending → completed is a valid admin transition)
    const completeRes = await patchJson(`/api/client-actions/${wsId}/${action.id}`, { status: 'completed' });
    expect(completeRes.status).toBe(200);

    // Now try to move completed → pending — this is invalid
    const badRes = await patchJson(`/api/client-actions/${wsId}/${action.id}`, { status: 'pending' });
    expect(badRes.status).toBe(409);
  });

  it('approved action appears in admin list with correct status', async () => {
    const createRes = await postJson(`/api/client-actions/${wsId}`, {
      sourceType: 'aeo_change',
      title: 'AEO: Add FAQ block',
      summary: 'Add FAQ schema to service page.',
    });
    expect(createRes.status).toBe(200);
    const action = await createRes.json() as ClientAction;

    const respondRes = await patchJson(
      `/api/public/client-actions/${wsId}/${action.id}/respond`,
      { status: 'approved' },
    );
    expect(respondRes.status).toBe(200);

    const listRes = await api(`/api/client-actions/${wsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as ClientAction[];
    expect(list.length).toBeGreaterThan(0);
    const found = list.find(a => a.id === action.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('approved');
  });
});
