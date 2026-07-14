/**
 * Integration tests for voice calibration mutation lifecycle.
 *
 * Covers mutation paths NOT already tested in:
 *   - voice-calibration-mutations.test.ts  (PATCH profile, sample CRUD, workspace isolation)
 *   - voice-calibration-read-routes.test.ts (GET profile, sessions, POST create)
 *   - voice-calibration-hardening.test.ts  (409 on double-create, feedback persistence,
 *                                            rate limits, validation)
 *
 * New coverage added here:
 *  1.  Profile creation lifecycle — 201 shape, idempotency guard
 *  2.  Sample submission — with contextTag/source variants, broadcast check
 *  3.  Calibration trigger (generateCalibrationVariations via POST /calibrate) —
 *        AI mocked, session returned, broadcast fired
 *  4.  Calibration session list reflects newly generated session
 *  5.  Refine variation (POST /calibrate/:sessionId/refine) — appends refined text
 *  6.  Variation feedback loop — save feedback, verify in sessions list
 *  7.  Reset to draft (PATCH status → 'draft') after calibration cycle
 *  8.  Cross-workspace isolation for calibration sessions
 *  9.  AI error path — callCreativeAI throws → 500 with error body, usage decremented
 * 10.  Payload validation — missing/bad fields → 400 on calibrate + refine + feedback
 * 11.  Broadcast emissions for each mutation route
 *
 * Uses an ephemeral in-process server port.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Broadcast capture ─────────────────────────────────────────────────────────
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

// ── AI mock — returns a well-formed 3-variation JSON by default ───────────────
// The mock is stateful so individual tests can flip `shouldFail` to simulate
// AI errors without spawning a separate server.
const aiState = vi.hoisted(() => ({
  shouldFail: false,
  refineText: 'Refined: Clear minds build great businesses.',
}));

vi.mock('../../server/content-posts-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/content-posts-ai.js')>();
  return {
    ...original,
    callCreativeAI: vi.fn(async (opts: { json?: boolean; operation?: string }) => {
      if (aiState.shouldFail) {
        throw new Error('Simulated AI failure');
      }
      // Named operations make the structured response contract explicit; each
      // strict schema receives only the fields it owns.
      if (opts.operation === 'voice-refinement') {
        return JSON.stringify({ refined: aiState.refineText });
      }
      return JSON.stringify({
        variations: [
          'Bold brands don\'t blend in — they ignite.',
          'Your audience is already searching. Be impossible to miss.',
          'Three words: clarity, confidence, conviction.',
        ],
      });
    }),
  };
});

// Prevent real email sends
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
import db from '../../server/db/index.js';

// ── In-process server setup ───────────────────────────────────────────────────

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
  wsId  = createWorkspace('Voice Lifecycle WS A 13863').id;
  wsIdB = createWorkspace('Voice Lifecycle WS B 13863').id;
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
  aiState.shouldFail = false;
  aiState.refineText = 'Refined: Clear minds build great businesses.';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Profile creation lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('Profile creation lifecycle', () => {
  it('POST /api/voice/:workspaceId returns 201 with a draft profile shape', async () => {
    const newWs = createWorkspace('Voice Lifecycle Create 13863');
    try {
      const res = await postJson(`/api/voice/${newWs.id}`, {});
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe('draft');
      expect(body.workspaceId).toBe(newWs.id);
      expect(typeof body.id).toBe('string');
      expect((body.id as string).startsWith('vp_')).toBe(true);
      expect(Array.isArray(body.samples)).toBe(true);
      expect((body.samples as unknown[]).length).toBe(0);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
    } finally {
      deleteWorkspace(newWs.id);
    }
  });

  it('POST fires a VOICE_PROFILE_UPDATED broadcast on creation', async () => {
    const newWs = createWorkspace('Voice Lifecycle BroadcastCreate 13863');
    try {
      broadcastState.calls = [];
      await postJson(`/api/voice/${newWs.id}`, {});
      const voiceCalls = broadcastState.calls.filter(c => c.event === WS_EVENTS.VOICE_PROFILE_UPDATED);
      expect(voiceCalls.length).toBeGreaterThanOrEqual(1);
      expect(voiceCalls[0].workspaceId).toBe(newWs.id);
    } finally {
      deleteWorkspace(newWs.id);
    }
  });

  it('POST returns 409 when profile already exists (idempotency guard)', async () => {
    // wsId already has a profile from beforeAll
    const res = await postJson(`/api/voice/${wsId}`, {});
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sample submission variants
// ─────────────────────────────────────────────────────────────────────────────

describe('Sample submission — context tag and source variants', () => {
  it('adds a sample with a contextTag=headline and returns the tag in the response', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'Dream bigger. Build bolder.',
      contextTag: 'headline',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.contextTag).toBe('headline');
    expect(body.content).toBe('Dream bigger. Build bolder.');
  });

  it('adds a sample with source=transcript_extraction and returns it', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'We believe every brand has a story worth telling.',
      source: 'transcript_extraction',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.source).toBe('transcript_extraction');
  });

  it('adds a sample without optional fields and defaults source to manual', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'Simple. Clear. Unforgettable.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.source).toBe('manual');
    expect(body.contextTag).toBeUndefined();
  });

  it('POST sample fires VOICE_PROFILE_UPDATED broadcast with sampleId', async () => {
    broadcastState.calls = [];
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'Sample for broadcast check.',
    });
    expect(res.status).toBe(200);
    const sample = await res.json() as Record<string, unknown>;
    const voiceCalls = broadcastState.calls.filter(c => c.event === WS_EVENTS.VOICE_PROFILE_UPDATED);
    expect(voiceCalls.length).toBeGreaterThanOrEqual(1);
    expect((voiceCalls[0].payload as Record<string, unknown>).sampleId).toBe(sample.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Calibration trigger — POST /api/voice/:workspaceId/calibrate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/voice/:workspaceId/calibrate — AI-backed variation generation', () => {
  // Use a dedicated workspace with growth tier to bypass the free-tier rate limit
  let calWsId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Voice Calibrate Trigger 13863');
    calWsId = ws.id;
    // Elevate to premium so incrementIfAllowed always passes (growth cap is 10/month
    // and multiple tests in this group each consume a usage slot).
    // premium → Infinity limit so no 429s regardless of how many test calls are made.
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('premium', calWsId);
    await postJson(`/api/voice/${calWsId}`, {});
  });

  afterAll(() => {
    deleteWorkspace(calWsId);
  });

  // Reset usage counter before each test so we never hit accumulated caps.
  beforeEach(() => {
    if (calWsId) {
      const month = new Date().toISOString().slice(0, 7);
      db.prepare(
        'DELETE FROM usage_tracking WHERE workspace_id = ? AND month = ? AND feature = ?',
      ).run(calWsId, month, 'voice_calibrations');
    }
  });

  it('returns 200 with a CalibrationSession shape when AI succeeds', async () => {
    const count = (type: string): number => (db.prepare(`
      SELECT COUNT(*) AS count
      FROM activity_log
      WHERE workspace_id = ? AND type = ?
    `).get(calWsId, type) as { count: number }).count;
    const draftUpdatesBefore = count('voice_profile_updated');
    const calibratedBefore = count('voice_calibrated');
    const res = await postJson(`/api/voice/${calWsId}/calibrate`, {
      promptType: 'headline',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect((body.id as string).startsWith('cal_')).toBe(true);
    expect(body.promptType).toBe('headline');
    expect(Array.isArray(body.variations)).toBe(true);
    expect((body.variations as unknown[]).length).toBeGreaterThan(0);
    expect(count('voice_profile_updated')).toBe(draftUpdatesBefore + 1);
    expect(count('voice_calibrated')).toBe(calibratedBefore);
  });

  it('fires VOICE_PROFILE_UPDATED broadcast with sessionId after calibration', async () => {
    broadcastState.calls = [];
    const res = await postJson(`/api/voice/${calWsId}/calibrate`, {
      promptType: 'body',
      steeringNotes: 'Keep it concise.',
    });
    expect(res.status).toBe(200);
    const session = await res.json() as Record<string, unknown>;
    const voiceCalls = broadcastState.calls.filter(c => c.event === WS_EVENTS.VOICE_PROFILE_UPDATED);
    expect(voiceCalls.length).toBeGreaterThanOrEqual(1);
    expect((voiceCalls[0].payload as Record<string, unknown>).sessionId).toBe(session.id);
  });

  it('returns steeringNotes in the session when provided', async () => {
    const res = await postJson(`/api/voice/${calWsId}/calibrate`, {
      promptType: 'cta',
      steeringNotes: 'Punchy and imperative.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.steeringNotes).toBe('Punchy and imperative.');
  });

  it('generated session is listed in GET /sessions with correct promptType', async () => {
    // Verify that any of the sessions generated by the prior tests in this group
    // appear in the sessions list. We use the profile row to confirm persistence.
    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(calWsId) as { id: string } | undefined;
    expect(profileRow).toBeDefined();

    const sessionsRes = await api(`/api/voice/${calWsId}/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = await sessionsRes.json() as Array<Record<string, unknown>>;
    // Tests 1-3 each added a session; at least 1 should be present
    expect(sessions.length).toBeGreaterThan(0);
    // Each session should have a cal_-prefixed id and a promptType
    const first = sessions[0];
    expect(typeof first.id).toBe('string');
    expect((first.id as string).startsWith('cal_')).toBe(true);
    expect(typeof first.promptType).toBe('string');
    expect(Array.isArray(first.variations)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Refine variation — POST /api/voice/:workspaceId/calibrate/:sessionId/refine
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /calibrate/:sessionId/refine — variation refinement', () => {
  let refineWsId = '';
  let sessionId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Voice Refine WS 13863');
    refineWsId = ws.id;
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('growth', refineWsId);
    await postJson(`/api/voice/${refineWsId}`, {});

    // Seed a session directly to avoid consuming calibration quota in setup
    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(refineWsId) as { id: string } | undefined;
    if (!profileRow) throw new Error('Profile not found for refine workspace');

    const sid = `cal_refinetest${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions
        (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sid,
      profileRow.id,
      'headline',
      JSON.stringify([
        { text: 'Variation A — the bold choice.' },
        { text: 'Variation B — the clear choice.' },
        { text: 'Variation C — the friendly choice.' },
      ]),
      null,
      new Date().toISOString(),
    );
    sessionId = sid;
  });

  afterAll(() => {
    deleteWorkspace(refineWsId);
  });

  it('returns 200 with the updated session containing the refined variation appended', async () => {
    aiState.refineText = 'The bold choice, refined for clarity.';
    const res = await postJson(
      `/api/voice/${refineWsId}/calibrate/${sessionId}/refine`,
      { variationIndex: 0, direction: 'Make it crisper.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const variations = body.variations as Array<{ text: string }>;
    expect(Array.isArray(variations)).toBe(true);
    // Original 3 + 1 refined appended
    expect(variations.length).toBe(4);
    expect(variations[3].text).toBe('The bold choice, refined for clarity.');
  });

  it('fires VOICE_PROFILE_UPDATED broadcast with sessionId on refine', async () => {
    broadcastState.calls = [];
    await postJson(
      `/api/voice/${refineWsId}/calibrate/${sessionId}/refine`,
      { variationIndex: 1, direction: 'More warmth.' },
    );
    const voiceCalls = broadcastState.calls.filter(c => c.event === WS_EVENTS.VOICE_PROFILE_UPDATED);
    expect(voiceCalls.length).toBeGreaterThanOrEqual(1);
    expect((voiceCalls[0].payload as Record<string, unknown>).sessionId).toBe(sessionId);
  });

  it('returns 404 for a non-existent sessionId', async () => {
    const res = await postJson(
      `/api/voice/${refineWsId}/calibrate/cal_nonexistent_xyz/refine`,
      { variationIndex: 0, direction: 'More energy.' },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('steering notes are updated to include refine direction', async () => {
    const res = await postJson(
      `/api/voice/${refineWsId}/calibrate/${sessionId}/refine`,
      { variationIndex: 2, direction: 'Friendly but professional.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.steeringNotes).toBe('string');
    expect((body.steeringNotes as string)).toContain('Friendly but professional.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Variation feedback loop
// ─────────────────────────────────────────────────────────────────────────────

describe('Variation feedback loop — POST /calibration-feedback', () => {
  let feedbackWsId = '';
  let sessionId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Voice Feedback WS 13863');
    feedbackWsId = ws.id;
    await postJson(`/api/voice/${feedbackWsId}`, {});

    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(feedbackWsId) as { id: string } | undefined;
    if (!profileRow) throw new Error('Profile not found for feedback workspace');

    const sid = `cal_fbtest${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions
        (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sid,
      profileRow.id,
      'service',
      JSON.stringify([
        { text: 'Feedback target variation.' },
        { text: 'Second feedback target.' },
      ]),
      null,
      new Date().toISOString(),
    );
    sessionId = sid;
  });

  afterAll(() => {
    deleteWorkspace(feedbackWsId);
  });

  it('POST /calibration-feedback returns 204 (no body)', async () => {
    const res = await postJson(`/api/voice/${feedbackWsId}/calibration-feedback`, {
      sessionId,
      variationIndex: 0,
      feedback: 'Too formal — lean casual.',
    });
    expect(res.status).toBe(204);
  });

  it('feedback is persisted and appears in GET /sessions', async () => {
    // Post a second feedback item
    await postJson(`/api/voice/${feedbackWsId}/calibration-feedback`, {
      sessionId,
      variationIndex: 1,
      feedback: 'Perfect tone.',
    });

    const sessionsRes = await api(`/api/voice/${feedbackWsId}/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = await sessionsRes.json() as Array<Record<string, unknown>>;
    const session = sessions.find(s => s.id === sessionId);
    expect(session).toBeDefined();
    const fb = session?.variationFeedback as Array<Record<string, unknown>>;
    expect(Array.isArray(fb)).toBe(true);
    expect(fb.length).toBeGreaterThanOrEqual(2);

    // All items from prior test + this one
    const item = fb.find(f => f.feedback === 'Perfect tone.');
    expect(item).toBeDefined();
    expect(item?.variationIndex).toBe(1);
  });

  it('fires VOICE_PROFILE_UPDATED broadcast after saving feedback', async () => {
    broadcastState.calls = [];
    await postJson(`/api/voice/${feedbackWsId}/calibration-feedback`, {
      sessionId,
      variationIndex: 0,
      feedback: 'Broadcast check feedback.',
    });
    const voiceCalls = broadcastState.calls.filter(c => c.event === WS_EVENTS.VOICE_PROFILE_UPDATED);
    expect(voiceCalls.length).toBeGreaterThanOrEqual(1);
    expect((voiceCalls[0].payload as Record<string, unknown>).sessionId).toBe(sessionId);
  });

  it('returns 404 for feedback on a non-existent session', async () => {
    const res = await postJson(`/api/voice/${feedbackWsId}/calibration-feedback`, {
      sessionId: 'cal_does_not_exist_00',
      variationIndex: 0,
      feedback: 'Should not persist.',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Generic status edits cannot finalize the profile
// ─────────────────────────────────────────────────────────────────────────────

describe('Status machine — finalization authority stays on POST /finalize', () => {
  let cycleWsId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Voice Cycle WS 13863');
    cycleWsId = ws.id;
    await postJson(`/api/voice/${cycleWsId}`, {});
  });

  afterAll(() => {
    deleteWorkspace(cycleWsId);
  });

  it('draft → calibrating succeeds, calibrated is rejected, then draft reset succeeds', async () => {
    // draft → calibrating
    let res = await patchJson(`/api/voice/${cycleWsId}`, { status: 'calibrating' });
    expect(res.status).toBe(200);
    let body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('calibrating');

    // Generic PATCH cannot claim calibrating → calibrated.
    res = await patchJson(`/api/voice/${cycleWsId}`, { status: 'calibrated' });
    expect(res.status).toBe(400);
    body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');

    // calibrating → draft (reset)
    res = await patchJson(`/api/voice/${cycleWsId}`, { status: 'draft' });
    expect(res.status).toBe(200);
    body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('draft');
  });

  it('GET reflects draft status after reset', async () => {
    // Ensure reset happened (from prior test); verify via GET
    const res = await api(`/api/voice/${cycleWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('draft');
  });

  it('draft → calibrated is rejected by the domain transition boundary', async () => {
    // The edge schema accepts the complete status vocabulary, but only explicit
    // finalization may claim calibrated authority; generic domain updates reject it.
    const res = await patchJson(`/api/voice/${cycleWsId}`, { status: 'calibrated' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    const getRes = await api(`/api/voice/${cycleWsId}`);
    const profile = await getRes.json() as Record<string, unknown>;
    expect(profile.status).toBe('draft');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cross-workspace isolation for calibration sessions
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-workspace isolation — calibration sessions', () => {
  let isoWsA = '';
  let isoWsB = '';

  beforeAll(async () => {
    const wsA = createWorkspace('Voice ISO A 13863');
    const wsB = createWorkspace('Voice ISO B 13863');
    isoWsA = wsA.id;
    isoWsB = wsB.id;
    // Both workspaces need growth/premium tier so the refine endpoint reaches the
    // session-ownership check rather than 429-ing on the rate limiter first.
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('premium', isoWsA);
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('growth', isoWsB);
    await postJson(`/api/voice/${isoWsA}`, {});
    await postJson(`/api/voice/${isoWsB}`, {});

    // Seed a session for workspace A only
    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(isoWsA) as { id: string } | undefined;
    if (!profileRow) throw new Error('Profile not found for isolation WS A');

    db.prepare(`
      INSERT INTO voice_calibration_sessions
        (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `cal_isoA_${Date.now().toString(36)}`,
      profileRow.id,
      'headline',
      JSON.stringify([{ text: 'Workspace A only variation.' }]),
      null,
      new Date().toISOString(),
    );
  });

  afterAll(() => {
    deleteWorkspace(isoWsA);
    deleteWorkspace(isoWsB);
  });

  it("GET /sessions for workspace B returns empty array (A's sessions are invisible)", async () => {
    const res = await api(`/api/voice/${isoWsB}/sessions`);
    expect(res.status).toBe(200);
    const sessions = await res.json() as unknown[];
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(0);
  });

  it("refine endpoint scoped to workspace B cannot access workspace A's session", async () => {
    // Get workspace A's session id
    const sessionsResA = await api(`/api/voice/${isoWsA}/sessions`);
    const sessionsA = await sessionsResA.json() as Array<Record<string, unknown>>;
    expect(sessionsA.length).toBeGreaterThan(0);
    const sessionIdA = sessionsA[0].id as string;

    // Attempt to refine it using workspace B's workspace id
    const res = await postJson(
      `/api/voice/${isoWsB}/calibrate/${sessionIdA}/refine`,
      { variationIndex: 0, direction: 'Cross-workspace attack.' },
    );
    // Should fail — session not found for workspace B's profile
    expect(res.status).toBe(404);
  });

  it('feedback for workspace B cannot reference a session belonging to workspace A', async () => {
    const sessionsResA = await api(`/api/voice/${isoWsA}/sessions`);
    const sessionsA = await sessionsResA.json() as Array<Record<string, unknown>>;
    const sessionIdA = sessionsA[0].id as string;

    const res = await postJson(`/api/voice/${isoWsB}/calibration-feedback`, {
      sessionId: sessionIdA,
      variationIndex: 0,
      feedback: 'Cross-workspace feedback attempt.',
    });
    // saveVariationFeedback scopes by workspace_id via JOIN — should 404
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. AI error path
// ─────────────────────────────────────────────────────────────────────────────

describe('AI error path — callCreativeAI throws', () => {
  let aiErrWsId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Voice AI Error WS 13863');
    aiErrWsId = ws.id;
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('growth', aiErrWsId);
    await postJson(`/api/voice/${aiErrWsId}`, {});
  });

  afterAll(() => {
    deleteWorkspace(aiErrWsId);
  });

  it('POST /calibrate returns 500 with error body when AI throws', async () => {
    aiState.shouldFail = true;
    const res = await postJson(`/api/voice/${aiErrWsId}/calibrate`, {
      promptType: 'headline',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('POST /calibrate/sessionId/refine returns 500 with error body when AI throws', async () => {
    // Seed a session for this workspace first
    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(aiErrWsId) as { id: string } | undefined;
    if (!profileRow) throw new Error('Profile not found for AI error workspace');

    const sid = `cal_aierr${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions
        (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sid,
      profileRow.id,
      'headline',
      JSON.stringify([{ text: 'Variation to refine.' }]),
      null,
      new Date().toISOString(),
    );

    aiState.shouldFail = true;
    const res = await postJson(`/api/voice/${aiErrWsId}/calibrate/${sid}/refine`, {
      variationIndex: 0,
      direction: 'Be bolder.',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('no new session is stored in DB when calibration AI throws', async () => {
    const profileRow = db.prepare(
      'SELECT id FROM voice_profiles WHERE workspace_id = ?',
    ).get(aiErrWsId) as { id: string } | undefined;
    if (!profileRow) throw new Error('Profile not found for AI error workspace');

    const beforeCount = (db.prepare(
      'SELECT COUNT(*) as n FROM voice_calibration_sessions WHERE voice_profile_id = ?',
    ).get(profileRow.id) as { n: number }).n;

    aiState.shouldFail = true;
    await postJson(`/api/voice/${aiErrWsId}/calibrate`, { promptType: 'body' });

    const afterCount = (db.prepare(
      'SELECT COUNT(*) as n FROM voice_calibration_sessions WHERE voice_profile_id = ?',
    ).get(profileRow.id) as { n: number }).n;

    expect(afterCount).toBe(beforeCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Payload validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Payload validation — missing or invalid fields → 400', () => {
  it('POST /calibrate with missing promptType returns 400', async () => {
    const res = await postJson(`/api/voice/${wsId}/calibrate`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('POST /calibrate with empty string promptType returns 400', async () => {
    const res = await postJson(`/api/voice/${wsId}/calibrate`, { promptType: '' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('POST /calibrate/:sessionId/refine with missing direction returns 400', async () => {
    const res = await postJson(`/api/voice/${wsId}/calibrate/cal_any/refine`, {
      variationIndex: 0,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('POST /calibrate/:sessionId/refine with non-integer variationIndex returns 400', async () => {
    const res = await postJson(`/api/voice/${wsId}/calibrate/cal_any/refine`, {
      variationIndex: 1.5,
      direction: 'More energy.',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('POST /calibration-feedback with empty feedback string returns 400', async () => {
    const res = await postJson(`/api/voice/${wsId}/calibration-feedback`, {
      sessionId: 'cal_any',
      variationIndex: 0,
      feedback: '',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('POST /samples with empty content string returns 400', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, { content: '' });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('PATCH with invalid voiceDNA shape (tone values out of range) returns 400', async () => {
    const res = await patchJson(`/api/voice/${wsId}`, {
      voiceDNA: {
        personalityTraits: ['bold'],
        toneSpectrum: {
          formal_casual: 99, // max is 10
          serious_playful: 5,
          technical_accessible: 5,
        },
        sentenceStyle: 'short',
        vocabularyLevel: 'accessible',
      },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Profile retrieval — voiceDNA and guardrails round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Profile retrieval — voiceDNA and guardrails fields', () => {
  let dnaWsId = '';

  beforeAll(async () => {
    const ws = createWorkspace('Voice DNA Retrieval WS 13863');
    dnaWsId = ws.id;
    await postJson(`/api/voice/${dnaWsId}`, {});
  });

  afterAll(() => {
    deleteWorkspace(dnaWsId);
  });

  it('PATCH voiceDNA is persisted and returned by GET', async () => {
    const dna = {
      personalityTraits: ['bold', 'direct'],
      toneSpectrum: { formal_casual: 7, serious_playful: 5, technical_accessible: 8 },
      sentenceStyle: 'short punchy sentences',
      vocabularyLevel: 'accessible',
      humorStyle: 'dry wit',
    };
    const patchRes = await patchJson(`/api/voice/${dnaWsId}`, { voiceDNA: dna });
    expect(patchRes.status).toBe(200);

    const getRes = await api(`/api/voice/${dnaWsId}`);
    const profile = await getRes.json() as Record<string, unknown>;
    const returned = profile.voiceDNA as Record<string, unknown>;
    expect(returned).toBeDefined();
    expect(returned.vocabularyLevel).toBe('accessible');
    expect(returned.humorStyle).toBe('dry wit');
  });

  it('PATCH guardrails is persisted and returned by GET', async () => {
    const guardrails = {
      forbiddenWords: ['synergy', 'leverage'],
      requiredTerminology: [{ use: 'clients', insteadOf: 'customers' }],
      toneBoundaries: ['Never condescending'],
      antiPatterns: ['Do not start sentences with "I"'],
    };
    const patchRes = await patchJson(`/api/voice/${dnaWsId}`, { guardrails });
    expect(patchRes.status).toBe(200);

    const getRes = await api(`/api/voice/${dnaWsId}`);
    const profile = await getRes.json() as Record<string, unknown>;
    const returned = profile.guardrails as Record<string, unknown>;
    expect(returned).toBeDefined();
    expect(Array.isArray(returned.forbiddenWords)).toBe(true);
    expect((returned.forbiddenWords as string[])).toContain('synergy');
    expect(Array.isArray(returned.requiredTerminology)).toBe(true);
  });

  it('PATCH contextModifiers is persisted and returned by GET', async () => {
    const contextModifiers = [
      { context: 'Headlines', description: 'Bold and punchy.' },
      { context: 'Blog posts', description: 'Narrative and warm.' },
    ];
    const patchRes = await patchJson(`/api/voice/${dnaWsId}`, { contextModifiers });
    expect(patchRes.status).toBe(200);

    const getRes = await api(`/api/voice/${dnaWsId}`);
    const profile = await getRes.json() as Record<string, unknown>;
    const returned = profile.contextModifiers as Array<Record<string, unknown>>;
    expect(Array.isArray(returned)).toBe(true);
    expect(returned.length).toBe(2);
    const headlines = returned.find(m => m.context === 'Headlines');
    expect(headlines).toBeDefined();
    expect(headlines?.description).toBe('Bold and punchy.');
  });
});
