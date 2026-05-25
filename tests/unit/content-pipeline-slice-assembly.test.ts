// tests/unit/content-pipeline-slice-assembly.test.ts
//
// Unit tests for server/intelligence/content-pipeline-slice.ts
// Probes specific bug vectors:
//   1. Coverage gap null/undefined brief.targetKeyword handling
//   2. assembleCopyPipeline approval rate accuracy
//   3. assembleCopyPipeline returns undefined for empty workspace
//   4. assembleContentPipeline empty workspace shape
//   5. lastBatchJob progress_json parsing (malformed/null/valid)

import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { assembleContentPipeline } from '../../server/intelligence/content-pipeline-slice.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function insertBlueprint(workspaceId: string): { blueprintId: string } {
  const blueprintId = `bp-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
     VALUES (?, ?, 'Test Blueprint', 1, 'draft', ?, ?)`,
  ).run(blueprintId, workspaceId, now, now);
  return { blueprintId };
}

function insertEntry(workspaceId: string, blueprintId: string): { entryId: string } {
  const entryId = `entry-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO blueprint_entries (
       id, blueprint_id, name, page_type, scope, sort_order, is_collection,
       primary_keyword, section_plan_json, created_at, updated_at
     ) VALUES (?, ?, 'Test Entry', 'service', 'included', 0, 0, 'test-keyword', '[]', ?, ?)`,
  ).run(entryId, blueprintId, now, now);
  return { entryId };
}

/**
 * Insert a copy_section. version=1 means first-version copy.
 */
function insertCopySection(opts: {
  workspaceId: string;
  entryId: string;
  status: string;
  version?: number;
}): { sectionId: string } {
  const sectionId = `sec-${randomUUID().slice(0, 8)}`;
  const spItemId = `sp-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sectionId,
    opts.workspaceId,
    opts.entryId,
    spItemId,
    opts.status,
    opts.version ?? 0,
    now,
    now,
  );
  return { sectionId };
}

/**
 * Insert a copy_batch_job.
 */
function insertBatchJob(opts: {
  workspaceId: string;
  blueprintId: string;
  progressJson: string;
  status?: string;
}): { jobId: string } {
  const jobId = `job-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO copy_batch_jobs (id, workspace_id, blueprint_id, status, progress_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    opts.workspaceId,
    opts.blueprintId,
    opts.status ?? 'completed',
    opts.progressJson,
    now,
    now,
  );
  return { jobId };
}

/**
 * Insert a content brief with a given targetKeyword.
 * target_keyword is NOT NULL per migration schema; pass '' to simulate an empty/cleared keyword.
 */
function insertContentBrief(workspaceId: string, targetKeyword: string): { briefId: string } {
  const briefId = `brief-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_briefs (
       id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at
     ) VALUES (?, ?, ?, '[]', 'Title', 'Meta', '[]', 1000, 'informational', 'general', 'none', '[]', ?)`,
  ).run(briefId, workspaceId, targetKeyword, now);
  return { briefId };
}

// ─── test state ───────────────────────────────────────────────────────────────

let workspaceId: string;
let cleanup: () => void;

beforeEach(() => {
  const ws = seedWorkspace({ clientPassword: '' });
  workspaceId = ws.workspaceId;
  cleanup = ws.cleanup;
});

afterEach(() => {
  cleanup();
});

// ─── Bug #1: coverage gap null/empty targetKeyword on brief ───────────────────
//
// The implementation uses `b.targetKeyword?.trim().toLowerCase()` which produces
// `undefined` for null/undefined targetKeyword values. Since the Set contains
// `undefined` for those briefs, `briefKeywords.has(kw.trim().toLowerCase())` can
// never match them (kw.trim().toLowerCase() always yields a string). So a brief
// with an empty keyword does NOT cover any strategy keyword.

