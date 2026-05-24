/**
 * Integration tests for admin copy-pipeline routes.
 * port-ok: next free after 13364
 *
 * Covers:
 * - GET  /api/copy/:workspaceId/entry/:entryId/sections
 * - GET  /api/copy/:workspaceId/entry/:entryId/status
 * - GET  /api/copy/:workspaceId/entry/:entryId/metadata
 * - PATCH /api/copy/:workspaceId/section/:sectionId/status  (valid and invalid transitions)
 * - PATCH /api/copy/:workspaceId/section/:sectionId/text
 * - POST  /api/copy/:workspaceId/section/:sectionId/suggest
 * - POST  /api/copy/:workspaceId/:blueprintId/:entryId/send-to-client
 * - POST  /api/copy/:workspaceId/:blueprintId/batch
 * - GET   /api/copy/:workspaceId/batch/:batchId
 * - GET   /api/copy/:workspaceId/intelligence
 * - GET   /api/copy/:workspaceId/intelligence/promotable  (route-ordering regression check)
 * - PATCH /api/copy/:workspaceId/intelligence/:patternId
 * - DELETE /api/copy/:workspaceId/intelligence/:patternId
 * - Export (CSV, copy_deck)
 * - Cross-workspace isolation for sections, batch jobs, intelligence patterns
 * - Zod validation rejections
 *
 * Intentionally skips /generate and /regenerate — those call AI and need unit mocks.
 * We do test that they are wired (check 400/404, not 500, when workspace doesn't exist).
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13365); // port-ok: next free after 13364
const { api, postJson, patchJson, del } = ctx;

let wsA: SeededFullWorkspace;
let wsB: SeededFullWorkspace;

// IDs created in beforeAll
let blueprintAId = '';
let entryAId = '';
let blueprintBId = '';
let entryBId = '';
const now = new Date().toISOString();

// ── Test data helpers ─────────────────────────────────────────────────────────

/**
 * Insert a copy_sections row directly. Entry must already exist (FK).
 * Uses a unique section_plan_item_id each time to avoid UNIQUE(entry_id, section_plan_item_id) conflicts.
 */
function insertSection(
  workspaceId: string,
  entryId: string,
  status: string,
  generatedCopy = 'Test copy content',
): string {
  const id = `cs_t_${randomUUID().slice(0, 8)}`;
  const planItemId = `spi_t_${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO copy_sections (
      id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
      ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
      version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', null, null, 1, ?, ?)
  `).run(
    id, workspaceId, entryId, planItemId,
    generatedCopy, status,
    'AI annotation', 'AI reasoning',
    now, now,
  );
  return id;
}

/** Read a section's current status from the DB for assertion after mutations. */
function getSectionStatus(sectionId: string): string | undefined {
  const row = db.prepare('SELECT status FROM copy_sections WHERE id = ?')
    .get(sectionId) as { status: string } | undefined;
  return row?.status;
}

/** Insert a batch job row directly without triggering the fire-and-forget loop. */
function insertBatchJob(workspaceId: string, blueprintId: string, status = 'running'): string {
  const id = `bj_${randomUUID()}`;
  db.prepare(`
    INSERT INTO copy_batch_jobs (
      id, workspace_id, blueprint_id, mode, entry_ids_json, batch_size,
      status, progress_json, accumulated_steering, created_at, updated_at
    )
    VALUES (?, ?, ?, 'review_inbox', '["e1","e2"]', 2, ?,
            '{"total":2,"generated":0,"reviewed":0,"approved":0}', '[]', ?, ?)
  `).run(id, workspaceId, blueprintId, status, now, now);
  return id;
}

