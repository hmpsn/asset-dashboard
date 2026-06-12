/**
 * Integration tests for suggested-briefs read paths.
 * Covers GET list endpoint, GET single endpoint, and validation.
 * Avoids AI generation routes.
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Suggested Briefs Read WS 13690').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Suggested Briefs — GET list endpoint', () => {
  it('returns 200 with empty array for a fresh workspace', async () => {
    const res = await api(`/api/suggested-briefs/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns 200 with empty array when ?all=true for a fresh workspace', async () => {
    const res = await api(`/api/suggested-briefs/${wsId}?all=true`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns 200 with empty array for an unknown workspaceId (no workspace validation on list)', async () => {
    // listSuggestedBriefs queries by workspace_id without verifying workspace existence
    // so an unknown workspace ID returns an empty array rather than 404
    const res = await api('/api/suggested-briefs/ws_nonexistent_sb_99999');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('Suggested Briefs — GET single endpoint', () => {
  it('returns 404 when briefId does not exist', async () => {
    const res = await api(`/api/suggested-briefs/${wsId}/brief_nonexistent_99999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when workspaceId does not exist', async () => {
    const res = await api('/api/suggested-briefs/ws_nonexistent_sb_99999/brief_nonexistent_99999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Suggested Briefs — PATCH validation', () => {
  it('returns 400 when status is invalid', async () => {
    const res = await ctx.patchJson(`/api/suggested-briefs/${wsId}/brief_nonexistent_99999`, {
      status: 'invalid_status',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when PATCH targets a nonexistent briefId with valid status', async () => {
    const res = await ctx.patchJson(`/api/suggested-briefs/${wsId}/brief_nonexistent_99999`, {
      status: 'accepted',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
