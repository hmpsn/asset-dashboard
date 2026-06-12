/**
 * Integration tests for voice-calibration GET read paths.
 *
 * Covers:
 * - GET /api/voice/:workspaceId → 200 with null for fresh workspace (no profile yet)
 * - POST /api/voice/:workspaceId → 201 creates a draft profile
 * - GET /api/voice/:workspaceId → 200 with profile shape after creation
 * - GET /api/voice/:workspaceId/sessions → 200 with array (empty for fresh profile)
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Voice Calibration Read WS 13640').id;
}, 40_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voice/:workspaceId — before profile is created
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/voice/:workspaceId — fresh workspace', () => {
  it('returns 200 with null when no voice profile exists', async () => {
    const res = await api(`/api/voice/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voice/:workspaceId/sessions — fresh workspace
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/voice/:workspaceId/sessions — fresh workspace', () => {
  it('returns 200 with an empty array when no sessions exist', async () => {
    const res = await api(`/api/voice/${wsId}/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voice/:workspaceId — create a profile, then verify GET shape
// ─────────────────────────────────────────────────────────────────────────────

describe('POST then GET /api/voice/:workspaceId', () => {
  it('POST creates a draft voice profile → 201', async () => {
    const res = await postJson(`/api/voice/${wsId}`, {});
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.workspaceId).toBe(wsId);
    expect(body.status).toBe('draft');
    expect(Array.isArray(body.samples)).toBe(true);
    expect((body.samples as unknown[]).length).toBe(0);
  });

  it('GET returns the created profile with expected shape', async () => {
    const res = await api(`/api/voice/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toBeNull();
    expect(typeof body.id).toBe('string');
    expect(body.workspaceId).toBe(wsId);
    expect(body.status).toBe('draft');
    expect(Array.isArray(body.samples)).toBe(true);
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('GET /sessions returns an empty array after profile creation (no calibration yet)', async () => {
    const res = await api(`/api/voice/${wsId}/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
