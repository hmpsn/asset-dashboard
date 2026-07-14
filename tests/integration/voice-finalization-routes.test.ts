import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  sendWorkspaceInvite: vi.fn(),
  sendPasswordReset: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendClientInvite: vi.fn(),
  sendApprovalNotification: vi.fn(),
  sendRequestNotification: vi.fn(),
  sendWeeklySummaryEmail: vi.fn(),
}));

import { signToken } from '../../server/auth.js';
import db from '../../server/db/index.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';

interface FinalizableFixture {
  workspaceId: string;
  profileId: string;
  profileRevision: number;
  sampleId: string;
}

const originalAppPassword = process.env.APP_PASSWORD;
let baseUrl = '';
let server: http.Server | undefined;
let operatorId = '';
let operatorToken = '';
let directFixture: FinalizableFixture;
let authorizationFixture: FinalizableFixture;
let errorFixture: FinalizableFixture;
let otherWorkspaceId = '';

function operatorHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${operatorToken}` };
}

async function api(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = operatorHeaders(),
): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedFinalizable(workspaceId: string): Promise<FinalizableFixture> {
  const created = await postJson(`/api/voice/${workspaceId}`, {});
  expect(created.status).toBe(201);
  const profile = await created.json() as { id: string };

  const sampleResponse = await postJson(`/api/voice/${workspaceId}/samples`, {
    content: `Authentic operator-provided voice sample for ${workspaceId}.`,
    contextTag: 'body',
    source: 'manual',
  });
  expect(sampleResponse.status).toBe(200);
  const sample = await sampleResponse.json() as { id: string };

  const calibrating = await patchJson(`/api/voice/${workspaceId}`, { status: 'calibrating' });
  expect(calibrating.status).toBe(200);

  const current = await api(`/api/voice/${workspaceId}`, { headers: operatorHeaders() });
  expect(current.status).toBe(200);
  const currentProfile = await current.json() as { revision: number };
  return {
    workspaceId,
    profileId: profile.id,
    profileRevision: currentProfile.revision,
    sampleId: sample.id,
  };
}

function finalizationBody(
  fixture: FinalizableFixture,
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    expectedProfileRevision: fixture.profileRevision,
    voiceDNA: {
      personalityTraits: ['clear', 'grounded', 'warm'],
      toneSpectrum: {
        formal_casual: 6,
        serious_playful: 4,
        technical_accessible: 8,
      },
      sentenceStyle: 'Concise sentences with a natural conversational rhythm.',
      vocabularyLevel: 'Accessible expert language without unnecessary jargon.',
      humorStyle: 'Light and situational, never forced.',
    },
    guardrails: {
      forbiddenWords: ['guaranteed'],
      requiredTerminology: [{ use: 'clients', insteadOf: 'customers' }],
      toneBoundaries: ['Never sound condescending or make unsupported claims.'],
      antiPatterns: ['Avoid generic hype and empty superlatives.'],
    },
    contextModifiers: [],
    anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: fixture.sampleId }],
    calibrationSelections: [],
    idempotencyKey,
    ...overrides,
  };
}

function countCalibrationActivities(workspaceId: string): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count
    FROM activity_log
    WHERE workspace_id = ? AND type = 'voice_calibrated'
  `).get(workspaceId) as { count: number }).count;
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const directWorkspaceId = createWorkspace('Voice Finalization Direct Route').id;
  const authorizationWorkspaceId = createWorkspace('Voice Finalization Authorization Route').id;
  const errorWorkspaceId = createWorkspace('Voice Finalization Error Route').id;
  otherWorkspaceId = createWorkspace('Voice Finalization Foreign Route').id;

  const operator = await createUser(
    `voice-finalization-route-${randomUUID()}@test.local`,
    'VoiceFinalizationRoutePass1!',
    'Voice Finalization Operator',
    'member',
    [directWorkspaceId, authorizationWorkspaceId, errorWorkspaceId],
  );
  operatorId = operator.id;
  operatorToken = signToken({ userId: operator.id, email: operator.email, role: operator.role });

  directFixture = await seedFinalizable(directWorkspaceId);
  authorizationFixture = await seedFinalizable(authorizationWorkspaceId);
  errorFixture = await seedFinalizable(errorWorkspaceId);
}, 60_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  if (operatorId) deleteUser(operatorId);
  for (const workspaceId of [
    directFixture?.workspaceId,
    authorizationFixture?.workspaceId,
    errorFixture?.workspaceId,
    otherWorkspaceId,
  ]) {
    if (workspaceId) deleteWorkspace(workspaceId);
  }
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close(err => err ? reject(err) : resolve());
    });
  }
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('brand voice finalization HTTP routes', () => {
  it('reads readiness without exposing private intake payloads', async () => {
    const res = await api(`/api/voice/${directFixture.workspaceId}/readiness`, {
      headers: operatorHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      profile: {
        id: directFixture.profileId,
        revision: directFixture.profileRevision,
        status: 'calibrating',
      },
      readiness: { state: 'missing' },
    });
    expect(body).toHaveProperty('eligibleAnchors');
    expect(JSON.stringify(body)).not.toContain('authenticSamples');
  });

  it('creates a server-attributed finalization, replays without effects, and invalidates once', async () => {
    const workspaceId = directFixture.workspaceId;
    const cacheKey = `voice-finalization-route-${randomUUID()}`;
    db.prepare(`
      INSERT INTO intelligence_sub_cache (workspace_id, cache_key, ttl_seconds, data)
      VALUES (?, ?, 300, '{}')
    `).run(workspaceId, cacheKey);
    db.prepare(`
      DELETE FROM activity_log
      WHERE workspace_id = ? AND type = 'voice_calibrated'
    `).run(workspaceId);

    const request = finalizationBody(directFixture, 'voice-finalization-route-create');
    const created = await postJson(`/api/voice/${workspaceId}/finalize`, request);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      created: boolean;
      replayed: boolean;
      profileRevision: number;
      snapshot: {
        id: string;
        voiceProfileId: string;
        voiceVersion: number;
        fingerprint: string;
        finalizedBy: { actorType: string; actorId: string; actorLabel?: string };
        executionActor: { actorType: string; actorId: string; actorLabel?: string };
      };
      readiness: { state: string };
    };
    expect(createdBody).toMatchObject({
      created: true,
      replayed: false,
      snapshot: {
        voiceProfileId: directFixture.profileId,
        voiceVersion: 1,
        finalizedBy: {
          actorType: 'operator',
          actorId: operatorId,
          actorLabel: 'Voice Finalization Operator',
        },
        executionActor: {
          actorType: 'operator',
          actorId: operatorId,
          actorLabel: 'Voice Finalization Operator',
        },
      },
      readiness: { state: 'finalized' },
    });
    expect(createdBody.snapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const finalizedProfileResponse = await api(`/api/voice/${workspaceId}`, {
      headers: operatorHeaders(),
    });
    expect(finalizedProfileResponse.status).toBe(200);
    await expect(finalizedProfileResponse.json()).resolves.toMatchObject({
      id: directFixture.profileId,
      status: 'calibrated',
      revision: createdBody.profileRevision,
    });
    expect(countCalibrationActivities(workspaceId)).toBe(1);
    expect(db.prepare(`
      SELECT actor_id AS actorId, actor_name AS actorName,
        json_extract(metadata, '$.finalizationId') AS finalizationId
      FROM activity_log
      WHERE workspace_id = ? AND type = 'voice_calibrated'
    `).get(workspaceId)).toEqual({
      actorId: operatorId,
      actorName: 'Voice Finalization Operator',
      finalizationId: createdBody.snapshot.id,
    });
    expect(db.prepare(`
      SELECT invalidated_at AS invalidatedAt
      FROM intelligence_sub_cache
      WHERE workspace_id = ? AND cache_key = ?
    `).get(workspaceId, cacheKey)).toMatchObject({ invalidatedAt: expect.any(String) });

    const createdEvents = broadcastState.calls.filter(
      call => call.event === WS_EVENTS.VOICE_PROFILE_UPDATED,
    );
    expect(createdEvents).toEqual([{
      workspaceId,
      event: WS_EVENTS.VOICE_PROFILE_UPDATED,
      payload: {
        workspaceId,
        voiceProfileId: directFixture.profileId,
        finalizationId: createdBody.snapshot.id,
        profileRevision: createdBody.profileRevision,
        voiceVersion: 1,
        status: 'calibrated',
      },
    }]);

    db.prepare(`
      UPDATE intelligence_sub_cache SET invalidated_at = NULL
      WHERE workspace_id = ? AND cache_key = ?
    `).run(workspaceId, cacheKey);
    broadcastState.calls = [];
    const replay = await postJson(`/api/voice/${workspaceId}/finalize`, request);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      created: false,
      replayed: true,
      snapshot: { id: createdBody.snapshot.id },
    });
    expect(countCalibrationActivities(workspaceId)).toBe(1);
    expect(broadcastState.calls).toEqual([]);
    expect(db.prepare(`
      SELECT invalidated_at AS invalidatedAt
      FROM intelligence_sub_cache
      WHERE workspace_id = ? AND cache_key = ?
    `).get(workspaceId, cacheKey)).toEqual({ invalidatedAt: null });

    const changedCommand = await postJson(`/api/voice/${workspaceId}/finalize`, {
      ...request,
      voiceDNA: {
        ...(request.voiceDNA as Record<string, unknown>),
        sentenceStyle: 'A different command cannot reuse the finalized idempotency key.',
      },
    });
    expect(changedCommand.status).toBe(409);
    await expect(changedCommand.json()).resolves.toMatchObject({
      code: 'voice_finalization_idempotency_conflict',
    });
    expect(countCalibrationActivities(workspaceId)).toBe(1);
    expect(broadcastState.calls).toEqual([]);
  });

  it('creates non-recoverable authorization tokens for exact operator-approved commands', async () => {
    const workspaceId = authorizationFixture.workspaceId;
    db.prepare(`
      DELETE FROM activity_log
      WHERE workspace_id = ? AND title = 'Authorized voice finalization'
    `).run(workspaceId);
    broadcastState.calls = [];
    const request = finalizationBody(
      authorizationFixture,
      'voice-finalization-route-authorization',
    );
    const created = await postJson(
      `/api/voice/${workspaceId}/finalization-authorizations`,
      request,
    );
    expect(created.status).toBe(201);
    const body = await created.json() as {
      authorization: {
        authorizationId: string;
        authorizedBy: { actorType: string; actorId: string; actorLabel?: string };
        consumedAt: string | null;
      };
      authorizationToken: string;
    };
    expect(body.authorization).toMatchObject({
      authorizedBy: {
        actorType: 'operator',
        actorId: operatorId,
        actorLabel: 'Voice Finalization Operator',
      },
      consumedAt: null,
    });
    expect(body.authorizationToken.length).toBeGreaterThan(20);
    const stored = db.prepare(`
      SELECT token_hash AS tokenHash, request_json AS requestJson
      FROM voice_finalization_authorizations
      WHERE id = ?
    `).get(body.authorization.authorizationId) as { tokenHash: string; requestJson: string };
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(body.authorizationToken);
    expect(stored.requestJson).not.toContain(body.authorizationToken);
    expect(countCalibrationActivities(workspaceId)).toBe(0);
    const activity = db.prepare(`
      SELECT title, description, metadata, actor_id AS actorId, actor_name AS actorName
      FROM activity_log
      WHERE workspace_id = ? AND title = 'Authorized voice finalization'
      ORDER BY created_at DESC LIMIT 1
    `).get(workspaceId) as Record<string, unknown>;
    expect(activity).toMatchObject({
      title: 'Authorized voice finalization',
      actorId: operatorId,
      actorName: 'Voice Finalization Operator',
    });
    expect(JSON.stringify(activity)).not.toContain(body.authorizationToken);
    expect(JSON.parse(activity.metadata as string)).toEqual({
      authorizationId: body.authorization.authorizationId,
      profileRevision: authorizationFixture.profileRevision,
      expiresAt: expect.any(String),
    });
    expect(broadcastState.calls).toEqual([{
      workspaceId,
      event: WS_EVENTS.VOICE_PROFILE_UPDATED,
      payload: { workspaceId },
    }]);

    broadcastState.calls = [];
    const second = await postJson(
      `/api/voice/${workspaceId}/finalization-authorizations`,
      request,
    );
    expect(second.status).toBe(201);
    const secondBody = await second.json() as {
      authorization: { authorizationId: string };
      authorizationToken: string;
    };
    expect(secondBody.authorization.authorizationId)
      .not.toBe(body.authorization.authorizationId);
    expect(secondBody.authorizationToken).not.toBe(body.authorizationToken);
    expect(countCalibrationActivities(workspaceId)).toBe(0);
    expect(JSON.stringify(broadcastState.calls)).not.toContain(secondBody.authorizationToken);
  });

  it('maps validation, stale revision, and generated-anchor prerequisites without effects', async () => {
    const workspaceId = errorFixture.workspaceId;
    db.prepare(`
      DELETE FROM activity_log
      WHERE workspace_id = ? AND type = 'voice_calibrated'
    `).run(workspaceId);

    const missing = await postJson(
      '/api/voice/voice-finalization-missing-workspace/finalize',
      finalizationBody(errorFixture, 'voice-finalization-route-missing'),
      {},
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      code: 'voice_finalization_not_found',
    });

    const invalid = await postJson(`/api/voice/${workspaceId}/finalize`, {
      ...finalizationBody(errorFixture, 'voice-finalization-route-invalid'),
      voiceDNA: { personalityTraits: [] },
    });
    expect(invalid.status).toBe(400);

    const stale = await postJson(
      `/api/voice/${workspaceId}/finalize`,
      finalizationBody(errorFixture, 'voice-finalization-route-stale', {
        expectedProfileRevision: errorFixture.profileRevision + 1,
      }),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: 'voice_finalization_conflict',
      actualRevision: errorFixture.profileRevision,
    });

    const generatedSample = await postJson(`/api/voice/${workspaceId}/samples`, {
      content: 'Generated calibration-loop copy must not become authentic evidence.',
      contextTag: 'body',
      source: 'calibration_loop',
    });
    expect(generatedSample.status).toBe(200);
    const generated = await generatedSample.json() as { id: string };
    const current = await api(`/api/voice/${workspaceId}`, { headers: operatorHeaders() });
    const profile = await current.json() as { revision: number };
    const generatedOnly = await postJson(
      `/api/voice/${workspaceId}/finalize`,
      finalizationBody(errorFixture, 'voice-finalization-route-generated-anchor', {
        expectedProfileRevision: profile.revision,
        anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: generated.id }],
      }),
    );
    expect(generatedOnly.status).toBe(422);
    await expect(generatedOnly.json()).resolves.toMatchObject({
      code: 'voice_finalization_precondition',
    });

    const corruptSessionId = `cal_corrupt_${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions (
        id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at
      ) VALUES (?, ?, 'body', ?, NULL, ?)
    `).run(
      corruptSessionId,
      errorFixture.profileId,
      JSON.stringify({ internalSecret: 'must-not-leak' }),
      new Date().toISOString(),
    );
    const corruptStoredSession = await postJson(
      `/api/voice/${workspaceId}/finalize`,
      finalizationBody(errorFixture, 'voice-finalization-route-corrupt-session', {
        expectedProfileRevision: profile.revision,
        calibrationSelections: [{
          sessionId: corruptSessionId,
          variationIndex: 0,
          rating: 'on_brand',
          selected: true,
        }],
      }),
    );
    expect(corruptStoredSession.status).toBe(500);
    const corruptBody = await corruptStoredSession.json() as Record<string, unknown>;
    expect(corruptBody).toEqual({ error: 'Failed to finalize brand voice' });
    expect(JSON.stringify(corruptBody)).not.toContain('internalSecret');
    expect(countCalibrationActivities(workspaceId)).toBe(0);
    expect(broadcastState.calls.filter(call => (
      call.event === WS_EVENTS.VOICE_PROFILE_UPDATED
      && (call.payload as { status?: string }).status === 'calibrated'
    ))).toEqual([]);
  });

  it('enforces workspace scope before readiness, finalization, or authorization creation', async () => {
    const foreignBody = finalizationBody(
      directFixture,
      'voice-finalization-route-cross-workspace',
    );
    const readiness = await api(`/api/voice/${otherWorkspaceId}/readiness`, {
      headers: operatorHeaders(),
    });
    expect(readiness.status).toBe(403);

    const finalize = await postJson(`/api/voice/${otherWorkspaceId}/finalize`, foreignBody);
    expect(finalize.status).toBe(403);

    const authorize = await postJson(
      `/api/voice/${otherWorkspaceId}/finalization-authorizations`,
      foreignBody,
    );
    expect(authorize.status).toBe(403);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM voice_profile_finalizations
      WHERE workspace_id = ?
    `).get(otherWorkspaceId)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM voice_finalization_authorizations
      WHERE workspace_id = ?
    `).get(otherWorkspaceId)).toEqual({ count: 0 });
  });
});
