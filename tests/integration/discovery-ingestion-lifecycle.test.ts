/**
 * Integration tests — Discovery Ingestion Lifecycle
 *
 * Covers the full create → list → delete lifecycle for sources (text-paste),
 * extraction listing, extraction PATCH, and workspace isolation.
 *
 * Uses in-process HTTP via createApp() + http.createServer() with listen(0)
 * so vi.mock intercepts broadcast and email before the server module loads.
 *
 * Does NOT test:
 *   - POST /api/discovery/:workspaceId/sources  (file upload — requires multer tmp files)
 *   - POST /api/discovery/:workspaceId/sources/:id/process  (calls AI + buildIntelPrompt)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

// ── Hoisted mock state ────────────────────────────────────────────────────────

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
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// ── In-process server setup ───────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
let wsA = '';
let wsB = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = (server.address() as AddressInfo);
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

async function patchJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ── DB seed helpers ───────────────────────────────────────────────────────────

function seedExtraction(workspaceId: string, sourceId: string): string {
  const id = `ext_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO discovery_extractions
       (id, source_id, workspace_id, extraction_type, category, content,
        source_quote, confidence, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sourceId, workspaceId, 'voice_pattern', 'signature_phrase',
    'Test extraction content', null, 'medium', 'pending', now);
  return id;
}

function seedSource(workspaceId: string): string {
  const id = `src_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO discovery_sources
       (id, workspace_id, filename, source_type, raw_content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, 'seed-source.txt', 'brand_doc', 'seeded raw content', now);
  return id;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsA = createWorkspace('DiscoveryLifecycle-WsA').id;
  wsB = createWorkspace('DiscoveryLifecycle-WsB').id;
}, 30_000);

afterAll(async () => {
  db.prepare('DELETE FROM discovery_extractions WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  db.prepare('DELETE FROM discovery_sources WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  db.prepare('DELETE FROM activity_log WHERE workspace_id IN (?, ?)').run(wsA, wsB);
  deleteWorkspace(wsA);
  deleteWorkspace(wsB);
  await stopTestServer();
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/discovery/:workspaceId/sources/text — create text source
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/discovery/:workspaceId/sources/text — create text source', () => {
  it('creates a text source and returns 200 with id, filename, sourceType, workspaceId present', async () => {
    const { status, body } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'We help small businesses tell their story with clarity.',
      filename: 'brand-overview.txt',
      sourceType: 'brand_doc',
    });
    expect(status).toBe(200);
    const source = body as Record<string, unknown>;
    expect(source).toHaveProperty('id');
    expect(source).toHaveProperty('filename', 'brand-overview.txt');
    expect(source).toHaveProperty('sourceType', 'brand_doc');
    expect(source).toHaveProperty('workspaceId', wsA);
    expect(typeof source.id).toBe('string');
    expect((source.id as string).startsWith('src_')).toBe(true);
  });

  it('returns source in subsequent GET /api/discovery/:workspaceId/sources', async () => {
    // Create a fresh source specifically for this assertion
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Our mission is to serve customers well.',
      filename: 'mission.txt',
    });
    const createdSource = created as Record<string, unknown>;

    const { status, body: list } = await getJson(`/api/discovery/${wsA}/sources`);
    expect(status).toBe(200);
    const sources = list as Record<string, unknown>[];
    const found = sources.find((s) => s.id === createdSource.id);
    expect(found).toBeDefined();
    expect(found!.filename).toBe('mission.txt');
  });

  it('succeeds even for unknown workspaceId because requireWorkspaceAccess passes through without a JWT user', async () => {
    // The discovery_sources table has no FK constraint on workspace_id, so the
    // insert succeeds for any string. requireWorkspaceAccess only blocks when a
    // JWT user is present and doesn't have access to the given workspace.
    const { status } = await postJson('/api/discovery/ws_nonexistent_000/sources/text', {
      rawContent: 'Some content here.',
    });
    expect(status).toBe(200);
  });

  it('returns 400 for missing required field rawContent', async () => {
    const { status, body } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      filename: 'no-content.txt',
    });
    expect(status).toBe(400);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('returns 400 for empty rawContent string', async () => {
    const { status, body } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: '',
    });
    expect(status).toBe(400);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('uses default sourceType of brand_doc when sourceType is omitted', async () => {
    const { status, body } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Default type test content.',
    });
    expect(status).toBe(200);
    const source = body as Record<string, unknown>;
    expect(source.sourceType).toBe('brand_doc');
  });

  it('uses pasted-text.txt as default filename when filename is omitted', async () => {
    const { status, body } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Content without a filename.',
    });
    expect(status).toBe(200);
    const source = body as Record<string, unknown>;
    expect(source.filename).toBe('pasted-text.txt');
  });

  it('broadcasts DISCOVERY_UPDATED after successful creation', async () => {
    broadcastState.calls.length = 0;
    const { status } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Broadcast test content.',
      filename: 'broadcast-test.txt',
    });
    expect(status).toBe(200);
    const discoveryCall = broadcastState.calls.find((c) => c.event === 'discovery:updated');
    expect(discoveryCall).toBeDefined();
    expect(discoveryCall!.workspaceId).toBe(wsA);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/discovery/:workspaceId/sources — list sources
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/discovery/:workspaceId/sources — list sources', () => {
  it('returns empty array for fresh workspace', async () => {
    const freshWs = createWorkspace('DiscoveryLifecycle-FreshGet').id;
    try {
      const { status, body } = await getJson(`/api/discovery/${freshWs}/sources`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect((body as unknown[]).length).toBe(0);
    } finally {
      deleteWorkspace(freshWs);
    }
  });

  it('returns created source in list', async () => {
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Source listing test content.',
      filename: 'listing-test.txt',
    });
    const createdSource = created as Record<string, unknown>;

    const { status, body } = await getJson(`/api/discovery/${wsA}/sources`);
    expect(status).toBe(200);
    const list = body as Record<string, unknown>[];
    const found = list.find((s) => s.id === createdSource.id);
    expect(found).toBeDefined();
  });

  it('list contains source metadata — id, filename, sourceType, workspaceId', async () => {
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Metadata check content.',
      filename: 'metadata-check.txt',
      sourceType: 'transcript',
    });
    const createdSource = created as Record<string, unknown>;

    const { body } = await getJson(`/api/discovery/${wsA}/sources`);
    const list = body as Record<string, unknown>[];
    const found = list.find((s) => s.id === createdSource.id);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('id');
    expect(found).toHaveProperty('filename');
    expect(found).toHaveProperty('sourceType', 'transcript');
    expect(found).toHaveProperty('workspaceId', wsA);
    expect(found).toHaveProperty('createdAt');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /api/discovery/:workspaceId/sources/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/discovery/:workspaceId/sources/:id', () => {
  it('deletes a source and returns 200 with deleted: true', async () => {
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Source to be deleted.',
      filename: 'delete-me.txt',
    });
    const createdSource = created as Record<string, unknown>;

    const { status, body } = await del(`/api/discovery/${wsA}/sources/${createdSource.id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ deleted: true });
  });

  it('deleted source does not appear in subsequent GET list', async () => {
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Source that should vanish after delete.',
      filename: 'vanish.txt',
    });
    const createdSource = created as Record<string, unknown>;

    await del(`/api/discovery/${wsA}/sources/${createdSource.id}`);

    const { body } = await getJson(`/api/discovery/${wsA}/sources`);
    const list = body as Record<string, unknown>[];
    const found = list.find((s) => s.id === createdSource.id);
    expect(found).toBeUndefined();
  });

  it('returns 404 for nonexistent source id', async () => {
    const { status, body } = await del(`/api/discovery/${wsA}/sources/src_doesnotexist`);
    expect(status).toBe(404);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('returns 404 for unknown workspaceId', async () => {
    const { status, body } = await del('/api/discovery/ws_nonexistent_000/sources/src_anyid');
    expect(status).toBe(404);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('broadcasts DISCOVERY_UPDATED after successful delete', async () => {
    broadcastState.calls.length = 0;
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Source for broadcast delete test.',
      filename: 'broadcast-delete.txt',
    });
    const createdSource = created as Record<string, unknown>;
    broadcastState.calls.length = 0; // clear after creation

    await del(`/api/discovery/${wsA}/sources/${createdSource.id}`);

    const discoveryCall = broadcastState.calls.find((c) => c.event === 'discovery:updated');
    expect(discoveryCall).toBeDefined();
    expect(discoveryCall!.workspaceId).toBe(wsA);
    expect((discoveryCall!.payload as Record<string, unknown>).deleted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/discovery/:workspaceId/extractions — list all extractions
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/discovery/:workspaceId/extractions — list all extractions', () => {
  it('returns empty array for fresh workspace with no extractions', async () => {
    const freshWs = createWorkspace('DiscoveryLifecycle-FreshExtractions').id;
    try {
      const { status, body } = await getJson(`/api/discovery/${freshWs}/extractions`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect((body as unknown[]).length).toBe(0);
    } finally {
      deleteWorkspace(freshWs);
    }
  });

  it('returns extractions seeded directly to DB', async () => {
    // Create a source, then seed an extraction for it directly
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);

    const { status, body } = await getJson(`/api/discovery/${wsA}/extractions`);
    expect(status).toBe(200);
    const list = body as Record<string, unknown>[];
    const found = list.find((e) => e.id === extId);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('sourceId', srcId);
    expect(found).toHaveProperty('workspaceId', wsA);
    expect(found).toHaveProperty('status', 'pending');
    expect(found).toHaveProperty('extractionType', 'voice_pattern');

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/discovery/:workspaceId/sources/:id/extractions — by source
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/discovery/:workspaceId/sources/:id/extractions — by source', () => {
  it('returns empty array for source with no extractions', async () => {
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Source with no extractions yet.',
      filename: 'no-extractions.txt',
    });
    const createdSource = created as Record<string, unknown>;

    const { status, body } = await getJson(
      `/api/discovery/${wsA}/sources/${createdSource.id}/extractions`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);

    // Cleanup
    await del(`/api/discovery/${wsA}/sources/${createdSource.id}`);
  });

  it('returns empty array for nonexistent source id (route returns [] not 404)', async () => {
    const { status, body } = await getJson(
      `/api/discovery/${wsA}/sources/src_doesnotexist/extractions`,
    );
    // listExtractionsBySource scoped to workspace returns [] for any unknown source
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('returns only extractions belonging to the specified source', async () => {
    const srcIdA = seedSource(wsA);
    const srcIdB = seedSource(wsA);
    const extIdA = seedExtraction(wsA, srcIdA);
    seedExtraction(wsA, srcIdB); // extraction for a different source

    const { status, body } = await getJson(
      `/api/discovery/${wsA}/sources/${srcIdA}/extractions`,
    );
    expect(status).toBe(200);
    const list = body as Record<string, unknown>[];
    expect(list.every((e) => e.sourceId === srcIdA)).toBe(true);
    expect(list.find((e) => e.id === extIdA)).toBeDefined();

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE source_id IN (?, ?)').run(srcIdA, srcIdB);
    db.prepare('DELETE FROM discovery_sources WHERE id IN (?, ?)').run(srcIdA, srcIdB);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/discovery/:workspaceId/extractions/:id — update extraction
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/discovery/:workspaceId/extractions/:id — update extraction', () => {
  it('updates extraction status and returns { updated: true }', async () => {
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);

    const { status, body } = await patchJson(
      `/api/discovery/${wsA}/extractions/${extId}`,
      { status: 'accepted' },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ updated: true });

    // Confirm status persisted in DB
    const row = db
      .prepare('SELECT status FROM discovery_extractions WHERE id = ?')
      .get(extId) as { status: string } | undefined;
    expect(row?.status).toBe('accepted');

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });

  it('updates extraction content and returns { updated: true }', async () => {
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);
    const newContent = 'Updated extraction content text.';

    const { status, body } = await patchJson(
      `/api/discovery/${wsA}/extractions/${extId}`,
      { content: newContent },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ updated: true });

    // Confirm content persisted in DB
    const row = db
      .prepare('SELECT content FROM discovery_extractions WHERE id = ?')
      .get(extId) as { content: string } | undefined;
    expect(row?.content).toBe(newContent);

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });

  it('can update status with routedTo destination', async () => {
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);

    const { status, body } = await patchJson(
      `/api/discovery/${wsA}/extractions/${extId}`,
      { status: 'accepted', routedTo: 'voice_profile' },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ updated: true });

    const row = db
      .prepare('SELECT status, routed_to FROM discovery_extractions WHERE id = ?')
      .get(extId) as { status: string; routed_to: string } | undefined;
    expect(row?.status).toBe('accepted');
    expect(row?.routed_to).toBe('voice_profile');

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });

  it('returns 404 for nonexistent extraction id', async () => {
    const { status, body } = await patchJson(
      `/api/discovery/${wsA}/extractions/ext_doesnotexist`,
      { status: 'accepted' },
    );
    expect(status).toBe(404);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('returns 400 for empty body (no status or content)', async () => {
    const { status, body } = await patchJson(
      `/api/discovery/${wsA}/extractions/ext_fake`,
      {},
    );
    expect(status).toBe(400);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('returns 400 for routedTo without status', async () => {
    const { status, body } = await patchJson(
      `/api/discovery/${wsA}/extractions/ext_fake`,
      { routedTo: 'voice_profile' },
    );
    expect(status).toBe(400);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('error');
  });

  it('broadcasts DISCOVERY_UPDATED after successful patch', async () => {
    broadcastState.calls.length = 0;
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);

    const { status } = await patchJson(
      `/api/discovery/${wsA}/extractions/${extId}`,
      { status: 'dismissed' },
    );
    expect(status).toBe(200);

    const discoveryCall = broadcastState.calls.find((c) => c.event === 'discovery:updated');
    expect(discoveryCall).toBeDefined();
    expect(discoveryCall!.workspaceId).toBe(wsA);
    expect((discoveryCall!.payload as Record<string, unknown>).extractionId).toBe(extId);

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Workspace isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('Workspace isolation', () => {
  it('sources from workspace A do NOT appear in workspace B GET', async () => {
    // Create a source in wsA
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Workspace A private content.',
      filename: 'ws-a-only.txt',
    });
    const createdSource = created as Record<string, unknown>;

    // Fetch sources for wsB — must not include wsA's source
    const { status, body } = await getJson(`/api/discovery/${wsB}/sources`);
    expect(status).toBe(200);
    const list = body as Record<string, unknown>[];
    const found = list.find((s) => s.id === createdSource.id);
    expect(found).toBeUndefined();
  });

  it('DELETE of wsA source via wsB path returns 404 (no cross-workspace delete)', async () => {
    // Create a source in wsA
    const { body: created } = await postJson(`/api/discovery/${wsA}/sources/text`, {
      rawContent: 'Source owned by wsA.',
      filename: 'ws-a-source.txt',
    });
    const createdSource = created as Record<string, unknown>;

    // Attempt to delete via wsB path — deleteSource is scoped to workspace_id
    const { status } = await del(
      `/api/discovery/${wsB}/sources/${createdSource.id}`,
    );
    expect(status).toBe(404);

    // Source should still exist in wsA
    const { body } = await getJson(`/api/discovery/${wsA}/sources`);
    const list = body as Record<string, unknown>[];
    const found = list.find((s) => s.id === createdSource.id);
    expect(found).toBeDefined();

    // Cleanup
    await del(`/api/discovery/${wsA}/sources/${createdSource.id}`);
  });

  it('extractions from workspace A do NOT appear in workspace B extractions list', async () => {
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);

    const { status, body } = await getJson(`/api/discovery/${wsB}/extractions`);
    expect(status).toBe(200);
    const list = body as Record<string, unknown>[];
    const found = list.find((e) => e.id === extId);
    expect(found).toBeUndefined();

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });

  it('PATCH of wsA extraction via wsB path returns 404 (no cross-workspace update)', async () => {
    const srcId = seedSource(wsA);
    const extId = seedExtraction(wsA, srcId);

    const { status } = await patchJson(
      `/api/discovery/${wsB}/extractions/${extId}`,
      { status: 'accepted' },
    );
    expect(status).toBe(404);

    // Original status should be unchanged
    const row = db
      .prepare('SELECT status FROM discovery_extractions WHERE id = ?')
      .get(extId) as { status: string } | undefined;
    expect(row?.status).toBe('pending');

    // Cleanup
    db.prepare('DELETE FROM discovery_extractions WHERE id = ?').run(extId);
    db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(srcId);
  });
});
