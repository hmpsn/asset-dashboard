import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createBatch, updateItem } from '../../server/approvals.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13333); // port-ok: 13201-13332 already allocated in integration suite
const { postJson } = ctx;

let wsId = '';
let schemaBatchId = '';
let cmsBatchId = '';
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

  const cmsBatch = createBatch(wsId, 'site-apply-guard', 'CMS Batch', [{
    pageId: 'cms-item-1',
    pageTitle: 'CMS Item',
    pageSlug: 'cms-item',
    field: 'seoTitle',
    collectionId: 'collection-1',
    currentValue: 'Current',
    proposedValue: 'Proposed',
  }]);
  cmsBatchId = cmsBatch.id;
  updateItem(wsId, cmsBatchId, cmsBatch.items[0].id, { status: 'approved' });
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
    expect(body.error).toContain('Only static page SEO title and meta description');
  });

  it('blocks CMS approval items from client apply even when the field is SEO title', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/${cmsBatchId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Only static page SEO title and meta description');
  });
});
