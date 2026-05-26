/**
 * Integration tests for voice-calibration mutation endpoints.
 *
 * Covers:
 * - PATCH /api/voice/:workspaceId (update profile)
 * - POST /api/voice/:workspaceId/samples (add sample)
 * - DELETE /api/voice/:workspaceId/samples/:sampleId (delete sample)
 * - Workspace isolation for profile mutations and samples
 * - Full mutation chain (create → add sample → delete sample)
 *
 * Uses in-process server with dynamic port so vi.mock interceptors work
 * for broadcast capture.
 *
 * Port: dynamic (listen(0)) — no port conflict possible.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Broadcast capture ──────────────────────────────────────────────────────────
// vi.hoisted() lifts this before any imports so the mock sees the same object
// reference the tests use.
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

// Prevent any real email sends during mutation tests
vi.mock('../../server/email.js', () => ({
  sendEmail: vi.fn(),
  sendWorkspaceInvite: vi.fn(),
  sendPasswordReset: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendClientInvite: vi.fn(),
  sendApprovalNotification: vi.fn(),
  sendRequestNotification: vi.fn(),
  sendWeeklySummaryEmail: vi.fn(),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

// ── In-process server setup ───────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
/** Primary workspace for most tests */
let wsId = '';
/** Secondary workspace for isolation tests */
let wsIdB = '';

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
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();

  // Create two workspaces: one primary, one for isolation checks
  wsId = createWorkspace('Voice Calibration Mutations WS A').id;
  wsIdB = createWorkspace('Voice Calibration Mutations WS B').id;

  // Pre-create voice profiles so mutation tests can start immediately
  await postJson(`/api/voice/${wsId}`, {});
  await postJson(`/api/voice/${wsIdB}`, {});
}, 40_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await stopTestServer();
});

