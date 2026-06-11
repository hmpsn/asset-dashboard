/**
 * Integration tests for public-portal READ paths — keyword feedback, content gap votes, copy entries.
 *
 * Port: 13602
 *
 * Covers:
 * - GET /api/public/keyword-feedback/:workspaceId — 404 unknown, 200 with array
 * - GET /api/public/content-gap-votes/:workspaceId — 404 unknown, 200 with { votes: {} }
 * - GET /api/public/copy/:workspaceId/entries — 404 unknown, 200 with { entries: [] }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createTestContext(13602, { autoPublicAuth: true });
const { api } = ctx;

const UNKNOWN = 'nonexistent-ws-feedback-99999';

let ws: SeededFullWorkspace;

beforeAll(async () => {
  await ctx.startServer();
  ws = seedWorkspace({ clientPassword: '' });
}, 25_000);

afterAll(async () => {
  ws.cleanup();
  await ctx.stopServer();
});

// ── GET /api/public/keyword-feedback/:workspaceId ─────────────────────────────

describe('GET /api/public/keyword-feedback/:workspaceId', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/keyword-feedback/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace', async () => {
    const res = await api(`/api/public/keyword-feedback/${ws.workspaceId}`);
    expect(res.status).toBe(200);
  });

  it('returns an array (empty for fresh workspace)', async () => {
    const res = await api(`/api/public/keyword-feedback/${ws.workspaceId}`);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace has no keyword feedback rows', async () => {
    const res = await api(`/api/public/keyword-feedback/${ws.workspaceId}`);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(0);
  });
});

// ── GET /api/public/content-gap-votes/:workspaceId ───────────────────────────

describe('GET /api/public/content-gap-votes/:workspaceId', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/content-gap-votes/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace', async () => {
    const res = await api(`/api/public/content-gap-votes/${ws.workspaceId}`);
    expect(res.status).toBe(200);
  });

  it('returns object with { votes } key', async () => {
    const res = await api(`/api/public/content-gap-votes/${ws.workspaceId}`);
    const body = await res.json() as { votes: unknown };
    expect(body).toHaveProperty('votes');
  });

  it('votes is a plain object (not an array)', async () => {
    const res = await api(`/api/public/content-gap-votes/${ws.workspaceId}`);
    const body = await res.json() as { votes: unknown };
    expect(typeof body.votes).toBe('object');
    expect(body.votes).not.toBeNull();
    expect(Array.isArray(body.votes)).toBe(false);
  });

  it('fresh workspace has empty votes map', async () => {
    const res = await api(`/api/public/content-gap-votes/${ws.workspaceId}`);
    const body = await res.json() as { votes: Record<string, string> };
    expect(Object.keys(body.votes)).toHaveLength(0);
  });
});

// ── GET /api/public/copy/:workspaceId/entries ─────────────────────────────────

describe('GET /api/public/copy/:workspaceId/entries', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/copy/${UNKNOWN}/entries`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace with portal enabled', async () => {
    // seedWorkspace does not set clientPortalEnabled explicitly — it defaults to enabled
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    expect(res.status).toBe(200);
  });

  it('returns { entries } key', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    const body = await res.json() as { entries: unknown };
    expect(body).toHaveProperty('entries');
  });

  it('entries is an array', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    const body = await res.json() as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('fresh workspace with no copy sections has empty entries array', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    const body = await res.json() as { entries: unknown[] };
    // A fresh workspace has no blueprints/entries — list should be empty
    expect(body.entries).toHaveLength(0);
  });
});