/** Insert a copy_intelligence row directly. */
function insertPattern(
  workspaceId: string,
  patternType = 'tone',
  pattern = `Pattern ${randomUUID().slice(0, 8)}`,
  frequency = 1,
  active = 1,
): string {
  const id = `ip_t_${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO copy_intelligence (id, workspace_id, pattern_type, pattern, source, frequency, active, created_at)
    VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)
  `).run(id, workspaceId, patternType, pattern, frequency, active, now);
  return id;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  wsA = seedWorkspace({ tier: 'growth', clientPassword: '' });
  wsB = seedWorkspace({ tier: 'growth', clientPassword: '' });

  // Seed blueprint + entry for workspace A via direct DB inserts (mirrors the
  // pattern in existing integration tests that set up page-strategy fixtures).
  blueprintAId = `test-bp-a-${randomUUID().slice(0, 8)}`;
  entryAId = `test-entry-a-${randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'active', ?, ?)
  `).run(blueprintAId, wsA.workspaceId, 'Test Blueprint A', now, now);

  db.prepare(`
    INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'service', 'included', 0, ?, 'test keyword', 0, ?, ?)
  `).run(
    entryAId, blueprintAId, 'Test Entry A',
    JSON.stringify([
      { id: 'sp-a1', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 150, brandNote: '', seoNote: '' },
    ]),
    now, now,
  );

  // Seed blueprint + entry for workspace B (cross-workspace isolation tests)
  blueprintBId = `test-bp-b-${randomUUID().slice(0, 8)}`;
  entryBId = `test-entry-b-${randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'active', ?, ?)
  `).run(blueprintBId, wsB.workspaceId, 'Test Blueprint B', now, now);

  db.prepare(`
    INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'service', 'included', 0, ?, 'other keyword', 0, ?, ?)
  `).run(
    entryBId, blueprintBId, 'Test Entry B',
    JSON.stringify([
      { id: 'sp-b1', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 150, brandNote: '', seoNote: '' },
    ]),
    now, now,
  );
}, 25_000);

afterAll(async () => {
  // Delete in dependency order (sections/metadata/intelligence/batch before entries/blueprints)
  db.prepare('DELETE FROM copy_sections WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId, wsB.workspaceId,
  );
  db.prepare('DELETE FROM copy_metadata WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId, wsB.workspaceId,
  );
  db.prepare('DELETE FROM copy_intelligence WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId, wsB.workspaceId,
  );
  db.prepare('DELETE FROM copy_batch_jobs WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId, wsB.workspaceId,
  );
  db.prepare('DELETE FROM blueprint_entries WHERE blueprint_id IN (?, ?)').run(
    blueprintAId, blueprintBId,
  );
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id IN (?, ?)').run(
    wsA.workspaceId, wsB.workspaceId,
  );
  wsA?.cleanup();
  wsB?.cleanup();
  await ctx.stopServer();
});

// ── Entry read routes ─────────────────────────────────────────────────────────

describe('GET /api/copy/:workspaceId/entry/:entryId/sections', () => {
  it('returns 200 with an empty array when no sections exist', async () => {
    const res = await api(`/api/copy/${wsA.workspaceId}/entry/${entryAId}/sections`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns only sections belonging to the given workspace+entry', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    // wsB section for the SAME entryId must not leak across — section is scoped by workspace_id
    const otherSId = insertSection(wsB.workspaceId, entryBId, 'draft');

    const resA = await api(`/api/copy/${wsA.workspaceId}/entry/${entryAId}/sections`);
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    const idsA = bodyA.map((s: { id: string }) => s.id);
    expect(idsA).toContain(sId);
    expect(idsA).not.toContain(otherSId);

    // Verify section shape
    const section = bodyA.find((s: { id: string }) => s.id === sId);
    expect(section).toMatchObject({
      id: sId,
      workspaceId: wsA.workspaceId,
      entryId: entryAId,
      status: 'draft',
    });
  });
});

describe('GET /api/copy/:workspaceId/entry/:entryId/status', () => {
  it('returns 200 with zero-count status when no sections exist', async () => {
    // Use a fresh entry ID that has no sections to avoid cross-test pollution
    const freshEntryId = `test-status-entry-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'service', 'included', 0, '[]', null, 99, ?, ?)
    `).run(freshEntryId, blueprintAId, 'Fresh Status Entry', now, now);

    const res = await api(`/api/copy/${wsA.workspaceId}/entry/${freshEntryId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      entryId: freshEntryId,
      totalSections: 0,
      pendingSections: 0,
      draftSections: 0,
      clientReviewSections: 0,
      approvedSections: 0,
      revisionSections: 0,
      overallStatus: 'pending',
      approvalPercentage: 0,
    });
  });

  it('accurately reflects section counts by status', async () => {
    const countEntryId = `test-count-entry-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'service', 'included', 0, '[]', null, 100, ?, ?)
    `).run(countEntryId, blueprintAId, 'Count Status Entry', now, now);

    insertSection(wsA.workspaceId, countEntryId, 'draft');
    insertSection(wsA.workspaceId, countEntryId, 'client_review');
    insertSection(wsA.workspaceId, countEntryId, 'approved');

    const res = await api(`/api/copy/${wsA.workspaceId}/entry/${countEntryId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalSections).toBe(3);
    expect(body.draftSections).toBe(1);
    expect(body.clientReviewSections).toBe(1);
    expect(body.approvedSections).toBe(1);
  });
});

