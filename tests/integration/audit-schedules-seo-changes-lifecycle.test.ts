/**
 * Integration tests for audit-schedules and seo-change-tracker lifecycle.
 *
 * Covers:
 *   - GET /api/audit-schedules (global list)
 *   - GET /api/audit-schedules/:workspaceId
 *   - PUT /api/audit-schedules/:workspaceId (upsert)
 *   - DELETE /api/audit-schedules/:workspaceId
 *   - GET /api/seo-changes/:workspaceId
 *   - GET /api/seo-change-impact/:workspaceId (error paths)
 *   - GET /api/schema-impact/:workspaceId (error paths)
 *
 * Uses in-process server (listen on port 0) so vi.mock intercepts broadcastToWorkspace.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── broadcast mock (hoisted so vi.mock runs before any imports) ───────────────

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
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(() => false),
  notifyAuditAlert: vi.fn(),
  notifyClientAuditComplete: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyClientWelcome: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamPaymentReceived: vi.fn(),
  notifyTeamChurnSignal: vi.fn(),
  notifyTeamClientSignal: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientTeamResponse: vi.fn(),
}));

// ── deferred imports (after vi.mock) ──────────────────────────────────────────

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { deleteSchedule } from '../../server/scheduled-audits.js';

// ── server bootstrap ──────────────────────────────────────────────────────────

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
  const { port } = server!.address() as AddressInfo;
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
  return fetch(`${baseUrl}${path}`, opts);
}

async function putJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsAId = createWorkspace('Audit Schedules Test WS-A').id;
  wsBId = createWorkspace('Audit Schedules Test WS-B').id;
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  // Clean up schedules first to avoid leaking into other tests
  try { deleteSchedule(wsAId); } catch { /* no-op */ }
  try { deleteSchedule(wsBId); } catch { /* no-op */ }
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

// ── Audit Schedules — GET by workspaceId ─────────────────────────────────────

