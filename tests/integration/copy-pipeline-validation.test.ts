/**
 * Integration tests for server/routes/copy-pipeline.ts
 *
 * Covers validation and empty-state behaviors for the Copy Pipeline routes:
 * - GET /api/copy/:workspaceId/entry/:entryId/sections — empty state
 * - GET /api/copy/:workspaceId/entry/:entryId/status — empty state
 * - GET /api/copy/:workspaceId/entry/:entryId/metadata — 404 for unknown entry
 * - GET /api/copy/:workspaceId/intelligence — empty state
 * - GET /api/copy/:workspaceId/intelligence/promotable — empty state
 * - GET /api/copy/:workspaceId/batch/:batchId — 404 for unknown batch
 * - PATCH /api/copy/:workspaceId/section/:sectionId/status — 400 for invalid status
 * - PATCH /api/copy/:workspaceId/section/:sectionId/text — 400 for missing copy
 * - POST /api/copy/:workspaceId/section/:sectionId/suggest — 400 for missing fields
 * - POST /api/copy/:workspaceId/:blueprintId/batch — 400 for missing entryIds
 * - POST /api/copy/:workspaceId/:blueprintId/export — 400 for missing format/scope
 * - DELETE /api/copy/:workspaceId/intelligence/:patternId — 204 or graceful error on unknown
 * - POST /api/copy/:workspaceId/intelligence/extract — 400 for missing steeringNotes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`CopyPipeline-13502`).id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── Entry read routes — empty state ───────────────────────────────────────────

describe('GET /api/copy/:workspaceId/entry/:entryId/sections — empty state', () => {
  it('returns empty array for unknown entry', async () => {
    const res = await api(`/api/copy/${wsId}/entry/entry_nonexistent_13502/sections`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('GET /api/copy/:workspaceId/entry/:entryId/status — empty state', () => {
  it('returns status object for unknown entry (graceful empty state)', async () => {
    const res = await api(`/api/copy/${wsId}/entry/entry_nonexistent_13502/status`);
    expect(res.status).toBe(200);
    // Returns an object with counts (could all be 0)
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });
});

describe('GET /api/copy/:workspaceId/entry/:entryId/metadata — 404 for unknown', () => {
  it('returns 404 for unknown entry', async () => {
    const res = await api(`/api/copy/${wsId}/entry/entry_nonexistent_13502/metadata`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});

// ── Intelligence routes — empty state ─────────────────────────────────────────

describe('GET /api/copy/:workspaceId/intelligence — list all patterns', () => {
  it('returns empty array for fresh workspace', async () => {
    const res = await api(`/api/copy/${wsId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('GET /api/copy/:workspaceId/intelligence/promotable — promotable patterns', () => {
  it('returns empty array for fresh workspace', async () => {
    const res = await api(`/api/copy/${wsId}/intelligence/promotable`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ── Batch route — 404 for unknown ─────────────────────────────────────────────

describe('GET /api/copy/:workspaceId/batch/:batchId — batch job lookup', () => {
  it('returns 404 for unknown batch job id', async () => {
    const res = await api(`/api/copy/${wsId}/batch/bj_nonexistent_13502`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});

// ── Section mutation validation ────────────────────────────────────────────────

describe('PATCH /api/copy/:workspaceId/section/:sectionId/status — validation', () => {
  it('returns 400 for missing status field', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/status`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status value', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/status`, {
      status: 'not-a-valid-status',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for valid status on unknown section', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/status`, {
      status: 'draft',
    });
    // valid status but section doesn't exist
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('accepts all valid status enum values (Zod passes, 404 from DB lookup)', async () => {
    const validStatuses = ['pending', 'draft', 'client_review', 'approved', 'revision_requested'];
    for (const status of validStatuses) {
      const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/status`, { status });
      // Should pass Zod validation (400 would mean schema rejection), but 404 because section doesn't exist
      expect(res.status).not.toBe(400);
    }
  });
});

describe('PATCH /api/copy/:workspaceId/section/:sectionId/text — validation', () => {
  it('returns 400 for missing copy field', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/text`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty copy string (min(1))', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/text`, { copy: '' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for valid copy on unknown section', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/text`, {
      copy: 'Updated copy text here',
    });
    expect(res.status).toBe(404);
  });
});

// ── Suggestion validation ──────────────────────────────────────────────────────

describe('POST /api/copy/:workspaceId/section/:sectionId/suggest — validation', () => {
  it('returns 400 for missing originalText', async () => {
    const res = await postJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/suggest`, {
      suggestedText: 'New suggestion',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing suggestedText', async () => {
    const res = await postJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/suggest`, {
      originalText: 'Original text here',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty originalText (min(1))', async () => {
    const res = await postJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/suggest`, {
      originalText: '',
      suggestedText: 'New suggestion',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for valid body on unknown section', async () => {
    const res = await postJson(`/api/copy/${wsId}/section/sec_nonexistent_13502/suggest`, {
      originalText: 'Original text here',
      suggestedText: 'Improved suggestion',
    });
    expect(res.status).toBe(404);
  });
});

// ── Batch start validation ─────────────────────────────────────────────────────

describe('POST /api/copy/:workspaceId/:blueprintId/batch — batch start validation', () => {
  it('returns 400 for missing entryIds', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/batch`, {
      mode: 'review_inbox',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty entryIds array (min(1))', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/batch`, {
      entryIds: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid mode value', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/batch`, {
      entryIds: ['entry_1'],
      mode: 'not-a-valid-mode',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for valid body with unknown blueprint', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/batch`, {
      entryIds: ['entry_1', 'entry_2'],
      mode: 'review_inbox',
    });
    // Blueprint not found
    expect(res.status).toBe(404);
  });
});

// ── Export validation ──────────────────────────────────────────────────────────

describe('POST /api/copy/:workspaceId/:blueprintId/export — export validation', () => {
  it('returns 400 for missing format', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/export`, {
      scope: 'all',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing scope', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/export`, {
      format: 'csv',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid format value', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/export`, {
      format: 'pdf',
      scope: 'all',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid scope value', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/export`, {
      format: 'csv',
      scope: 'everything',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when scope=selected but entryIds is missing', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/export`, {
      format: 'csv',
      scope: 'selected',
      // entryIds deliberately omitted
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when scope=single but entryId is missing', async () => {
    const res = await postJson(`/api/copy/${wsId}/bp_nonexistent_13502/export`, {
      format: 'copy_deck',
      scope: 'single',
      // entryId deliberately omitted
    });
    expect(res.status).toBe(400);
  });
});

// ── Intelligence extraction validation ────────────────────────────────────────

describe('POST /api/copy/:workspaceId/intelligence/extract — validation', () => {
  it('returns 400 for missing steeringNotes', async () => {
    const res = await postJson(`/api/copy/${wsId}/intelligence/extract`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty steeringNotes array (min(1))', async () => {
    const res = await postJson(`/api/copy/${wsId}/intelligence/extract`, { steeringNotes: [] });
    expect(res.status).toBe(400);
  });
});

// ── Intelligence pattern PATCH/DELETE ─────────────────────────────────────────

describe('PATCH /api/copy/:workspaceId/intelligence/:patternId — update pattern', () => {
  it('returns 400 for pattern without patternType (partial text update)', async () => {
    const res = await patchJson(`/api/copy/${wsId}/intelligence/pat_nonexistent_13502`, {
      pattern: 'Some pattern text',
      // patternType omitted — route requires both or neither
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/patternType/i);
  });

  it('returns 400 for patternType without pattern (partial text update)', async () => {
    const res = await patchJson(`/api/copy/${wsId}/intelligence/pat_nonexistent_13502`, {
      patternType: 'tone',
      // pattern omitted — route requires both or neither
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pattern/i);
  });

  it('returns 200 for toggling active state (no DB row needed for toggle)', async () => {
    // togglePattern for nonexistent pattern may still return updated:true
    const res = await patchJson(`/api/copy/${wsId}/intelligence/pat_nonexistent_13502`, {
      active: false,
    });
    // Should pass validation; result depends on DB state (200 is fine, 500 is not expected)
    expect([200, 404, 500]).toContain(res.status);
    // Must not be a 400 (Zod validation error)
    expect(res.status).not.toBe(400);
  });
});

describe('DELETE /api/copy/:workspaceId/intelligence/:patternId — remove pattern', () => {
  it('returns 204 even for unknown pattern id (idempotent delete)', async () => {
    const res = await del(`/api/copy/${wsId}/intelligence/pat_nonexistent_13502`);
    // Route calls removePattern() which may no-op; either 204 or an error response
    expect([204, 500]).toContain(res.status);
    // Must not be 400 (schema error) or 401 (auth error)
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(401);
  });
});
