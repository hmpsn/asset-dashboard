import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{
    workspaceId: string;
    event: string;
    payload: Record<string, unknown>;
  }>,
}));

const webflowState = vi.hoisted(() => ({
  publishSchemaCalls: [] as Array<{ siteId: string; pageId: string; schema: Record<string, unknown>; token?: string }>,
  retractSchemaCalls: [] as Array<{ siteId: string; pageId: string; token?: string }>,
  publishSiteCalls: [] as Array<{ siteId: string; token?: string }>,
  publishSchemaResult: {
    success: true,
    published: true,
    delivery: { method: 'webflow-api', status: 'published', jsonLd: '{}' },
  } as {
    success: boolean;
    published?: boolean;
    error?: string;
    delivery: { method: string; status: string; jsonLd?: string; message?: string };
  },
  retractSchemaResult: { success: true, removed: 1 } as { success: boolean; removed: number; error?: string },
  publishSiteResult: { success: true } as { success: boolean; error?: string },
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyApprovalReady: vi.fn(),
  };
});

vi.mock('../../server/webflow.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    publishSchemaToPage: async (
      siteId: string,
      pageId: string,
      schema: Record<string, unknown>,
      token?: string,
    ) => {
      webflowState.publishSchemaCalls.push({ siteId, pageId, schema, token });
      return webflowState.publishSchemaResult;
    },
    retractSchemaFromPage: async (siteId: string, pageId: string, token?: string) => {
      webflowState.retractSchemaCalls.push({ siteId, pageId, token });
      return webflowState.retractSchemaResult;
    },
    publishSite: async (siteId: string, token?: string) => {
      webflowState.publishSiteCalls.push({ siteId, token });
      return webflowState.publishSiteResult;
    },
  };
});

vi.mock('../../server/llms-txt-generator.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/llms-txt-generator.js')>();
  return {
    ...actual,
    queueLlmsTxtRegeneration: vi.fn(),
  };
});

import db from '../../server/db/index.js';
import {
  deleteSchemaPlan,
  deleteSchemaSnapshot,
  getSchemaPlan,
  getSchemaPublishHistory,
  getSchemaSnapshot,
  recordSchemaPublish,
  saveSchemaPlan,
  saveSchemaSnapshot,
} from '../../server/schema-store.js';
import { createWorkspace, deleteWorkspace, getPageState, updateWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';
let otherWorkspaceId = '';
const siteId = `schema_mutation_${randomUUID().slice(0, 8)}`;
const otherSiteId = `schema_mutation_other_${randomUUID().slice(0, 8)}`;
const pageId = `page_schema_mutation_${randomUUID().slice(0, 8)}`;
const originalAppPassword = process.env.APP_PASSWORD;

const validSchema: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Mutation Safety Schema',
  datePublished: '2026-01-01',
  author: { '@type': 'Person', name: 'Schema Tester' },
  image: 'https://example.test/schema.jpg',
};

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

function workspaceQuery(wsId = workspaceId): string {
  return `?workspaceId=${encodeURIComponent(wsId)}`;
}

