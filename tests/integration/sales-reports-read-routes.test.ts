/**
 * Integration tests for sales report READ paths in server/routes/reports.ts.
 *
 * Tests:
 * - GET /api/sales-reports → 200 with array
 * - GET /api/sales-report/:id with unknown id → 404
 * - GET /api/sales-report/:id/html with unknown id → 404
 * - GET /api/public/report/:id with unknown id → 404 (snapshot-based endpoint)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13608);
const { api } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Reports Read WS 13608').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Sales Reports — list', () => {
  it('GET /api/sales-reports returns 200 with array', async () => {
    const res = await api('/api/sales-reports');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Sales Reports — single by id (unknown)', () => {
  it('GET /api/sales-report/:id with unknown id returns 404', async () => {
    const res = await api('/api/sales-report/sr_nonexistent_00000000');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/sales-report/:id/html with unknown id returns 404', async () => {
    const res = await api('/api/sales-report/sr_nonexistent_00000000/html');
    expect(res.status).toBe(404);
  });

  it('GET /api/sales-report/:id rejects malformed traversal id with 400', async () => {
    const badId = encodeURIComponent('../../etc/passwd');
    const res = await api(`/api/sales-report/${badId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid report id format' });
  });

  it('GET /api/sales-report/:id/html rejects malformed traversal id with 400', async () => {
    const badId = encodeURIComponent('../../etc/passwd');
    const res = await api(`/api/sales-report/${badId}/html`);
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Invalid report id format');
  });
});

describe('Public snapshot report — unknown id', () => {
  it('GET /api/public/report/:id with unknown snapshot id returns 404', async () => {
    const res = await api('/api/public/report/snap_nonexistent_00000000');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