describe('GET /api/copy/:workspaceId/entry/:entryId/metadata', () => {
  it('returns 404 when no metadata exists for the entry', async () => {
    const res = await api(`/api/copy/${wsA.workspaceId}/entry/${entryAId}/metadata`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when the entryId is completely unknown', async () => {
    const res = await api(`/api/copy/${wsA.workspaceId}/entry/entry_totally_missing/metadata`);
    expect(res.status).toBe(404);
  });

  it('returns metadata when it has been inserted', async () => {
    const metaId = `cm_t_${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO copy_metadata (
        id, workspace_id, entry_id, seo_title, meta_description,
        og_title, og_description, status, steering_history, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?)
    `).run(
      metaId, wsA.workspaceId, entryAId,
      'SEO Title Test', 'Meta desc test', 'OG Title', 'OG Desc',
      now, now,
    );

    const res = await api(`/api/copy/${wsA.workspaceId}/entry/${entryAId}/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      entryId: entryAId,
      seoTitle: 'SEO Title Test',
      metaDescription: 'Meta desc test',
    });

    // Clean up so it doesn't affect other tests
    db.prepare('DELETE FROM copy_metadata WHERE id = ?').run(metaId);
  });
});

// ── Section status mutation routes ────────────────────────────────────────────

describe('PATCH /api/copy/:workspaceId/section/:sectionId/status', () => {
  it('valid transition draft → client_review returns 200 and updated section', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/status`,
      { status: 'client_review' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('client_review');
    expect(body.id).toBe(sId);
  });

  it('invalid transition pending → approved returns 404 without mutating DB', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'pending');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/status`,
      { status: 'approved' },
    );
    // updateSectionStatus returns null on invalid transition; route responds 404
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    // DB must remain unmodified
    expect(getSectionStatus(sId)).toBe('pending');
  });

  it('invalid transition client_review → draft returns 404', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    // First do a valid transition to client_review
    await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/status`,
      { status: 'client_review' },
    );
    // Now try the invalid back-transition
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/status`,
      { status: 'draft' },
    );
    expect(res.status).toBe(404);
    expect(getSectionStatus(sId)).toBe('client_review'); // unchanged
  });

  it('unrecognized status enum value returns 400', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/status`,
      { status: 'not_a_valid_status' },
    );
    expect(res.status).toBe(400);
    expect(getSectionStatus(sId)).toBe('draft');
  });

  it('missing status field returns 400', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/status`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('non-existent sectionId returns 404', async () => {
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/cs_totally_nonexistent/status`,
      { status: 'client_review' },
    );
    expect(res.status).toBe(404);
  });

  it('cross-workspace isolation: wsB section is invisible to wsA path → returns 404', async () => {
    // BUG WATCH: the DB query in updateSectionStatus scopes by (id, workspace_id).
    // wsA cannot see or modify wsB's section — returns 404, not 200.
    const sIdB = insertSection(wsB.workspaceId, entryBId, 'draft');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sIdB}/status`,
      { status: 'client_review' },
    );
    expect(res.status).toBe(404);
    // wsB section must remain unchanged
    expect(getSectionStatus(sIdB)).toBe('draft');
  });
});

// ── Section text update ───────────────────────────────────────────────────────

describe('PATCH /api/copy/:workspaceId/section/:sectionId/text', () => {
  it('returns 200 and updates text and version', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft', 'Original copy');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/text`,
      { copy: 'Updated copy text from edit' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedCopy).toBe('Updated copy text from edit');
    expect(body.status).toBe('draft');
    expect(body.version).toBeGreaterThan(1);
  });

  it('returns 400 when copy field is missing', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/text`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when copy is an empty string', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/text`,
      { copy: '' },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when editing an approved section (immutable after approval)', async () => {
    // updateCopyText explicitly returns null for approved sections
    const sId = insertSection(wsA.workspaceId, entryAId, 'approved', 'Approved copy');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/text`,
      { copy: 'Attempted edit on approved section' },
    );
    expect(res.status).toBe(404);
    // Status must remain approved, copy unchanged
    const row = db.prepare('SELECT status, generated_copy FROM copy_sections WHERE id = ?')
      .get(sId) as { status: string; generated_copy: string } | undefined;
    expect(row?.status).toBe('approved');
    expect(row?.generated_copy).toBe('Approved copy');
  });

  it('cross-workspace isolation: wsB section inaccessible via wsA text route', async () => {
    const sIdB = insertSection(wsB.workspaceId, entryBId, 'draft', 'WS-B original copy');
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/section/${sIdB}/text`,
      { copy: 'Cross-workspace hijack attempt' },
    );
    expect(res.status).toBe(404);
    // wsB section copy must be unchanged
    const row = db.prepare('SELECT generated_copy FROM copy_sections WHERE id = ?')
      .get(sIdB) as { generated_copy: string } | undefined;
    expect(row?.generated_copy).toBe('WS-B original copy');
  });
});

