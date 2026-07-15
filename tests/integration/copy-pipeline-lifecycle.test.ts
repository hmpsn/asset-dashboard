/**
 * Integration tests for the Copy Pipeline routes lifecycle.
 *
 * Covers:
 *   - GET  /api/copy/:workspaceId/entry/:entryId/sections
 *   - GET  /api/copy/:workspaceId/entry/:entryId/status
 *   - GET  /api/copy/:workspaceId/entry/:entryId/metadata
 *   - PATCH /api/copy/:workspaceId/section/:sectionId/status
 *   - PATCH /api/copy/:workspaceId/section/:sectionId/text
 *   - POST  /api/copy/:workspaceId/:blueprintId/batch  (non-AI: returns batchId immediately)
 *   - GET   /api/copy/:workspaceId/batch/:batchId
 *   - GET   /api/copy/:workspaceId/intelligence
 *   - DELETE /api/copy/:workspaceId/intelligence/:patternId
 *   - Workspace isolation across all mutation + read paths
 *
 * Architecture: in-process Express server with dynamic port (listen(0)).
 * No createTestContext subprocess — vi.mock() works reliably with this pattern.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

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

// ── Imports (after mock declarations) ─────────────────────────────────────────

import db from '../../server/db/index.js';
import { cancelJob, listJobs } from '../../server/jobs.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createBlueprint, addEntry } from '../../server/page-strategy.js';
import { initializeSections, saveGeneratedCopy, saveMetadata } from '../../server/copy-review.js';
import { addPattern } from '../../server/copy-intelligence.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { CopySection, CopyIntelligencePattern, EntryCopyStatus, CopyMetadata } from '../../shared/types/copy-pipeline.js';
import type { SectionPlanItem } from '../../shared/types/page-strategy.js';

function clearActiveCopyBatchJobs() {
  for (const job of listJobs().filter(job => job.type === 'copy-batch-generation' && (job.status === 'pending' || job.status === 'running'))) {
    cancelJob(job.id);
  }
  db.prepare(`
    UPDATE jobs
    SET status = 'cancelled' -- status-ok: test isolation for copy batch active-job guard
    WHERE type = 'copy-batch-generation'
      AND status IN ('pending', 'running')
  `).run();
}

// ── Test server ───────────────────────────────────────────────────────────────

let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

function getJson(path: string): Promise<Response> {
  return api(path);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string): Promise<Response> {
  return api(path, { method: 'DELETE' });
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

/** Section plan items used to initialise copy_sections rows. */
function makeSectionPlan(): SectionPlanItem[] {
  return [
    { id: 'spi_hero', sectionType: 'hero', label: 'Hero', targetWordCount: 100, required: true },
    { id: 'spi_cta', sectionType: 'cta', label: 'CTA', targetWordCount: 50, required: true },
  ];
}

interface SeededEntry {
  workspaceId: string;
  blueprintId: string;
  entryId: string;
  sections: CopySection[];
}

/** Creates a blueprint entry with initialized copy sections in the DB. */
function seedEntry(workspaceId: string): SeededEntry {
  const blueprint = createBlueprint({ workspaceId, name: 'Test Blueprint' });
  const sectionPlan = makeSectionPlan();
  const entry = addEntry(workspaceId, blueprint.id, {
    name: 'Test Page',
    pageType: 'landing',
    sectionPlan,
  });
  if (!entry) throw new Error('Failed to create blueprint entry');
  const sections = initializeSections(workspaceId, entry.id, sectionPlan);
  return { workspaceId, blueprintId: blueprint.id, entryId: entry.id, sections };
}

/** Transitions a section to draft status by saving generated copy. */
function makeSectionDraft(sectionId: string, workspaceId: string): CopySection | null {
  return saveGeneratedCopy(sectionId, workspaceId, {
    generatedCopy: 'This is draft copy.',
    aiAnnotation: 'Annotation text',
    aiReasoning: 'Reasoning text',
  });
}

