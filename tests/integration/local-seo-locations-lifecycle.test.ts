/**
 * Integration tests — Local SEO Location CRUD Lifecycle
 *
 * Covers the full create → list → update → delete lifecycle for client
 * locations, plus main local SEO settings GET/PUT.
 *
 * Uses in-process HTTP via createApp() + http.createServer() with listen(0)
 * so vi.mock intercepts broadcast and email before the server module loads.
 *
 * Does NOT test:
 *   - GET /api/local-seo/:workspaceId/location-lookup (makes external API calls)
 *   - POST /api/local-seo/:workspaceId/refresh (triggers background job)
 *   - Local SEO markets (covered by local-seo-routes.test.ts and local-seo-primary-market.test.ts)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoisted mock state ────────────────────────────────────────────────────────

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
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';

// ── Feature flag: enable local-seo-visibility before app loads ────────────────

process.env.FEATURE_LOCAL_SEO_VISIBILITY = 'true';

// ── In-process server setup ───────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsA = '';
let wsB = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = (server!.address() as AddressInfo);
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

async function putJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ── Cleanup helpers ───────────────────────────────────────────────────────────

function clearLocationData(workspaceId: string): void {
  db.prepare('DELETE FROM client_locations WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsA = createWorkspace('LocalSeoLocations-WsA').id;
  wsB = createWorkspace('LocalSeoLocations-WsB').id;
}, 30_000);

beforeEach(() => {
  broadcastState.calls = [];
  clearLocationData(wsA);
  clearLocationData(wsB);
});

afterAll(async () => {
  clearLocationData(wsA);
  clearLocationData(wsB);
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await stopTestServer();
}, 15_000);

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/local-seo/:workspaceId — main settings
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/local-seo/:workspaceId — main settings', () => {
  it('returns 200 with a read model shape for a fresh workspace', async () => {
    const { status, body } = await getJson(`/api/local-seo/${wsA}`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('featureEnabled');
    expect(typeof b.featureEnabled).toBe('boolean');
    expect(b).toHaveProperty('settings');
    expect(b).toHaveProperty('markets');
    expect(Array.isArray(b.markets)).toBe(true);
    expect(b).toHaveProperty('report');
    // Default posture for fresh workspace
    const settings = b.settings as Record<string, unknown>;
    expect(settings).toHaveProperty('posture', 'unknown');
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const { status, body } = await getJson('/api/local-seo/nonexistent-workspace-xyz');
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)).toHaveProperty('error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/local-seo/:workspaceId — update main settings
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/local-seo/:workspaceId — update main settings', () => {
  it('updates posture and returns 200 with updated settings', async () => {
    const { status, body } = await putJson(`/api/local-seo/${wsA}`, {
      posture: 'local',
    });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('settings');
    const settings = b.settings as Record<string, unknown>;
    expect(settings.posture).toBe('local');
  });

  it('returns 400 for invalid schema (unknown field)', async () => {
    const { status } = await putJson(`/api/local-seo/${wsA}`, {
      unknownField: 'bad-value',
    });
    expect(status).toBe(400);
  });

  it('returns 404 for unknown workspaceId', async () => {
    const { status, body } = await putJson('/api/local-seo/nonexistent-workspace-xyz', {
      posture: 'local',
    });
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)).toHaveProperty('error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/local-seo/:workspaceId/locations — list
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/local-seo/:workspaceId/locations — list', () => {
  it('returns empty locations array for a fresh workspace', async () => {
    const { status, body } = await getJson(`/api/local-seo/${wsA}/locations`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('locations');
    expect(Array.isArray(b.locations)).toBe(true);
    expect((b.locations as unknown[]).length).toBe(0);
  });

  it('returns created location in the list', async () => {
    // Create a location first
    const { status: createStatus, body: created } = await postJson(
      `/api/local-seo/${wsA}/locations`,
      { name: 'Main Office' },
    );
    expect(createStatus).toBe(201);
    const loc = (created as Record<string, unknown>).location as Record<string, unknown>;
    expect(loc).toHaveProperty('id');

    // Now list should include it
    const { status, body } = await getJson(`/api/local-seo/${wsA}/locations`);
    expect(status).toBe(200);
    const locations = (body as Record<string, unknown>).locations as Record<string, unknown>[];
    expect(locations.some(l => l.id === loc.id)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/local-seo/:workspaceId/locations — create
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/local-seo/:workspaceId/locations — create', () => {
  it('creates a location with name only and returns 201 with id and name', async () => {
    const { status, body } = await postJson(`/api/local-seo/${wsA}/locations`, {
      name: 'Downtown Branch',
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('location');
    const loc = b.location as Record<string, unknown>;
    expect(loc).toHaveProperty('id');
    expect(loc.name).toBe('Downtown Branch');
    // Default status should be 'needs_review'
    expect(loc.status).toBe('needs_review');
  });

  it('creates a location with all optional fields and returns 201', async () => {
    const { status, body } = await postJson(`/api/local-seo/${wsA}/locations`, {
      name: 'Uptown Location',
      domain: 'https://uptown.example.com',
      phone: '(512) 555-0199',
      streetAddress: '456 Main St',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      isPrimary: true,
      status: 'confirmed',
    });
    expect(status).toBe(201);
    const loc = (body as Record<string, unknown>).location as Record<string, unknown>;
    expect(loc.name).toBe('Uptown Location');
    expect(loc.city).toBe('Austin');
    expect(loc.status).toBe('confirmed');
    expect(loc.isPrimary).toBe(true);
  });

  it('location appears in subsequent GET list', async () => {
    const { body: created } = await postJson(`/api/local-seo/${wsA}/locations`, {
      name: 'Appears In List',
    });
    const locId = ((created as Record<string, unknown>).location as Record<string, unknown>).id as string;

    const { status, body } = await getJson(`/api/local-seo/${wsA}/locations`);
    expect(status).toBe(200);
    const locations = (body as Record<string, unknown>).locations as Record<string, unknown>[];
    expect(locations.some(l => l.id === locId)).toBe(true);
  });

  it('returns 400 when required field "name" is missing', async () => {
    const { status } = await postJson(`/api/local-seo/${wsA}/locations`, {
      city: 'Austin',
    });
    expect(status).toBe(400);
  });

  it('returns 400 for unknown additional fields (strict schema)', async () => {
    const { status } = await postJson(`/api/local-seo/${wsA}/locations`, {
      name: 'Valid Name',
      unknownField: 'extra',
    });
    expect(status).toBe(400);
  });

  it('returns 404 for unknown workspaceId', async () => {
    const { status, body } = await postJson('/api/local-seo/nonexistent-workspace-xyz/locations', {
      name: 'Orphan Location',
    });
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)).toHaveProperty('error');
  });

  it('broadcasts LOCAL_SEO_UPDATED event with location_created action after creation', async () => {
    broadcastState.calls = [];
    await postJson(`/api/local-seo/${wsA}/locations`, { name: 'Broadcast Test Location' });

    const localSeoCall = broadcastState.calls.find(c => c.event === WS_EVENTS.LOCAL_SEO_UPDATED);
    expect(localSeoCall).toBeDefined();
    expect(localSeoCall!.workspaceId).toBe(wsA);
    const payload = localSeoCall!.payload as Record<string, unknown>;
    expect(payload.action).toBe('location_created');
    expect(payload.locationName).toBe('Broadcast Test Location');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/local-seo/:workspaceId/locations/:locationId — update
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/local-seo/:workspaceId/locations/:locationId — update', () => {
  async function createLocation(name: string): Promise<string> {
    const { body } = await postJson(`/api/local-seo/${wsA}/locations`, { name });
    return ((body as Record<string, unknown>).location as Record<string, unknown>).id as string;
  }

  it('updates location name and returns 200 with updated data', async () => {
    const locationId = await createLocation('Original Name');
    const { status, body } = await putJson(
      `/api/local-seo/${wsA}/locations/${locationId}`,
      { name: 'Updated Name' },
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('location');
    const loc = b.location as Record<string, unknown>;
    expect(loc.name).toBe('Updated Name');
    expect(loc.id).toBe(locationId);
  });

  it('updated data persists in subsequent GET list', async () => {
    const locationId = await createLocation('Before Update');
    await putJson(`/api/local-seo/${wsA}/locations/${locationId}`, {
      name: 'After Update',
      status: 'confirmed',
    });

    const { body } = await getJson(`/api/local-seo/${wsA}/locations`);
    const locations = (body as Record<string, unknown>).locations as Record<string, unknown>[];
    const updated = locations.find(l => l.id === locationId);
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('After Update');
    expect(updated!.status).toBe('confirmed');
  });

  it('broadcasts LOCAL_SEO_UPDATED event with location_updated action after update', async () => {
    const locationId = await createLocation('Broadcast Update Location');
    broadcastState.calls = [];

    await putJson(`/api/local-seo/${wsA}/locations/${locationId}`, {
      name: 'Broadcast Updated Name',
    });

    const localSeoCall = broadcastState.calls.find(c => c.event === WS_EVENTS.LOCAL_SEO_UPDATED);
    expect(localSeoCall).toBeDefined();
    expect(localSeoCall!.workspaceId).toBe(wsA);
    const payload = localSeoCall!.payload as Record<string, unknown>;
    expect(payload.action).toBe('location_updated');
  });

  it('returns 404 for a nonexistent locationId', async () => {
    const { status, body } = await putJson(
      `/api/local-seo/${wsA}/locations/does-not-exist`,
      { name: 'Ghost' },
    );
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)).toHaveProperty('error');
  });

  it('returns 400 for invalid schema (unknown field)', async () => {
    const locationId = await createLocation('Schema Test Location');
    const { status } = await putJson(
      `/api/local-seo/${wsA}/locations/${locationId}`,
      { unknownField: 'bad-value' },
    );
    expect(status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/local-seo/:workspaceId/locations/:locationId
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/local-seo/:workspaceId/locations/:locationId', () => {
  async function createLocation(wsId: string, name: string): Promise<string> {
    const { body } = await postJson(`/api/local-seo/${wsId}/locations`, { name });
    return ((body as Record<string, unknown>).location as Record<string, unknown>).id as string;
  }

  it('deletes location and returns 200 with deleted: true', async () => {
    const locationId = await createLocation(wsA, 'To Delete');
    const { status, body } = await del(`/api/local-seo/${wsA}/locations/${locationId}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).deleted).toBe(true);
  });

  it('deleted location no longer appears in GET list', async () => {
    const locationId = await createLocation(wsA, 'Will Be Deleted');
    await del(`/api/local-seo/${wsA}/locations/${locationId}`);

    const { body } = await getJson(`/api/local-seo/${wsA}/locations`);
    const locations = (body as Record<string, unknown>).locations as Record<string, unknown>[];
    expect(locations.some(l => l.id === locationId)).toBe(false);
  });

  it('broadcasts LOCAL_SEO_UPDATED event with location_deleted action after delete', async () => {
    const locationId = await createLocation(wsA, 'Broadcast Delete Location');
    broadcastState.calls = [];

    await del(`/api/local-seo/${wsA}/locations/${locationId}`);

    const localSeoCall = broadcastState.calls.find(c => c.event === WS_EVENTS.LOCAL_SEO_UPDATED);
    expect(localSeoCall).toBeDefined();
    expect(localSeoCall!.workspaceId).toBe(wsA);
    const payload = localSeoCall!.payload as Record<string, unknown>;
    expect(payload.action).toBe('location_deleted');
  });

  it('returns 404 for a nonexistent locationId', async () => {
    const { status, body } = await del(`/api/local-seo/${wsA}/locations/does-not-exist`);
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)).toHaveProperty('error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Workspace isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('Workspace isolation', () => {
  async function createLocationInWs(wsId: string, name: string): Promise<string> {
    const { body } = await postJson(`/api/local-seo/${wsId}/locations`, { name });
    return ((body as Record<string, unknown>).location as Record<string, unknown>).id as string;
  }

  it('location created in wsA is not visible in wsB GET list', async () => {
    const locIdA = await createLocationInWs(wsA, 'WsA Private Location');

    const { status, body } = await getJson(`/api/local-seo/${wsB}/locations`);
    expect(status).toBe(200);
    const locations = (body as Record<string, unknown>).locations as Record<string, unknown>[];
    expect(locations.some(l => l.id === locIdA)).toBe(false);
  });

  it('DELETE of wsA location via wsB path returns 404', async () => {
    const locIdA = await createLocationInWs(wsA, 'Cross-Workspace Delete Target');

    // Attempt to delete wsA's location using wsB's workspace path
    const { status } = await del(`/api/local-seo/${wsB}/locations/${locIdA}`);
    expect(status).toBe(404);

    // Verify the location still exists in wsA
    const { body } = await getJson(`/api/local-seo/${wsA}/locations`);
    const locations = (body as Record<string, unknown>).locations as Record<string, unknown>[];
    expect(locations.some(l => l.id === locIdA)).toBe(true);
  });
});
