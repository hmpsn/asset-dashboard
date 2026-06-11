/**
 * Integration tests for server/routes/deliverables.ts (Phase 0, dark).
 *
 * Focus:
 * 1. PATCH /api/public/deliverables/:workspaceId/:id/respond is gated by the ROUTE's
 *    own requireAuthenticatedClientPortalAuth — proven with a PASSWORDLESS workspace,
 *    which the global app.ts client-session gate lets through (it only 401s
 *    password-protected workspaces) but requireAuthenticatedClientPortalAuth denies.
 *    So a 401 here can only come from the route guard itself (audit §B.5, M1).
 * 2. A client-JWT-authenticated request reaches the handler (404 for a missing
 *    deliverable, not the Express catch-all) — proving the route is registered with
 *    the :workspaceId param and the auth guard recognizes a real client token.
 * 3. POST /api/deliverables/:workspaceId/:id/remind is the admin remind route.
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { createJob } from '../../server/jobs.js';
import { getDeliverable, upsertDeliverable } from '../../server/client-deliverables.js';
import { listActivity } from '../../server/activity-log.js';
import db from '../../server/db/index.js';
import { saveSchemaPlan, getSchemaPlan, deleteSchemaPlan } from '../../server/schema-store.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

const ctx = createTestContext(13874, { autoPublicAuth: true }); // port-ok: next free after 13873

let pwless: SeededFullWorkspace;
let clientUserId = '';
let clientToken = '';

function clientFetch(url: string, opts: RequestInit & { method: string }): Promise<Response> {
  return fetch(`${ctx.BASE}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `client_user_token_${pwless.workspaceId}=${clientToken}`,
      ...(opts.headers as Record<string, string> | undefined),
    },
    redirect: 'manual',
  });
}

beforeAll(async () => {
  await ctx.startServer();
  // Passwordless workspace: the global app.ts client-session gate lets it through,
  // so the only auth left standing is the route's requireAuthenticatedClientPortalAuth.
  pwless = seedWorkspace({ clientPassword: '' });
  const user = await createClientUser(
    `deliverables-test-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Deliverables Test Client',
    pwless.workspaceId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(pwless.workspaceId);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(pwless.workspaceId);
  deleteSchemaPlan(pwless.webflowSiteId);
  if (clientUserId) deleteClientUser(clientUserId, pwless.workspaceId);
  pwless?.cleanup();
  await ctx.stopServer();
});

describe('PATCH /api/public/deliverables/:workspaceId/:id/respond auth', () => {
  it('returns 401 unauthenticated on a PASSWORDLESS workspace (route guard, not global gate)', async () => {
    const res = await ctx.api(
      `/api/public/deliverables/${pwless.workspaceId}/cd_nonexistent/respond`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' },
        body: JSON.stringify({ decision: 'approved' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown workspace (requireAuthenticatedClientPortalAuth fails closed)', async () => {
    const res = await ctx.patchJson('/api/public/deliverables/no-such-ws/cd_x/respond', {
      decision: 'approved',
    });
    expect(res.status).toBe(404);
  });

  it('client-JWT request reaches the handler (404 missing deliverable, not catch-all)', async () => {
    const res = await clientFetch(
      `/api/public/deliverables/${pwless.workspaceId}/cd_definitely_missing/respond`,
      { method: 'PATCH', body: JSON.stringify({ decision: 'approved' }) },
    );
    expect(res.status).toBe(404);
  });

  it('rejects an invalid decision value with 400 (Zod validation runs before the handler)', async () => {
    const res = await clientFetch(`/api/public/deliverables/${pwless.workspaceId}/cd_x/respond`, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'banana' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when a schema-plan deliverable is answered during active regeneration', async () => {
    const now = new Date().toISOString();
    const plan: SchemaSitePlan = {
      id: `schema-plan-${pwless.webflowSiteId}`,
      siteId: pwless.webflowSiteId,
      workspaceId: pwless.workspaceId,
      siteUrl: 'https://test.example.com',
      canonicalEntities: [],
      pageRoles: [{
        pagePath: '/',
        pageTitle: 'Home',
        role: 'homepage',
        primaryType: 'Organization',
        entityRefs: [],
      }],
      status: 'sent_to_client',
      generatedAt: now,
      updatedAt: now,
    };
    saveSchemaPlan(plan);
    const deliverable = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'schema_plan',
      kind: 'review',
      status: 'awaiting_client',
      title: 'Schema Strategy Review',
      summary: '1 page, 0 entities for review',
      payload: { siteId: pwless.webflowSiteId, pageRoles: plan.pageRoles, canonicalEntities: [] },
      externalRef: pwless.webflowSiteId,
      sentAt: now,
      generatedAt: now,
      sourceRef: `schema_plan:${pwless.webflowSiteId}`,
    });
    const activeJob = createJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, {
      workspaceId: pwless.workspaceId,
      message: 'Generating schema plan...',
    });

    const res = await clientFetch(
      `/api/public/deliverables/${pwless.workspaceId}/${deliverable.id}/respond`,
      { method: 'PATCH', body: JSON.stringify({ decision: 'approved' }) },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Schema plan generation is in progress. Wait for it to finish before responding to this plan.',
      jobId: activeJob.id,
    });
    expect(getSchemaPlan(pwless.webflowSiteId)?.status).toBe('sent_to_client');
    expect(getDeliverable(deliverable.id)?.status).toBe('awaiting_client');
  });
});

describe('POST /api/deliverables/:workspaceId/:id/remind (admin)', () => {
  it('remind route reaches the handler (404 for a missing deliverable)', async () => {
    // APP_PASSWORD is empty in the test harness, so the admin gate is open; the route's
    // requireWorkspaceAccess passes for a known workspace and the handler 404s on miss.
    const res = await ctx.api(`/api/deliverables/${pwless.workspaceId}/cd_missing/remind`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('writes a deliverable_reminded activity row on a successful remind', async () => {
    // Seed a real awaiting_client deliverable so the handler succeeds.
    const d = upsertDeliverable({
      workspaceId: pwless.workspaceId,
      type: 'redirect',
      kind: 'decision',
      status: 'awaiting_client',
      title: 'Reminder target',
      payload: {},
      sentAt: new Date().toISOString(),
    });

    const res = await ctx.api(`/api/deliverables/${pwless.workspaceId}/${d.id}/remind`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const reminded = listActivity(pwless.workspaceId, 50).find(
      (a) => a.type === 'deliverable_reminded',
    );
    expect(reminded).toBeTruthy();
    expect(reminded!.metadata?.deliverableId).toBe(d.id);
  });
});
