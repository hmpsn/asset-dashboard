/**
 * Integration tests — Content Plan Review lifecycle.
 *
 * Covers:
 *  - Public GET list (empty, populated, workspace isolation)
 *  - Public GET single matrix (found, not found, null for no client-visible cells)
 *  - Admin send-template-review (creates approval batch, broadcasts, 404s)
 *  - Admin send-samples (creates batch, updates cell status to review, broadcasts, 404s)
 *  - Admin batch-approve (moves planned/keyword_validated cells to approved, broadcasts)
 *  - Client flag cell (sets flagged status, broadcasts)
 *  - Workspace isolation across all public paths
 *
 * Uses in-process server with dynamic port 0 so vi.mock works reliably.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Mocks (must be declared before any server import) ────────────────────────

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: emailMock.sendEmail,
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

// ── Server bootstrap ─────────────────────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import { createTemplate } from '../../server/content-templates.js';
import db from '../../server/db/index.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

let baseUrl = '';
let server: http.Server | undefined;

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
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

function postJson(path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
}

function countActivityMatching(workspaceId: string, action: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND metadata LIKE ?
  `).get(workspaceId, `%"action":"${action}"%`) as { count: number };
  return row.count;
}

function countDeliverablesByType(workspaceId: string, type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM client_deliverable
    WHERE workspace_id = ?
      AND type = ?
  `).get(workspaceId, type) as { count: number };
  return row.count;
}

// ── Test data ─────────────────────────────────────────────────────────────────

/** Minimal matrix payload: 1 service × 2 cities = 2 cells, all starting as 'planned'. */
const MATRIX_PAYLOAD = {
  name: 'Review Lifecycle Matrix',
  templateId: 'tpl_review_placeholder',
  dimensions: [
    { variableName: 'service', values: ['Plumbing'] },
    { variableName: 'city', values: ['Austin', 'Dallas'] },
  ],
  urlPattern: '/services/{city}/{service}',
  keywordPattern: '{service} in {city}',
};

// ── Workspace state ──────────────────────────────────────────────────────────

let wsA = '';
let wsB = '';

beforeAll(async () => {
  await startTestServer();
  wsA = createWorkspace('Content Plan Review WS-A').id;
  wsB = createWorkspace('Content Plan Review WS-B').id;
}, 60_000);

afterAll(async () => {
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await stopTestServer();
});

beforeEach(() => {
  broadcastState.calls = [];
  emailMock.sendEmail.mockClear();
});