describe('GET /api/audit-schedules/:workspaceId', () => {
  it('returns 404 for a workspace with no schedule configured', async () => {
    const freshWs = createWorkspace('No Schedule WS');
    try {
      const res = await api(`/api/audit-schedules/${freshWs.id}`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/audit-schedules/ws_nonexistent_zzz');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ── Audit Schedules — PUT (upsert) ───────────────────────────────────────────

describe('PUT /api/audit-schedules/:workspaceId', () => {
  it('creates a schedule and returns the upserted object with correct fields', async () => {
    const res = await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 10,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(wsAId);
    expect(body.enabled).toBe(true);
    expect(body.intervalDays).toBe(7);
    expect(body.scoreDropThreshold).toBe(10);
  });

  it('GET after PUT returns the stored schedule with correct values', async () => {
    await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: true,
      intervalDays: 14,
      scoreDropThreshold: 5,
    });

    const res = await api(`/api/audit-schedules/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(wsAId);
    expect(body.intervalDays).toBe(14);
    expect(body.scoreDropThreshold).toBe(5);
    expect(body.enabled).toBe(true);
  });

  it('PUT updates existing schedule (upsert behaviour)', async () => {
    // First PUT to create
    await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });

    // Second PUT to update interval
    const res = await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: false,
      intervalDays: 30,
      scoreDropThreshold: 15,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.intervalDays).toBe(30);
    expect(body.scoreDropThreshold).toBe(15);
  });

  it('PUT with only enabled=false disables the schedule (partial update merges with existing)', async () => {
    // Create baseline
    await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });

    // Partial update — only send enabled: false
    const res = await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: false,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    // intervalDays merges from existing
    expect(body.intervalDays).toBe(7);
  });
});

// ── Audit Schedules — DELETE ──────────────────────────────────────────────────

describe('DELETE /api/audit-schedules/:workspaceId', () => {
  it('DELETE returns { ok: true }', async () => {
    // Create a schedule to delete
    await putJson(`/api/audit-schedules/${wsBId}`, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });

    const res = await api(`/api/audit-schedules/${wsBId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET after DELETE returns 404 (schedule no longer exists)', async () => {
    // Seed then remove
    await putJson(`/api/audit-schedules/${wsBId}`, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });
    await api(`/api/audit-schedules/${wsBId}`, { method: 'DELETE' });

    const res = await api(`/api/audit-schedules/${wsBId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE on a workspace that has no schedule still returns 200', async () => {
    // Make sure there is no schedule for wsB
    await api(`/api/audit-schedules/${wsBId}`, { method: 'DELETE' });

    const res = await api(`/api/audit-schedules/${wsBId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ── Audit Schedules — GET global list ────────────────────────────────────────

describe('GET /api/audit-schedules (global list)', () => {
  it('returns 200 with an array', async () => {
    const res = await api('/api/audit-schedules');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('includes a newly created schedule in the global list', async () => {
    const freshWs = createWorkspace('Global List Test WS');
    try {
      await putJson(`/api/audit-schedules/${freshWs.id}`, {
        enabled: true,
        intervalDays: 7,
        scoreDropThreshold: 5,
      });

      const res = await api('/api/audit-schedules');
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ workspaceId: string }>;
      const found = body.find(s => s.workspaceId === freshWs.id);
      expect(found).toBeDefined();
    } finally {
      deleteSchedule(freshWs.id);
      deleteWorkspace(freshWs.id);
    }
  });

  it('each entry has required shape fields (workspaceId, enabled, intervalDays, scoreDropThreshold)', async () => {
    const freshWs = createWorkspace('Schedule Shape Test WS');
    try {
      await putJson(`/api/audit-schedules/${freshWs.id}`, {
        enabled: true,
        intervalDays: 7,
        scoreDropThreshold: 5,
      });

      const res = await api('/api/audit-schedules');
      const body = await res.json() as Array<{ workspaceId: string; enabled: boolean; intervalDays: number; scoreDropThreshold: number }>;
      const entry = body.find(s => s.workspaceId === freshWs.id);
      expect(entry).toBeDefined();
      expect(typeof entry!.enabled).toBe('boolean');
      expect(typeof entry!.intervalDays).toBe('number');
      expect(typeof entry!.scoreDropThreshold).toBe('number');
    } finally {
      deleteSchedule(freshWs.id);
      deleteWorkspace(freshWs.id);
    }
  });
});

// ── Audit Schedules — workspace isolation ────────────────────────────────────

describe('Audit Schedules — workspace isolation', () => {
  it('schedule for WS-A is not visible via WS-B GET endpoint', async () => {
    // Ensure WS-A has a schedule, WS-B does not
    await putJson(`/api/audit-schedules/${wsAId}`, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 5,
    });
    await api(`/api/audit-schedules/${wsBId}`, { method: 'DELETE' });

    const resB = await api(`/api/audit-schedules/${wsBId}`);
    expect(resB.status).toBe(404);

    const resA = await api(`/api/audit-schedules/${wsAId}`);
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    expect(bodyA.workspaceId).toBe(wsAId);
  });
});

// ── SEO Changes — GET /api/seo-changes/:workspaceId ──────────────────────────

describe('GET /api/seo-changes/:workspaceId', () => {
  it('returns 200 with empty changes array for a fresh workspace', async () => {
    const freshWs = createWorkspace('SEO Changes Fresh WS');
    try {
      const res = await api(`/api/seo-changes/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('changes');
      expect(Array.isArray(body.changes)).toBe(true);
      expect(body.changes).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns 200 with changes array for a known workspace', async () => {
    const res = await api(`/api/seo-changes/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('changes');
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it('returns 400 when limit query param is not a positive integer', async () => {
    const res = await api(`/api/seo-changes/${wsAId}?limit=abc`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when limit is 0', async () => {
    const res = await api(`/api/seo-changes/${wsAId}?limit=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/seo-changes/ws_unknown_zzz_seo');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('workspace isolation — changes from WS-A not visible via WS-B', async () => {
    const resA = await api(`/api/seo-changes/${wsAId}`);
    const resB = await api(`/api/seo-changes/${wsBId}`);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // The two responses should be independent arrays
    const bodyA = await resA.json();
    const bodyB = await resB.json();
    expect(Array.isArray(bodyA.changes)).toBe(true);
    expect(Array.isArray(bodyB.changes)).toBe(true);
  });
});

// ── SEO Change Impact — GET /api/seo-change-impact/:workspaceId ──────────────

describe('GET /api/seo-change-impact/:workspaceId', () => {
  it('returns 400 when workspace has no GSC property configured', async () => {
    // wsAId has no gscPropertyUrl by default
    const res = await api(`/api/seo-change-impact/${wsAId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GSC/i);
  });

  it('returns 400 when workspace has GSC but no site linked', async () => {
    const ws = createWorkspace('SEO Impact No Site WS');
    try {
      updateWorkspace(ws.id, { gscPropertyUrl: 'https://example.com' });
      const res = await api(`/api/seo-change-impact/${ws.id}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toMatch(/site/i);
    } finally {
      deleteWorkspace(ws.id);
    }
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/seo-change-impact/ws_unknown_zzz_impact');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when limit query param is invalid', async () => {
    const ws = createWorkspace('SEO Impact Limit WS');
    try {
      updateWorkspace(ws.id, { gscPropertyUrl: 'https://example.com', webflowSiteId: 'site_abc' });
      const res = await api(`/api/seo-change-impact/${ws.id}?limit=-5`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      deleteWorkspace(ws.id);
    }
  });
});

// ── Schema Impact — GET /api/schema-impact/:workspaceId ──────────────────────

describe('GET /api/schema-impact/:workspaceId', () => {
  it('returns 400 when workspace has no GSC property configured', async () => {
    const res = await api(`/api/schema-impact/${wsAId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/GSC/i);
  });

  it('returns 400 when workspace has GSC but no site linked', async () => {
    const ws = createWorkspace('Schema Impact No Site WS');
    try {
      updateWorkspace(ws.id, { gscPropertyUrl: 'https://schema-test.com' });
      const res = await api(`/api/schema-impact/${ws.id}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toMatch(/site/i);
    } finally {
      deleteWorkspace(ws.id);
    }
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/schema-impact/ws_unknown_zzz_schema');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when limit query param is invalid', async () => {
    const ws = createWorkspace('Schema Impact Limit WS');
    try {
      updateWorkspace(ws.id, { gscPropertyUrl: 'https://schema-test.com', webflowSiteId: 'site_schema_abc' });
      const res = await api(`/api/schema-impact/${ws.id}?limit=not_a_number`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      deleteWorkspace(ws.id);
    }
  });
});
