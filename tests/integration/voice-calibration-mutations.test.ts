/**
 * Integration tests for voice-calibration mutation endpoints.
 *
 * Covers:
 * - PATCH /api/voice/:workspaceId (update profile)
 * - POST /api/voice/:workspaceId/samples (add sample)
 * - POST /api/voice/:workspaceId/samples/:sampleId/attest (human attestation)
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
  failNext: false,
  failEvent: null as string | null,
}));

const activityState = vi.hoisted(() => ({ failNext: false }));
const cacheState = vi.hoisted(() => ({
  calls: [] as string[],
  failNext: false,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    if (
      broadcastState.failNext
      && (broadcastState.failEvent === null || broadcastState.failEvent === event)
    ) {
      broadcastState.failNext = false;
      broadcastState.failEvent = null;
      throw new Error('simulated broadcast failure');
    }
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/activity-log.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: (...args: Parameters<typeof actual.addActivity>) => {
      if (activityState.failNext) {
        activityState.failNext = false;
        throw new Error('simulated activity failure');
      }
      return actual.addActivity(...args);
    },
  };
});

vi.mock('../../server/intelligence/cache-invalidation.js', async importOriginal => {
  const actual = await importOriginal<
    typeof import('../../server/intelligence/cache-invalidation.js')
  >();
  return {
    ...actual,
    invalidateIntelligenceCache: (workspaceId: string) => {
      cacheState.calls.push(workspaceId);
      if (cacheState.failNext) {
        cacheState.failNext = false;
        throw new Error('simulated intelligence-cache failure');
      }
      return actual.invalidateIntelligenceCache(workspaceId);
    },
  };
});

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
import { listActivity } from '../../server/activity-log.js';

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
  broadcastState.failNext = false;
  broadcastState.failEvent = null;
  activityState.failNext = false;
  cacheState.calls = [];
  cacheState.failNext = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voice/:workspaceId — create profile
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/voice/:workspaceId — create profile', () => {
  it('returns the committed profile when post-commit activity fails', async () => {
    const workspaceId = createWorkspace('Voice Profile Effect Isolation').id;
    try {
      activityState.failNext = true;

      const response = await postJson(`/api/voice/${workspaceId}`, {});
      expect(response.status).toBe(201);
      const created = await response.json() as { workspaceId: string; revision: number };
      expect(created).toMatchObject({ workspaceId, revision: 1 });

      const read = await api(`/api/voice/${workspaceId}`);
      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({ workspaceId, revision: 1 });
      expect(broadcastState.calls).toContainEqual(expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.VOICE_PROFILE_UPDATED,
      }));
      expect(cacheState.calls).toContain(workspaceId);

      // The successful response prevents a false retry. A deliberate duplicate
      // request sees the already-committed profile rather than creating another.
      const retry = await postJson(`/api/voice/${workspaceId}`, {});
      expect(retry.status).toBe(409);
    } finally {
      deleteWorkspace(workspaceId);
    }
  });

  it('returns the committed profile when intelligence-cache invalidation fails', async () => {
    const workspaceId = createWorkspace('Voice Profile Cache Effect Isolation').id;
    try {
      cacheState.failNext = true;

      const response = await postJson(`/api/voice/${workspaceId}`, {});
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ workspaceId, revision: 1 });
      expect(cacheState.calls).toEqual([workspaceId]);

      const read = await api(`/api/voice/${workspaceId}`);
      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({ workspaceId, revision: 1 });
    } finally {
      deleteWorkspace(workspaceId);
    }
  });
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

  it('rejects calibrated status even after the profile enters calibrating', async () => {
    // Only the finalization endpoint may assert calibrated authority.
    await patchJson(`/api/voice/${wsId}`, { status: 'calibrating' });
    const res = await patchJson(`/api/voice/${wsId}`, { status: 'calibrated' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    const getRes = await api(`/api/voice/${wsId}`);
    const profile = await getRes.json() as Record<string, unknown>;
    expect(profile.status).toBe('calibrating');
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

  it('does not create audit or broadcast noise for an exact no-op PATCH', async () => {
    const beforeActivityCount = listActivity(wsId).length;
    const beforeProfileResponse = await api(`/api/voice/${wsId}`);
    const beforeProfile = await beforeProfileResponse.json() as { revision: number; status: string };
    broadcastState.calls = [];

    const response = await patchJson(`/api/voice/${wsId}`, { status: beforeProfile.status });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      revision: beforeProfile.revision,
      status: beforeProfile.status,
    });
    expect(listActivity(wsId)).toHaveLength(beforeActivityCount);
    expect(broadcastState.calls).toEqual([]);
  });

  it('returns the committed update when one post-commit effect fails and continues later effects', async () => {
    const beforeActivityCount = listActivity(wsId).length;
    const beforeProfileResponse = await api(`/api/voice/${wsId}`);
    const beforeProfile = await beforeProfileResponse.json() as { status: string; revision: number };
    const targetStatus = beforeProfile.status === 'draft' ? 'calibrating' : 'draft';
    broadcastState.failNext = true;

    const response = await patchJson(`/api/voice/${wsId}`, { status: targetStatus });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: targetStatus,
      revision: beforeProfile.revision + 1,
    });
    expect(listActivity(wsId)).toHaveLength(beforeActivityCount + 1);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: wsId,
      event: WS_EVENTS.INTELLIGENCE_CACHE_UPDATED,
    }));
  });

  it('rejects bounded-profile overflow without advancing revision or status', async () => {
    const beforeResponse = await api(`/api/voice/${wsId}`);
    const before = await beforeResponse.json() as { revision: number; status: string; updatedAt: string };
    const dnaBase = {
      toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 },
      sentenceStyle: 'Clear sentences.',
      vocabularyLevel: 'Accessible.',
    };

    const overCount = await patchJson(`/api/voice/${wsId}`, {
      voiceDNA: {
        ...dnaBase,
        personalityTraits: Array.from({ length: 21 }, (_, index) => `Trait ${index}`),
      },
    });
    expect(overCount.status).toBe(400);

    const overText = await patchJson(`/api/voice/${wsId}`, {
      voiceDNA: {
        ...dnaBase,
        personalityTraits: ['Clear'],
        sentenceStyle: 'x'.repeat(10_001),
      },
    });
    expect(overText.status).toBe(400);

    const overUtf8Bytes = await patchJson(`/api/voice/${wsId}`, {
      contextModifiers: Array.from({ length: 20 }, (_, index) => ({
        context: `Context ${index}`,
        description: 'é'.repeat(4_000),
      })),
    });
    expect(overUtf8Bytes.status).toBe(400);

    const afterResponse = await api(`/api/voice/${wsId}`);
    const after = await afterResponse.json() as { revision: number; status: string; updatedAt: string };
    expect(after).toEqual(expect.objectContaining(before));
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

  it('normalizes content and rejects samples that cannot become bounded anchors', async () => {
    const normalized = await postJson(`/api/voice/${wsId}/samples`, {
      content: '  Calm, exact language.  ',
    });
    expect(normalized.status).toBe(200);
    await expect(normalized.json()).resolves.toMatchObject({
      content: 'Calm, exact language.',
    });

    const whitespace = await postJson(`/api/voice/${wsId}/samples`, { content: '   ' });
    expect(whitespace.status).toBe(400);

    const oversized = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'x'.repeat(10_001),
    });
    expect(oversized.status).toBe(400);

    const multibyteOverflow = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'é'.repeat(5_001),
    });
    expect(multibyteOverflow.status).toBe(400);
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson('/api/voice/nonexistent-ws-99999/samples', {
      content: 'This workspace does not exist.',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns one committed sample when the activity effect fails', async () => {
    const uniqueContent = `Activity-effect sample ${Date.now()}`;
    const beforeActivityCount = listActivity(wsId).length;
    activityState.failNext = true;

    const response = await postJson(`/api/voice/${wsId}/samples`, {
      content: uniqueContent,
    });
    expect(response.status).toBe(200);
    const added = await response.json() as { id: string; content: string };
    expect(added.content).toBe(uniqueContent);
    expect(listActivity(wsId)).toHaveLength(beforeActivityCount);

    const read = await api(`/api/voice/${wsId}`);
    const profile = await read.json() as { samples: Array<{ id: string; content: string }> };
    expect(profile.samples.filter(sample => sample.content === uniqueContent)).toEqual([added]);
    expect(cacheState.calls).toContain(wsId);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: wsId,
      event: WS_EVENTS.VOICE_PROFILE_UPDATED,
    }));
  });

  it('returns one committed sample when the workspace broadcast effect fails', async () => {
    const uniqueContent = `Broadcast-effect sample ${Date.now()}`;
    const beforeResponse = await api(`/api/voice/${wsId}`);
    const before = await beforeResponse.json() as { revision: number };
    broadcastState.failNext = true;
    broadcastState.failEvent = WS_EVENTS.VOICE_PROFILE_UPDATED;

    const response = await postJson(`/api/voice/${wsId}/samples`, {
      content: uniqueContent,
    });
    expect(response.status).toBe(200);
    const added = await response.json() as { id: string; content: string };

    const read = await api(`/api/voice/${wsId}`);
    const profile = await read.json() as {
      revision: number;
      samples: Array<{ id: string; content: string }>;
    };
    expect(profile.revision).toBe(before.revision + 1);
    expect(profile.samples.filter(sample => sample.content === uniqueContent)).toEqual([added]);
    expect(cacheState.calls).toContain(wsId);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      workspaceId: wsId,
      event: WS_EVENTS.INTELLIGENCE_CACHE_UPDATED,
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voice/:workspaceId/samples/:sampleId/attest
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/voice/:workspaceId/samples/:sampleId/attest', () => {
  it('promotes a chat proposal with human attribution and invalidates readers', async () => {
    const created = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'A chat-proposed sample awaiting a human decision.',
      contextTag: 'body',
      source: 'mcp_proposed',
    });
    expect(created.status).toBe(200);
    const sample = await created.json() as { id: string };
    const profileResponse = await api(`/api/voice/${wsId}`);
    const profile = await profileResponse.json() as { revision: number };
    broadcastState.calls = [];
    cacheState.calls = [];

    const attested = await postJson(`/api/voice/${wsId}/samples/${sample.id}/attest`, {
      expectedProfileRevision: profile.revision,
    });

    expect(attested.status).toBe(200);
    await expect(attested.json()).resolves.toMatchObject({
      id: sample.id,
      source: 'operator_attested',
    });
    expect(listActivity(wsId)).toContainEqual(expect.objectContaining({
      title: 'Confirmed chat-proposed voice sample',
    }));
    expect(broadcastState.calls).toContainEqual({
      workspaceId: wsId,
      event: WS_EVENTS.VOICE_PROFILE_UPDATED,
      payload: { sampleId: sample.id, attested: true },
    });
    expect(cacheState.calls).toContain(wsId);
  });

  it('rejects stale revisions and non-proposals', async () => {
    const forgedAttestation = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'A caller cannot skip the human confirmation mutation.',
      source: 'operator_attested',
    });
    expect(forgedAttestation.status).toBe(400);

    const manual = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'An operator-entered sample is already authentic.',
      source: 'manual',
    });
    const manualSample = await manual.json() as { id: string };
    const profileResponse = await api(`/api/voice/${wsId}`);
    const profile = await profileResponse.json() as { revision: number };

    const stale = await postJson(`/api/voice/${wsId}/samples/${manualSample.id}/attest`, {
      expectedProfileRevision: profile.revision - 1,
    });
    expect(stale.status).toBe(409);

    const wrongSource = await postJson(`/api/voice/${wsId}/samples/${manualSample.id}/attest`, {
      expectedProfileRevision: profile.revision,
    });
    expect(wrongSource.status).toBe(422);
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

  it('returns the committed delete when intelligence-cache invalidation fails', async () => {
    const content = `Cache-effect delete sample ${Date.now()}`;
    const addResponse = await postJson(`/api/voice/${wsId}/samples`, { content });
    expect(addResponse.status).toBe(200);
    const added = await addResponse.json() as { id: string };
    const beforeResponse = await api(`/api/voice/${wsId}`);
    const before = await beforeResponse.json() as { revision: number };
    cacheState.calls = [];
    cacheState.failNext = true;

    const response = await del(`/api/voice/${wsId}/samples/${added.id}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(cacheState.calls).toEqual([wsId]);

    const read = await api(`/api/voice/${wsId}`);
    const profile = await read.json() as {
      revision: number;
      samples: Array<{ id: string }>;
    };
    expect(profile.revision).toBe(before.revision + 1);
    expect(profile.samples.some(sample => sample.id === added.id)).toBe(false);

    // The first response truthfully reported success; a deliberate repeat sees
    // the already-applied delete and cannot advance the revision again.
    const retry = await del(`/api/voice/${wsId}/samples/${added.id}`);
    expect(retry.status).toBe(404);
    const afterRetryResponse = await api(`/api/voice/${wsId}`);
    const afterRetry = await afterRetryResponse.json() as { revision: number };
    expect(afterRetry.revision).toBe(profile.revision);
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

  it('create profile → generic PATCH cannot claim calibrated authority', async () => {
    // A separate workspace so status mutations don't bleed across tests
    const chainWsId = createWorkspace('Voice Chain Test WS').id;
    try {
      await postJson(`/api/voice/${chainWsId}`, {});

      // draft → calibrating
      const patchCalibrating = await patchJson(`/api/voice/${chainWsId}`, { status: 'calibrating' });
      expect(patchCalibrating.status).toBe(200);

      // calibrating → calibrated is reserved for POST /finalize.
      const patchCalibrated = await patchJson(`/api/voice/${chainWsId}`, { status: 'calibrated' });
      expect(patchCalibrated.status).toBe(400);

      // GET preserves the last legal status.
      const getRes = await api(`/api/voice/${chainWsId}`);
      expect(getRes.status).toBe(200);
      const profile = await getRes.json() as Record<string, unknown>;
      expect(profile.status).toBe('calibrating');
    } finally {
      deleteWorkspace(chainWsId);
    }
  });
});