// ── Client suggestion route ───────────────────────────────────────────────────

describe('POST /api/copy/:workspaceId/section/:sectionId/suggest', () => {
  it('adds a suggestion and transitions client_review → revision_requested', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'client_review');
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/suggest`,
      {
        originalText: 'Original client review copy',
        suggestedText: 'Improved copy from client',
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('revision_requested');
    expect(body.clientSuggestions).toHaveLength(1);
    expect(body.clientSuggestions[0]).toMatchObject({
      originalText: 'Original client review copy',
      suggestedText: 'Improved copy from client',
      status: 'pending',
    });
  });

  it('suggestion on draft section does NOT change status (stays draft)', async () => {
    // addClientSuggestion only transitions to revision_requested from client_review
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/suggest`,
      {
        originalText: 'Draft copy',
        suggestedText: 'Suggested improvement',
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Status remains draft — suggestion is stored but no transition occurs
    expect(body.status).toBe('draft');
  });

  it('returns 400 when originalText is missing', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'client_review');
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/suggest`,
      { suggestedText: 'Only suggested text' },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when suggestedText is missing', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'client_review');
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/section/${sId}/suggest`,
      { originalText: 'Only original text' },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when section does not exist', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/section/cs_totally_missing/suggest`,
      { originalText: 'Text', suggestedText: 'Better text' },
    );
    expect(res.status).toBe(404);
  });
});

// ── Send-to-client route ──────────────────────────────────────────────────────

