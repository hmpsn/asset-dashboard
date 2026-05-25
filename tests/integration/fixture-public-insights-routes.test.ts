import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import db from '../../server/db/index.js';
import { seedIntelligenceTestData, type SeededWorkspace } from '../fixtures/intelligence-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13716);
const { api } = ctx;

let openSeed: SeededWorkspace | null = null;
let protectedSeed: SeededWorkspace | null = null;
let foreignSeed: SeededWorkspace | null = null;

let openWorkspaceInserted = false;
let protectedWorkspaceInserted = false;
let foreignWorkspaceInserted = false;

let protectedClientUserId = '';
let protectedClientToken = '';
let foreignClientUserId = '';
let foreignClientToken = '';

function insertWorkspaceRow(workspaceId: string, name: string, clientPassword: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO workspaces (
      id, name, folder, webflow_site_id, webflow_token,
      gsc_property_url, ga4_property_id, client_password,
      live_domain, tier, seo_data_provider, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    name,
    `fixture-public-insights-${workspaceId}`,
    null,
    null,
    null,
    null,
    clientPassword,
    'fixture-insights.test',
    'growth',
    null,
    now,
  );
}

beforeAll(async () => {
  await ctx.startServer();

  openSeed = seedIntelligenceTestData();
  protectedSeed = seedIntelligenceTestData();
  foreignSeed = seedIntelligenceTestData();

  insertWorkspaceRow(openSeed.workspaceId, 'Fixture Public Insights Open Workspace', '');
  openWorkspaceInserted = true;

  insertWorkspaceRow(protectedSeed.workspaceId, 'Fixture Public Insights Protected Workspace', 'fixture-secret-123');
  protectedWorkspaceInserted = true;

  insertWorkspaceRow(foreignSeed.workspaceId, 'Fixture Public Insights Foreign Token Workspace', 'fixture-secret-foreign');
  foreignWorkspaceInserted = true;

  const protectedUser = await createClientUser(
    `public-insights-protected-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Fixture Insights Protected Client',
    protectedSeed.workspaceId,
    'client_member',
  );
  protectedClientUserId = protectedUser.id;
  protectedClientToken = signClientToken(protectedUser);

  const foreignUser = await createClientUser(
    `public-insights-foreign-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Fixture Insights Foreign Client',
    foreignSeed.workspaceId,
    'client_member',
  );
  foreignClientUserId = foreignUser.id;
  foreignClientToken = signClientToken(foreignUser);
}, 30_000);

afterAll(async () => {
  if (protectedClientUserId && protectedSeed) {
    deleteClientUser(protectedClientUserId, protectedSeed.workspaceId);
  }
  if (foreignClientUserId && foreignSeed) {
    deleteClientUser(foreignClientUserId, foreignSeed.workspaceId);
  }

  if (openWorkspaceInserted && openSeed) {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(openSeed.workspaceId);
  }
  if (protectedWorkspaceInserted && protectedSeed) {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(protectedSeed.workspaceId);
  }
  if (foreignWorkspaceInserted && foreignSeed) {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(foreignSeed.workspaceId);
  }

  openSeed?.cleanup();
  protectedSeed?.cleanup();
  foreignSeed?.cleanup();
  await ctx.stopServer();
});

describe('public insights routes with intelligence fixture', () => {
  it('GET /api/public/insights/:workspaceId returns 200 with non-empty array for passwordless workspace', async () => {
    expect(openSeed).toBeTruthy();
    if (!openSeed) return;

    const res = await api(`/api/public/insights/${openSeed.workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ id: string; workspaceId: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every(row => row.workspaceId === openSeed.workspaceId)).toBe(true); // every-ok: guarded by length > 0 above
  });

  it('GET /api/public/insights/:workspaceId enforces auth for protected workspace (no token -> 401)', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}`);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Authentication required/i);
  });

  it('GET /api/public/insights/:workspaceId rejects token from another workspace (workspace isolation -> 401)', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}`, {
      headers: {
        Cookie: `client_user_token_${protectedSeed.workspaceId}=${foreignClientToken}`,
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Authentication required/i);
  });

  it('GET /api/public/insights/:workspaceId accepts correct workspace token (200)', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}`, {
      headers: {
        Cookie: `client_user_token_${protectedSeed.workspaceId}=${protectedClientToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; workspaceId: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every(row => row.workspaceId === protectedSeed.workspaceId)).toBe(true); // every-ok: guarded by length > 0 above
    expect(body.some(row => row.id.includes(`insight-${protectedSeed.workspaceId}-`))).toBe(true);
  });

  it('GET /api/public/insights/:workspaceId?type=content_decay filters by type only', async () => {
    expect(openSeed).toBeTruthy();
    if (!openSeed) return;

    const res = await api(`/api/public/insights/${openSeed.workspaceId}?type=content_decay`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ insightType: string; workspaceId: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every(row => row.workspaceId === openSeed.workspaceId)).toBe(true); // every-ok: guarded by length > 0 above
    expect(body.every(row => row.insightType === 'content_decay')).toBe(true); // every-ok: guarded by length > 0 above
  });

  it('GET /api/public/insights/:workspaceId handles unknown type filter without leakage (200 + empty array)', async () => {
    expect(openSeed).toBeTruthy();
    if (!openSeed) return;

    const res = await api(`/api/public/insights/${openSeed.workspaceId}?type=__malformed_unknown_type__`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('GET /api/public/insights/:workspaceId ignores malformed force query value and still returns data', async () => {
    expect(openSeed).toBeTruthy();
    if (!openSeed) return;

    const res = await api(`/api/public/insights/${openSeed.workspaceId}?force=TRUE&type=content_decay`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ insightType: string; workspaceId: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every(row => row.workspaceId === openSeed.workspaceId)).toBe(true); // every-ok: guarded by length > 0 above
    expect(body.every(row => row.insightType === 'content_decay')).toBe(true); // every-ok: guarded by length > 0 above
  });

  it('GET /api/public/insights/:workspaceId/narrative enforces auth on protected workspace', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}/narrative`);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Authentication required/i);
  });

  it('GET /api/public/insights/:workspaceId/narrative returns client payload when authenticated', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}/narrative`, {
      headers: {
        Cookie: `client_user_token_${protectedSeed.workspaceId}=${protectedClientToken}`,
      },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('insights');
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    expect(Array.isArray(body.insights) || (typeof body.insights === 'object' && body.insights !== null)).toBe(true);
  });

  it('GET /api/public/insights/:workspaceId/digest enforces auth on protected workspace', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}/digest`);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Authentication required/i);
  });

  it('GET /api/public/insights/:workspaceId/digest returns object payload when authenticated', async () => {
    expect(protectedSeed).toBeTruthy();
    if (!protectedSeed) return;

    const res = await api(`/api/public/insights/${protectedSeed.workspaceId}/digest`, {
      headers: {
        Cookie: `client_user_token_${protectedSeed.workspaceId}=${protectedClientToken}`,
      },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    expect(Array.isArray(body)).toBe(false);
  });

  it('returns 404 for unknown workspace on insights endpoint', async () => {
    const res = await api('/api/public/insights/ws_fixture_public_insights_missing');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});
