import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { deleteSchemaPlan, getSchemaPlan, saveSchemaPlan } from '../../server/schema-store.js';
import db from '../../server/db/index.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.ts';

const ctx = createTestContext(13277);
const { api, postJson, clearCookies } = ctx;

let workspaceId = '';
let protectedWorkspaceId = '';
let otherWorkspaceId = '';
const siteId = `schema-public-${Date.now()}`;
const protectedSiteId = `schema-public-protected-${Date.now()}`;
const otherSiteId = `schema-public-other-${Date.now()}`;

function plan(
  status: SchemaSitePlan['status'],
  overrides: Partial<Pick<SchemaSitePlan, 'siteId' | 'workspaceId' | 'id'>> = {},
): SchemaSitePlan {
  const now = new Date().toISOString();
  const planSiteId = overrides.siteId ?? siteId;
  const planWorkspaceId = overrides.workspaceId ?? workspaceId;
  return {
    id: overrides.id ?? `schema-plan-${planSiteId}-${status}`,
    siteId: planSiteId,
    workspaceId: planWorkspaceId,
    siteUrl: 'https://example.test',
    canonicalEntities: [],
    pageRoles: [{
      pagePath: '/',
      pageTitle: 'Home',
      role: 'homepage',
      primaryType: 'WebPage',
      entityRefs: [],
    }],
    status,
    generatedAt: now,
    updatedAt: now,
  };
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Schema Plan Public Route Test');
  workspaceId = ws.id;
  updateWorkspace(workspaceId, { webflowSiteId: siteId });

  const protectedWs = createWorkspace('Schema Plan Protected Route Test');
  protectedWorkspaceId = protectedWs.id;
  updateWorkspace(protectedWorkspaceId, {
    webflowSiteId: protectedSiteId,
    clientPassword: 'schema-plan-test',
  });

  const otherWs = createWorkspace('Schema Plan Other Route Test');
  otherWorkspaceId = otherWs.id;
  updateWorkspace(otherWorkspaceId, { webflowSiteId: otherSiteId });
}, 25_000);

afterAll(async () => {
  deleteSchemaPlan(siteId);
  deleteSchemaPlan(protectedSiteId);
  deleteSchemaPlan(otherSiteId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(protectedWorkspaceId);
  deleteWorkspace(otherWorkspaceId);
  await ctx.stopServer();
});

function countSchemaFeedbackActivities(workspaceId: string, title: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = 'changes_requested'
      AND title = ?
  `).get(workspaceId, title) as { count: number };
  return row.count;
}

describe('public schema plan routes', () => {
  it('hides draft schema plans from the client portal', async () => {
    saveSchemaPlan(plan('draft'));
    const res = await api(`/api/public/schema-plan/${workspaceId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('returns sent schema plans and accepts feedback only in sent_to_client', async () => {
    saveSchemaPlan(plan('sent_to_client'));

    const visibleRes = await api(`/api/public/schema-plan/${workspaceId}`);
    expect(visibleRes.status).toBe(200);
    const visible = await visibleRes.json();
    expect(visible.status).toBe('sent_to_client');

    const feedbackRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, { action: 'approve' });
    expect(feedbackRes.status).toBe(200);
    const approved = await feedbackRes.json();
    expect(approved.status).toBe('client_approved');

    const secondFeedback = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, { action: 'request_changes' });
    expect(secondFeedback.status).toBe(409);
  });

  it('requires client auth before reading or updating protected schema plan feedback', async () => {
    saveSchemaPlan(plan('sent_to_client', {
      siteId: protectedSiteId,
      workspaceId: protectedWorkspaceId,
    }));

    clearCookies();
    const readRes = await api(`/api/public/schema-plan/${protectedWorkspaceId}`);
    expect(readRes.status).toBe(401);

    const feedbackRes = await postJson(`/api/public/schema-plan/${protectedWorkspaceId}/feedback`, {
      action: 'approve',
      note: 'This should not save.',
    });
    expect(feedbackRes.status).toBe(401);
    expect(getSchemaPlan(protectedSiteId)?.status).toBe('sent_to_client');
    expect(countSchemaFeedbackActivities(protectedWorkspaceId, 'Client approved schema plan')).toBe(0);

    const loginRes = await postJson(`/api/public/auth/${protectedWorkspaceId}`, {
      password: 'schema-plan-test',
    });
    expect(loginRes.status).toBe(200);

    const authedFeedbackRes = await postJson(`/api/public/schema-plan/${protectedWorkspaceId}/feedback`, {
      action: 'approve',
      note: 'Approved after login.',
    });
    expect(authedFeedbackRes.status).toBe(200);
    const approved = await authedFeedbackRes.json();
    expect(approved.status).toBe('client_approved');
    expect(getSchemaPlan(protectedSiteId)?.status).toBe('client_approved');
    expect(countSchemaFeedbackActivities(protectedWorkspaceId, 'Client approved schema plan')).toBe(1);
    clearCookies();
  });

  it('rejects invalid feedback without mutating the sent plan', async () => {
    saveSchemaPlan(plan('sent_to_client'));

    const invalidActionRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'publish_now',
      note: 'Invalid action should not save.',
    });
    expect(invalidActionRes.status).toBe(400);
    expect(getSchemaPlan(siteId)?.status).toBe('sent_to_client');

    const malformedNoteRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'request_changes',
      note: { text: 'Structured note should not save.' },
    });
    expect(malformedNoteRes.status).toBe(400);
    expect(getSchemaPlan(siteId)?.status).toBe('sent_to_client');
    expect(countSchemaFeedbackActivities(workspaceId, 'Client requested changes on schema plan')).toBe(0);
  });

  it('does not update a schema plan through the wrong workspace', async () => {
    saveSchemaPlan(plan('sent_to_client'));
    const ownerApprovalsBefore = countSchemaFeedbackActivities(workspaceId, 'Client approved schema plan');

    const crossFeedbackRes = await postJson(`/api/public/schema-plan/${otherWorkspaceId}/feedback`, {
      action: 'approve',
      note: 'Wrong workspace should not approve.',
    });
    expect(crossFeedbackRes.status).toBe(404);
    expect(getSchemaPlan(siteId)?.status).toBe('sent_to_client');
    expect(getSchemaPlan(otherSiteId)).toBeNull();
    expect(countSchemaFeedbackActivities(workspaceId, 'Client approved schema plan')).toBe(ownerApprovalsBefore);
    expect(countSchemaFeedbackActivities(otherWorkspaceId, 'Client approved schema plan')).toBe(0);
  });

  it('persists request-changes feedback while the plan is sent to the client', async () => {
    saveSchemaPlan(plan('sent_to_client'));

    const changesRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'request_changes',
      note: 'Please revisit the service page schema.',
    });
    expect(changesRes.status).toBe(200);
    const changes = await changesRes.json();
    expect(changes.status).toBe('client_changes_requested');
    expect(getSchemaPlan(siteId)?.status).toBe('client_changes_requested');
    expect(countSchemaFeedbackActivities(workspaceId, 'Client requested changes on schema plan')).toBe(1);
  });
});