describe('coverageGaps — empty/null-like targetKeyword on brief', () => {
  it('strategy keyword appears in coverageGaps when brief has empty string targetKeyword', async () => {
    // Seed a strategy keyword on the workspace
    db.prepare(
      `UPDATE workspaces SET keyword_strategy = ? WHERE id = ?`,
    ).run(
      JSON.stringify({ siteKeywords: ['seo services'] }),
      workspaceId,
    );

    // Seed a brief with empty targetKeyword — simulates the null/undefined path
    // In production this can happen when a brief is created without a keyword or
    // the keyword field is cleared.
    insertContentBrief(workspaceId, '');

    const result = await assembleContentPipeline(workspaceId);

    // 'seo services' should appear in coverageGaps because '' !== 'seo services'
    expect(result.coverageGaps).toContain('seo services');
  });

  it('strategy keyword is excluded from coverageGaps when brief covers it', async () => {
    db.prepare(
      `UPDATE workspaces SET keyword_strategy = ? WHERE id = ?`,
    ).run(
      JSON.stringify({ siteKeywords: ['seo services'] }),
      workspaceId,
    );

    // Brief covers the exact keyword (case-insensitive match)
    insertContentBrief(workspaceId, 'SEO Services');

    const result = await assembleContentPipeline(workspaceId);

    // 'seo services' should NOT appear — brief's lowercased key 'seo services' matches
    expect(result.coverageGaps).not.toContain('seo services');
  });

  it('caps coverageGaps at 10 entries even when many gaps exist', async () => {
    const manyKeywords = Array.from({ length: 15 }, (_, i) => `keyword-${i}`);
    db.prepare(
      `UPDATE workspaces SET keyword_strategy = ? WHERE id = ?`,
    ).run(
      JSON.stringify({ siteKeywords: manyKeywords }),
      workspaceId,
    );

    // No briefs — all 15 are gaps
    const result = await assembleContentPipeline(workspaceId);
    expect(result.coverageGaps.length).toBeLessThanOrEqual(10);
  });

  it('returns empty coverageGaps when no strategy keywords are configured', async () => {
    // Workspace with no keywordStrategy
    const result = await assembleContentPipeline(workspaceId);
    expect(result.coverageGaps).toEqual([]);
  });
});

// ─── Bug #2: assembleCopyPipeline approval rate accuracy ─────────────────────

describe('assembleCopyPipeline — approval rate math', () => {
  it('computes approvalRate = 75 for 3 approved out of 4 total sections', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);

    // 4 total: 3 approved (2 first-version, 1 revised), 1 draft
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 2 });
    insertCopySection({ workspaceId, entryId, status: 'draft', version: 0 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.totalSections).toBe(4);
    expect(result.copyPipeline!.approvedSections).toBe(3);
    expect(result.copyPipeline!.approvalRate).toBe(75);
  });

  it('computes firstTryApprovalRate = 67 for 2 first-version out of 3 approved (rounds up from 66.67)', async () => {
    // Bug probe: Math.round(2/3 * 100) = Math.round(66.666...) = 67, NOT 66
    // The implementation uses Math.round, so the result is 67.
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);

    insertCopySection({ workspaceId, entryId, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 2 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.approvedSections).toBe(3);
    // Math.round(66.666...) = 67 — verify actual rounding behavior
    expect(result.copyPipeline!.firstTryApprovalRate).toBe(67);
  });

  it('firstTryApprovalRate is 0 when all approved sections are revisions (version > 1)', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);

    // 2 approved, both revised (version = 2)
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 2 });
    insertCopySection({ workspaceId, entryId, status: 'approved', version: 2 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline!.approvedSections).toBe(2);
    expect(result.copyPipeline!.firstTryApprovalRate).toBe(0);
  });

  it('firstTryApprovalRate is 0 when no sections are approved (no division by zero)', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);

    // All sections are pending, none approved
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });
    insertCopySection({ workspaceId, entryId, status: 'draft', version: 0 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.approvedSections).toBe(0);
    expect(result.copyPipeline!.firstTryApprovalRate).toBe(0);
    expect(result.copyPipeline!.approvalRate).toBe(0);
  });

  it('counts each status bucket correctly', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);

    insertCopySection({ workspaceId, entryId, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'draft', version: 0 });
    insertCopySection({ workspaceId, entryId, status: 'client_review', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });
    insertCopySection({ workspaceId, entryId, status: 'revision_requested', version: 1 });

    const result = await assembleContentPipeline(workspaceId);

    const cp = result.copyPipeline!;
    expect(cp.totalSections).toBe(5);
    expect(cp.approvedSections).toBe(1);
    expect(cp.draftSections).toBe(1);
    expect(cp.clientReviewSections).toBe(1);
    expect(cp.pendingSections).toBe(1);
    expect(cp.revisionSections).toBe(1);
    expect(cp.approvalRate).toBe(20); // 1/5 = 20%
  });
});

