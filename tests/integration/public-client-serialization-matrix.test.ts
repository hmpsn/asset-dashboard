import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createBatch } from '../../server/approvals.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { createClientAction } from '../../server/client-actions.js';
import { createMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import { deleteSchemaPlan, deleteSchemaSnapshot, saveSchemaPlan, saveSchemaSnapshot } from '../../server/schema-store.js';
import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.ts';

const ctx = createTestContext(13356); // port-ok: 13201-13355 already allocated in integration suite
const { api } = ctx;

let workspaceAId = '';
let workspaceBId = '';
let siteAId = '';
let siteBId = '';
let approvalBatchAId = '';
let approvalBatchBId = '';
let contentRequestRequestedAId = '';
let contentRequestDeliveredAId = '';
let contentRequestBId = '';
let clientActionAId = '';
let clientActionBId = '';
let matrixAId = '';
let matrixBId = '';
let hiddenPlannedCellAId = '';

function buildSchemaPlan(
  workspaceId: string,
  siteId: string,
  status: SchemaSitePlan['status'],
): SchemaSitePlan {
  const now = new Date().toISOString();
  return {
    id: `schema-plan-${siteId}-${status}`,
    siteId,
    workspaceId,
    siteUrl: `https://${siteId}.example.test`,
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

function buildSchemaSuggestion(pageId: string, slug: string): SchemaPageSuggestion {
  return {
    pageId,
    pageTitle: slug === '/' ? 'Home' : 'Service',
    slug,
    url: `https://example.test${slug === '/' ? '' : slug}`,
    existingSchemas: [],
    suggestedSchemas: [{
      type: 'Article',
      reason: 'Serialization matrix fixture',
      priority: 'high',
      template: {
        '@context': 'https://schema.org',
        '@graph': [{
          '@type': 'Article',
          headline: slug === '/' ? 'Home Page' : 'Service Page',
          markerSecret: 'schema-template-secret-token',
        }],
      },
    }],
  };
}

beforeAll(async () => {
  await ctx.startServer();

  siteAId = `site_public_matrix_a_${Date.now()}`;
  siteBId = `site_public_matrix_b_${Date.now()}`;

  workspaceAId = createWorkspace('Public Client Serialization Matrix A').id;
  workspaceBId = createWorkspace('Public Client Serialization Matrix B').id;

  updateWorkspace(workspaceAId, {
    webflowSiteId: siteAId,
    clientPortalEnabled: true,
    clientPassword: '',
    tier: 'growth',
    stripeCustomerId: 'cus_matrix_secret',
    stripeSubscriptionId: 'sub_matrix_secret',
  });
  updateWorkspace(workspaceBId, {
    webflowSiteId: siteBId,
    clientPortalEnabled: true,
    clientPassword: '',
  });

  const approvalA = createBatch(workspaceAId, siteAId, 'Matrix A Approval Batch', [{
    pageId: 'page-a-1',
    pageTitle: 'Page A',
    pageSlug: '/page-a',
    field: 'seoTitle',
    currentValue: 'Old A',
    proposedValue: 'New A',
  }]);
  approvalBatchAId = approvalA.id;

  const approvalB = createBatch(workspaceBId, siteBId, 'Matrix B Approval Batch', [{
    pageId: 'page-b-1',
    pageTitle: 'Page B',
    pageSlug: '/page-b',
    field: 'seoDescription',
    currentValue: 'Old B',
    proposedValue: 'New B',
  }]);
  approvalBatchBId = approvalB.id;

  const requestARequested = createContentRequest(workspaceAId, {
    topic: 'Matrix Requested Topic',
    targetKeyword: 'matrix requested keyword',
    intent: 'informational',
    priority: 'medium',
    rationale: 'Requested fixture',
    source: 'client',
  });
  contentRequestRequestedAId = requestARequested.id;

  const requestADelivered = createContentRequest(workspaceAId, {
    topic: 'Matrix Delivered Topic',
    targetKeyword: 'matrix delivered keyword',
    intent: 'transactional',
    priority: 'high',
    rationale: 'Delivered fixture',
    source: 'strategy',
  });
  contentRequestDeliveredAId = requestADelivered.id;
  updateContentRequest(workspaceAId, contentRequestDeliveredAId, {
    status: 'delivered',
    deliveryUrl: 'https://example.test/delivered-topic',
    deliveryNotes: 'Delivered to client for review.',
  });

  contentRequestBId = createContentRequest(workspaceBId, {
    topic: 'Workspace B Topic',
    targetKeyword: 'workspace b keyword',
    intent: 'informational',
    priority: 'low',
    rationale: 'Workspace B fixture',
    source: 'client',
  }).id;

  clientActionAId = createClientAction({
    workspaceId: workspaceAId,
    sourceType: 'content_decay',
    title: 'Refresh Declining Page',
    summary: 'A-side action fixture',
    payload: { targetKeyword: 'matrix delivered keyword' },
  }).id;

  clientActionBId = createClientAction({
    workspaceId: workspaceBId,
    sourceType: 'internal_link',
    title: 'Link Cleanup',
    summary: 'B-side action fixture',
    payload: { links: ['/a', '/b'] },
  }).id;

  const matrixA = createMatrix(workspaceAId, {
    name: 'Matrix A Content Plan',
    templateId: 'tpl_matrix_a',
    dimensions: [{ variableName: 'service', values: ['SEO', 'Content'] }],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} optimization',
  });
  matrixAId = matrixA.id;
  if (matrixA.cells[0]) {
    updateMatrixCell(workspaceAId, matrixA.id, matrixA.cells[0].id, { status: 'review' });
  }
  if (matrixA.cells[1]) {
    hiddenPlannedCellAId = matrixA.cells[1].id;
    updateMatrixCell(workspaceAId, matrixA.id, matrixA.cells[1].id, { status: 'planned' });
  }

  const matrixB = createMatrix(workspaceBId, {
    name: 'Matrix B Content Plan',
    templateId: 'tpl_matrix_b',
    dimensions: [{ variableName: 'service', values: ['Schema'] }],
    urlPattern: '/schema/{service}',
    keywordPattern: '{service} template',
  });
  matrixBId = matrixB.id;
  if (matrixB.cells[0]) {
    updateMatrixCell(workspaceBId, matrixB.id, matrixB.cells[0].id, { status: 'review' });
  }

  saveSchemaSnapshot(siteAId, workspaceAId, [buildSchemaSuggestion('schema-page-a', '/')]);
  saveSchemaSnapshot(siteBId, workspaceBId, [buildSchemaSuggestion('schema-page-b', '/schema')]);
  saveSchemaPlan(buildSchemaPlan(workspaceAId, siteAId, 'sent_to_client'));
  saveSchemaPlan(buildSchemaPlan(workspaceBId, siteBId, 'sent_to_client'));
}, 30_000);

afterAll(async () => {
  deleteSchemaPlan(siteAId);
  deleteSchemaPlan(siteBId);
  deleteSchemaSnapshot(siteAId);
  deleteSchemaSnapshot(siteBId);
  if (workspaceAId) deleteWorkspace(workspaceAId);
  if (workspaceBId) deleteWorkspace(workspaceBId);
  await ctx.stopServer();
});

describe('public/client serialization contract matrix', () => {
  it('public workspace read exposes client-safe fields and strips sensitive admin fields', async () => {
    const res = await api(`/api/public/workspace/${workspaceAId}`);
    expect(res.status).toBe(200);
    const workspace = await res.json() as Record<string, unknown>;

    expect(workspace.id).toBe(workspaceAId);
    expect(workspace.name).toBe('Public Client Serialization Matrix A');
    expect(workspace.tier).toBe('growth');
    expect(workspace.baseTier).toBe('growth');
    expect(workspace.clientPortalEnabled).toBe(true);
    expect(workspace.requiresPassword).toBe(false);
    expect(typeof workspace.stripeEnabled).toBe('boolean');
    expect(workspace.billingMode).toBe('platform');

    expect(workspace.webflowToken).toBeUndefined();
    expect(workspace.clientPassword).toBeUndefined();
    expect(workspace.stripeCustomerId).toBeUndefined();
    expect(workspace.stripeSubscriptionId).toBeUndefined();
    expect(workspace.portalContacts).toBeUndefined();
    expect(workspace.knowledgeBase).toBeUndefined();
  });

  it('public intelligence read stays client-safe and never leaks workspace secrets', async () => {
    const res = await api(`/api/public/intelligence/${workspaceAId}`);
    expect(res.status).toBe(200);
    const intelligence = await res.json() as Record<string, unknown>;

    expect(intelligence.workspaceId).toBe(workspaceAId);
    expect(intelligence.tier).toBe('growth');
    expect(intelligence.assembledAt).toBeTypeOf('string');
    expect('insightsSummary' in intelligence).toBe(true);
    expect('pipelineStatus' in intelligence).toBe(true);
    expect('learningHighlights' in intelligence).toBe(true);

    expect(intelligence.webflowToken).toBeUndefined();
    expect(intelligence.clientPassword).toBeUndefined();
    expect(intelligence.stripeCustomerId).toBeUndefined();
    expect(intelligence.stripeSubscriptionId).toBeUndefined();
    expect(intelligence.eventConfig).toBeUndefined();
    expect(intelligence.eventGroups).toBeUndefined();
  });

  it('public approvals read stays workspace-scoped and exposes approval item essentials', async () => {
    const res = await api(`/api/public/approvals/${workspaceAId}`);
    expect(res.status).toBe(200);
    const batches = await res.json() as Array<Record<string, unknown>>;

    expect(Array.isArray(batches)).toBe(true);
    expect(batches.some(batch => batch.id === approvalBatchAId)).toBe(true);
    expect(batches.some(batch => batch.id === approvalBatchBId)).toBe(false);

    const batch = batches.find(item => item.id === approvalBatchAId);
    expect(batch).toBeDefined();
    expect(Array.isArray(batch?.items)).toBe(true);
    const item = (batch?.items as Array<Record<string, unknown>>)[0];
    expect(item).toMatchObject({
      pageId: 'page-a-1',
      pageSlug: '/page-a',
      pageTitle: 'Page A',
      field: 'seoTitle',
      status: 'pending',
    });
    expect(item.workspaceId).toBeUndefined();
    expect(item.webflowToken).toBeUndefined();
    expect(item.clientPassword).toBeUndefined();
  });

  it('public content request read includes delivery fields only for delivered rows', async () => {
    const res = await api(`/api/public/content-requests/${workspaceAId}`);
    expect(res.status).toBe(200);
    const requests = await res.json() as Array<Record<string, unknown>>;

    const requested = requests.find(item => item.id === contentRequestRequestedAId);
    const delivered = requests.find(item => item.id === contentRequestDeliveredAId);

    expect(requested).toBeDefined();
    expect(delivered).toBeDefined();

    expect(requested?.status).toBe('requested');
    expect(requested?.deliveryUrl).toBeUndefined();
    expect(requested?.deliveryNotes).toBeUndefined();

    expect(delivered?.status).toBe('delivered');
    expect(delivered?.deliveryUrl).toBe('https://example.test/delivered-topic');
    expect(delivered?.deliveryNotes).toBe('Delivered to client for review.');

    expect(requests.some(item => item.id === contentRequestBId)).toBe(false);
    for (const row of requests) {
      expect(row.workspaceId).toBeUndefined();
      expect(row.internalNote).toBeUndefined();
      expect(row.declineReason).toBeUndefined();
    }
  });

  it('public client action read is scoped and preserves response payload fields', async () => {
    const resA = await api(`/api/public/client-actions/${workspaceAId}`);
    expect(resA.status).toBe(200);
    const actionsA = await resA.json() as Array<Record<string, unknown>>;

    expect(actionsA.some(action => action.id === clientActionAId)).toBe(true);
    expect(actionsA.some(action => action.id === clientActionBId)).toBe(false);

    const actionA = actionsA.find(action => action.id === clientActionAId);
    expect(actionA).toMatchObject({
      id: clientActionAId,
      status: 'pending',
      sourceType: 'content_decay',
      title: 'Refresh Declining Page',
    });
    expect(typeof actionA?.payload).toBe('object');
  });

  it('public content plan list/detail expose only client-visible cell states', async () => {
    const listRes = await api(`/api/public/content-plan/${workspaceAId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as Array<Record<string, unknown>>;

    const plan = list.find(item => item.id === matrixAId);
    expect(plan).toBeDefined();
    expect(Array.isArray(plan?.cells)).toBe(true);

    const cells = plan?.cells as Array<Record<string, unknown>>;
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some(cell => cell.id === hiddenPlannedCellAId)).toBe(false);
    for (const cell of cells) {
      expect(['review', 'flagged', 'approved', 'published']).toContain(String(cell.status));
      expect(cell.hasBrief).toBeDefined();
      expect(cell.hasPost).toBeDefined();
      expect(cell.template).toBeUndefined();
    }

    const detailRes = await api(`/api/public/content-plan/${workspaceAId}/${matrixAId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as Record<string, unknown>;
    expect(detail.id).toBe(matrixAId);
    expect(detail.templateName).toBeNull();
    expect(detail.templatePageType).toBeNull();
    expect(detail.templateId).toBeUndefined();
  });

  it('public schema snapshot read returns simplified page rows only', async () => {
    const res = await api(`/api/public/schema-snapshot/${workspaceAId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.pageCount).toBe(1);
    expect(Array.isArray(body.pages)).toBe(true);
    const page = (body.pages as Array<Record<string, unknown>>)[0];
    expect(page).toMatchObject({
      pageId: 'schema-page-a',
      pageTitle: 'Home',
      slug: '/',
      url: 'https://example.test',
    });
    expect(Array.isArray(page.schemaTypes)).toBe(true);
    expect((page.schemaTypes as string[]).includes('Article')).toBe(true);
    expect(page.suggestedSchemas).toBeUndefined();
    expect(page.template).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('schema-template-secret-token');
  });

  it('public schema plan read returns sent plans and hides drafts', async () => {
    const sentRes = await api(`/api/public/schema-plan/${workspaceAId}`);
    expect(sentRes.status).toBe(200);
    const sentPlan = await sentRes.json() as Record<string, unknown>;

    expect(sentPlan.id).toBe(`schema-plan-${siteAId}-sent_to_client`);
    expect(sentPlan.status).toBe('sent_to_client');
    expect(Array.isArray(sentPlan.pageRoles)).toBe(true);

    saveSchemaPlan(buildSchemaPlan(workspaceAId, siteAId, 'draft'));

    const draftRes = await api(`/api/public/schema-plan/${workspaceAId}`);
    expect(draftRes.status).toBe(200);
    const draftBody = await draftRes.json();
    expect(draftBody).toBeNull();
  });

  it('workspace B public endpoints never include workspace A records', async () => {
    const [approvalsRes, requestsRes, actionsRes, contentPlanRes, schemaSnapshotRes] = await Promise.all([
      api(`/api/public/approvals/${workspaceBId}`),
      api(`/api/public/content-requests/${workspaceBId}`),
      api(`/api/public/client-actions/${workspaceBId}`),
      api(`/api/public/content-plan/${workspaceBId}`),
      api(`/api/public/schema-snapshot/${workspaceBId}`),
    ]);

    expect(approvalsRes.status).toBe(200);
    expect(requestsRes.status).toBe(200);
    expect(actionsRes.status).toBe(200);
    expect(contentPlanRes.status).toBe(200);
    expect(schemaSnapshotRes.status).toBe(200);

    const approvals = await approvalsRes.json() as Array<Record<string, unknown>>;
    const requests = await requestsRes.json() as Array<Record<string, unknown>>;
    const actions = await actionsRes.json() as Array<Record<string, unknown>>;
    const plans = await contentPlanRes.json() as Array<Record<string, unknown>>;
    const schemaSnapshot = await schemaSnapshotRes.json() as Record<string, unknown>;

    expect(approvals.some(row => row.id === approvalBatchAId)).toBe(false);
    expect(requests.some(row => row.id === contentRequestRequestedAId || row.id === contentRequestDeliveredAId)).toBe(false);
    expect(actions.some(row => row.id === clientActionAId)).toBe(false);
    expect(plans.some(row => row.id === matrixAId)).toBe(false);
    expect(JSON.stringify(schemaSnapshot)).not.toContain('schema-page-a');
  });
});
