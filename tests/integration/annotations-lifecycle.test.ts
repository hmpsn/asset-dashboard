/**
 * Integration tests for annotations lifecycle — create, read, delete, broadcast,
 * public endpoint, and workspace isolation.
 *
 * Uses in-process server (listen(0)) so vi.mock intercepts broadcastToWorkspace.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── broadcast mock (must be hoisted so vi.mock runs before imports) ────────────

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

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
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

// ── deferred imports (after vi.mock) ──────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ── server helpers ─────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsAId = '';
let wsBId = '';
const originalAppPassword = process.env.APP_PASSWORD;

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

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, opts));
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

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Annotations Lifecycle WS-A').id;
  wsBId = createWorkspace('Annotations Lifecycle WS-B').id;
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────

function annotationBroadcasts() {
  return broadcastState.calls.filter(
    call => call.event === WS_EVENTS.ANNOTATION_BRIDGE_CREATED,
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/annotations/:workspaceId — create', () => {
  it('creates annotation and returns 200 with id, date, label, and createdAt fields', async () => {
    const res = await postJson(`/api/annotations/${wsAId}`, {
      date: '2025-03-10',
      label: 'Site migration',
      description: 'Full domain migration to new host',
      color: '#ff6600',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.date).toBe('2025-03-10');
    expect(body.label).toBe('Site migration');
    expect(body).toHaveProperty('createdAt');
  });

  it('created annotation appears in subsequent GET /api/annotations/:workspaceId', async () => {
    const createRes = await postJson(`/api/annotations/${wsAId}`, {
      date: '2025-04-01',
      label: 'April Fools campaign',
    });
    const created = await createRes.json();

    const listRes = await api(`/api/annotations/${wsAId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const found = list.find((a: { id: string }) => a.id === created.id);
    expect(found).toBeDefined();
    expect(found.label).toBe('April Fools campaign');
  });

  it('broadcasts ANNOTATION_BRIDGE_CREATED with workspaceId and annotation id on create', async () => {
    const res = await postJson(`/api/annotations/${wsAId}`, {
      date: '2025-05-01',
      label: 'Broadcast check',
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const broadcasts = annotationBroadcasts();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].workspaceId).toBe(wsAId);
    expect(broadcasts[0].event).toBe(WS_EVENTS.ANNOTATION_BRIDGE_CREATED);
    expect(broadcasts[0].payload).toMatchObject({ id: body.id, action: 'created' });
  });

  it('returns 400 when both date and label are missing', async () => {
    const res = await postJson(`/api/annotations/${wsAId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when label is missing (date provided)', async () => {
    const res = await postJson(`/api/annotations/${wsAId}`, { date: '2025-06-01' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when date is missing (label provided)', async () => {
    const res = await postJson(`/api/annotations/${wsAId}`, { label: 'Missing date' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('GET /api/annotations/:workspaceId — list', () => {
  it('returns empty array for a fresh workspace', async () => {
    const freshWsId = createWorkspace('Annotations Fresh WS').id;
    try {
      const res = await api(`/api/annotations/${freshWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWsId);
    }
  });

  it('returns all created annotations for a workspace', async () => {
    const wsId = createWorkspace('Annotations List WS').id;
    try {
      await postJson(`/api/annotations/${wsId}`, { date: '2025-01-01', label: 'First' });
      await postJson(`/api/annotations/${wsId}`, { date: '2025-02-01', label: 'Second' });

      const res = await api(`/api/annotations/${wsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(2);
      const labels = body.map((a: { label: string }) => a.label);
      expect(labels).toContain('First');
      expect(labels).toContain('Second');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('returns 200 with empty array for unknown workspaceId (no auth enforced without APP_PASSWORD)', async () => {
    // APP_PASSWORD is unset in the test server so requireWorkspaceAccess passes through.
    // The route runs against an unknown workspaceId and returns an empty array.
    const res = await api('/api/annotations/ws_lifecycle_unknown_xyz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('DELETE /api/annotations/:workspaceId/:id', () => {
  let annotationId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/annotations/${wsAId}`, {
      date: '2025-06-15',
      label: 'To be deleted',
    });
    const body = await res.json();
    annotationId = body.id;
  });

  it('deletes an annotation and returns 200 with ok: true', async () => {
    const res = await del(`/api/annotations/${wsAId}/${annotationId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('deleted annotation does not appear in subsequent GET', async () => {
    const res = await api(`/api/annotations/${wsAId}`);
    const list = await res.json();
    const found = list.find((a: { id: string }) => a.id === annotationId);
    expect(found).toBeUndefined();
  });

  it('broadcasts ANNOTATION_BRIDGE_CREATED with action: deleted on delete', async () => {
    // Create a fresh annotation to delete in this sub-test
    const createRes = await postJson(`/api/annotations/${wsAId}`, {
      date: '2025-07-01',
      label: 'Delete broadcast check',
    });
    const created = await createRes.json();
    broadcastState.calls = [];

    const deleteRes = await del(`/api/annotations/${wsAId}/${created.id}`);
    expect(deleteRes.status).toBe(200);

    const broadcasts = annotationBroadcasts();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].workspaceId).toBe(wsAId);
    expect(broadcasts[0].event).toBe(WS_EVENTS.ANNOTATION_BRIDGE_CREATED);
    expect(broadcasts[0].payload).toMatchObject({ id: created.id, action: 'deleted' });
  });

  it('deleting a nonexistent annotation id still returns 200 (no-op delete)', async () => {
    // The route calls deleteAnnotation() which issues a DELETE SQL statement —
    // deleting a row that doesn't exist returns 0 changes but the route always
    // responds { ok: true }. We verify the API is stable for unknown ids.
    const res = await del(`/api/annotations/${wsAId}/ann_nonexistent_id_xyz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('GET /api/public/annotations/:workspaceId — public endpoint', () => {
  it('returns annotations for a workspace without auth', async () => {
    const wsId = createWorkspace('Annotations Public WS').id;
    try {
      await postJson(`/api/annotations/${wsId}`, {
        date: '2025-08-01',
        label: 'Public visible annotation',
      });

      const res = await api(`/api/public/annotations/${wsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      const labels = body.map((a: { label: string }) => a.label);
      expect(labels).toContain('Public visible annotation');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('returns empty array for a fresh workspace', async () => {
    const freshWsId = createWorkspace('Annotations Public Fresh').id;
    try {
      const res = await api(`/api/public/annotations/${freshWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWsId);
    }
  });

  it('public and admin endpoints return the same annotation data', async () => {
    const wsId = createWorkspace('Annotations Public Parity').id;
    try {
      const createRes = await postJson(`/api/annotations/${wsId}`, {
        date: '2025-09-15',
        label: 'Parity check annotation',
        color: '#00aaff',
      });
      const created = await createRes.json();

      const [adminRes, publicRes] = await Promise.all([
        api(`/api/annotations/${wsId}`),
        api(`/api/public/annotations/${wsId}`),
      ]);

      const adminList = await adminRes.json();
      const publicList = await publicRes.json();

      const adminItem = adminList.find((a: { id: string }) => a.id === created.id);
      const publicItem = publicList.find((a: { id: string }) => a.id === created.id);

      expect(adminItem).toBeDefined();
      expect(publicItem).toBeDefined();
      expect(publicItem.label).toBe(adminItem.label);
      expect(publicItem.date).toBe(adminItem.date);
      expect(publicItem.color).toBe(adminItem.color);
    } finally {
      deleteWorkspace(wsId);
    }
  });
});

describe('Workspace isolation', () => {
  let wsAAnnotationId = '';
  let wsBAnnotationId = '';

  beforeAll(async () => {
    const [resA, resB] = await Promise.all([
      postJson(`/api/annotations/${wsAId}`, {
        date: '2025-10-01',
        label: 'WS-A exclusive annotation',
      }),
      postJson(`/api/annotations/${wsBId}`, {
        date: '2025-10-02',
        label: 'WS-B exclusive annotation',
      }),
    ]);
    wsAAnnotationId = (await resA.json()).id;
    wsBAnnotationId = (await resB.json()).id;
  });

  it('annotations from workspace A do NOT appear in workspace B GET', async () => {
    const res = await api(`/api/annotations/${wsBId}`);
    const list = await res.json();
    const leaked = list.find((a: { id: string }) => a.id === wsAAnnotationId);
    expect(leaked).toBeUndefined();
  });

  it('annotations from workspace B do NOT appear in workspace A GET', async () => {
    const res = await api(`/api/annotations/${wsAId}`);
    const list = await res.json();
    const leaked = list.find((a: { id: string }) => a.id === wsBAnnotationId);
    expect(leaked).toBeUndefined();
  });

  it('DELETE of ws-A annotation id via ws-B path is a no-op (does not remove ws-A annotation)', async () => {
    // The deleteAnnotation SQL scopes by workspace_id so deleting across
    // workspace boundaries silently finds 0 rows to delete. The annotation
    // in ws-A should still exist afterwards.
    const crossDeleteRes = await del(`/api/annotations/${wsBId}/${wsAAnnotationId}`);
    // Route returns { ok: true } regardless of rows affected
    expect(crossDeleteRes.status).toBe(200);

    // Verify ws-A annotation is still present
    const listRes = await api(`/api/annotations/${wsAId}`);
    const list = await listRes.json();
    const stillThere = list.find((a: { id: string }) => a.id === wsAAnnotationId);
    expect(stillThere).toBeDefined();
  });

  it('isolation holds on public endpoint — ws-A annotations not visible via ws-B public path', async () => {
    const res = await api(`/api/public/annotations/${wsBId}`);
    const list = await res.json();
    const leaked = list.find((a: { id: string }) => a.id === wsAAnnotationId);
    expect(leaked).toBeUndefined();
  });
});
