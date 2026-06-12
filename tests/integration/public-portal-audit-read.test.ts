/**
 * Integration tests for public-portal READ paths — audit summary and detail.
 *
 *
 * Covers:
 * - GET /api/public/audit-summary/:workspaceId  — 404 unknown, 400 no-site, 200/null for linked site
 * - GET /api/public/audit-detail/:workspaceId   — 404 unknown, 400 no-site, 200/null for linked site
 * - GET /api/public/business-priorities/:workspaceId — 404 unknown, 200 with shape
 *
 * Note: audit endpoints require a workspace with a webflowSiteId. For a fresh workspace with
 * no snapshots, they return null (200). Webflow API is NOT called — these are read-only DB paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const UNKNOWN = 'nonexistent-ws-audit-99999';

// Workspace with a webflowSiteId (for audit endpoints that require it)
let seededWs: SeededFullWorkspace;

// Workspace without webflowSiteId (for testing the 400 "no site linked" path)
let bareWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  // seedWorkspace always sets a webflowSiteId
  seededWs = seedWorkspace({ clientPassword: '' });
  // createWorkspace produces a workspace with no webflowSiteId
  const bareWs = createWorkspace('Public Portal Audit Bare WS 13601');
  bareWsId = bareWs.id;
}, 25_000);

afterAll(async () => {
  seededWs.cleanup();
  deleteWorkspace(bareWsId);
  await ctx.stopServer();
});

// ── GET /api/public/audit-summary/:workspaceId ────────────────────────────────

describe('GET /api/public/audit-summary/:workspaceId', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/audit-summary/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when workspace has no webflowSiteId linked', async () => {
    const res = await api(`/api/public/audit-summary/${bareWsId}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a workspace with a webflowSiteId (no snapshots → null body)', async () => {
    const res = await api(`/api/public/audit-summary/${seededWs.workspaceId}`);
    // Either 200 with null (no snapshots) or 200 with shape (snapshots exist)
    expect(res.status).toBe(200);
  });

  it('body is null or an object when no snapshots exist', async () => {
    const res = await api(`/api/public/audit-summary/${seededWs.workspaceId}`);
    const body = await res.json();
    // fresh workspace has no snapshots — body should be null
    expect(body === null || typeof body === 'object').toBe(true);
  });
});

// ── GET /api/public/audit-detail/:workspaceId ─────────────────────────────────

describe('GET /api/public/audit-detail/:workspaceId', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/audit-detail/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when workspace has no webflowSiteId linked', async () => {
    const res = await api(`/api/public/audit-detail/${bareWsId}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a workspace with a webflowSiteId', async () => {
    const res = await api(`/api/public/audit-detail/${seededWs.workspaceId}`);
    expect(res.status).toBe(200);
  });

  it('body is null or an object (fresh workspace has no snapshots)', async () => {
    const res = await api(`/api/public/audit-detail/${seededWs.workspaceId}`);
    const body = await res.json();
    expect(body === null || typeof body === 'object').toBe(true);
  });
});

// ── GET /api/public/business-priorities/:workspaceId ─────────────────────────

describe('GET /api/public/business-priorities/:workspaceId', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/business-priorities/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace', async () => {
    const res = await api(`/api/public/business-priorities/${seededWs.workspaceId}`);
    expect(res.status).toBe(200);
  });

  it('returns { priorities: [], updatedAt: null } when none set', async () => {
    const res = await api(`/api/public/business-priorities/${seededWs.workspaceId}`);
    const body = await res.json() as { priorities: unknown[]; updatedAt: unknown };
    expect(body).toHaveProperty('priorities');
    expect(Array.isArray(body.priorities)).toBe(true);
    expect(body.priorities).toHaveLength(0);
    expect(body).toHaveProperty('updatedAt');
    expect(body.updatedAt).toBeNull();
  });

  it('bare workspace (no webflowSiteId) also returns 200 with empty priorities', async () => {
    const res = await api(`/api/public/business-priorities/${bareWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { priorities: unknown[] };
    expect(Array.isArray(body.priorities)).toBe(true);
  });
});
