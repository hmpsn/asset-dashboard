/**
 * Integration tests for the full brandscript CRUD lifecycle.
 *
 * Covers:
 * - GET /api/brandscript-templates — list templates, verify shape
 * - POST /api/brandscripts/:workspaceId — create, validation, broadcast
 * - GET /api/brandscripts/:workspaceId — list (empty + after create)
 * - GET /api/brandscripts/:workspaceId/:id — get one, 404, isolation
 * - PUT /api/brandscripts/:workspaceId/:id/sections — update, persist, broadcast, validation, 404
 * - DELETE /api/brandscripts/:workspaceId/:id — delete, subsequent 404, unknown 404
 * - Workspace isolation: cross-workspace access denied
 *
 * Uses in-process server with dynamic port so vi.mock works.
 * Port: dynamic (listen(0))
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Brandscript, BrandscriptSection, BrandscriptTemplate } from '../../shared/types/brand-engine.js';

// ── Broadcast mock ────────────────────────────────────────────────────────────

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

// ── Imports after mocks ───────────────────────────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

// ── Server setup ──────────────────────────────────────────────────────────────

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
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ── Workspace setup ───────────────────────────────────────────────────────────

let wsId = '';
let wsIdB = '';

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Brandscript Lifecycle WS A').id;
  wsIdB = createWorkspace('Brandscript Lifecycle WS B').id;
}, 40_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await stopTestServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brandscript-templates
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brandscript-templates — templates list', () => {
  it('returns 200 with a templates array', async () => {
    const res = await api('/api/brandscript-templates');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('templates have expected fields (id, name, sections)', async () => {
    const res = await api('/api/brandscript-templates');
    const body = await res.json() as BrandscriptTemplate[];
    // There may be zero templates seeded in test DB — only validate shape if any exist
    if (body.length > 0) {
      const t = body[0];
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(Array.isArray(t.sections)).toBe(true);
      expect(typeof t.createdAt).toBe('string');
    } else {
      // No templates seeded — still a valid empty list
      expect(body).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brandscripts/:workspaceId — list
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brandscripts/:workspaceId — list', () => {
  it('returns empty array for a fresh workspace', async () => {
    const freshWs = createWorkspace('Brandscript Fresh WS');
    try {
      const res = await api(`/api/brandscripts/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns created brandscript in list after creation', async () => {
    // Create one via API
    await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Listed Brandscript',
      frameworkType: 'storybrand',
    });

    const res = await api(`/api/brandscripts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Brandscript[];
    expect(Array.isArray(body)).toBe(true);
    const found = body.some(b => b.name === 'Listed Brandscript');
    expect(found).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/brandscripts/:workspaceId — create brandscript
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/brandscripts/:workspaceId — create brandscript', () => {
  it('creates a brandscript and returns 200 with id, workspaceId, frameworkType, sections', async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Create Test BS',
      frameworkType: 'storybrand',
      sections: [
        { title: 'The Hero', content: 'Our customer is a founder.' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Brandscript;
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.workspaceId).toBe(wsId);
    expect(body.name).toBe('Create Test BS');
    expect(body.frameworkType).toBe('storybrand');
    expect(Array.isArray(body.sections)).toBe(true);
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('new brandscript appears in GET /api/brandscripts/:workspaceId list', async () => {
    const createRes = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Appears In List BS',
      frameworkType: 'storybrand',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as Brandscript;

    const listRes = await api(`/api/brandscripts/${wsId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as Brandscript[];
    const found = list.find(b => b.id === created.id);
    expect(found).toBeDefined();
  });

  it('returns 400 when required name is missing', async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      frameworkType: 'storybrand',
      // name intentionally omitted
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('broadcasts BRANDSCRIPT_UPDATED on successful create', async () => {
    broadcastState.calls = [];
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Broadcast Test BS',
      frameworkType: 'storybrand',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Brandscript;

    const broadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.BRANDSCRIPT_UPDATED && c.workspaceId === wsId,
    );
    expect(broadcast).toBeDefined();
    expect((broadcast!.payload as Record<string, unknown>).brandscriptId).toBe(body.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brandscripts/:workspaceId/:id — get one
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brandscripts/:workspaceId/:id — get one', () => {
  let bsId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Get One BS',
      frameworkType: 'storybrand',
      sections: [{ title: 'The Problem', content: 'Pain point.' }],
    });
    const body = await res.json() as Brandscript;
    bsId = body.id;
  });

  it('returns full brandscript with sections', async () => {
    const res = await api(`/api/brandscripts/${wsId}/${bsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Brandscript;
    expect(body.id).toBe(bsId);
    expect(body.workspaceId).toBe(wsId);
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
    const section = body.sections[0] as BrandscriptSection;
    expect(typeof section.id).toBe('string');
    expect(typeof section.title).toBe('string');
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await api(`/api/brandscripts/${wsId}/bs_does_not_exist_xyz`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 404 when accessing wsA brandscript via wsB path (workspace isolation)', async () => {
    // bsId belongs to wsId (wsA) — accessing it via wsIdB must return 404
    const res = await api(`/api/brandscripts/${wsIdB}/${bsId}`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/brandscripts/:workspaceId/:id/sections — update sections
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/brandscripts/:workspaceId/:id/sections — update sections', () => {
  let bsId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Sections Update BS',
      frameworkType: 'storybrand',
    });
    const body = await res.json() as Brandscript;
    bsId = body.id;
  });

  it('updates sections array and returns updated brandscript', async () => {
    const newSections = [
      { title: 'The Hero', content: 'Small business owner.' },
      { title: 'The Problem', content: 'Lack of visibility.' },
    ];
    const res = await putJson(`/api/brandscripts/${wsId}/${bsId}/sections`, {
      sections: newSections,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Brandscript;
    expect(body.id).toBe(bsId);
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBe(2);
    expect(body.sections[0].title).toBe('The Hero');
    expect(body.sections[1].title).toBe('The Problem');
  });

  it('updated sections persist in subsequent GET', async () => {
    await putJson(`/api/brandscripts/${wsId}/${bsId}/sections`, {
      sections: [{ title: 'Persisted Section', content: 'Persisted content.' }],
    });

    const getRes = await api(`/api/brandscripts/${wsId}/${bsId}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as Brandscript;
    expect(body.sections.length).toBe(1);
    expect(body.sections[0].title).toBe('Persisted Section');
  });

  it('broadcasts BRANDSCRIPT_UPDATED on section update', async () => {
    broadcastState.calls = [];
    const res = await putJson(`/api/brandscripts/${wsId}/${bsId}/sections`, {
      sections: [{ title: 'Broadcast Section', content: 'Check broadcast.' }],
    });
    expect(res.status).toBe(200);

    const broadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.BRANDSCRIPT_UPDATED && c.workspaceId === wsId,
    );
    expect(broadcast).toBeDefined();
    expect((broadcast!.payload as Record<string, unknown>).brandscriptId).toBe(bsId);
  });

  it('returns 400 when sections field contains an item missing title', async () => {
    // brandscriptSectionInputSchema requires title: z.string().min(1)
    const res = await putJson(`/api/brandscripts/${wsId}/${bsId}/sections`, {
      sections: [{ content: 'No title here' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 404 for an unknown brandscript id', async () => {
    const res = await putJson(`/api/brandscripts/${wsId}/bs_nonexistent_xyz/sections`, {
      sections: [{ title: 'Some Section' }],
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/brandscripts/:workspaceId/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/brandscripts/:workspaceId/:id', () => {
  it('deletes a brandscript and returns { deleted: true }', async () => {
    // Create a fresh one to delete
    const createRes = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'To Be Deleted BS',
      frameworkType: 'storybrand',
    });
    expect(createRes.status).toBe(200);
    const { id } = await createRes.json() as Brandscript;

    const deleteRes = await del(`/api/brandscripts/${wsId}/${id}`);
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it('deleted brandscript returns 404 on subsequent GET', async () => {
    const createRes = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Delete Then 404 BS',
      frameworkType: 'storybrand',
    });
    const { id } = await createRes.json() as Brandscript;

    await del(`/api/brandscripts/${wsId}/${id}`);

    const getRes = await api(`/api/brandscripts/${wsId}/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting a nonexistent brandscript id', async () => {
    const res = await del(`/api/brandscripts/${wsId}/bs_nonexistent_delete_xyz`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('broadcasts BRANDSCRIPT_UPDATED with deleted:true on successful delete', async () => {
    const createRes = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Broadcast Delete BS',
      frameworkType: 'storybrand',
    });
    const { id } = await createRes.json() as Brandscript;
    broadcastState.calls = [];

    const deleteRes = await del(`/api/brandscripts/${wsId}/${id}`);
    expect(deleteRes.status).toBe(200);

    const broadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.BRANDSCRIPT_UPDATED && c.workspaceId === wsId,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as Record<string, unknown>;
    expect(payload.brandscriptId).toBe(id);
    expect(payload.deleted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workspace isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  let wsAbsId = '';

  beforeAll(async () => {
    // Create a brandscript in wsId (workspace A)
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Isolation Test BS',
      frameworkType: 'storybrand',
    });
    const body = await res.json() as Brandscript;
    wsAbsId = body.id;
  });

  it('PUT sections for wsA brandscript returns 404 via wsB path', async () => {
    const res = await putJson(`/api/brandscripts/${wsIdB}/${wsAbsId}/sections`, {
      sections: [{ title: 'Should Not Work', content: 'Cross-workspace attempt.' }],
    });
    expect(res.status).toBe(404);
  });

  it('DELETE wsA brandscript via wsB path returns 404', async () => {
    // Create a fresh brandscript in wsA to try deleting via wsB
    const createRes = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Isolation Delete Target BS',
      frameworkType: 'storybrand',
    });
    const { id } = await createRes.json() as Brandscript;

    const deleteRes = await del(`/api/brandscripts/${wsIdB}/${id}`);
    expect(deleteRes.status).toBe(404);

    // Confirm it still exists in wsA
    const getRes = await api(`/api/brandscripts/${wsId}/${id}`);
    expect(getRes.status).toBe(200);
  });
});
