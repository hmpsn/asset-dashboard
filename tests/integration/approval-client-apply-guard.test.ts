import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createBatch, getBatch, updateItem } from '../../server/approvals.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13333); // port-ok: 13201-13332 already allocated in integration suite
const { postJson } = ctx;

let wsId = '';
let schemaBatchId = '';
let syntheticCmsBatchId = '';
let nonSeoCmsBatchId = '';
let pendingBatchId = '';
let savedWebflowToken: string | undefined;

beforeAll(async () => {
  savedWebflowToken = process.env.WEBFLOW_API_TOKEN;
  process.env.WEBFLOW_API_TOKEN = 'fake-webflow-token-for-guard-test';
  await ctx.startServer();
  if (savedWebflowToken === undefined) delete process.env.WEBFLOW_API_TOKEN;
  else process.env.WEBFLOW_API_TOKEN = savedWebflowToken;

  const ws = createWorkspace('Approval Apply Guard', 'site-apply-guard');
  wsId = ws.id;

  const schemaBatch = createBatch(wsId, 'site-apply-guard', 'Schema Batch', [{
    pageId: 'page-static-1',
    pageTitle: 'Static Page',
    pageSlug: 'static-page',
    field: 'schemaJson',
    currentValue: '{}',
    proposedValue: '{"@type":"FAQPage"}',
  }]);
  schemaBatchId = schemaBatch.id;
  updateItem(wsId, schemaBatchId, schemaBatch.items[0].id, { status: 'approved' });

  const syntheticCmsBatch = createBatch(wsId, 'site-apply-guard', 'Synthetic CMS Batch', [{
    pageId: 'cms-item-1',
    pageTitle: 'CMS Item',
    pageSlug: 'cms-item',
    field: 'seoTitle',
    collectionId: 'collection-1',
    currentValue: 'Current',
    proposedValue: 'Proposed',
  }]);
  syntheticCmsBatchId = syntheticCmsBatch.id;
  updateItem(wsId, syntheticCmsBatchId, syntheticCmsBatch.items[0].id, { status: 'approved' });

  const nonSeoCmsBatch = createBatch(wsId, 'site-apply-guard', 'CMS Non-SEO Batch', [{
    pageId: 'real-cms-item-1',
    pageTitle: 'CMS Item',
    pageSlug: 'cms-item',
    field: 'slug',
    collectionId: 'collection-1',
    currentValue: 'current-slug',
    proposedValue: 'proposed-slug',
  }]);
  nonSeoCmsBatchId = nonSeoCmsBatch.id;
  updateItem(wsId, nonSeoCmsBatchId, nonSeoCmsBatch.items[0].id, { status: 'approved' });

  const pendingBatch = createBatch(wsId, 'site-apply-guard', 'Pending Batch', [{
    pageId: 'page-static-pending',
    pageTitle: 'Pending Static Page',
    pageSlug: 'pending-static-page',
    field: 'seoTitle',
    currentValue: 'Current',
    proposedValue: 'Proposed',
  }]);
  pendingBatchId = pendingBatch.id;
});

afterAll(async () => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('public approval apply guard', () => {
  it('blocks non-static SEO approval items from client apply', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/${schemaBatchId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('real CMS item approvals');

    const batch = getBatch(wsId, schemaBatchId);
    expect(batch?.status).toBe('approved');
    expect(batch?.items[0].status).toBe('approved');
  });

  it('blocks synthetic CMS approval items even when collection metadata is present', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/${syntheticCmsBatchId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('real CMS item approvals');

    const batch = getBatch(wsId, syntheticCmsBatchId);
    expect(batch?.status).toBe('approved');
    expect(batch?.items[0].status).toBe('approved');
  });

  it('blocks real CMS approval items for non-SEO collection fields', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/${nonSeoCmsBatchId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('real CMS item approvals');

    const batch = getBatch(wsId, nonSeoCmsBatchId);
    expect(batch?.status).toBe('approved');
    expect(batch?.items[0].status).toBe('approved');
  });

  it('does not mutate pending items when there are no approved items to apply', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/${pendingBatchId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No approved items to apply');

    const batch = getBatch(wsId, pendingBatchId);
    expect(batch?.status).toBe('pending');
    expect(batch?.items[0].status).toBe('pending');
  });
});