function buildPlan(status: SchemaSitePlan['status'] = 'draft'): SchemaSitePlan {
  const now = new Date().toISOString();
  return {
    id: `schema-plan-${siteId}`,
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

function buildSnapshotResult(id = pageId, schema: Record<string, unknown> = validSchema): SchemaPageSuggestion {
  return {
    pageId: id,
    pageTitle: 'Schema Mutation Page',
    slug: 'schema-mutation',
    publishedPath: '/schema-mutation',
    url: 'https://example.test/schema-mutation',
    existingSchemas: [],
    suggestedSchemas: [{
      type: 'Article',
      reason: 'Mutation safety fixture',
      priority: 'high',
      template: schema,
    }],
  };
}

function seedSnapshot(schema: Record<string, unknown> = validSchema): void {
  saveSchemaSnapshot(siteId, workspaceId, [buildSnapshotResult(pageId, schema)]);
}

function schemaBroadcasts(event: string) {
  return broadcastState.calls.filter(call => call.event === event);
}

function countActivities(type: string, title?: string): number {
  const row = title
    ? db.prepare(`
        SELECT COALESCE(COUNT(*), 0) AS count
        FROM activity_log
        WHERE workspace_id = ?
          AND type = ?
          AND title = ?
      `).get(workspaceId, type, title) as { count: number }
    : db.prepare(`
        SELECT COALESCE(COUNT(*), 0) AS count
        FROM activity_log
        WHERE workspace_id = ?
          AND type = ?
      `).get(workspaceId, type) as { count: number };
  return row.count;
}

function countPublishHistory(id = pageId): number {
  return getSchemaPublishHistory(siteId, id, 20).length;
}

function resetSchemaState(): void {
  broadcastState.calls = [];
  webflowState.publishSchemaCalls = [];
  webflowState.retractSchemaCalls = [];
  webflowState.publishSiteCalls = [];
  webflowState.publishSchemaResult = {
    success: true,
    published: true,
    delivery: { method: 'webflow-api', status: 'published', jsonLd: '{}' },
  };
  webflowState.retractSchemaResult = { success: true, removed: 1 };
  webflowState.publishSiteResult = { success: true };

  deleteSchemaPlan(siteId);
  deleteSchemaSnapshot(siteId);
  db.prepare('DELETE FROM schema_publish_history WHERE site_id = ?').run(siteId);
  db.prepare('DELETE FROM schema_validations WHERE workspace_id IN (?, ?)').run(workspaceId, otherWorkspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(workspaceId, otherWorkspaceId);
  db.prepare('DELETE FROM page_edit_states WHERE workspace_id IN (?, ?)').run(workspaceId, otherWorkspaceId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id IN (?, ?)').run(workspaceId, otherWorkspaceId);
  db.prepare('DELETE FROM seo_changes WHERE workspace_id IN (?, ?)').run(workspaceId, otherWorkspaceId);
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Schema Mutation Safety', siteId);
  workspaceId = ws.id;
  updateWorkspace(workspaceId, {
    webflowToken: 'schema-mutation-token',
    liveDomain: 'example.test',
  });
  const other = createWorkspace('Schema Mutation Safety Other', otherSiteId);
  otherWorkspaceId = other.id;
}, 25_000);

beforeEach(() => {
  resetSchemaState();
});

afterAll(async () => {
  resetSchemaState();
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('schema mutation safety', () => {
  it('sends a schema plan to the client with status, activity, broadcast, and public read-path updates', async () => {
    saveSchemaPlan(buildPlan('draft'));

    const res = await postJson(`/api/webflow/schema-plan/${siteId}/send-to-client${workspaceQuery()}`, {});

    expect(res.status).toBe(200);
    const body = await res.json() as { plan: SchemaSitePlan };
    expect(body.plan.status).toBe('sent_to_client');
    expect(getSchemaPlan(siteId)?.status).toBe('sent_to_client');
    expect(countActivities('schema_plan_sent', 'Schema strategy sent to client for review')).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_PLAN_SENT)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_PLAN_SENT,
        payload: { siteId },
      },
    ]);

    const publicRes = await api(`/api/public/schema-plan/${workspaceId}`);
    expect(publicRes.status).toBe(200);
    const publicPlan = await publicRes.json() as SchemaSitePlan;
    expect(publicPlan.status).toBe('sent_to_client');
  });

  it('records approve and request-changes feedback with schema-plan broadcasts', async () => {
    saveSchemaPlan(buildPlan('sent_to_client'));

    const approveRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'approve',
      note: 'Approved for rollout.',
    });

    expect(approveRes.status).toBe(200);
    expect(getSchemaPlan(siteId)?.status).toBe('client_approved');
    expect(countActivities('changes_requested', 'Client approved schema plan')).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_PLAN_SENT)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_PLAN_SENT,
        payload: {
          siteId,
          action: 'schema_plan_feedback',
          status: 'client_approved',
        },
      },
    ]);

    broadcastState.calls = [];
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
    saveSchemaPlan(buildPlan('sent_to_client'));

    const changesRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'request_changes',
      note: 'Please revisit the service pages.',
    });

    expect(changesRes.status).toBe(200);
    expect(getSchemaPlan(siteId)?.status).toBe('client_changes_requested');
    expect(countActivities('changes_requested', 'Client requested changes on schema plan')).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_PLAN_SENT)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_PLAN_SENT,
        payload: {
          siteId,
          action: 'schema_plan_feedback',
          status: 'client_changes_requested',
        },
      },
    ]);
  });

  it('rejects invalid or missing schema-plan feedback without side effects', async () => {
    saveSchemaPlan(buildPlan('sent_to_client'));

    const invalidRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'publish_now',
      note: 'Invalid action.',
    });

    expect(invalidRes.status).toBe(400);
    expect(getSchemaPlan(siteId)?.status).toBe('sent_to_client');
    expect(countActivities('changes_requested')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);

    deleteSchemaPlan(siteId);
    const missingRes = await postJson(`/api/public/schema-plan/${workspaceId}/feedback`, {
      action: 'approve',
    });

    expect(missingRes.status).toBe(404);
    expect(countActivities('changes_requested')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('publishes schema only after Webflow success and records snapshot, page-state, activity, history, and broadcast side effects', async () => {
    seedSnapshot();

    const res = await postJson(`/api/webflow/schema-publish/${siteId}${workspaceQuery()}`, {
      pageId,
      schema: { ...validSchema, headline: 'Updated Schema Headline' },
      publishAfter: true,
      skipValidation: true,
      pageSlug: 'schema-mutation',
      pageTitle: 'Schema Mutation Page',
    });

    expect(res.status).toBe(200);
    expect(webflowState.publishSchemaCalls).toEqual([
      {
        siteId,
        pageId,
        schema: { ...validSchema, headline: 'Updated Schema Headline' },
        token: 'schema-mutation-token',
      },
    ]);
    expect(webflowState.publishSiteCalls).toEqual([{ siteId, token: 'schema-mutation-token' }]);
    expect(getSchemaSnapshot(siteId)?.results[0].suggestedSchemas[0].template).toMatchObject({
      headline: 'Updated Schema Headline',
    });
    expect(getPageState(workspaceId, pageId)).toMatchObject({
      status: 'live',
      source: 'schema',
      fields: ['schema'],
      updatedBy: 'admin',
    });
    expect(countActivities('schema_published', 'Schema published to Webflow')).toBe(1);
    expect(countPublishHistory()).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
        payload: { siteId, action: 'published', pageId },
      },
    ]);
  });

  it('does not record publish side effects when schema validation or schema write fails', async () => {
    seedSnapshot();

    const invalidRes = await postJson(`/api/webflow/schema-publish/${siteId}${workspaceQuery()}`, {
      pageId,
      schema: {
        '@context': 'https://schema.org',
        '@type': 'Article',
      },
    });

    expect(invalidRes.status).toBe(422);
    expect(webflowState.publishSchemaCalls).toHaveLength(0);
    expect(countPublishHistory()).toBe(0);
    expect(getPageState(workspaceId, pageId)).toBeUndefined();
    expect(countActivities('schema_published')).toBe(0);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toHaveLength(0);

    webflowState.publishSchemaResult = {
      success: false,
      error: 'Webflow rejected schema write',
      delivery: { method: 'webflow-api', status: 'failed', jsonLd: '{}' },
    };
    const beforeSnapshot = getSchemaSnapshot(siteId)?.results[0].suggestedSchemas[0].template;

    const failedRes = await postJson(`/api/webflow/schema-publish/${siteId}${workspaceQuery()}`, {
      pageId,
      schema: { ...validSchema, headline: 'Should Not Persist' },
      skipValidation: true,
    });

    expect(failedRes.status).toBe(500);
    expect(getSchemaSnapshot(siteId)?.results[0].suggestedSchemas[0].template).toEqual(beforeSnapshot);
    expect(countPublishHistory()).toBe(0);
    expect(getPageState(workspaceId, pageId)).toBeUndefined();
    expect(countActivities('schema_published')).toBe(0);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toHaveLength(0);
  });

  it('retracts published schema with snapshot, page-state, activity, and broadcast side effects', async () => {
    seedSnapshot();

    const res = await del(`/api/webflow/schema-retract/${siteId}/${pageId}${workspaceQuery()}`);

    expect(res.status).toBe(200);
    expect(webflowState.retractSchemaCalls).toEqual([{ siteId, pageId, token: 'schema-mutation-token' }]);
    expect(getSchemaSnapshot(siteId)?.results.find(result => result.pageId === pageId)).toBeUndefined();
    expect(getPageState(workspaceId, pageId)).toMatchObject({
      status: 'clean',
      source: 'schema',
      fields: ['schema'],
      updatedBy: 'admin',
    });
    expect(countActivities('schema_published', 'Schema retracted from page')).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
        payload: { siteId, action: 'retracted', pageId },
      },
    ]);
  });

  it('does not record retract side effects when Webflow retract fails or the workspace does not own the site', async () => {
    seedSnapshot();
    webflowState.retractSchemaResult = { success: false, removed: 0, error: 'Webflow retract failed' };

    const failedRes = await del(`/api/webflow/schema-retract/${siteId}/${pageId}${workspaceQuery()}`);

    expect(failedRes.status).toBe(500);
    expect(getSchemaSnapshot(siteId)?.results.find(result => result.pageId === pageId)).toBeDefined();
    expect(getPageState(workspaceId, pageId)).toBeUndefined();
    expect(countActivities('schema_published')).toBe(0);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toHaveLength(0);

    const crossWorkspaceRes = await del(
      `/api/webflow/schema-retract/${siteId}/${pageId}${workspaceQuery(otherWorkspaceId)}`,
    );

    expect(crossWorkspaceRes.status).toBe(403);
    expect(webflowState.retractSchemaCalls).toHaveLength(1);
    expect(getSchemaSnapshot(siteId)?.results.find(result => result.pageId === pageId)).toBeDefined();
    expect(getPageState(workspaceId, pageId)).toBeUndefined();
    expect(countActivities('schema_published')).toBe(0);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toHaveLength(0);
  });

  it('deletes a schema plan and snapshot with activity and snapshot invalidation', async () => {
    saveSchemaPlan(buildPlan('sent_to_client'));
    seedSnapshot();

    const res = await del(`/api/webflow/schema-plan/${siteId}${workspaceQuery()}`);

    expect(res.status).toBe(200);
    expect(getSchemaPlan(siteId)).toBeNull();
    expect(getSchemaSnapshot(siteId)).toBeNull();
    expect(countActivities('schema_plan_deleted', 'Schema site plan retracted')).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
        payload: { siteId, action: 'deleted' },
      },
    ]);
  });

  it('rejects missing and cross-workspace schema-plan deletes without side effects', async () => {
    const missingRes = await del(`/api/webflow/schema-plan/${siteId}${workspaceQuery()}`);
    expect(missingRes.status).toBe(404);
    expect(countActivities('schema_plan_deleted')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);

    saveSchemaPlan(buildPlan('sent_to_client'));
    seedSnapshot();

    const crossWorkspaceRes = await del(`/api/webflow/schema-plan/${siteId}${workspaceQuery(otherWorkspaceId)}`);
    expect(crossWorkspaceRes.status).toBe(403);
    expect(getSchemaPlan(siteId)?.status).toBe('sent_to_client');
    expect(getSchemaSnapshot(siteId)).not.toBeNull();
    expect(countActivities('schema_plan_deleted')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rolls back schema history with snapshot, activity, history, and broadcast side effects', async () => {
    seedSnapshot({ ...validSchema, headline: 'Current Schema' });
    const previous = recordSchemaPublish(siteId, pageId, workspaceId, {
      ...validSchema,
      headline: 'Previous Schema',
    });
    broadcastState.calls = [];

    const res = await postJson(`/api/webflow/schema-rollback/${siteId}${workspaceQuery()}`, {
      pageId,
      historyId: previous.id,
    });

    expect(res.status).toBe(200);
    expect(webflowState.publishSchemaCalls).toEqual([
      {
        siteId,
        pageId,
        schema: { ...validSchema, headline: 'Previous Schema' },
        token: 'schema-mutation-token',
      },
    ]);
    expect(getSchemaSnapshot(siteId)?.results[0].suggestedSchemas[0].template).toMatchObject({
      headline: 'Previous Schema',
    });
    expect(countActivities('schema_published', 'Schema rolled back to previous version')).toBe(1);
    expect(countPublishHistory()).toBe(2);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toEqual([
      {
        workspaceId,
        event: WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
        payload: { siteId, action: 'rolled_back', pageId },
      },
    ]);
  });

  it('rejects malformed and cross-page rollback requests without side effects', async () => {
    seedSnapshot({ ...validSchema, headline: 'Current Schema' });
    const previous = recordSchemaPublish(siteId, pageId, workspaceId, {
      ...validSchema,
      headline: 'Previous Schema',
    });
    broadcastState.calls = [];

    const malformedRes = await postJson(`/api/webflow/schema-rollback/${siteId}${workspaceQuery()}`, {
      pageId,
    });

    expect(malformedRes.status).toBe(400);
    expect(webflowState.publishSchemaCalls).toHaveLength(0);
    expect(countActivities('schema_published')).toBe(0);
    expect(countPublishHistory()).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toHaveLength(0);

    const wrongPageRes = await postJson(`/api/webflow/schema-rollback/${siteId}${workspaceQuery()}`, {
      pageId: 'wrong-page',
      historyId: previous.id,
    });

    expect(wrongPageRes.status).toBe(400);
    expect(webflowState.publishSchemaCalls).toHaveLength(0);
    expect(getSchemaSnapshot(siteId)?.results[0].suggestedSchemas[0].template).toMatchObject({
      headline: 'Current Schema',
    });
    expect(countActivities('schema_published')).toBe(0);
    expect(countPublishHistory()).toBe(1);
    expect(schemaBroadcasts(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED)).toHaveLength(0);
  });
});
