import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { deleteSchemaPlan, saveSchemaPlan } from '../../server/schema-store.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.ts';

const ctx = createTestContext(13277);
const { api, postJson } = ctx;

let workspaceId = '';
const siteId = `schema-public-${Date.now()}`;

function plan(status: SchemaSitePlan['status']): SchemaSitePlan {
  const now = new Date().toISOString();
  return {
    id: `schema-plan-${status}`,
    siteId,
    workspaceId,
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
}, 25_000);

afterAll(() => {
  deleteSchemaPlan(siteId);
  deleteWorkspace(workspaceId);
  ctx.stopServer();
});

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
});