// ════════════════════════════════════════════════════════════════════════════
// Public GET /api/public/content-plan/:workspaceId — list
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/content-plan/:workspaceId — list', () => {
  let freshWs = '';

  beforeAll(() => {
    freshWs = createWorkspace('Content Plan Review Public List WS').id;
  });

  afterAll(() => {
    deleteWorkspace(freshWs);
  });

  it('returns 200 with empty array for a fresh workspace (no client-visible cells)', async () => {
    const res = await getJson(`/api/public/content-plan/${freshWs}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('returns 200 with empty array when matrix exists but all cells are in "planned" status (not client-visible)', async () => {
    // All cells start as 'planned' which is NOT in CLIENT_VISIBLE_CELL_STATUSES
    createMatrix(freshWs, {
      name: 'Hidden Matrix',
      templateId: 'tpl_hidden',
      dimensions: [{ variableName: 'city', values: ['Portland'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });

    const res = await getJson(`/api/public/content-plan/${freshWs}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Matrices with only planned cells are filtered out by the server
    expect(body.length).toBe(0);
  });

  it('returns 404 for a nonexistent workspace', async () => {
    const res = await getJson('/api/public/content-plan/ws_nonexistent_review_xyz');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns matrix in list after cells are promoted to client-visible status', async () => {
    const reviewWs = createWorkspace('Content Plan Review Visible WS').id;
    try {
      // Create template + matrix, then promote a cell to 'review' status via the API
      const tpl = createTemplate(reviewWs, {
        name: 'Visible Template',
        pageType: 'service',
        urlPattern: '/services/{city}',
        keywordPattern: 'plumber in {city}',
      });
      const matrix = createMatrix(reviewWs, {
        name: 'Visible Matrix',
        templateId: tpl.id,
        dimensions: [{ variableName: 'city', values: ['Chicago'] }],
        urlPattern: '/services/{city}',
        keywordPattern: 'plumber in {city}',
      });

      // Use send-samples endpoint to promote cell(s) to 'review' status
      const cellId = matrix.cells[0].id;
      const sendRes = await postJson(
        `/api/content-plan/${reviewWs}/${matrix.id}/send-samples`,
        { cellIds: [cellId] },
      );
      expect(sendRes.status).toBe(200);

      const listRes = await getJson(`/api/public/content-plan/${reviewWs}`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(1);

      const found = list.find((m: { id: string }) => m.id === matrix.id);
      expect(found).toBeDefined();
      expect(found.name).toBe('Visible Matrix');
      expect(Array.isArray(found.cells)).toBe(true);
    } finally {
      deleteWorkspace(reviewWs);
    }
  });

  it('public list response shape includes required fields', async () => {
    const shapeWs = createWorkspace('Content Plan Review Shape WS').id;
    try {
      const tpl = createTemplate(shapeWs, {
        name: 'Shape Template',
        pageType: 'service',
        urlPattern: '/services/{city}',
        keywordPattern: 'plumber in {city}',
      });
      const matrix = createMatrix(shapeWs, {
        name: 'Shape Matrix',
        templateId: tpl.id,
        dimensions: [{ variableName: 'city', values: ['Denver'] }],
        urlPattern: '/services/{city}',
        keywordPattern: 'plumber in {city}',
      });

      // Promote cell to review
      await postJson(
        `/api/content-plan/${shapeWs}/${matrix.id}/send-samples`,
        { cellIds: [matrix.cells[0].id] },
      );

      const res = await getJson(`/api/public/content-plan/${shapeWs}`);
      const [item] = await res.json();
      expect(item.id).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.stats).toBeDefined();
      expect(item.dimensions).toBeDefined();
      expect(Array.isArray(item.cells)).toBe(true);
      expect(item.createdAt).toBeDefined();
      // Admin-internal fields must NOT be present
      expect(item.workspaceId).toBeUndefined();
    } finally {
      deleteWorkspace(shapeWs);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Public GET /api/public/content-plan/:workspaceId/:matrixId — single matrix
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/content-plan/:workspaceId/:matrixId — single', () => {
  let singleWs = '';
  let matrixWithCells = '';
  let matrixAllPlanned = '';

  beforeAll(async () => {
    singleWs = createWorkspace('Content Plan Review Single WS').id;

    // Matrix with cells promoted to 'review' (client-visible)
    const tpl = createTemplate(singleWs, {
      name: 'Single Test Template',
      pageType: 'service',
      sections: [{ headingTemplate: 'About {service}', wordCountTarget: 400 }] as Parameters<typeof createTemplate>[1]['sections'],
    });
    const mx = createMatrix(singleWs, {
      name: 'Single Visible Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Seattle'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });
    matrixWithCells = mx.id;

    // Promote cells to review so they become client-visible
    const sendRes = await postJson(
      `/api/content-plan/${singleWs}/${mx.id}/send-samples`,
      { cellIds: [mx.cells[0].id] },
    );
    expect(sendRes.status).toBe(200);

    // A matrix where all cells remain 'planned' (not client-visible)
    const mx2 = createMatrix(singleWs, {
      name: 'All Planned Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Phoenix'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });
    matrixAllPlanned = mx2.id;
  });

  afterAll(() => {
    deleteWorkspace(singleWs);
  });

  it('returns 200 with matrix data when client-visible cells exist', async () => {
    const res = await getJson(`/api/public/content-plan/${singleWs}/${matrixWithCells}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.id).toBe(matrixWithCells);
    expect(body.name).toBe('Single Visible Matrix');
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.cells.length).toBeGreaterThan(0);
  });

  it('returns null (200) when matrix has no client-visible cells', async () => {
    const res = await getJson(`/api/public/content-plan/${singleWs}/${matrixAllPlanned}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Route returns res.json(null) when cells are all filtered out
    expect(body).toBeNull();
  });

  it('returns 404 for a nonexistent matrixId', async () => {
    const res = await getJson(`/api/public/content-plan/${singleWs}/mtx_nonexistent_review_999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('single-matrix response shape includes templateName and templatePageType', async () => {
    const res = await getJson(`/api/public/content-plan/${singleWs}/${matrixWithCells}`);
    const body = await res.json();
    expect(body).not.toBeNull();
    // templateName may be null if template not found, but the key must be present
    expect('templateName' in body).toBe(true);
    expect('templatePageType' in body).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Workspace isolation — public paths
// ════════════════════════════════════════════════════════════════════════════

describe('Workspace isolation — public content plan paths', () => {
  let isoWsA = '';
  let isoWsB = '';
  let isoMatrixId = '';

  beforeAll(async () => {
    isoWsA = createWorkspace('Content Plan Review Iso WS-A').id;
    isoWsB = createWorkspace('Content Plan Review Iso WS-B').id;

    const tpl = createTemplate(isoWsA, {
      name: 'Iso Template',
      pageType: 'service',
    });
    const mx = createMatrix(isoWsA, {
      name: 'Iso Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Miami'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });
    isoMatrixId = mx.id;

    // Promote cells so matrix is visible on wsA
    await postJson(
      `/api/content-plan/${isoWsA}/${mx.id}/send-samples`,
      { cellIds: [mx.cells[0].id] },
    );
  });

  afterAll(() => {
    deleteWorkspace(isoWsA);
    deleteWorkspace(isoWsB);
  });

  it('matrix from wsA not visible in wsB public list', async () => {
    const res = await getJson(`/api/public/content-plan/${isoWsB}`);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.some((m: { id: string }) => m.id === isoMatrixId)).toBe(false);
  });

  it('wsA matrixId returns 404 via wsB public single-matrix path', async () => {
    const res = await getJson(`/api/public/content-plan/${isoWsB}/${isoMatrixId}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Admin POST send-template-review
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content-plan/:workspaceId/:matrixId/send-template-review', () => {
  let adminWs = '';
  let matrixId = '';
  let templateId = '';

  beforeAll(async () => {
    adminWs = createWorkspace('Content Plan Review Admin Template WS').id;

    const tpl = createTemplate(adminWs, {
      name: 'Admin Template',
      pageType: 'service',
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
      sections: [
        { headingTemplate: 'Why Choose Us for {service}', wordCountTarget: 500 },
        { headingTemplate: '{service} Services in {city}', wordCountTarget: 300 },
      ] as Parameters<typeof createTemplate>[1]['sections'],
      variables: [{ name: 'city' }, { name: 'service' }] as Parameters<typeof createTemplate>[1]['variables'],
      toneAndStyle: 'Professional and friendly',
    });
    templateId = tpl.id;

    const mx = createMatrix(adminWs, {
      name: 'Admin Review Matrix',
      templateId: tpl.id,
      dimensions: [
        { variableName: 'service', values: ['Roofing'] },
        { variableName: 'city', values: ['Boston'] },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
    });
    matrixId = mx.id;
  });

  afterAll(() => {
    deleteWorkspace(adminWs);
  });

  it('returns 200 with batchId when matrix and template both exist', async () => {
    broadcastState.calls = [];
    const res = await postJson(
      `/api/content-plan/${adminWs}/${matrixId}/send-template-review`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toBeDefined();
    expect(typeof body.batchId).toBe('string');
    expect(body.batch).toBeDefined();
  });

  it('preserves the template approval-batch payload shape', async () => {
    const res = await postJson(
      `/api/content-plan/${adminWs}/${matrixId}/send-template-review`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batch.items).toHaveLength(1);
    expect(body.batch.items[0].field).toBe('content_plan_template');
    expect(body.batch.items[0].pageTitle).toBe('Template: Admin Template');
    expect(body.batch.items[0].proposedValue).toContain('Page Type: service');
    expect(body.batch.items[0].proposedValue).toContain('Sections:');
    expect(body.batch.items[0].proposedValue).toContain('1. Why Choose Us for {service} (500 words)');
    expect(countActivityMatching(adminWs, 'template_review_sent')).toBeGreaterThanOrEqual(1);
    expect(countDeliverablesByType(adminWs, 'content_plan_template')).toBeGreaterThanOrEqual(1);
  });

  it('broadcasts APPROVAL_UPDATE and CONTENT_UPDATED after send-template-review', async () => {
    broadcastState.calls = [];
    await postJson(`/api/content-plan/${adminWs}/${matrixId}/send-template-review`);

    const approvalBroadcast = broadcastState.calls.find(
      c => c.workspaceId === adminWs && c.event === 'approval:update',
    );
    expect(approvalBroadcast).toBeDefined();
    expect((approvalBroadcast?.payload as Record<string, unknown>).action).toBe('created');

    const contentBroadcast = broadcastState.calls.find(
      c => c.workspaceId === adminWs && c.event === 'content:updated',
    );
    expect(contentBroadcast).toBeDefined();
    expect((contentBroadcast?.payload as Record<string, unknown>).domain).toBe('content-plan');
    expect((contentBroadcast?.payload as Record<string, unknown>).action).toBe('template_review_sent');
  });

  it('returns 404 for a nonexistent matrixId', async () => {
    const res = await postJson(
      `/api/content-plan/${adminWs}/mtx_nonexistent_template_review/send-template-review`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 404 when matrix templateId does not match any real template', async () => {
    // Create a matrix referencing a non-existent template
    const orphanMatrix = createMatrix(adminWs, {
      name: 'Orphan Matrix',
      templateId: 'tpl_does_not_exist_xyz',
      dimensions: [{ variableName: 'city', values: ['Nowhere'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });

    const res = await postJson(
      `/api/content-plan/${adminWs}/${orphanMatrix.id}/send-template-review`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Admin POST send-samples
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content-plan/:workspaceId/:matrixId/send-samples', () => {
  let samplesWs = '';
  let matrixId = '';
  let cells: Array<{ id: string }> = [];

  beforeAll(async () => {
    samplesWs = createWorkspace('Content Plan Review Samples WS').id;
    const tpl = createTemplate(samplesWs, {
      name: 'Samples Template',
      pageType: 'service',
    });
    const mx = createMatrix(samplesWs, {
      name: 'Samples Matrix',
      templateId: tpl.id,
      dimensions: [
        { variableName: 'service', values: ['HVAC', 'Electrical'] },
        { variableName: 'city', values: ['Atlanta'] },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
    });
    matrixId = mx.id;
    cells = mx.cells;
  });

  afterAll(() => {
    deleteWorkspace(samplesWs);
  });

  it('returns 200 with batchId and cellsSent count', async () => {
    const res = await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      { cellIds: [cells[0].id] },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toBeDefined();
    expect(body.cellsSent).toBe(1);
    expect(body.batch).toBeDefined();
  });

  it('preserves the sample approval-batch payload shape', async () => {
    const res = await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      { cellIds: [cells[0].id] },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batch.items).toHaveLength(1);
    expect(body.batch.items[0].field).toBe('content_plan_sample');
    expect(body.batch.items[0].pageTitle).toBe('HVAC in Atlanta');
    expect(body.batch.items[0].pageSlug).toBe('/services/atlanta/hvac');
    expect(body.batch.items[0].proposedValue).toContain('Keyword: HVAC in Atlanta');
    expect(body.batch.items[0].proposedValue).toContain('Planned URL: /services/atlanta/hvac');
    expect(body.batch.items[0].proposedValue).toContain('Variables: service=HVAC, city=Atlanta');
    expect(countActivityMatching(samplesWs, 'sample_review_sent')).toBeGreaterThanOrEqual(1);
    expect(countDeliverablesByType(samplesWs, 'content_plan_sample')).toBeGreaterThanOrEqual(1);
  });

  it('promotes sent cells to "review" status (visible in public GET)', async () => {
    // Send the second cell
    const cellId = cells[1].id;
    const res = await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      { cellIds: [cellId] },
    );
    expect(res.status).toBe(200);

    // Now that cell should appear in the public view
    const pubRes = await getJson(`/api/public/content-plan/${samplesWs}/${matrixId}`);
    expect(pubRes.status).toBe(200);
    const body = await pubRes.json();
    expect(body).not.toBeNull();
    const reviewCell = body.cells.find((c: { id: string; status: string }) => c.id === cellId);
    expect(reviewCell).toBeDefined();
    expect(reviewCell.status).toBe('review');
  });

  it('broadcasts APPROVAL_UPDATE and CONTENT_UPDATED after send-samples', async () => {
    broadcastState.calls = [];
    await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      { cellIds: [cells[0].id] },
    );

    const approvalBroadcast = broadcastState.calls.find(
      c => c.workspaceId === samplesWs && c.event === 'approval:update',
    );
    expect(approvalBroadcast).toBeDefined();

    const contentBroadcast = broadcastState.calls.find(
      c => c.workspaceId === samplesWs && c.event === 'content:updated',
    );
    expect(contentBroadcast).toBeDefined();
    expect((contentBroadcast?.payload as Record<string, unknown>).action).toBe('sample_review_sent');
  });

  it('returns 400 when cellIds array is empty', async () => {
    const res = await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      { cellIds: [] },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when cellIds is missing from body', async () => {
    const res = await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent matrixId', async () => {
    const res = await postJson(
      `/api/content-plan/${samplesWs}/mtx_nonexistent_samples_xyz/send-samples`,
      { cellIds: ['cell_any'] },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when cellIds provided but none match matrix cells', async () => {
    const res = await postJson(
      `/api/content-plan/${samplesWs}/${matrixId}/send-samples`,
      { cellIds: ['cell_does_not_exist_review'] },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // I3: send-samples must validate every selected cell's transition to 'review' BEFORE creating
  // the batch. A terminal 'published' cell can't go to 'review', so the whole op is rejected with
  // a 409 and NO orphaned batch/deliverable is created (previously the batch was created+mirrored
  // first, then the status loop threw mid-way, leaving partial state).
  it('rejects send-samples atomically when a selected cell is ineligible (409, no orphaned batch)', async () => {
    const tpl = createTemplate(samplesWs, { name: 'I3 Atomic Tpl', pageType: 'service' });
    const mx = createMatrix(samplesWs, {
      name: 'I3 Atomic Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Tampa', 'Miami'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'pest control in {city}',
    });
    const eligibleCell = mx.cells[0].id;   // stays 'planned' → review is legal
    const ineligibleCell = mx.cells[1].id; // promote to terminal 'published'
    updateMatrixCell(samplesWs, mx.id, ineligibleCell, { status: 'approved' });
    updateMatrixCell(samplesWs, mx.id, ineligibleCell, { status: 'published' });

    const beforeCount = countDeliverablesByType(samplesWs, 'content_plan_sample');

    const res = await postJson(
      `/api/content-plan/${samplesWs}/${mx.id}/send-samples`,
      { cellIds: [eligibleCell, ineligibleCell] },
    );
    expect(res.status).toBe(409);

    // No batch/deliverable was created, and the eligible cell was NOT flipped to review.
    expect(countDeliverablesByType(samplesWs, 'content_plan_sample')).toBe(beforeCount);
    const pubRes = await getJson(`/api/public/content-plan/${samplesWs}/${mx.id}`);
    const body = await pubRes.json();
    const flipped = body?.cells?.find((c: { id: string }) => c.id === eligibleCell);
    // eligibleCell is still 'planned' → not client-visible → absent from the public response.
    expect(flipped).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Admin POST batch-approve
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content-plan/:workspaceId/:matrixId/batch-approve', () => {
  let approveWs = '';
  let matrixId = '';

  beforeAll(async () => {
    approveWs = createWorkspace('Content Plan Review Approve WS').id;
    const tpl = createTemplate(approveWs, {
      name: 'Approve Template',
      pageType: 'service',
    });
    const mx = createMatrix(approveWs, {
      name: 'Approve Matrix',
      templateId: tpl.id,
      dimensions: [
        { variableName: 'service', values: ['Landscaping', 'Painting'] },
        { variableName: 'city', values: ['Nashville'] },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
    });
    matrixId = mx.id;
    // All 2 cells start as 'planned' — both are approvable
  });

  afterAll(() => {
    deleteWorkspace(approveWs);
  });

  it('returns 200 with ok:true and approvedCount', async () => {
    const res = await postJson(
      `/api/content-plan/${approveWs}/${matrixId}/batch-approve`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.approvedCount).toBe('number');
    expect(body.approvedCount).toBeGreaterThan(0);
    expect(body.totalCells).toBeDefined();
  });

  it('approvedCount equals number of planned cells in matrix', async () => {
    // Create a fresh matrix for counting
    const tpl = createTemplate(approveWs, {
      name: 'Count Template',
      pageType: 'service',
    });
    const mx = createMatrix(approveWs, {
      name: 'Count Matrix',
      templateId: tpl.id,
      dimensions: [
        { variableName: 'city', values: ['Memphis', 'Louisville', 'Indianapolis'] },
      ],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    }); // 3 planned cells

    const res = await postJson(
      `/api/content-plan/${approveWs}/${mx.id}/batch-approve`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvedCount).toBe(3);
    expect(body.totalCells).toBe(3);
  });

  it('broadcasts CONTENT_UPDATED with action:matrix_batch_approved', async () => {
    const tpl = createTemplate(approveWs, {
      name: 'Broadcast Approve Template',
      pageType: 'service',
    });
    const mx = createMatrix(approveWs, {
      name: 'Broadcast Approve Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Salt Lake City'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });

    broadcastState.calls = [];
    const res = await postJson(
      `/api/content-plan/${approveWs}/${mx.id}/batch-approve`,
    );
    expect(res.status).toBe(200);

    const broadcast = broadcastState.calls.find(
      c => c.workspaceId === approveWs && c.event === 'content:updated',
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast?.payload as Record<string, unknown>;
    expect(payload.domain).toBe('content-plan');
    expect(payload.action).toBe('matrix_batch_approved');
    expect(payload.matrixId).toBe(mx.id);
    expect(typeof payload.approvedCount).toBe('number');
  });

  it('returns 0 approvedCount when all cells already beyond planned status', async () => {
    // Create a matrix with cells that were already promoted to review
    const tpl = createTemplate(approveWs, {
      name: 'Already Reviewed Template',
      pageType: 'service',
    });
    const mx = createMatrix(approveWs, {
      name: 'Already Reviewed Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Cincinnati'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });

    // Promote the only cell to 'review' via send-samples
    await postJson(
      `/api/content-plan/${approveWs}/${mx.id}/send-samples`,
      { cellIds: [mx.cells[0].id] },
    );

    // Now batch-approve: 'review' status is not in the approvable list ['planned', 'keyword_validated', 'brief_generated']
    const res = await postJson(
      `/api/content-plan/${approveWs}/${mx.id}/batch-approve`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvedCount).toBe(0);
  });

  it('returns 404 for a nonexistent matrixId', async () => {
    const res = await postJson(
      `/api/content-plan/${approveWs}/mtx_nonexistent_approve_xyz/batch-approve`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Public POST flag cell
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/public/content-plan/:workspaceId/:matrixId/cells/:cellId/flag', () => {
  let flagWs = '';
  let matrixId = '';
  let reviewCellId = '';
  let plannedCellId = '';

  beforeAll(async () => {
    flagWs = createWorkspace('Content Plan Review Flag WS').id;
    const tpl = createTemplate(flagWs, {
      name: 'Flag Template',
      pageType: 'service',
    });
    const mx = createMatrix(flagWs, {
      name: 'Flag Matrix',
      templateId: tpl.id,
      dimensions: [
        { variableName: 'service', values: ['Fence', 'Deck'] },
        { variableName: 'city', values: ['Raleigh'] },
      ],
      urlPattern: '/services/{city}/{service}',
      keywordPattern: '{service} in {city}',
    });
    matrixId = mx.id;

    // Promote first cell to 'review'
    reviewCellId = mx.cells[0].id;
    plannedCellId = mx.cells[1].id;

    await postJson(
      `/api/content-plan/${flagWs}/${matrixId}/send-samples`,
      { cellIds: [reviewCellId] },
    );
  });

  afterAll(() => {
    deleteWorkspace(flagWs);
  });

  it('returns 200 ok:true when flagging a review cell', async () => {
    const res = await postJson(`/api/public/content-plan/${flagWs}/${matrixId}/cells/${reviewCellId}/flag`, {
      comment: 'Please update the keyword to be more specific',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('broadcasts CONTENT_UPDATED with action:matrix_cell_flagged', async () => {
    // Create a fresh matrix and promote a cell for this test
    const tpl = createTemplate(flagWs, {
      name: 'Broadcast Flag Template',
      pageType: 'service',
    });
    const mx = createMatrix(flagWs, {
      name: 'Broadcast Flag Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Omaha'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'plumber in {city}',
    });
    const cellId = mx.cells[0].id;
    await postJson(
      `/api/content-plan/${flagWs}/${mx.id}/send-samples`,
      { cellIds: [cellId] },
    );

    broadcastState.calls = [];
    await postJson(`/api/public/content-plan/${flagWs}/${mx.id}/cells/${cellId}/flag`, {
      comment: 'Needs revision',
    });

    const broadcast = broadcastState.calls.find(
      c => c.workspaceId === flagWs && c.event === 'content:updated',
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast?.payload as Record<string, unknown>;
    expect(payload.action).toBe('matrix_cell_flagged');
    expect(payload.matrixId).toBe(mx.id);
    expect(payload.cellId).toBe(cellId);
  });

  it('returns 409 when trying to flag a cell that is not client-visible (planned)', async () => {
    const res = await postJson(`/api/public/content-plan/${flagWs}/${matrixId}/cells/${plannedCellId}/flag`, {
      comment: 'Should not work',
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // ── C2 regression: flagging an APPROVED or PUBLISHED cell must succeed (200), not 500. ──
  // Before G2/C2 the MATRIX_CELL_TRANSITIONS machine had no approved→flagged / published→flagged
  // edge, so updateMatrixCell threw InvalidTransitionError → the public flag route returned 500
  // for an in-spec client review action (the flag form is shown for every client-visible cell).
  it('returns 200 when flagging an APPROVED cell (C2)', async () => {
    const tpl = createTemplate(flagWs, { name: 'C2 Approved Tpl', pageType: 'service' });
    const mx = createMatrix(flagWs, {
      name: 'C2 Approved Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Denver'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'roofing in {city}',
    });
    const cellId = mx.cells[0].id;
    // planned → approved (a legal admin-shortcut edge)
    updateMatrixCell(flagWs, mx.id, cellId, { status: 'approved' });

    const res = await postJson(`/api/public/content-plan/${flagWs}/${mx.id}/cells/${cellId}/flag`, {
      comment: 'Client wants a different angle on this approved page',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('returns 200 when flagging a PUBLISHED cell (C2)', async () => {
    const tpl = createTemplate(flagWs, { name: 'C2 Published Tpl', pageType: 'service' });
    const mx = createMatrix(flagWs, {
      name: 'C2 Published Matrix',
      templateId: tpl.id,
      dimensions: [{ variableName: 'city', values: ['Austin'] }],
      urlPattern: '/services/{city}',
      keywordPattern: 'hvac in {city}',
    });
    const cellId = mx.cells[0].id;
    // planned → approved → published (each a legal edge)
    updateMatrixCell(flagWs, mx.id, cellId, { status: 'approved' });
    updateMatrixCell(flagWs, mx.id, cellId, { status: 'published' });

    const res = await postJson(`/api/public/content-plan/${flagWs}/${mx.id}/cells/${cellId}/flag`, {
      comment: 'This published page has an error the client noticed',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('returns 400 when comment is missing', async () => {
    const res = await postJson(`/api/public/content-plan/${flagWs}/${matrixId}/cells/${reviewCellId}/flag`, {});
    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent cellId', async () => {
    const res = await postJson(`/api/public/content-plan/${flagWs}/${matrixId}/cells/cell_nonexistent_flag_xyz/flag`, {
      comment: 'Ghost cell comment',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