beforeEach(() => {
  broadcastState.calls = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/voice/:workspaceId — update profile
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/voice/:workspaceId — update profile', () => {
  it('updates name-equivalent field (status: calibrating) and returns the updated profile', async () => {
    const res = await patchJson(`/api/voice/${wsId}`, { status: 'calibrating' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('calibrating');
    expect(body.workspaceId).toBe(wsId);
    expect(typeof body.id).toBe('string');
    // Reset to draft for subsequent tests
    await patchJson(`/api/voice/${wsId}`, { status: 'draft' });
  });

  it('updates status field (draft → calibrated) and returns the updated profile', async () => {
    // Move to calibrating first (draft → calibrating is a valid forward transition)
    await patchJson(`/api/voice/${wsId}`, { status: 'calibrating' });
    const res = await patchJson(`/api/voice/${wsId}`, { status: 'calibrated' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('calibrated');
    // Reset to draft for subsequent tests
    await patchJson(`/api/voice/${wsId}`, { status: 'draft' });
  });

  it('fires VOICE_PROFILE_UPDATED broadcast with workspaceId on PATCH', async () => {
    broadcastState.calls = [];
    await patchJson(`/api/voice/${wsId}`, { status: 'calibrating' });
    const voiceCalls = broadcastState.calls.filter(c => c.event === WS_EVENTS.VOICE_PROFILE_UPDATED);
    expect(voiceCalls.length).toBeGreaterThanOrEqual(1);
    const call = voiceCalls[0];
    expect(call.workspaceId).toBe(wsId);
    // Payload must include workspaceId per route implementation
    expect((call.payload as Record<string, unknown>).workspaceId).toBe(wsId);
    // Reset
    await patchJson(`/api/voice/${wsId}`, { status: 'draft' });
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await patchJson('/api/voice/nonexistent-ws-99999', { status: 'calibrating' });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid schema (unknown extra field rejected by .strict())', async () => {
    const res = await patchJson(`/api/voice/${wsId}`, { unknownField: 'should-fail' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voice/:workspaceId/samples — add sample
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/voice/:workspaceId/samples — add sample', () => {
  it('adds a content sample and returns 200 with the sample shape', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'We help ambitious brands become unforgettable.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.content).toBe('We help ambitious brands become unforgettable.');
    expect(typeof body.createdAt).toBe('string');
  });

  it('returns a truthy string id in the response', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'Clear is kind. Clever is optional.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect((body.id as string).length).toBeGreaterThan(0);
  });

  it('added sample appears in GET /api/voice/:workspaceId response', async () => {
    const uniqueContent = `Sample content unique-${Date.now()}`;
    const addRes = await postJson(`/api/voice/${wsId}/samples`, { content: uniqueContent });
    expect(addRes.status).toBe(200);
    const added = await addRes.json() as Record<string, unknown>;

    const getRes = await api(`/api/voice/${wsId}`);
    expect(getRes.status).toBe(200);
    const profile = await getRes.json() as Record<string, unknown>;
    const samples = profile.samples as Array<Record<string, unknown>>;
    expect(Array.isArray(samples)).toBe(true);
    const found = samples.find(s => s.id === added.id);
    expect(found).toBeDefined();
    expect(found?.content).toBe(uniqueContent);
  });

  it('returns 400 for missing content field', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/voice/nonexistent-ws-99999/samples', {
      content: 'This workspace does not exist.',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/voice/:workspaceId/samples/:sampleId
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/voice/:workspaceId/samples/:sampleId', () => {
  let createdSampleId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'Sample to be deleted in delete tests.',
    });
    const body = await res.json() as Record<string, unknown>;
    createdSampleId = body.id as string;
  });

  it('deletes an existing sample and returns 200 with { deleted: true }', async () => {
    const res = await del(`/api/voice/${wsId}/samples/${createdSampleId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.deleted).toBe(true);
  });

  it('deleted sample is no longer present in GET /api/voice/:workspaceId', async () => {
    // Add a fresh sample, then delete it
    const addRes = await postJson(`/api/voice/${wsId}/samples`, {
      content: `Sample to verify deletion ${Date.now()}`,
    });
    const added = await addRes.json() as Record<string, unknown>;
    const sid = added.id as string;

    await del(`/api/voice/${wsId}/samples/${sid}`);

    const getRes = await api(`/api/voice/${wsId}`);
    const profile = await getRes.json() as Record<string, unknown>;
    const samples = profile.samples as Array<Record<string, unknown>>;
    const found = samples.find(s => s.id === sid);
    expect(found).toBeUndefined();
  });

  it('returns 404 for a nonexistent sampleId', async () => {
    const res = await del(`/api/voice/${wsId}/samples/vs_does_not_exist_abc123`);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for a nonexistent workspaceId', async () => {
    const res = await del('/api/voice/nonexistent-ws-99999/samples/vs_any_sample_id');
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workspace isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  it('PATCH to voiceProfile of workspace A cannot affect workspace B profile', async () => {
    // Update ws A to calibrating
    const patchRes = await patchJson(`/api/voice/${wsId}`, { status: 'calibrating' });
    expect(patchRes.status).toBe(200);

    // ws B should still be draft (unchanged)
    const getResB = await api(`/api/voice/${wsIdB}`);
    expect(getResB.status).toBe(200);
    const profileB = await getResB.json() as Record<string, unknown>;
    expect(profileB.status).toBe('draft');

    // Reset ws A
    await patchJson(`/api/voice/${wsId}`, { status: 'draft' });
  });

  it('sample added to workspace A is NOT visible from workspace B GET', async () => {
    const uniqueContent = `Isolation test sample ${Date.now()}`;
    const addRes = await postJson(`/api/voice/${wsId}/samples`, { content: uniqueContent });
    expect(addRes.status).toBe(200);
    const added = await addRes.json() as Record<string, unknown>;
    const sampleId = added.id as string;

    const getResB = await api(`/api/voice/${wsIdB}`);
    expect(getResB.status).toBe(200);
    const profileB = await getResB.json() as Record<string, unknown>;
    const samplesB = profileB.samples as Array<Record<string, unknown>>;
    const leaked = samplesB.find(s => s.id === sampleId);
    expect(leaked).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full mutation chain
// ─────────────────────────────────────────────────────────────────────────────

describe('Full mutation chain', () => {
  it('create profile → add sample → delete sample → samples array is empty for this chain', async () => {
    // Use wsIdB which already has a profile (created in beforeAll)
    // Add a sample
    const addRes = await postJson(`/api/voice/${wsIdB}/samples`, {
      content: 'Chain test sample to add then delete.',
    });
    expect(addRes.status).toBe(200);
    const sample = await addRes.json() as Record<string, unknown>;
    const sid = sample.id as string;
    expect(typeof sid).toBe('string');

    // Delete the sample
    const delRes = await del(`/api/voice/${wsIdB}/samples/${sid}`);
    expect(delRes.status).toBe(200);

    // Verify sample is gone from the profile GET
    const getRes = await api(`/api/voice/${wsIdB}`);
    expect(getRes.status).toBe(200);
    const profile = await getRes.json() as Record<string, unknown>;
    const samples = profile.samples as Array<Record<string, unknown>>;
    const remaining = samples.find(s => s.id === sid);
    expect(remaining).toBeUndefined();
  });

  it('create profile → PATCH to calibrated → GET shows calibrated status', async () => {
    // A separate workspace so status mutations don't bleed across tests
    const chainWsId = createWorkspace('Voice Chain Test WS').id;
    try {
      await postJson(`/api/voice/${chainWsId}`, {});

      // draft → calibrating
      const patchCalibrating = await patchJson(`/api/voice/${chainWsId}`, { status: 'calibrating' });
      expect(patchCalibrating.status).toBe(200);

      // calibrating → calibrated
      const patchCalibrated = await patchJson(`/api/voice/${chainWsId}`, { status: 'calibrated' });
      expect(patchCalibrated.status).toBe(200);

      // GET should reflect calibrated
      const getRes = await api(`/api/voice/${chainWsId}`);
      expect(getRes.status).toBe(200);
      const profile = await getRes.json() as Record<string, unknown>;
      expect(profile.status).toBe('calibrated');
    } finally {
      deleteWorkspace(chainWsId);
    }
  });
});