// ─── Bug #3: assembleCopyPipeline returns undefined when no rows ──────────────

describe('assembleCopyPipeline — undefined for empty workspace', () => {
  it('returns undefined when no copy_sections rows exist for workspace', async () => {
    const result = await assembleContentPipeline(workspaceId);
    expect(result.copyPipeline).toBeUndefined();
  });

  it('returns a summary when at least one section exists', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.totalSections).toBe(1);
  });
});

// ─── Bug #4: assembleContentPipeline empty workspace shape ───────────────────

describe('assembleContentPipeline — empty workspace defaults', () => {
  it('returns zero counts and empty arrays with no data', async () => {
    const result = await assembleContentPipeline(workspaceId);

    expect(result.briefs.total).toBe(0);
    expect(result.posts.total).toBe(0);
    expect(result.matrices.total).toBe(0);
    expect(result.requests.pending).toBe(0);
    expect(result.workOrders.active).toBe(0);
    expect(result.coverageGaps).toEqual([]);
    expect(result.cannibalizationWarnings).toEqual([]);
    expect(result.decayAlerts).toEqual([]);
    expect(result.suggestedBriefs).toBe(0);
    expect(result.copyPipeline).toBeUndefined();
    // subscriptions is populated as { active: 0, totalPages: 0 } when no subs exist
    // (listContentSubscriptions returns [] → activeSubs = [] → counts are 0)
    expect(result.subscriptions).toEqual({ active: 0, totalPages: 0 });
    // schemaDeployment is populated (seedWorkspace has a webflowSiteId) with zero counts
    expect(result.schemaDeployment).toEqual({ planned: 0, deployed: 0, types: [] });
    expect(result.rewritePlaybook).toBeUndefined();
    expect(result.contentPricing).toBeUndefined();
  });

  it('shape matches ContentPipelineSlice required fields', async () => {
    const result = await assembleContentPipeline(workspaceId);

    // Required fields that must always be present
    expect(result).toHaveProperty('briefs');
    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('matrices');
    expect(result).toHaveProperty('requests');
    expect(result).toHaveProperty('workOrders');
    expect(result).toHaveProperty('coverageGaps');
    expect(result).toHaveProperty('seoEdits');
    expect(result).toHaveProperty('cannibalizationWarnings');
    expect(result).toHaveProperty('decayAlerts');
    expect(result).toHaveProperty('suggestedBriefs');
  });
});

// ─── Bug #5: lastBatchJob progress_json parsing ───────────────────────────────

