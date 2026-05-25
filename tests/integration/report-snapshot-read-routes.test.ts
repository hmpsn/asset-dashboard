/**
 * Integration tests for report snapshot READ paths in server/routes/reports.ts.
 *
 * Tests:
 * - GET /api/reports/:siteId/latest — no workspace query → 200 (null for unknown siteId)
 * - GET /api/reports/snapshot/:id with unknown id → 404
 * - GET /api/reports/snapshot/:id/actions with unknown id → 404
 *
 * Auth note: The test server runs with APP_PASSWORD='' so the HMAC gate is
 * disabled. requireWorkspaceSiteAccessFromQuery passes through when req.user is
 * unset (legacy auth path). requireSnapshotWorkspaceAccess short-circuits to 404
 * when getSnapshot() returns null, before any workspace check.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13609);
const { api } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Report Snapshot Read WS 13609').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Reports latest — unknown siteId', () => {
  it('GET /api/reports/:siteId/latest returns 200 with null for unknown siteId', async () => {
    // requireWorkspaceSiteAccessFromQuery passes through (no JWT user, HMAC disabled).
    // getLatestSnapshot returns null for unknown siteId → route responds JSON null.
    const res = await api('/api/reports/site_nonexistent_00000000/latest');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('Snapshot — unknown id', () => {
  it('GET /api/reports/snapshot/:id with unknown id returns 404', async () => {
    // requireSnapshotWorkspaceAccess calls getSnapshot() first — if null → 404.
    const res = await api('/api/reports/snapshot/snap_nonexistent_00000000');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/reports/snapshot/:id/actions with unknown id returns 404', async () => {
    // Same middleware: requireSnapshotWorkspaceAccess rejects before handler runs.
    const res = await api('/api/reports/snapshot/snap_nonexistent_00000000/actions');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
