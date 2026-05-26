/**
 * Integration tests for brand-identity GET read paths and basic mutations.
 *
 * Covers:
 * - GET /api/brand-identity/:workspaceId → 200 with array (empty for fresh ws)
 * - GET /api/brand-identity/:workspaceId/export → 200 (empty export)
 * - GET /api/brand-identity/:workspaceId/:id unknown id → 404
 * - PATCH /api/brand-identity/:workspaceId/:id unknown id → 404
 *
 * Port: 13642 (unique — no other file uses this port).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13642); // port-ok: extending range to 13642
const { api, patchJson } = ctx;

let wsId = '';

function seedDeliverable(
  workspaceId: string,
  id: string,
  content: string,
  status: 'draft' | 'approved' = 'draft',
  deliverableType: 'mission' | 'vision' = 'mission',
) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO brand_identity_deliverables
    (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, deliverableType, content, status, 1, 'essentials', now, now);
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Brand Identity Read WS 13642').id;
}, 40_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brand-identity/:workspaceId — list deliverables
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brand-identity/:workspaceId', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const res = await api(`/api/brand-identity/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('returns 400 for an invalid tier query param', async () => {
    const res = await api(`/api/brand-identity/${wsId}?tier=invalid_tier`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns 200 with empty array when filtering by valid tier', async () => {
    const res = await api(`/api/brand-identity/${wsId}?tier=essentials`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brand-identity/:workspaceId/export — export approved deliverables
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brand-identity/:workspaceId/export', () => {
  it('returns 200 for a fresh workspace (empty export)', async () => {
    const res = await api(`/api/brand-identity/${wsId}/export`);
    expect(res.status).toBe(200);
    // Response type is text/markdown
    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toContain('text/markdown');
    const body = await res.text();
    expect(typeof body).toBe('string');
  });

  it('returns 400 for an invalid tier query param on export', async () => {
    const res = await api(`/api/brand-identity/${wsId}/export?tier=bad_tier`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brand-identity/:workspaceId/:id — unknown id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brand-identity/:workspaceId/:id', () => {
  it('returns 404 for an unknown deliverable id', async () => {
    const res = await api(`/api/brand-identity/${wsId}/del_does_not_exist`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/brand-identity/:workspaceId/:id — unknown id
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/brand-identity/:workspaceId/:id', () => {
  it('returns 404 for an unknown deliverable id', async () => {
    const res = await patchJson(`/api/brand-identity/${wsId}/del_does_not_exist`, {
      status: 'approved',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns 400 for an invalid status value', async () => {
    const res = await patchJson(`/api/brand-identity/${wsId}/del_does_not_exist`, {
      status: 'invalid_status',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('updates deliverable content and increments version', async () => {
    const deliverableId = `bid_patch_content_${Date.now()}`;
    seedDeliverable(wsId, deliverableId, 'Original mission copy.', 'approved');

    const res = await patchJson(`/api/brand-identity/${wsId}/${deliverableId}`, {
      content: 'Updated mission copy for manual edit.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; status: string; version: number };
    expect(body.content).toBe('Updated mission copy for manual edit.');
    expect(body.status).toBe('draft');
    expect(body.version).toBe(2);

    const row = db.prepare('SELECT content, status, version FROM brand_identity_deliverables WHERE id = ?').get(deliverableId) as {
      content: string;
      status: 'draft' | 'approved';
      version: number;
    };
    expect(row.content).toBe('Updated mission copy for manual edit.');
    expect(row.status).toBe('draft');
    expect(row.version).toBe(2);
  });

  it('rejects empty content updates', async () => {
    const deliverableId = `bid_patch_empty_${Date.now()}`;
    seedDeliverable(wsId, deliverableId, 'Original content.', 'draft', 'vision');

    const res = await patchJson(`/api/brand-identity/${wsId}/${deliverableId}`, {
      content: '   ',
    });
    expect(res.status).toBe(400);
  });
});
