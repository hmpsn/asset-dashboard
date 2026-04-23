/**
 * Integration tests for voice-calibration route hardening (Task 5).
 *
 * Tests:
 * 1. GET before POST returns null (no side-effect creation)
 * 2. First POST creates a draft profile → 201; second POST → 409
 * 3. POST /calibration-feedback persists feedback; follow-up sessions GET includes it
 * 4. Free-tier POST /calibrate returns 429 with code: 'usage_limit'
 * 5. Bad payload on /calibration-feedback (missing feedback) → 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

// Port 13321 is taken by keyword-strategy-concurrent-guard.test.ts (const PORT, not createTestContext).
// 13323 is taken by brandscript-hardening.test.ts; 13324 is the next free port.
const ctx = createTestContext(13324); // port-ok: 13201-13323 fully allocated; extending range
const { api, postJson } = ctx;

let testWsId = '';
let freeWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Voice Hardening Test Workspace');
  testWsId = ws.id;
  // Free-tier workspace for rate-limit tests
  const freeWs = createWorkspace('Voice Hardening Free Workspace');
  freeWsId = freeWs.id;
}, 30_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  deleteWorkspace(freeWsId);
  ctx.stopServer();
});

describe('Voice Calibration Hardening — GET before POST returns null', () => {
  it('GET /api/voice/:workspaceId before any POST returns null (no auto-create)', async () => {
    const res = await api(`/api/voice/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // After A5 fix: GET should return null when no profile exists, not auto-create
    expect(body).toBeNull();
  });
});

describe('Voice Calibration Hardening — Explicit POST create', () => {
  it('First POST /api/voice/:workspaceId creates draft profile → 201', async () => {
    const res = await postJson(`/api/voice/${testWsId}`, {});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.status).toBe('draft');
    expect(body.workspaceId).toBe(testWsId);
    expect(Array.isArray(body.samples)).toBe(true);
    expect(body.samples.length).toBe(0);
  });

  it('Second POST /api/voice/:workspaceId → 409 (already exists)', async () => {
    const res = await postJson(`/api/voice/${testWsId}`, {});
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET now returns the created profile', async () => {
    const res = await api(`/api/voice/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.status).toBe('draft');
    expect(body.workspaceId).toBe(testWsId);
  });
});

describe('Voice Calibration Hardening — Feedback persistence', () => {
  let sessionId = '';

  beforeAll(() => {
    // Seed a calibration session directly in the DB for this workspace
    // First get the voice profile id
    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(testWsId) as { id: string } | undefined;

    if (!profileRow) {
      throw new Error('Voice profile not found — depends on "Explicit POST create" group running first');
    }

    const sid = `cal_test_${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions
        (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sid,
      profileRow.id,
      'headline',
      JSON.stringify([{ text: 'Variation A' }, { text: 'Variation B' }, { text: 'Variation C' }]),
      null,
      new Date().toISOString(),
    );
    sessionId = sid;
  });

  it('POST /api/voice/:workspaceId/calibration-feedback persists feedback → 204', async () => {
    const res = await postJson(`/api/voice/${testWsId}/calibration-feedback`, {
      sessionId,
      variationIndex: 1,
      feedback: 'Love the rhythm but tone it down a bit',
    });
    expect(res.status).toBe(204);
  });

  it('GET /api/voice/:workspaceId/sessions includes feedback in the session', async () => {
    const res = await api(`/api/voice/${testWsId}/sessions`);
    expect(res.status).toBe(200);
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
    const session = sessions.find((s: { id: string }) => s.id === sessionId);
    expect(session).toBeDefined();
    // variationFeedback should be present and contain our item
    expect(Array.isArray(session.variationFeedback)).toBe(true);
    expect(session.variationFeedback.length).toBe(1);
    expect(session.variationFeedback[0].variationIndex).toBe(1);
    expect(session.variationFeedback[0].feedback).toBe('Love the rhythm but tone it down a bit');
  });

  it('POST /calibration-feedback with non-existent sessionId → 404', async () => {
    const res = await postJson(`/api/voice/${testWsId}/calibration-feedback`, {
      sessionId: 'cal_nonexistent',
      variationIndex: 0,
      feedback: 'Some feedback',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Voice Calibration Hardening — Rate limit (free tier)', () => {
  it('POST /api/voice/:workspaceId/calibrate returns 429 with code: usage_limit for free tier', async () => {
    // First create a profile for freeWsId
    await postJson(`/api/voice/${freeWsId}`, {});

    const res = await postJson(`/api/voice/${freeWsId}/calibrate`, {
      promptType: 'headline',
      steeringNotes: 'Test',
    });
    // Free tier has voice_calibrations limit = 0, so first call should be 429
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('code', 'usage_limit');
  });
});

describe('Voice Calibration Hardening — Validation', () => {
  it('POST /calibration-feedback with missing feedback field → 400', async () => {
    const res = await postJson(`/api/voice/${testWsId}/calibration-feedback`, {
      sessionId: '00000000-0000-0000-0000-000000000001',
      variationIndex: 0,
      // feedback is missing
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /calibration-feedback with variationIndex out of range → 400', async () => {
    const res = await postJson(`/api/voice/${testWsId}/calibration-feedback`, {
      sessionId: 'cal_somesession',
      variationIndex: 200, // max is 100
      feedback: 'Some feedback',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