describe('POST /api/copy/:workspaceId/:blueprintId/:entryId/send-to-client', () => {
  it('returns 400 when there are no draft sections', async () => {
    // Fresh entry ID with no sections at all
    const freshEntryId = `test-stc-empty-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'service', 'included', 0, '[]', null, 200, ?, ?)
    `).run(freshEntryId, blueprintAId, 'STC Empty Entry', now, now);

    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/${freshEntryId}/send-to-client`,
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No draft sections');
  });

  it('returns 400 when all sections are non-draft (client_review or approved)', async () => {
    const entryId = `test-stc-nondraft-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'service', 'included', 0, '[]', null, 201, ?, ?)
    `).run(entryId, blueprintAId, 'STC Non-Draft Entry', now, now);

    insertSection(wsA.workspaceId, entryId, 'client_review');
    insertSection(wsA.workspaceId, entryId, 'approved');

    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/${entryId}/send-to-client`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('transitions all draft sections to client_review and returns sent count', async () => {
    const entryId = `test-stc-draft-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'service', 'included', 0, '[]', null, 202, ?, ?)
    `).run(entryId, blueprintAId, 'STC Draft Entry', now, now);

    const d1 = insertSection(wsA.workspaceId, entryId, 'draft');
    const d2 = insertSection(wsA.workspaceId, entryId, 'draft');
    const alreadyReview = insertSection(wsA.workspaceId, entryId, 'client_review');

    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/${entryId}/send-to-client`,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2); // only the 2 draft sections

    // Verify DB state — all three should now be client_review
    expect(getSectionStatus(d1)).toBe('client_review');
    expect(getSectionStatus(d2)).toBe('client_review');
    expect(getSectionStatus(alreadyReview)).toBe('client_review'); // unchanged, already correct
  });

  it('all-or-nothing transaction: all draft sections succeed together', async () => {
    // This test verifies the db.transaction() wrapping makes the bulk update atomic.
    // If the transaction failed mid-loop, some sections would still be draft.
    const entryId = `test-stc-atomic-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'service', 'included', 0, '[]', null, 203, ?, ?)
    `).run(entryId, blueprintAId, 'STC Atomic Entry', now, now);

    const drafts = [
      insertSection(wsA.workspaceId, entryId, 'draft'),
      insertSection(wsA.workspaceId, entryId, 'draft'),
      insertSection(wsA.workspaceId, entryId, 'draft'),
    ];

    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/${entryId}/send-to-client`,
      {},
    );
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(3);

    // All must have transitioned — no partial state
    for (const id of drafts) {
      expect(getSectionStatus(id)).toBe('client_review');
    }
  });
});

// ── Batch routes ──────────────────────────────────────────────────────────────

