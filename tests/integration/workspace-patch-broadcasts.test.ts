/**
 * Integration tests for PATCH /api/workspaces/:id — broadcast verification,
 * field updates, sensitive field handling, error cases, and workspace isolation.
 *
 * Uses an in-process server with a dynamic port so vi.mock intercepts
 * broadcastToWorkspace calls synchronously.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before any imports so vi.hoisted
// captures them before module resolution begins.
// ---------------------------------------------------------------------------
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
  notifyClientWelcome: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Lazy imports after mocks are installed
// ---------------------------------------------------------------------------
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------
let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';   // primary workspace
let wsIdB = '';  // secondary workspace (isolation tests)

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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Workspace Patch Broadcasts Primary');
  wsId = ws.id;
  const wsB = createWorkspace('Workspace Patch Broadcasts Secondary');
  wsIdB = wsB.id;
}, 30_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await stopTestServer();
});

// ---------------------------------------------------------------------------
// Helper: broadcasts for WORKSPACE_UPDATED filtered to a specific workspace
// ---------------------------------------------------------------------------
function workspaceUpdatedBroadcasts(forWorkspaceId: string) {
  return broadcastState.calls.filter(
    c => c.event === WS_EVENTS.WORKSPACE_UPDATED && c.workspaceId === forWorkspaceId,
  );
}

// ===========================================================================
// PATCH /api/workspaces/:id — name update
// ===========================================================================
describe('PATCH /api/workspaces/:id — name update', () => {
  it('returns 200 with the updated name in the response', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      name: 'Renamed Primary Workspace',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe('Renamed Primary Workspace');
  });

  it('subsequent GET reflects the updated name', async () => {
    await patchJson(`/api/workspaces/${wsId}`, { name: 'GET Verify Name' });

    const res = await api(`/api/workspaces/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe('GET Verify Name');
  });

  it('broadcast is fired after name PATCH (activity proxy via broadcast count)', async () => {
    await patchJson(`/api/workspaces/${wsId}`, { name: 'Activity Probe Name' });

    // The route fires broadcastToWorkspace after every successful update —
    // presence of the broadcast confirms the mutation path was fully executed.
    expect(workspaceUpdatedBroadcasts(wsId).length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// PATCH /api/workspaces/:id — broadcast verification
// ===========================================================================
describe('PATCH /api/workspaces/:id — broadcast verification', () => {
  it('PATCH name fires WORKSPACE_UPDATED broadcast with the correct workspaceId', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { name: 'Broadcast Test Name' });
    expect(res.status).toBe(200);

    const broadcasts = workspaceUpdatedBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH liveDomain fires WORKSPACE_UPDATED broadcast', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      liveDomain: 'https://example-broadcast-test.com',
    });
    expect(res.status).toBe(200);

    const broadcasts = workspaceUpdatedBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it('broadcast payload contains the updated name field', async () => {
    const uniqueName = `Payload Verify ${Date.now()}`;
    const res = await patchJson(`/api/workspaces/${wsId}`, { name: uniqueName });
    expect(res.status).toBe(200);

    const broadcasts = workspaceUpdatedBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const payload = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(payload.name).toBe(uniqueName);
  });

  it('broadcast payload does not include clientPassword or webflowToken', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { name: 'Sensitive Strip Broadcast' });
    expect(res.status).toBe(200);

    const broadcasts = workspaceUpdatedBroadcasts(wsId);
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
    const payload = broadcasts[broadcasts.length - 1].payload as Record<string, unknown>;
    expect(payload.clientPassword).toBeUndefined();
    expect(payload.webflowToken).toBeUndefined();
  });
});

// ===========================================================================
// PATCH /api/workspaces/:id — field updates
// ===========================================================================
describe('PATCH /api/workspaces/:id — field updates', () => {
  it('PATCH liveDomain to a valid URL returns 200 with updated liveDomain', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      liveDomain: 'https://my-site.example.com',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.liveDomain).toBe('https://my-site.example.com');
  });

  it('PATCH clientPortalEnabled=true returns 200 with updated value', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      clientPortalEnabled: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.clientPortalEnabled).toBe(true);
  });

  it('PATCH knowledgeBase stores and returns the value', async () => {
    const knowledgeBase = 'Our company specialises in sustainable packaging.';
    const res = await patchJson(`/api/workspaces/${wsId}`, { knowledgeBase });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.knowledgeBase).toBe(knowledgeBase);
  });

  it('unknown fields outside the schema are silently ignored and 200 is returned', async () => {
    // updateWorkspace uses a Partial<Pick<...>> of known fields, so unknown keys
    // are simply not persisted — the route does not validate/reject them.
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      name: 'Unknown Fields Test',
      nonExistentField: 'should be ignored',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe('Unknown Fields Test');
    expect(body).not.toHaveProperty('nonExistentField');
  });
});

// ===========================================================================
// PATCH /api/workspaces/:id — sensitive field handling
// ===========================================================================
describe('PATCH /api/workspaces/:id — sensitive field handling', () => {
  it('PATCH clientPassword returns 200 but clientPassword is NOT in the response', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      clientPassword: 'SuperSecretPass1!',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.clientPassword).toBeUndefined();
  });

  it('after PATCH clientPassword, GET also omits clientPassword from response', async () => {
    await patchJson(`/api/workspaces/${wsId}`, { clientPassword: 'AnotherSecret2@' });

    const getRes = await api(`/api/workspaces/${wsId}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as Record<string, unknown>;
    expect(body.clientPassword).toBeUndefined();
    // hasPassword should be true because a password was just set
    expect(body.hasPassword).toBe(true);
  });

  it('PATCH clientPassword="" clears the password and hasPassword becomes false', async () => {
    // First ensure a password is set
    await patchJson(`/api/workspaces/${wsId}`, { clientPassword: 'TempSecret3#' });

    // Clear it
    const res = await patchJson(`/api/workspaces/${wsId}`, { clientPassword: '' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.clientPassword).toBeUndefined();
    expect(body.hasPassword).toBe(false);
  });
});

// ===========================================================================
// PATCH /api/workspaces/:id — error cases
// ===========================================================================
describe('PATCH /api/workspaces/:id — error cases', () => {
  it('returns 404 for an unknown workspaceId', async () => {
    const res = await patchJson('/api/workspaces/ws_does_not_exist_xyz', {
      name: 'Should Not Persist',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when billingMode is an invalid value', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      billingMode: 'invalid_billing_value',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect((body.error as string).toLowerCase()).toContain('billingmode');
  });
});

// ===========================================================================
// Workspace isolation
// ===========================================================================
describe('Workspace isolation', () => {
  it('PATCH to workspace A does not affect workspace B', async () => {
    // Capture the current name of workspace B before mutating A
    const beforeRes = await api(`/api/workspaces/${wsIdB}`);
    expect(beforeRes.status).toBe(200);
    const before = await beforeRes.json() as Record<string, unknown>;
    const nameBeforeB = before.name as string;

    // Mutate workspace A
    const patchRes = await patchJson(`/api/workspaces/${wsId}`, {
      name: 'Isolation PATCH on A',
    });
    expect(patchRes.status).toBe(200);

    // Workspace B name must be unchanged
    const afterRes = await api(`/api/workspaces/${wsIdB}`);
    expect(afterRes.status).toBe(200);
    const after = await afterRes.json() as Record<string, unknown>;
    expect(after.name).toBe(nameBeforeB);
  });

  it('broadcast for workspace A PATCH targets workspace A only', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, {
      name: 'Broadcast Isolation A',
    });
    expect(res.status).toBe(200);

    // Every WORKSPACE_UPDATED broadcast must be scoped to wsId, not wsIdB
    const broadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.WORKSPACE_UPDATED,
    );
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);

    for (const b of broadcasts) {
      expect(b.workspaceId).not.toBe(wsIdB);
    }
  });
});
