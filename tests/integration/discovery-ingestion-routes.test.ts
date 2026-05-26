/**
 * Integration tests for discovery ingestion API routes.
 *
 * Routes under test:
 *   GET    /api/discovery/:workspaceId/sources
 *   POST   /api/discovery/:workspaceId/sources/text       (paste source)
 *   DELETE /api/discovery/:workspaceId/sources/:id
 *   POST   /api/discovery/:workspaceId/sources/:id/process
 *   GET    /api/discovery/:workspaceId/extractions
 *   GET    /api/discovery/:workspaceId/sources/:id/extractions
 *   PATCH  /api/discovery/:workspaceId/extractions/:id
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import db from '../../server/db/index.js';

// port-ok: 13201–13559 already allocated in integration suite
const ctx = createTestContext(13562);
const { api, postJson, patchJson, del } = ctx;

const WS_ID = `ws_disc_integ_${Date.now()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedExtraction(sourceId: string, overrides: Record<string, unknown> = {}): string {
  const id = `ext_test_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO discovery_extractions
      (id, source_id, workspace_id, extraction_type, category, content, source_quote, confidence, status, created_at)
     VALUES (@id, @source_id, @workspace_id, @extraction_type, @category, @content, @source_quote, @confidence, @status, @created_at)`,
  ).run({
    id,
    source_id: sourceId,
    workspace_id: WS_ID,
    extraction_type: 'voice_pattern',
    category: 'tone_marker',
    content: 'Warm and direct tone.',
    source_quote: null,
    confidence: 'medium',
    status: 'pending',
    created_at: now,
    ...overrides,
  });
  return id;
}

function markSourceProcessed(sourceId: string): void {
  db.prepare(
    `UPDATE discovery_sources SET processed_at = ? WHERE id = ? AND workspace_id = ?`,
  ).run(new Date().toISOString(), sourceId, WS_ID);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(WS_ID, 'Discovery Integration WS', WS_ID, new Date().toISOString());
  await ctx.startServer();
}, 30_000);

afterAll(async () => {
  await ctx.stopServer();
  // Cascade-delete: discovery_extractions references discovery_sources, so
  // deleting the workspace data is enough once we remove sources first.
  db.prepare(`DELETE FROM discovery_extractions WHERE workspace_id = ?`).run(WS_ID);
  db.prepare(`DELETE FROM discovery_sources WHERE workspace_id = ?`).run(WS_ID);
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(WS_ID);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/discovery/:workspaceId/sources', () => {
  it('returns an empty array for a fresh workspace', async () => {
    const res = await api(`/api/discovery/${WS_ID}/sources`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('POST /api/discovery/:workspaceId/sources/text (paste source)', () => {
  it('creates a source with valid rawContent and returns the source object', async () => {
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'This is our brand voice. We speak plainly.',
      sourceType: 'brand_doc',
      filename: 'brand-guide.txt',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.workspaceId).toBe(WS_ID);
    expect(body.filename).toBe('brand-guide.txt');
    expect(body.sourceType).toBe('brand_doc');
    expect(body.rawContent).toBe('This is our brand voice. We speak plainly.');

    // Confirm it now appears in the list
    const list = await api(`/api/discovery/${WS_ID}/sources`);
    const sources = await list.json();
    expect(sources.some((s: { id: string }) => s.id === body.id)).toBe(true);
  });

  it('defaults filename to pasted-text.txt when none is provided', async () => {
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Some content with no filename',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filename).toBe('pasted-text.txt');
  });

  it('defaults sourceType to brand_doc when not provided', async () => {
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Content without explicit source type',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sourceType).toBe('brand_doc');
  });

  it('returns 400 when rawContent is missing', async () => {
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      sourceType: 'brand_doc',
      filename: 'no-content.txt',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when rawContent is an empty string', async () => {
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: '',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when sourceType is an invalid enum value', async () => {
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Some content',
      sourceType: 'invalid_type',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when rawContent exceeds 1 MiB (Zod max validation path)', async () => {
    // Zod's max(1_048_576) rejects before the DB trigger fires.
    // Use a string 1 byte over the limit.
    const bigContent = 'x'.repeat(1_048_577);
    const res = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: bigContent,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('DELETE /api/discovery/:workspaceId/sources/:id', () => {
  it('returns 404 for a nonexistent source id', async () => {
    const res = await del(`/api/discovery/${WS_ID}/sources/src_doesnotexist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('deletes a previously created source and removes it from the list', async () => {
    // Create a source first
    const create = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Source that will be deleted',
      sourceType: 'transcript',
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    const srcId = created.id;

    // Delete it
    const del_ = await del(`/api/discovery/${WS_ID}/sources/${srcId}`);
    expect(del_.status).toBe(200);
    const delBody = await del_.json();
    expect(delBody.deleted).toBe(true);

    // Confirm it is gone from the list
    const list = await api(`/api/discovery/${WS_ID}/sources`);
    const sources = await list.json();
    expect(sources.every((s: { id: string }) => s.id !== srcId)).toBe(true);
  });
});

describe('GET /api/discovery/:workspaceId/extractions', () => {
  it('returns an empty array for a fresh workspace (before any processing)', async () => {
    // Use a distinct workspace to avoid cross-test contamination
    const isolatedWsId = `ws_disc_ext_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(isolatedWsId, 'Isolated Extraction WS', isolatedWsId, new Date().toISOString());

    try {
      const res = await api(`/api/discovery/${isolatedWsId}/extractions`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(isolatedWsId);
    }
  });
});

describe('GET /api/discovery/:workspaceId/sources/:id/extractions', () => {
  it('returns only extractions for the specified source', async () => {
    // Create two sources and seed extractions for each
    const createA = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Source A content for extraction scoping test',
      sourceType: 'brand_doc',
    });
    const srcA = (await createA.json()).id;

    const createB = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Source B content for extraction scoping test',
      sourceType: 'transcript',
    });
    const srcB = (await createB.json()).id;

    // Seed one extraction per source directly in the DB
    const extAId = seedExtraction(srcA, { content: 'Extraction for source A' });
    const extBId = seedExtraction(srcB, { content: 'Extraction for source B' });

    // GET extractions scoped to srcA
    const res = await api(`/api/discovery/${WS_ID}/sources/${srcA}/extractions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((e: { id: string }) => e.id);
    expect(ids).toContain(extAId);
    expect(ids).not.toContain(extBId);
  });
});

describe('PATCH /api/discovery/:workspaceId/extractions/:id', () => {
  let extractionId: string;
  let sourceId: string;

  beforeAll(async () => {
    // Create a source and seed an extraction to update
    const create = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Content for PATCH extraction tests',
      sourceType: 'brand_doc',
    });
    sourceId = (await create.json()).id;
    extractionId = seedExtraction(sourceId);
  });

  it('updates both status and content when both are supplied', async () => {
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/${extractionId}`,
      { status: 'accepted', content: 'Updated extraction content' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);

    // Verify the DB row reflects the changes
    const row = db.prepare(
      `SELECT status, content FROM discovery_extractions WHERE id = ? AND workspace_id = ?`,
    ).get(extractionId, WS_ID) as { status: string; content: string } | undefined;
    expect(row?.status).toBe('accepted');
    expect(row?.content).toBe('Updated extraction content');
  });

  it('updates only status when just status is supplied', async () => {
    const extId = seedExtraction(sourceId, { status: 'pending', content: 'Original content' });
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/${extId}`,
      { status: 'dismissed' },
    );
    expect(res.status).toBe(200);
    const row = db.prepare(
      `SELECT status, content FROM discovery_extractions WHERE id = ? AND workspace_id = ?`,
    ).get(extId, WS_ID) as { status: string; content: string } | undefined;
    expect(row?.status).toBe('dismissed');
    expect(row?.content).toBe('Original content');
  });

  it('updates only content when just content is supplied', async () => {
    const extId = seedExtraction(sourceId, { status: 'pending', content: 'Before edit' });
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/${extId}`,
      { content: 'After edit' },
    );
    expect(res.status).toBe(200);
    const row = db.prepare(
      `SELECT status, content FROM discovery_extractions WHERE id = ? AND workspace_id = ?`,
    ).get(extId, WS_ID) as { status: string; content: string } | undefined;
    expect(row?.content).toBe('After edit');
    expect(row?.status).toBe('pending');
  });

  it('returns 400 when neither status nor content is provided (Zod refine)', async () => {
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/${extractionId}`,
      { routedTo: 'voice_profile' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when routedTo is supplied without status (Zod refine)', async () => {
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/${extractionId}`,
      { content: 'Some content', routedTo: 'brandscript' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for a nonexistent extraction id when only status is provided', async () => {
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/ext_doesnotexist`,
      { status: 'accepted' },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Extraction not found');
  });

  it('returns 404 for a nonexistent extraction id when only content is provided', async () => {
    const res = await patchJson(
      `/api/discovery/${WS_ID}/extractions/ext_doesnotexist`,
      { content: 'Some new content' },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Extraction not found');
  });
});

describe('POST /api/discovery/:workspaceId/sources/:id/process', () => {
  it('returns 409 when the source has already been processed (SourceAlreadyProcessedError)', async () => {
    // Create a source via the API
    const create = await postJson(`/api/discovery/${WS_ID}/sources/text`, {
      rawContent: 'Content for idempotency test',
      sourceType: 'brand_doc',
    });
    expect(create.status).toBe(200);
    const { id: srcId } = await create.json();

    // Simulate a previously-processed state by setting processed_at directly in the DB.
    // The processSource function checks this field BEFORE calling the AI, so we can
    // test the 409 path without mocking OpenAI.
    markSourceProcessed(srcId);

    // Now call process without force — expect 409
    const res = await postJson(
      `/api/discovery/${WS_ID}/sources/${srcId}/process`,
      {},
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('source_already_processed');
    expect(body).toHaveProperty('error');
  });
});