describe('POST /api/copy/:workspaceId/:blueprintId/batch', () => {
  it('returns 200 with { batchId } immediately (fire-and-forget)', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/batch`,
      { entryIds: [entryAId] },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('batchId');
    expect(typeof body.batchId).toBe('string');
    expect(body.batchId).toMatch(/^bj_/);
  });

  it('persists a batch job record with status=running immediately', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/batch`,
      { entryIds: [entryAId], mode: 'review_inbox', batchSize: 1 },
    );
    expect(res.status).toBe(200);
    const { batchId } = await res.json();

    const row = db.prepare('SELECT * FROM copy_batch_jobs WHERE id = ? AND workspace_id = ?')
      .get(batchId, wsA.workspaceId) as { status: string; mode: string; batch_size: number } | undefined;
    expect(row).toBeTruthy();
    expect(row?.status).toBe('running');
    expect(row?.mode).toBe('review_inbox');
    expect(row?.batch_size).toBe(1);
  });

  it('returns 404 when blueprintId does not belong to the workspace', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/blueprint_nonexistent_xyz/batch`,
      { entryIds: [entryAId] },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Blueprint not found');
  });

  it('cross-workspace isolation: blueprintB is not accessible via wsA path', async () => {
    // getBlueprint(wsA.workspaceId, blueprintBId) returns null → 404
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintBId}/batch`,
      { entryIds: [entryBId] },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when entryIds is empty', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/batch`,
      { entryIds: [] },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when entryIds field is missing', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/batch`,
      {},
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/copy/:workspaceId/batch/:batchId', () => {
  it('returns the batch job with parsed fields', async () => {
    const batchId = insertBatchJob(wsA.workspaceId, blueprintAId, 'complete');
    const res = await api(`/api/copy/${wsA.workspaceId}/batch/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: batchId,
      workspaceId: wsA.workspaceId,
      blueprintId: blueprintAId,
      status: 'complete',
      entryIds: ['e1', 'e2'],
      progress: { total: 2, generated: 0, reviewed: 0, approved: 0 },
    });
  });

  it('returns 404 for a non-existent batchId', async () => {
    const res = await api(`/api/copy/${wsA.workspaceId}/batch/bj_does_not_exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('cross-workspace isolation: wsB batch job is invisible via wsA route', async () => {
    const batchId = insertBatchJob(wsB.workspaceId, blueprintBId, 'running');
    // The DB query includes workspace_id scope → wsA cannot see wsB's job
    const res = await api(`/api/copy/${wsA.workspaceId}/batch/${batchId}`);
    expect(res.status).toBe(404);
  });
});

// ── Intelligence routes ───────────────────────────────────────────────────────

describe('GET /api/copy/:workspaceId/intelligence', () => {
  it('returns 200 with empty array when no patterns exist', async () => {
    const freshWs = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/copy/${freshWs.workspaceId}/intelligence`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      freshWs.cleanup();
    }
  });

  it('returns patterns for the workspace', async () => {
    const pId = insertPattern(wsA.workspaceId, 'tone', 'Always use active voice');
    const res = await api(`/api/copy/${wsA.workspaceId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.find((p: { id: string }) => p.id === pId);
    expect(found).toBeTruthy();
    expect(found).toMatchObject({ patternType: 'tone', pattern: 'Always use active voice' });
  });

  it('cross-workspace isolation: wsA patterns do not appear in wsB list', async () => {
    const pIdA = insertPattern(wsA.workspaceId, 'terminology', 'WS-A exclusive term');
    const res = await api(`/api/copy/${wsB.workspaceId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(pIdA);
  });
});

describe('GET /api/copy/:workspaceId/intelligence/promotable', () => {
  it('returns 200 — not 404 — confirming /promotable is registered BEFORE /:patternId', async () => {
    // CRITICAL ROUTE ORDERING TEST:
    // The route file explicitly comments that literal sub-paths (/promotable, /extract)
    // MUST be registered before the param route (/:patternId).
    // If that registration order were reversed, Express would match "promotable" as a
    // patternId and call the PATCH handler on a non-existent ID instead of
    // getPatternsForPromotion — yielding 200 { updated: true } or 500, not an array.
    // This test catches that regression by asserting the response is an array.
    const res = await api(`/api/copy/${wsA.workspaceId}/intelligence/promotable`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns only patterns with frequency >= 3', async () => {
    const lowFreqId = insertPattern(wsA.workspaceId, 'structure', `Low freq ${randomUUID().slice(0, 8)}`, 1);
    const highFreqId = insertPattern(wsA.workspaceId, 'tone', `High freq ${randomUUID().slice(0, 8)}`, 3);

    const res = await api(`/api/copy/${wsA.workspaceId}/intelligence/promotable`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((p: { id: string }) => p.id);

    expect(ids).toContain(highFreqId);
    expect(ids).not.toContain(lowFreqId);
  });
});

describe('PATCH /api/copy/:workspaceId/intelligence/:patternId', () => {
  it('toggles a pattern to inactive and returns { updated: true }', async () => {
    const pId = insertPattern(wsA.workspaceId, 'tone', `Toggle pattern ${randomUUID().slice(0, 8)}`);

    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/intelligence/${pId}`,
      { active: false },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);

    const row = db.prepare('SELECT active FROM copy_intelligence WHERE id = ?')
      .get(pId) as { active: number } | undefined;
    expect(row?.active).toBe(0);
  });

  it('returns 400 when pattern is provided without patternType', async () => {
    const pId = insertPattern(wsA.workspaceId, 'tone', `Incomplete update ${randomUUID().slice(0, 8)}`);
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/intelligence/${pId}`,
      { pattern: 'New text without type' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Both pattern and patternType are required');
  });

  it('updates both pattern text and type when both are provided', async () => {
    const pId = insertPattern(wsA.workspaceId, 'tone', `Update both ${randomUUID().slice(0, 8)}`);
    const res = await patchJson(
      `/api/copy/${wsA.workspaceId}/intelligence/${pId}`,
      { pattern: 'Updated pattern text', patternType: 'terminology' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);
  });
});

describe('DELETE /api/copy/:workspaceId/intelligence/:patternId', () => {
  it('deletes a pattern and returns 204', async () => {
    const pId = insertPattern(wsA.workspaceId, 'keyword_usage', `Delete me ${randomUUID().slice(0, 8)}`);

    const res = await del(`/api/copy/${wsA.workspaceId}/intelligence/${pId}`);
    expect(res.status).toBe(204);

    const row = db.prepare('SELECT id FROM copy_intelligence WHERE id = ?').get(pId);
    expect(row).toBeUndefined();
  });

  it('cross-workspace isolation: wsB pattern survives a delete attempt via wsA route', async () => {
    // removePattern(patternId, wsA.workspaceId) runs DELETE WHERE id=? AND workspace_id=wsA
    // wsB's pattern is scoped to wsB so it is unaffected — the route still returns 204
    // (no error on missing row), but the row must still exist under wsB.
    const pIdB = insertPattern(wsB.workspaceId, 'tone', `WS-B protect me ${randomUUID().slice(0, 8)}`);

    const res = await del(`/api/copy/${wsA.workspaceId}/intelligence/${pIdB}`);
    // Route returns 204 regardless (removePattern is fire-and-forget)
    expect(res.status).toBe(204);

    // Pattern must still be present under wsB
    const row = db.prepare('SELECT id FROM copy_intelligence WHERE id = ?').get(pIdB);
    expect(row).toBeTruthy();
  });
});

// ── Export routes ─────────────────────────────────────────────────────────────

describe('Export', () => {
  it('POST /api/copy/:wsId/:blueprintId/export CSV returns 200 with content', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/export`,
      { format: 'csv', scope: 'all' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('csv');
    expect(body.filename).toBeDefined();
    expect(typeof body.content).toBe('string');
  });

  it('POST /api/copy/:wsId/:blueprintId/export copy_deck returns 200 with content', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/export`,
      { format: 'copy_deck', scope: 'all' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('copy_deck');
    expect(body.filename).toBeDefined();
    expect(typeof body.content).toBe('string');
  });

  it('returns 400 for unknown export format', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/export`,
      { format: 'not_a_format', scope: 'all' },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when scope is "selected" but entryIds is absent', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/export`,
      { format: 'csv', scope: 'selected' },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when scope is "single" but entryId is absent', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/export`,
      { format: 'csv', scope: 'single' },
    );
    expect(res.status).toBe(400);
  });
});

// ── AI-dependent endpoint wiring checks ──────────────────────────────────────
// We don't invoke AI in integration tests. We verify the route is registered by
// checking that Zod validation fires (400) when the body is incorrect — which
// confirms the middleware chain ran rather than Express returning 404 (no route).

describe('AI-dependent endpoint wiring (Zod validation fires = route is registered)', () => {
  it('generate endpoint: invalid accumulatedSteering returns 400 — Zod ran = route is registered', async () => {
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/${entryAId}/generate`,
      { accumulatedSteering: 'not-an-array' },
    );
    expect(res.status).toBe(400);
  });

  it('regenerate endpoint: missing required field "note" returns 400 — Zod ran = route is registered', async () => {
    const sId = insertSection(wsA.workspaceId, entryAId, 'draft');
    // regenerateSectionSchema requires note: string.min(1). Sending {} triggers Zod → 400.
    const res = await postJson(
      `/api/copy/${wsA.workspaceId}/${blueprintAId}/${entryAId}/regenerate/${sId}`,
      {},
    );
    // 400 = Zod validation rejected the request before reaching AI → route is registered
    expect(res.status).toBe(400);
  });
});
