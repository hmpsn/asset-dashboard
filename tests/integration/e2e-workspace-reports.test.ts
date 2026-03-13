/**
 * API-level E2E test: Workspace → Report → Action Items flow.
 *
 * Tests the complete multi-step flow:
 * 1. Create workspace
 * 2. Save an audit snapshot
 * 3. Add action items to the snapshot
 * 4. Update and complete action items
 * 5. Verify public report endpoint
 * 6. Verify public reports list for workspace
 * 7. Clean up
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import {
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../../server/workspaces.js';

const ctx = createTestContext(13232);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
const testSiteId = 'site_e2e_reports_' + Date.now();

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('E2E Reports Flow');
  testWsId = ws.id;
  // Link a fake site ID to the workspace for report association
  updateWorkspace(testWsId, { webflowSiteId: testSiteId });
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('E2E: Workspace → Report → Action Items', () => {
  let snapshotId = '';
  let action1Id = '';
  let action2Id = '';

  it('Step 1: Save audit snapshot for workspace site', async () => {
    const res = await postJson(`/api/reports/${testSiteId}/snapshot`, {
      siteName: 'E2E Test Site',
      audit: {
        siteScore: 72,
        totalPages: 10,
        errors: 5,
        warnings: 8,
        pages: [
          {
            pageId: 'p1',
            url: '/home',
            title: 'Home',
            score: 80,
            issues: [
              { check: 'meta-title', message: 'Title too short', severity: 'warning', category: 'meta' },
              { check: 'meta-desc', message: 'Missing meta description', severity: 'error', category: 'meta' },
            ],
          },
          {
            pageId: 'p2',
            url: '/about',
            title: 'About',
            score: 65,
            issues: [
              { check: 'h1-missing', message: 'No H1 tag found', severity: 'error', category: 'content' },
            ],
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.siteScore).toBe(72);
    snapshotId = body.id;
  });

  it('Step 2: Snapshot appears in site history', async () => {
    const res = await api(`/api/reports/${testSiteId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((s: { id: string }) => s.id === snapshotId)).toBe(true);
  });

  it('Step 3: Latest endpoint returns the snapshot', async () => {
    const res = await api(`/api/reports/${testSiteId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(snapshotId);
    expect(body.audit.siteScore).toBe(72);
  });

  it('Step 4: Add first action item', async () => {
    const res = await postJson(`/api/reports/snapshot/${snapshotId}/actions`, {
      title: 'Fix missing meta descriptions',
      description: 'Add unique meta descriptions to all pages',
      priority: 'high',
      category: 'meta',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Fix missing meta descriptions');
    action1Id = body.id;
  });

  it('Step 5: Add second action item', async () => {
    const res = await postJson(`/api/reports/snapshot/${snapshotId}/actions`, {
      title: 'Add H1 tags to all pages',
      description: 'Ensure every page has exactly one H1',
      priority: 'medium',
      category: 'content',
    });
    expect(res.status).toBe(200);
    action2Id = (await res.json()).id;
  });

  it('Step 6: List actions shows both items', async () => {
    const res = await api(`/api/reports/snapshot/${snapshotId}/actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it('Step 7: Mark first action as completed', async () => {
    const res = await patchJson(`/api/reports/snapshot/${snapshotId}/actions/${action1Id}`, {
      status: 'completed',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
  });

  it('Step 8: Public report endpoint returns snapshot', async () => {
    const res = await api(`/api/public/report/${snapshotId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(snapshotId);
    expect(body.audit.pages).toHaveLength(2);
  });

  it('Step 9: Public workspace reports list includes the snapshot', async () => {
    const res = await api(`/api/public/reports/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ours = body.find((r: { id: string }) => r.id === snapshotId);
    expect(ours).toBeDefined();
    expect(ours.type).toBe('audit');
    expect(ours.score).toBe(72);
  });

  it('Step 10: Delete action items and verify', async () => {
    await del(`/api/reports/snapshot/${snapshotId}/actions/${action1Id}`);
    await del(`/api/reports/snapshot/${snapshotId}/actions/${action2Id}`);
    const res = await api(`/api/reports/snapshot/${snapshotId}/actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });
});