describe('assembleCopyPipeline — lastBatchJob progress_json parsing', () => {
  it('handles malformed progress_json gracefully — falls back to completionRate = 0', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    insertBatchJob({
      workspaceId,
      blueprintId,
      progressJson: 'not-valid-json',
      status: 'completed',
    });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.lastBatchJob).not.toBeNull();
    expect(result.copyPipeline!.lastBatchJob!.completionRate).toBe(0);
    expect(result.copyPipeline!.lastBatchJob!.status).toBe('completed');
  });

  it('handles progress_json = "null" gracefully — falls back to completionRate = 0', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    insertBatchJob({
      workspaceId,
      blueprintId,
      progressJson: 'null',
      status: 'running',
    });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.lastBatchJob).not.toBeNull();
    expect(result.copyPipeline!.lastBatchJob!.completionRate).toBe(0);
    expect(result.copyPipeline!.lastBatchJob!.status).toBe('running');
  });

  it('parses valid progress_json and computes completionRate correctly — 5/10 = 50%', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    insertBatchJob({
      workspaceId,
      blueprintId,
      progressJson: JSON.stringify({ total: 10, generated: 5, reviewed: 3, approved: 2 }),
      status: 'completed',
    });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.lastBatchJob).not.toBeNull();
    expect(result.copyPipeline!.lastBatchJob!.completionRate).toBe(50);
  });

  it('returns null lastBatchJob when no batch jobs exist for workspace', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.lastBatchJob).toBeNull();
  });

  it('progress.total = 0 yields completionRate = 0 (no division by zero)', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    insertBatchJob({
      workspaceId,
      blueprintId,
      progressJson: JSON.stringify({ total: 0, generated: 0, reviewed: 0, approved: 0 }),
      status: 'pending',
    });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline!.lastBatchJob!.completionRate).toBe(0);
  });

  it('most recent batch job is returned when multiple jobs exist', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId, status: 'pending', version: 0 });

    // Insert older job first, newer job second
    // Use explicit timestamps to control ordering
    const oldId = `job-old-${randomUUID().slice(0, 8)}`;
    const newId = `job-new-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO copy_batch_jobs (id, workspace_id, blueprint_id, status, progress_json, created_at, updated_at)
       VALUES (?, ?, ?, 'completed', ?, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
    ).run(oldId, workspaceId, blueprintId, JSON.stringify({ total: 10, generated: 10, reviewed: 10, approved: 10 }));
    db.prepare(
      `INSERT INTO copy_batch_jobs (id, workspace_id, blueprint_id, status, progress_json, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, '2024-06-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z')`,
    ).run(newId, workspaceId, blueprintId, JSON.stringify({ total: 20, generated: 4, reviewed: 0, approved: 0 }));

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline!.lastBatchJob!.status).toBe('running');
    expect(result.copyPipeline!.lastBatchJob!.completionRate).toBe(20); // 4/20 = 20%
  });
});

// ─── Entry-level completion tracking ─────────────────────────────────────────

describe('assembleCopyPipeline — entry completion tracking', () => {
  it('counts entriesWithCompleteCopy and entriesWithPendingCopy correctly', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);

    // Entry A: all sections approved
    const { entryId: entryA } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId: entryA, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId: entryA, status: 'approved', version: 1 });

    // Entry B: one approved, one pending (still in progress)
    const { entryId: entryB } = insertEntry(workspaceId, blueprintId);
    insertCopySection({ workspaceId, entryId: entryB, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId: entryB, status: 'pending', version: 0 });

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline).toBeDefined();
    expect(result.copyPipeline!.entriesWithCompleteCopy).toBe(1);
    expect(result.copyPipeline!.entriesWithPendingCopy).toBe(1);
  });

  it('entriesWithCompleteCopy is 0 when no entry has all sections approved', async () => {
    const { blueprintId } = insertBlueprint(workspaceId);
    const { entryId } = insertEntry(workspaceId, blueprintId);

    insertCopySection({ workspaceId, entryId, status: 'approved', version: 1 });
    insertCopySection({ workspaceId, entryId, status: 'draft', version: 0 }); // incomplete

    const result = await assembleContentPipeline(workspaceId);

    expect(result.copyPipeline!.entriesWithCompleteCopy).toBe(0);
    expect(result.copyPipeline!.entriesWithPendingCopy).toBe(1);
  });
});

// ─── Workspace isolation ──────────────────────────────────────────────────────

describe('assembleCopyPipeline — workspace isolation', () => {
  it('does not include sections from another workspace', async () => {
    const ws2 = seedWorkspace({ clientPassword: '' });
    try {
      const { blueprintId: bp2 } = insertBlueprint(ws2.workspaceId);
      const { entryId: entry2 } = insertEntry(ws2.workspaceId, bp2);
      insertCopySection({ workspaceId: ws2.workspaceId, entryId: entry2, status: 'approved', version: 1 });
      insertCopySection({ workspaceId: ws2.workspaceId, entryId: entry2, status: 'draft', version: 0 });

      // Our main workspace has no sections
      const result = await assembleContentPipeline(workspaceId);
      expect(result.copyPipeline).toBeUndefined();

      // The other workspace has its own sections
      const result2 = await assembleContentPipeline(ws2.workspaceId);
      expect(result2.copyPipeline).toBeDefined();
      expect(result2.copyPipeline!.totalSections).toBe(2);
    } finally {
      ws2.cleanup();
    }
  });
});