// ── Lifecycle vars ────────────────────────────────────────────────────────────

let ws = { workspaceId: '', webflowSiteId: '', webflowToken: '', cleanup: () => {} };
let wsB = { workspaceId: '', webflowSiteId: '', webflowToken: '', cleanup: () => {} };

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  ws = seedWorkspace();
  wsB = seedWorkspace();
});

afterAll(async () => {
  // Clean up copy pipeline data first, then workspaces
  db.prepare('DELETE FROM copy_sections WHERE workspace_id IN (?, ?)').run(ws.workspaceId, wsB.workspaceId);
  db.prepare('DELETE FROM copy_metadata WHERE workspace_id IN (?, ?)').run(ws.workspaceId, wsB.workspaceId);
  db.prepare('DELETE FROM copy_intelligence WHERE workspace_id IN (?, ?)').run(ws.workspaceId, wsB.workspaceId);
  db.prepare('DELETE FROM copy_batch_jobs WHERE workspace_id IN (?, ?)').run(ws.workspaceId, wsB.workspaceId);
  db.prepare('DELETE FROM blueprint_entries WHERE blueprint_id IN (SELECT id FROM site_blueprints WHERE workspace_id IN (?, ?))').run(ws.workspaceId, wsB.workspaceId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id IN (?, ?)').run(ws.workspaceId, wsB.workspaceId);
  ws.cleanup();
  wsB.cleanup();
  await new Promise<void>(resolve => server!.close(() => resolve()));
});

beforeEach(() => {
  broadcastState.calls = [];
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/copy/:workspaceId/entry/:entryId/sections
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/copy/:workspaceId/entry/:entryId/sections', () => {
  it('returns 200 with an empty array for an entry with no sections', async () => {
    // Create entry but skip initializeSections so copy_sections is empty
    const blueprint = createBlueprint({ workspaceId: ws.workspaceId, name: 'Empty Sections Blueprint' });
    const entry = addEntry(ws.workspaceId, blueprint.id, { name: 'Empty Page', pageType: 'landing', sectionPlan: [] });
    expect(entry).not.toBeNull();

    const res = await getJson(`/api/copy/${ws.workspaceId}/entry/${entry!.id}/sections`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns 200 with initialized sections for a seeded entry', async () => {
    const { workspaceId, entryId, sections } = seedEntry(ws.workspaceId);
    const res = await getJson(`/api/copy/${workspaceId}/entry/${entryId}/sections`);
    expect(res.status).toBe(200);
    const body = await res.json() as CopySection[];
    expect(body).toHaveLength(sections.length);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('status', 'pending');
    expect(body[0]).toHaveProperty('entryId', entryId);
  });

  it('workspace isolation: cannot read sections for an entry via another workspace', async () => {
    const { entryId } = seedEntry(ws.workspaceId);
    // Use wsB to access an entry that belongs to ws
    const res = await getJson(`/api/copy/${wsB.workspaceId}/entry/${entryId}/sections`);
    expect(res.status).toBe(200);
    // Returns empty array — copy_sections are scoped by both entry_id AND workspace_id
    const body = await res.json() as CopySection[];
    expect(body).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/copy/:workspaceId/entry/:entryId/status
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/copy/:workspaceId/entry/:entryId/status', () => {
  it('returns 200 with status object for a seeded entry', async () => {
    const { workspaceId, entryId } = seedEntry(ws.workspaceId);
    const res = await getJson(`/api/copy/${workspaceId}/entry/${entryId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as EntryCopyStatus;
    expect(body).toHaveProperty('entryId', entryId);
    expect(body).toHaveProperty('totalSections');
    expect(body).toHaveProperty('overallStatus');
    expect(body).toHaveProperty('approvalPercentage');
  });

  it('overallStatus is "pending" when all sections are pending', async () => {
    const { workspaceId, entryId } = seedEntry(ws.workspaceId);
    const res = await getJson(`/api/copy/${workspaceId}/entry/${entryId}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as EntryCopyStatus;
    expect(body.overallStatus).toBe('pending');
    expect(body.pendingSections).toBe(body.totalSections);
    expect(body.approvalPercentage).toBe(0);
  });

  it('returns 200 with pending counts for a fresh entry with no sections', async () => {
    const blueprint = createBlueprint({ workspaceId: ws.workspaceId, name: 'Status Blueprint' });
    const entry = addEntry(ws.workspaceId, blueprint.id, { name: 'Status Page', pageType: 'landing', sectionPlan: [] });
    const res = await getJson(`/api/copy/${ws.workspaceId}/entry/${entry!.id}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as EntryCopyStatus;
    expect(body.totalSections).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/copy/:workspaceId/entry/:entryId/metadata
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/copy/:workspaceId/entry/:entryId/metadata', () => {
  it('returns 404 when no metadata exists for the entry', async () => {
    const { workspaceId, entryId } = seedEntry(ws.workspaceId);
    const res = await getJson(`/api/copy/${workspaceId}/entry/${entryId}/metadata`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 200 with metadata after saveMetadata is called directly', async () => {
    const { workspaceId, entryId } = seedEntry(ws.workspaceId);
    saveMetadata(entryId, workspaceId, {
      seoTitle: 'Test SEO Title',
      metaDescription: 'Test meta description.',
      ogTitle: 'Test OG Title',
      ogDescription: 'Test OG description.',
    });

    const res = await getJson(`/api/copy/${workspaceId}/entry/${entryId}/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json() as CopyMetadata;
    expect(body).toHaveProperty('entryId', entryId);
    expect(body).toHaveProperty('seoTitle', 'Test SEO Title');
    expect(body).toHaveProperty('metaDescription', 'Test meta description.');
  });

  it('workspace isolation: cannot read metadata via another workspace', async () => {
    const { workspaceId, entryId } = seedEntry(ws.workspaceId);
    saveMetadata(entryId, workspaceId, {
      seoTitle: 'Isolated Title',
      metaDescription: 'Isolated meta.',
      ogTitle: 'Isolated OG',
      ogDescription: 'Isolated OG desc.',
    });

    // Accessing through wsB should return 404 (metadata not found for wsB)
    const res = await getJson(`/api/copy/${wsB.workspaceId}/entry/${entryId}/metadata`);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/copy/:workspaceId/section/:sectionId/status
// ═══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/copy/:workspaceId/section/:sectionId/status', () => {
  it('returns 200 with updated section after a valid status transition (pending → draft skipped; use draft → client_review)', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    // Get a section into draft state first
    const section = makeSectionDraft(sections[0].id, workspaceId);
    expect(section).not.toBeNull();

    const res = await patchJson(
      `/api/copy/${workspaceId}/section/${section!.id}/status`,
      { status: 'client_review', expectedRevision: section!.generationRevision },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as CopySection;
    expect(body).toHaveProperty('id', section!.id);
    expect(body).toHaveProperty('status', 'client_review');
  });

  it('returns 404 for a nonexistent sectionId', async () => {
    const res = await patchJson(
      `/api/copy/${ws.workspaceId}/section/nonexistent-section-id/status`,
      { status: 'draft', expectedRevision: 0 },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for an invalid status transition (pending → approved)', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    // sections start at 'pending'; pending → approved is not a valid transition
    const res = await patchJson(
      `/api/copy/${workspaceId}/section/${sections[0].id}/status`,
      { status: 'approved', expectedRevision: sections[0].generationRevision },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for missing status field', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const res = await patchJson(
      `/api/copy/${workspaceId}/section/${sections[0].id}/status`,
      { expectedRevision: sections[0].generationRevision },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid status value', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const res = await patchJson(
      `/api/copy/${workspaceId}/section/${sections[0].id}/status`,
      { status: 'not_a_real_status', expectedRevision: sections[0].generationRevision },
    );
    expect(res.status).toBe(400);
  });

  it('broadcasts COPY_SECTION_UPDATED with correct workspaceId on status update', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const section = makeSectionDraft(sections[0].id, workspaceId);

    broadcastState.calls = [];
    await patchJson(`/api/copy/${workspaceId}/section/${section!.id}/status`, {
      status: 'client_review',
      expectedRevision: section!.generationRevision,
    });

    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.COPY_SECTION_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast?.workspaceId).toBe(workspaceId);
    expect((broadcast?.payload as Record<string, unknown>).sectionId).toBe(section!.id);
    expect((broadcast?.payload as Record<string, unknown>).status).toBe('client_review');
  });

  it('workspace isolation: cannot update a section via another workspace', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const section = makeSectionDraft(sections[0].id, workspaceId);

    const res = await patchJson(
      `/api/copy/${wsB.workspaceId}/section/${section!.id}/status`,
      { status: 'client_review', expectedRevision: section!.generationRevision },
    );
    expect(res.status).toBe(404);
    // Original section must remain unchanged
    const checkRes = await getJson(`/api/copy/${workspaceId}/entry/${section!.entryId}/sections`);
    const sectionList = await checkRes.json() as CopySection[];
    const found = sectionList.find(s => s.id === section!.id);
    expect(found?.status).toBe('draft');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/copy/:workspaceId/section/:sectionId/text
// ═══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/copy/:workspaceId/section/:sectionId/text', () => {
  it('returns 200 with updated copy text', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    // updateCopyText works from any non-approved status; sections start as pending but
    // updateCopyText sets status→draft regardless; the pending→draft guard is not enforced by
    // updateCopyText, only by updateSectionStatus (it's a direct text override).
    const section = makeSectionDraft(sections[0].id, workspaceId);

    const res = await patchJson(
      `/api/copy/${workspaceId}/section/${section!.id}/text`,
      { copy: 'Manually edited copy text.', expectedRevision: section!.generationRevision },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as CopySection;
    expect(body).toHaveProperty('id', section!.id);
    expect(body).toHaveProperty('generatedCopy', 'Manually edited copy text.');
    expect(body).toHaveProperty('status', 'draft');
  });

  it('returns 404 for a nonexistent sectionId', async () => {
    const res = await patchJson(
      `/api/copy/${ws.workspaceId}/section/nonexistent-section-text/text`,
      { copy: 'Some text.', expectedRevision: 0 },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when copy field is missing', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const section = makeSectionDraft(sections[0].id, workspaceId);
    const res = await patchJson(
      `/api/copy/${workspaceId}/section/${section!.id}/text`,
      { expectedRevision: section!.generationRevision },
    );
    expect(res.status).toBe(400);
  });

  it('broadcasts COPY_SECTION_UPDATED on text update', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const section = makeSectionDraft(sections[0].id, workspaceId);

    broadcastState.calls = [];
    await patchJson(`/api/copy/${workspaceId}/section/${section!.id}/text`, {
      copy: 'New text.',
      expectedRevision: section!.generationRevision,
    });

    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.COPY_SECTION_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast?.workspaceId).toBe(workspaceId);
    expect((broadcast?.payload as Record<string, unknown>).sectionId).toBe(section!.id);
  });

  it('workspace isolation: cannot update section text via another workspace', async () => {
    const { workspaceId, sections } = seedEntry(ws.workspaceId);
    const section = makeSectionDraft(sections[0].id, workspaceId);
    const originalCopy = section!.generatedCopy;

    const res = await patchJson(
      `/api/copy/${wsB.workspaceId}/section/${section!.id}/text`,
      { copy: 'Cross-workspace attack.', expectedRevision: section!.generationRevision },
    );
    expect(res.status).toBe(404);
    // Verify original copy unchanged
    const checkRes = await getJson(`/api/copy/${workspaceId}/entry/${section!.entryId}/sections`);
    const sectionList = await checkRes.json() as CopySection[];
    const found = sectionList.find(s => s.id === section!.id);
    expect(found?.generatedCopy).toBe(originalCopy);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/copy/:workspaceId/:blueprintId/batch (start batch — non-AI path)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/copy/:workspaceId/:blueprintId/batch', () => {
  beforeEach(() => {
    clearActiveCopyBatchJobs();
  });

  it('returns 200 with a batchId when blueprint exists', async () => {
    const { workspaceId, blueprintId, entryId } = seedEntry(ws.workspaceId);
    const res = await postJson(`/api/copy/${workspaceId}/${blueprintId}/batch`, {
      entryIds: [entryId],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { batchId: string };
    expect(body).toHaveProperty('batchId');
    expect(typeof body.batchId).toBe('string');
    expect(body.batchId).toMatch(/^bj_/);
  });

  it('returns 404 when the blueprintId does not exist', async () => {
    const res = await postJson(`/api/copy/${ws.workspaceId}/nonexistent-blueprint/batch`, {
      entryIds: ['some-entry-id'],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when entryIds is missing or empty', async () => {
    const { workspaceId, blueprintId } = seedEntry(ws.workspaceId);
    const res = await postJson(`/api/copy/${workspaceId}/${blueprintId}/batch`, {});
    expect(res.status).toBe(400);
  });

  it('broadcasts COPY_BATCH_PROGRESS immediately after batch creation', async () => {
    const { workspaceId, blueprintId, entryId } = seedEntry(ws.workspaceId);
    broadcastState.calls = [];
    await postJson(`/api/copy/${workspaceId}/${blueprintId}/batch`, { entryIds: [entryId] });
    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.COPY_BATCH_PROGRESS);
    expect(broadcast).toBeDefined();
    expect(broadcast?.workspaceId).toBe(workspaceId);
    const payload = broadcast?.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('batchId');
    expect(payload.total).toBe(1);
    expect(payload.generated).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/copy/:workspaceId/batch/:batchId
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/copy/:workspaceId/batch/:batchId', () => {
  beforeEach(() => {
    clearActiveCopyBatchJobs();
  });

  it('returns 200 with batch job data for a valid batchId', async () => {
    const { workspaceId, blueprintId, entryId } = seedEntry(ws.workspaceId);
    const startRes = await postJson(`/api/copy/${workspaceId}/${blueprintId}/batch`, {
      entryIds: [entryId],
    });
    const { batchId } = await startRes.json() as { batchId: string };

    const res = await getJson(`/api/copy/${workspaceId}/batch/${batchId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id', batchId);
    expect(body).toHaveProperty('workspaceId', workspaceId);
    expect(body).toHaveProperty('blueprintId', blueprintId);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('progress');
    expect(body.progress).toHaveProperty('total', 1);
  });

  it('returns 404 for a nonexistent batchId', async () => {
    const res = await getJson(`/api/copy/${ws.workspaceId}/batch/nonexistent-batch-id`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('workspace isolation: cannot fetch a batch via another workspace', async () => {
    const { workspaceId, blueprintId, entryId } = seedEntry(ws.workspaceId);
    const startRes = await postJson(`/api/copy/${workspaceId}/${blueprintId}/batch`, {
      entryIds: [entryId],
    });
    const { batchId } = await startRes.json() as { batchId: string };

    // Try to read the batch via wsB
    const res = await getJson(`/api/copy/${wsB.workspaceId}/batch/${batchId}`);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/copy/:workspaceId/intelligence
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/copy/:workspaceId/intelligence', () => {
  it('returns 200 with an empty array when no patterns exist', async () => {
    const freshWs = seedWorkspace();
    try {
      const res = await getJson(`/api/copy/${freshWs.workspaceId}/intelligence`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      freshWs.cleanup();
    }
  });

  it('returns 200 with patterns seeded via addPattern', async () => {
    addPattern(ws.workspaceId, {
      patternType: 'terminology',
      pattern: 'Use "solution" not "product"',
      source: 'manual',
    });

    const res = await getJson(`/api/copy/${ws.workspaceId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json() as CopyIntelligencePattern[];
    const found = body.find(p => p.pattern === 'Use "solution" not "product"');
    expect(found).toBeDefined();
    expect(found).toHaveProperty('patternType', 'terminology');
    expect(found).toHaveProperty('workspaceId', ws.workspaceId);
    expect(found).toHaveProperty('active', true);
    expect(found).toHaveProperty('id');
  });

  it('workspace isolation: patterns from wsA do not appear in wsB intelligence list', async () => {
    addPattern(ws.workspaceId, {
      patternType: 'tone',
      pattern: 'Keep tone professional and concise',
      source: 'manual',
    });

    const res = await getJson(`/api/copy/${wsB.workspaceId}/intelligence`);
    expect(res.status).toBe(200);
    const body = await res.json() as CopyIntelligencePattern[];
    const leaked = body.find(p => p.workspaceId === ws.workspaceId);
    expect(leaked).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/copy/:workspaceId/intelligence/:patternId
// ═══════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/copy/:workspaceId/intelligence/:patternId', () => {
  it('returns 204 and removes the pattern from the list', async () => {
    const pattern = addPattern(ws.workspaceId, {
      patternType: 'structure',
      pattern: 'Start with the key benefit',
      source: 'manual',
    });

    const res = await del(`/api/copy/${ws.workspaceId}/intelligence/${pattern.id}`);
    expect(res.status).toBe(204);

    // Confirm deletion via GET
    const listRes = await getJson(`/api/copy/${ws.workspaceId}/intelligence`);
    const body = await listRes.json() as CopyIntelligencePattern[];
    expect(body.find(p => p.id === pattern.id)).toBeUndefined();
  });

  it('returns 204 even for a nonexistent patternId (idempotent delete)', async () => {
    // removePattern runs a DELETE SQL — if no rows affected it still succeeds
    const res = await del(`/api/copy/${ws.workspaceId}/intelligence/nonexistent-pattern-id`);
    expect(res.status).toBe(204);
  });

  it('broadcasts COPY_INTELLIGENCE_UPDATED with deleted: true', async () => {
    const pattern = addPattern(ws.workspaceId, {
      patternType: 'keyword_usage',
      pattern: 'Include primary keyword in first 100 words',
      source: 'manual',
    });

    broadcastState.calls = [];
    await del(`/api/copy/${ws.workspaceId}/intelligence/${pattern.id}`);

    const broadcast = broadcastState.calls.find(c => c.event === WS_EVENTS.COPY_INTELLIGENCE_UPDATED);
    expect(broadcast).toBeDefined();
    expect(broadcast?.workspaceId).toBe(ws.workspaceId);
    const payload = broadcast?.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('patternId', pattern.id);
    expect(payload).toHaveProperty('deleted', true);
  });

  it('workspace isolation: cannot delete a pattern via another workspace (pattern persists in owning workspace)', async () => {
    const pattern = addPattern(ws.workspaceId, {
      patternType: 'tone',
      pattern: 'Avoid jargon',
      source: 'manual',
    });

    // Attempt delete via wsB
    const res = await del(`/api/copy/${wsB.workspaceId}/intelligence/${pattern.id}`);
    // removePattern uses DELETE WHERE id=? AND workspace_id=? — silently affects 0 rows → still 204
    expect(res.status).toBe(204);

    // The pattern must still exist in the owning workspace
    const listRes = await getJson(`/api/copy/${ws.workspaceId}/intelligence`);
    const body = await listRes.json() as CopyIntelligencePattern[];
    expect(body.find(p => p.id === pattern.id)).toBeDefined();
  });
});
