/**
 * Integration tests for Copy Pipeline (Phase 3) routes.
 *
 * Covers: /api/copy/:workspaceId/* endpoints for sections, status, text edits,
 * client suggestions, intelligence CRUD, export, and workspace isolation.
 *
 * Intentionally avoids /generate, /regenerate, /batch endpoints — those call
 * OpenAI/Anthropic which are unavailable in the test environment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

const ctx = createTestContext(13319);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';
let wsOtherId = '';
let cleanupA: () => void;
let cleanupB: () => void;

// Seeded test data IDs
let blueprintId = '';
let entryId = '';
let otherBlueprintId = '';
let otherEntryId = '';
const now = new Date().toISOString();

beforeAll(async () => {
  await ctx.startServer();

  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  wsOtherId = wsB.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;

  // Seed blueprint + entry for workspace A
  blueprintId = `test-bp-${randomUUID().slice(0, 8)}`;
  entryId = `test-entry-${randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(blueprintId, wsId, 'Test Blueprint', 1, 'active', now, now);

  db.prepare(`
    INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entryId, blueprintId, 'Test Service Page', 'service', 'included', 0,
    JSON.stringify([
      { id: 'sp-1', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 150, brandNote: '', seoNote: '' },
      { id: 'sp-2', sectionType: 'body', narrativeRole: 'value-proof', wordCountTarget: 300, brandNote: '', seoNote: '' },
    ]),
    'test keyword', 0, now, now,
  );

  // Seed blueprint + entry for workspace B (isolation tests)
  otherBlueprintId = `test-bp-${randomUUID().slice(0, 8)}`;
  otherEntryId = `test-entry-${randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(otherBlueprintId, wsOtherId, 'Other Blueprint', 1, 'active', now, now);

  db.prepare(`
    INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, is_collection, section_plan_json, primary_keyword, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(otherEntryId, otherBlueprintId, 'Other Service Page', 'service', 'included', 0,
    JSON.stringify([
      { id: 'sp-1', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 150, brandNote: '', seoNote: '' },
    ]),
    'other keyword', 0, now, now,
  );
});

afterAll(() => {
  ctx.stopServer();

  // Clean up test data (order matters for FK constraints)
  db.prepare('DELETE FROM copy_sections WHERE workspace_id IN (?, ?)').run(wsId, wsOtherId);
  db.prepare('DELETE FROM copy_metadata WHERE workspace_id IN (?, ?)').run(wsId, wsOtherId);
  db.prepare('DELETE FROM copy_intelligence WHERE workspace_id IN (?, ?)').run(wsId, wsOtherId);
  db.prepare('DELETE FROM copy_batch_jobs WHERE workspace_id IN (?, ?)').run(wsId, wsOtherId);
  db.prepare('DELETE FROM blueprint_entries WHERE blueprint_id IN (?, ?)').run(blueprintId, otherBlueprintId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id IN (?, ?)').run(wsId, wsOtherId);

  cleanupA?.();
  cleanupB?.();
});

// ── Smoke — route registration ────────────────────────────────────────────────

describe('Smoke — route registration', () => {
  it('GET /api/copy/:wsId/entry/:entryId/sections returns 200 with empty array', async () => {
    const res = await api(`/api/copy/${wsId}/entry/${entryId}/sections`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /api/copy/:wsId/entry/:entryId/status returns 200 with status object', async () => {
    const res = await api(`/api/copy/${wsId}/entry/${entryId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryId).toBe(entryId);
    expect(body.totalSections).toBe(0);
    expect(body.overallStatus).toBe('pending');
  });

  it('GET /api/copy/:wsId/entry/:entryId/metadata returns 404 when no metadata exists', async () => {
    const res = await api(`/api/copy/${wsId}/entry/${entryId}/metadata`);
    expect(res.status).toBe(404);
  });
});

// ── Intelligence CRUD ─────────────────────────────────────────────────────────

describe('Intelligence CRUD (non-AI paths)', () => {
  let patternId = '';

  it('GET /api/copy/:wsId/intelligence returns 200 with empty array', async () => {
    const res = await api(`/api/copy/${wsId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('seed intelligence patterns directly and list them', async () => {
    // extractPatterns calls OpenAI so we seed directly via DB
    patternId = `ip_${randomUUID().slice(0, 8)}`;
    const patternNow = new Date().toISOString();

    db.prepare(`
      INSERT INTO copy_intelligence (id, workspace_id, pattern_type, pattern, source, frequency, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(patternId, wsId, 'tone', 'Use active voice', 'manual', 1, 1, patternNow);

    const res = await api(`/api/copy/${wsId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    const found = body.find((p: { id: string }) => p.id === patternId);
    expect(found).toBeDefined();
    expect(found.pattern).toBe('Use active voice');
    expect(found.patternType).toBe('tone');
  });

  it('PATCH /api/copy/:wsId/intelligence/:patternId toggles active', async () => {
    const res = await patchJson(`/api/copy/${wsId}/intelligence/${patternId}`, { active: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(true);

    // Verify via list
    const listRes = await api(`/api/copy/${wsId}/intelligence`);
    const patterns = await listRes.json();
    const updated = patterns.find((p: { id: string }) => p.id === patternId);
    expect(updated.active).toBe(false);
  });

  it('DELETE /api/copy/:wsId/intelligence/:patternId removes the pattern', async () => {
    const res = await del(`/api/copy/${wsId}/intelligence/${patternId}`);
    expect(res.status).toBe(204);

    // Verify removed
    const listRes = await api(`/api/copy/${wsId}/intelligence`);
    const patterns = await listRes.json();
    const found = patterns.find((p: { id: string }) => p.id === patternId);
    expect(found).toBeUndefined();
  });

  it('GET /api/copy/:wsId/intelligence/promotable returns 200', async () => {
    const res = await api(`/api/copy/${wsId}/intelligence/promotable`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Section status updates ──────────────────────────────────────────────────

describe('Section status updates', () => {
  let sectionId = '';

  beforeAll(() => {
    // Seed a copy_section row directly for status/text/suggest tests
    sectionId = `test-section-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, steering_history, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, wsId, entryId, 'sp-1', 'Test copy text', 'draft', '[]', 1, now, now);
  });

  it('PATCH status draft → client_review succeeds', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/${sectionId}/status`, { status: 'client_review' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('client_review');
  });

  it('PATCH status with invalid enum value returns 400', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/${sectionId}/status`, { status: 'invalid_status' });
    expect(res.status).toBe(400);
  });

  it('PATCH status with invalid transition returns 404', async () => {
    // Section is currently client_review; client_review → draft is not a valid transition
    const res = await patchJson(`/api/copy/${wsId}/section/${sectionId}/status`, { status: 'draft' });
    expect(res.status).toBe(404);
  });
});

// ── Text update ─────────────────────────────────────────────────────────────

describe('Section text update', () => {
  let sectionId = '';

  beforeAll(() => {
    sectionId = `test-text-section-${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, steering_history, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, wsId, entryId, 'sp-2', 'Original copy text', 'draft', '[]', 1, now, now);
  });

  it('PATCH /api/copy/:wsId/section/:sectionId/text updates copy', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/${sectionId}/text`, { copy: 'Updated copy text' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedCopy).toBe('Updated copy text');
    expect(body.status).toBe('draft');
    expect(body.version).toBeGreaterThan(1);
  });
});

// ── Client suggestion ───────────────────────────────────────────────────────

describe('Client suggestion', () => {
  let sectionId = '';

  beforeAll(() => {
    sectionId = `test-suggest-section-${randomUUID().slice(0, 8)}`;
    // Start in client_review so the suggestion triggers revision_requested transition
    // Uses 'sp-3' to avoid UNIQUE(entry_id, section_plan_item_id) conflict with 'sp-1'/'sp-2'
    db.prepare(`
      INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, steering_history, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, wsId, entryId, 'sp-3', 'Review copy text', 'client_review', '[]', 1, now, now);
  });

  it('POST /api/copy/:wsId/section/:sectionId/suggest adds suggestion', async () => {
    const res = await postJson(`/api/copy/${wsId}/section/${sectionId}/suggest`, {
      originalText: 'Review copy text',
      suggestedText: 'Better review copy text',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientSuggestions).toBeDefined();
    expect(body.clientSuggestions.length).toBeGreaterThan(0);
    expect(body.clientSuggestions[0].suggestedText).toBe('Better review copy text');
    expect(body.status).toBe('revision_requested');
  });
});

// ── Workspace isolation ─────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  let sectionId = '';

  beforeAll(() => {
    sectionId = `test-iso-section-${randomUUID().slice(0, 8)}`;
    // Uses 'sp-4' to avoid UNIQUE(entry_id, section_plan_item_id) conflict
    db.prepare(`
      INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, steering_history, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, wsId, entryId, 'sp-4', 'Isolation test copy', 'draft', '[]', 1, now, now);
  });

  it('GET sections for wsA entry via wsB returns empty array (not wsA data)', async () => {
    const res = await api(`/api/copy/${wsOtherId}/entry/${entryId}/sections`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('PATCH section from wsA via wsB returns 404', async () => {
    const res = await patchJson(`/api/copy/${wsOtherId}/section/${sectionId}/status`, { status: 'approved' });
    expect(res.status).toBe(404);
  });
});

// ── Export ───────────────────────────────────────────────────────────────────

describe('Export', () => {
  it('POST /api/copy/:wsId/:blueprintId/export CSV returns 200', async () => {
    const res = await postJson(`/api/copy/${wsId}/${blueprintId}/export`, {
      format: 'csv',
      scope: 'all',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('csv');
    expect(body.filename).toBeDefined();
    expect(typeof body.content).toBe('string');
  });

  it('POST /api/copy/:wsId/:blueprintId/export copy_deck returns 200', async () => {
    const res = await postJson(`/api/copy/${wsId}/${blueprintId}/export`, {
      format: 'copy_deck',
      scope: 'all',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('copy_deck');
    expect(body.filename).toBeDefined();
    expect(typeof body.content).toBe('string');
  });
});

// ── Zod validation ──────────────────────────────────────────────────────────

describe('Zod validation', () => {
  let sectionId = '';

  beforeAll(() => {
    sectionId = `test-zod-section-${randomUUID().slice(0, 8)}`;
    // Uses 'sp-5' to avoid UNIQUE(entry_id, section_plan_item_id) conflict
    db.prepare(`
      INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, steering_history, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, wsId, entryId, 'sp-5', 'Validation test copy', 'draft', '[]', 1, now, now);
  });

  it('PATCH status with missing body returns 400', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/${sectionId}/status`, {});
    expect(res.status).toBe(400);
  });

  it('POST export with invalid format returns 400', async () => {
    const res = await postJson(`/api/copy/${wsId}/${blueprintId}/export`, {
      format: 'invalid_format',
      scope: 'all',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH text with empty copy returns 400', async () => {
    const res = await patchJson(`/api/copy/${wsId}/section/${sectionId}/text`, { copy: '' });
    expect(res.status).toBe(400);
  });

  it('POST suggest with missing fields returns 400', async () => {
    const res = await postJson(`/api/copy/${wsId}/section/${sectionId}/suggest`, { originalText: 'test' });
    expect(res.status).toBe(400);
  });
});
