/**
 * Integration tests for reports API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/reports/:siteId/history (list snapshots)
 * - GET /api/reports/:siteId/latest (latest snapshot)
 * - GET /api/reports/snapshot/:id (get specific snapshot)
 * - POST /api/reports/:siteId/snapshot (save existing audit data)
 * - GET /api/reports/snapshot/:id/actions (list action items)
 * - POST /api/reports/snapshot/:id/actions (add action item)
 * - PATCH /api/reports/snapshot/:id/actions/:actionId (update action item)
 * - DELETE /api/reports/snapshot/:id/actions/:actionId (delete action item)
 * - GET /api/sales-reports (list sales reports)
 * - GET /api/public/reports/:workspaceId (unified report list)
 * - GET /api/public/report/:id (public report JSON)
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { signToken } from '../../server/auth.js';
import { createUser, deleteUser } from '../../server/users.js';
import { saveSnapshot } from '../../server/reports.js';
import { listActivity } from '../../server/activity-log.js';
import type { SeoAuditResult } from '../../server/seo-audit.js';

const ctx = createTestContext(13211);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';
let otherWsId = '';
let scopedUserId = '';
let scopedUserToken = '';
let otherSnapshotId = '';
const testSiteId = 'test_site_' + Date.now();
const otherSiteId = 'other_site_' + Date.now();

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Reports Test Workspace');
  testWsId = ws.id;
  const otherWs = createWorkspace('Reports Other Test Workspace');
  otherWsId = otherWs.id;
  updateWorkspace(testWsId, { webflowSiteId: testSiteId });
  updateWorkspace(otherWsId, { webflowSiteId: otherSiteId });
  const scopedUser = await createUser(
    'reports-scoped-user@test.local',
    'ScopedPass1!',
    'Reports Scoped User',
    'member',
    [testWsId],
  );
  scopedUserId = scopedUser.id;
  scopedUserToken = signToken({ userId: scopedUser.id, email: scopedUser.email, role: scopedUser.role });
  const otherSnapshot = saveSnapshot(otherSiteId, 'Other Test Site', {
    siteScore: 70,
    totalPages: 1,
    errors: 0,
    warnings: 1,
    infos: 0,
    pages: [],
    siteWideIssues: [],
  } satisfies SeoAuditResult);
  otherSnapshotId = otherSnapshot.id;
}, 25_000);

afterAll(async () => {
  deleteUser(scopedUserId);
  deleteWorkspace(testWsId);
  deleteWorkspace(otherWsId);
  await ctx.stopServer();
});

describe('Reports — snapshot listing', () => {
  it('GET /api/reports/:siteId/history returns array', async () => {
    const res = await api(`/api/reports/${testSiteId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/reports/:siteId/latest returns null for no audits', async () => {
    const res = await api(`/api/reports/${testSiteId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('GET /api/reports/snapshot/:id with bad id returns 404', async () => {
    const res = await api('/api/reports/snapshot/snap_nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Report not found');
  });

  it('rejects scoped JWT history reads for a site owned by another workspace', async () => {
    const res = await api(`/api/reports/${otherSiteId}/history?workspaceId=${testWsId}`, {
      headers: { Authorization: `Bearer ${scopedUserToken}` },
    });
    expect(res.status).toBe(403);
  });

  it('rejects scoped JWT snapshot reads when the snapshot belongs to another workspace', async () => {
    const res = await api(`/api/reports/snapshot/${otherSnapshotId}`, {
      headers: { Authorization: `Bearer ${scopedUserToken}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('Reports — save snapshot from existing audit data', () => {
  let snapshotId = '';

  it('POST /api/reports/:siteId/snapshot without audit returns 400', async () => {
    const res = await postJson(`/api/reports/${testSiteId}/snapshot`, {
      siteName: 'Test Site',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing audit data');
  });

  it('POST /api/reports/:siteId/snapshot with audit data returns snapshot', async () => {
    const res = await postJson(`/api/reports/${testSiteId}/snapshot`, {
      siteName: 'Test Site',
      audit: {
        siteScore: 85,
        totalPages: 5,
        errors: 2,
        warnings: 3,
        pages: [],
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('createdAt');
    expect(body.siteScore).toBe(85);
    snapshotId = body.id;
  });

  it('GET /api/reports/snapshot/:id returns saved snapshot', async () => {
    const res = await api(`/api/reports/snapshot/${snapshotId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(snapshotId);
    expect(body.siteName).toBe('Test Site');
  });

  it('GET /api/reports/:siteId/latest returns the saved snapshot', async () => {
    const res = await api(`/api/reports/${testSiteId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.id).toBe(snapshotId);
  });

  it('GET /api/reports/:siteId/history includes the snapshot', async () => {
    const res = await api(`/api/reports/${testSiteId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    const ours = body.find((s: { id: string }) => s.id === snapshotId);
    expect(ours).toBeDefined();
  });

  it('GET /api/public/report/:id returns snapshot JSON', async () => {
    const res = await api(`/api/public/report/${snapshotId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(snapshotId);
  });

  it('GET /api/public/report/:id with bad id returns 404', async () => {
    const res = await api('/api/public/report/snap_nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('Reports — suppression-adjusted public audit reads', () => {
  afterEach(() => {
    updateWorkspace(testWsId, { auditSuppressions: [] });
  });

  it('filters current score, previous score, score history, and logs snapshot saves', async () => {
    updateWorkspace(testWsId, {
      auditSuppressions: [{
        check: 'meta-description',
        pageSlug: 'about',
        createdAt: new Date().toISOString(),
      }],
    });

    const previousRes = await postJson(`/api/reports/${testSiteId}/snapshot`, {
      siteName: 'Suppression History Test',
      audit: {
        siteScore: 70,
        totalPages: 1,
        errors: 1,
        warnings: 1,
        infos: 0,
        pages: [{
          pageId: 'p-about',
          slug: 'about',
          url: 'https://example.com/about',
          page: 'About',
          score: 70,
          issues: [
            { check: 'meta-description', severity: 'error', message: 'Suppressed meta issue' },
            { check: 'content-length', severity: 'warning', message: 'Visible content warning' },
          ],
        }],
        siteWideIssues: [],
      },
    });
    expect(previousRes.status).toBe(200);
    const previousBody = await previousRes.json();
    expect(previousBody.siteScore).toBe(97);

    await new Promise(resolve => setTimeout(resolve, 5));

    const currentRes = await postJson(`/api/reports/${testSiteId}/snapshot`, {
      siteName: 'Suppression Current Test',
      audit: {
        siteScore: 85,
        totalPages: 1,
        errors: 1,
        warnings: 0,
        infos: 0,
        pages: [{
          pageId: 'p-about',
          slug: 'about',
          url: 'https://example.com/about',
          page: 'About',
          score: 85,
          issues: [
            { check: 'meta-description', severity: 'error', message: 'Suppressed meta issue' },
          ],
        }],
        siteWideIssues: [],
      },
    });
    expect(currentRes.status).toBe(200);
    const currentBody = await currentRes.json();
    expect(currentBody.siteScore).toBe(100);

    const detailRes = await api(`/api/public/audit-detail/${testWsId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();

    expect(detail.id).toBe(currentBody.id);
    expect(detail.audit.siteScore).toBe(100);
    expect(detail.audit.errors).toBe(0);
    expect(detail.audit.pages[0].issues).toHaveLength(0);
    expect(detail.previousScore).toBe(97);
    expect(detail.scoreHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: currentBody.id, siteScore: 100, errors: 0, warnings: 0 }),
      expect.objectContaining({ id: previousBody.id, siteScore: 97, errors: 0, warnings: 1 }),
    ]));

    const activities = listActivity(testWsId, 20);
    expect(activities.some(a =>
      a.type === 'audit_completed'
      && a.metadata?.snapshotOnly === true
      && a.metadata?.score === 100
    )).toBe(true);
  });
});

describe('Reports — action items CRUD', () => {
  let snapshotId = '';
  let actionId = '';

  beforeAll(async () => {
    // Create a snapshot first
    const res = await postJson(`/api/reports/${testSiteId}/snapshot`, {
      siteName: 'Actions Test',
      audit: { siteScore: 75, totalPages: 3, errors: 1, warnings: 2, pages: [] },
    });
    const body = await res.json();
    snapshotId = body.id;
  });

  it('GET /api/reports/snapshot/:id/actions returns empty array', async () => {
    const res = await api(`/api/reports/snapshot/${snapshotId}/actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('POST /api/reports/snapshot/:id/actions without title returns 400', async () => {
    const res = await postJson(`/api/reports/snapshot/${snapshotId}/actions`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Title is required');
  });

  it('POST /api/reports/snapshot/:id/actions rejects invalid priority', async () => {
    const res = await postJson(`/api/reports/snapshot/${snapshotId}/actions`, {
      title: 'Invalid priority action',
      priority: 'critical',
    });
    expect(res.status).toBe(400);

    const listRes = await api(`/api/reports/snapshot/${snapshotId}/actions`);
    const body = await listRes.json();
    expect(body).toHaveLength(0);
  });

  it('POST /api/reports/snapshot/:id/actions creates action item', async () => {
    const res = await postJson(`/api/reports/snapshot/${snapshotId}/actions`, {
      title: 'Fix broken links',
      description: 'Several 404 links found on homepage',
      priority: 'high',
      category: 'technical',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.title).toBe('Fix broken links');
    expect(body.priority).toBe('high');
    actionId = body.id;
  });

  it('GET /api/reports/snapshot/:id/actions returns the action', async () => {
    const res = await api(`/api/reports/snapshot/${snapshotId}/actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(actionId);
  });

  it('PATCH /api/reports/snapshot/:id/actions/:actionId updates action', async () => {
    const res = await patchJson(`/api/reports/snapshot/${snapshotId}/actions/${actionId}`, {
      title: 'Fix all broken links',
      status: 'in-progress',
      priority: 'low',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Fix all broken links');
    expect(body.status).toBe('in-progress');
    expect(body.priority).toBe('low');
  });

  it('PATCH rejects invalid status without mutating the action', async () => {
    const res = await patchJson(`/api/reports/snapshot/${snapshotId}/actions/${actionId}`, {
      status: 'done',
      priority: 'urgent',
    });
    expect(res.status).toBe(400);

    const listRes = await api(`/api/reports/snapshot/${snapshotId}/actions`);
    const body = await listRes.json();
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe('in-progress');
    expect(body[0].priority).toBe('low');
  });

  it('PATCH with bad action id returns 404', async () => {
    const res = await patchJson(`/api/reports/snapshot/${snapshotId}/actions/action_bad`, {
      title: 'X',
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/reports/snapshot/:id/actions/:actionId removes action', async () => {
    const res = await del(`/api/reports/snapshot/${snapshotId}/actions/${actionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('DELETE with bad action id returns 404', async () => {
    const res = await del(`/api/reports/snapshot/${snapshotId}/actions/action_bad`);
    expect(res.status).toBe(404);
  });
});

describe('Reports — sales reports', () => {
  it('GET /api/sales-reports returns array', async () => {
    const res = await api('/api/sales-reports');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Reports — public workspace reports', () => {
  it('GET /api/public/reports/:workspaceId returns array', async () => {
    const res = await api(`/api/public/reports/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/reports/:workspaceId with bad id returns 404', async () => {
    const res = await api('/api/public/reports/ws_nonexistent_999');
    expect(res.status).toBe(404);
  });
});
