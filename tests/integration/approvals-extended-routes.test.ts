/**
 * Extended integration tests for approvals API endpoints.
 *
 * Covers paths NOT tested in approvals-routes.test.ts:
 * - GET list for fresh workspace returns empty array
 * - POST remind: no clientEmail → 400
 * - POST remind: no pending items → 400
 * - POST apply: no Webflow site linked → 400
 * - PATCH item with clientValue field
 * - PATCH item reject (status: 'rejected') with clientNote
 * - Public GET list for open workspace (no password) returns 200
 * - Serialized batch fields shape check
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let wsWithEmailId = '';
const originalAppPassword = process.env.APP_PASSWORD;
const testSiteId = 'site_approvals_ext_test';

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
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}

async function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Approvals Extended WS A').id;
  wsWithEmailId = createWorkspace('Approvals Extended Email WS').id;
  updateWorkspace(wsWithEmailId, { clientEmail: 'test-client@example.com' });
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id IN (?, ?)').run(wsId, wsWithEmailId);
  deleteWorkspace(wsId);
  deleteWorkspace(wsWithEmailId);
  await stopTestServer();
});

describe('Approvals extended — GET list on fresh workspace', () => {
  it('GET /api/approvals/:workspaceId returns empty array for new workspace', async () => {
    const res = await get(`/api/approvals/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /api/public/approvals/:workspaceId returns empty array for open workspace', async () => {
    const res = await get(`/api/public/approvals/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('Approvals extended — remind endpoint validation', () => {
  let batchWithEmailId = '';
  let approvedBatchId = '';

  beforeAll(async () => {
    // Create batch in workspace with email (pending items)
    const res = await postJson(`/api/approvals/${wsWithEmailId}`, {
      siteId: testSiteId,
      name: 'Remind Test Batch',
      items: [
        {
          pageId: 'remind_page_1',
          pageSlug: '/remind-page',
          pageTitle: 'Remind Page',
          field: 'seoTitle',
          currentValue: 'Old Title',
          proposedValue: 'New Title',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    batchWithEmailId = body.id;

    // Create another batch and approve all items so remind returns 400 for no pending
    const res2 = await postJson(`/api/approvals/${wsWithEmailId}`, {
      siteId: testSiteId,
      name: 'All Approved Batch',
      items: [
        {
          pageId: 'approved_page_1',
          pageSlug: '/approved-page',
          pageTitle: 'Approved Page',
          field: 'seoTitle',
          currentValue: 'Old',
          proposedValue: 'New',
        },
      ],
    });
    expect(res2.status).toBe(200);
    const batch2 = await res2.json();
    approvedBatchId = batch2.id;
    const itemId = batch2.items[0].id;
    const approveRes = await patchJson(
      `/api/public/approvals/${wsWithEmailId}/${approvedBatchId}/${itemId}`,
      { status: 'approved' },
    );
    expect(approveRes.status).toBe(200);
  });

  afterAll(() => {
    if (batchWithEmailId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchWithEmailId);
    if (approvedBatchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(approvedBatchId);
  });

  it('POST remind with no clientEmail on workspace returns 400', async () => {
    const createRes = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      name: 'No Email Batch',
      items: [
        {
          pageId: 'no_email_page_1',
          pageSlug: '/no-email',
          pageTitle: 'No Email Page',
          field: 'seoTitle',
          currentValue: 'Old',
          proposedValue: 'New',
        },
      ],
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    try {
      const remindRes = await postJson(`/api/approvals/${wsId}/${created.id}/remind`, {});
      expect(remindRes.status).toBe(400);
      const body = await remindRes.json();
      expect(body.error).toMatch(/client email/i);
    } finally {
      db.prepare('DELETE FROM approval_batches WHERE id = ?').run(created.id);
    }
  });

  it('POST remind with missing batch returns 404', async () => {
    const res = await postJson(`/api/approvals/${wsWithEmailId}/batch_does_not_exist/remind`, {});
    expect(res.status).toBe(404);
  });

  it('POST remind with a batch that has no pending items returns 400', async () => {
    const remindRes = await postJson(`/api/approvals/${wsWithEmailId}/${approvedBatchId}/remind`, {});
    expect(remindRes.status).toBe(400);
    const body = await remindRes.json();
    expect(body.error).toMatch(/no pending/i);
  });
});

describe('Approvals extended — apply endpoint without Webflow', () => {
  let batchId = '';
  let itemId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      name: 'Apply Test Batch',
      items: [
        {
          pageId: 'apply_page_1',
          pageSlug: '/apply-page',
          pageTitle: 'Apply Page',
          field: 'seoTitle',
          currentValue: 'Old Apply Title',
          proposedValue: 'New Apply Title',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    batchId = body.id;
    itemId = body.items[0].id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
  });

  it('POST apply before any items are approved returns 400', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/${batchId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('POST apply with approved item but no Webflow site returns 400', async () => {
    const approveRes = await patchJson(
      `/api/public/approvals/${wsId}/${batchId}/${itemId}`,
      { status: 'approved' },
    );
    expect(approveRes.status).toBe(200);

    const applyRes = await postJson(`/api/public/approvals/${wsId}/${batchId}/apply`, {});
    expect(applyRes.status).toBe(400);
    const body = await applyRes.json();
    expect(body.error).toBeTruthy();
  });

  it('POST apply with missing batch returns 404', async () => {
    const res = await postJson(`/api/public/approvals/${wsId}/batch_nonexistent/apply`, {});
    expect(res.status).toBe(404);
  });
});

describe('Approvals extended — item update with clientValue', () => {
  let batchId = '';
  let itemId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      name: 'Client Value Batch',
      items: [
        {
          pageId: 'cv_page_1',
          pageSlug: '/cv-page',
          pageTitle: 'Client Value Page',
          field: 'seoTitle',
          currentValue: 'Old CV Title',
          proposedValue: 'Proposed CV Title',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    batchId = body.id;
    itemId = body.items[0].id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
  });

  it('PATCH item with clientValue stores the override value', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batchId}/${itemId}`,
      { status: 'approved', clientValue: 'My Custom Title Override' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find((i: { id: string }) => i.id === itemId);
    expect(item).toBeDefined();
    expect(item.status).toBe('approved');
    expect(item.clientValue).toBe('My Custom Title Override');
  });
});

describe('Approvals extended — reject item with clientNote', () => {
  let batchId = '';
  let itemId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      name: 'Reject Test Batch',
      items: [
        {
          pageId: 'rej_page_1',
          pageSlug: '/reject-page',
          pageTitle: 'Reject Page',
          field: 'seoDescription',
          currentValue: 'Old description',
          proposedValue: 'New description',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    batchId = body.id;
    itemId = body.items[0].id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
  });

  it('PATCH item with status rejected and clientNote stores rejection note', async () => {
    const res = await patchJson(
      `/api/public/approvals/${wsId}/${batchId}/${itemId}`,
      { status: 'rejected', clientNote: 'The new description is too long.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find((i: { id: string }) => i.id === itemId);
    expect(item).toBeDefined();
    expect(item.status).toBe('rejected');
    expect(item.clientNote).toBe('The new description is too long.');
  });
});

describe('Approvals extended — batch serialization fields', () => {
  let batchId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      name: 'Serialization Test Batch',
      note: 'Check all fields are present',
      items: [
        {
          pageId: 'ser_page_1',
          pageSlug: '/ser-page',
          pageTitle: 'Serialization Page',
          field: 'seoTitle',
          currentValue: 'Old Ser Title',
          proposedValue: 'New Ser Title',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    batchId = body.id;
  });

  afterAll(() => {
    if (batchId) db.prepare('DELETE FROM approval_batches WHERE id = ?').run(batchId);
  });

  it('GET batch returns expected shape with id, name, note, status, items, createdAt', async () => {
    const res = await get(`/api/approvals/${wsId}/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name', 'Serialization Test Batch');
    expect(body).toHaveProperty('note', 'Check all fields are present');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('createdAt');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);

    const item = body.items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('pageId', 'ser_page_1');
    expect(item).toHaveProperty('field', 'seoTitle');
    expect(item).toHaveProperty('status', 'pending');
  });

  it('GET list includes the batch with correct fields', async () => {
    const res = await get(`/api/approvals/${wsId}`);
    expect(res.status).toBe(200);
    const list = await res.json();
    const found = list.find((b: { id: string }) => b.id === batchId);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('name', 'Serialization Test Batch');
    expect(Array.isArray(found.items)).toBe(true);
  });
});

describe('Approvals extended — POST validation additional cases', () => {
  it('POST with empty items array returns 400', async () => {
    const res = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      name: 'Empty Items Batch',
      items: [],
    });
    expect(res.status).toBe(400);
  });

  it('POST with note too long returns 400', async () => {
    const res = await postJson(`/api/approvals/${wsId}`, {
      siteId: testSiteId,
      items: [
        {
          pageId: 'long_note_page',
          field: 'seoTitle',
          currentValue: 'Old',
          proposedValue: 'New',
        },
      ],
      note: 'x'.repeat(2001),
    });
    expect(res.status).toBe(400);
  });
});
