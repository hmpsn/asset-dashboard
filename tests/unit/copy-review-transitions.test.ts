/**
 * Unit tests for pure functions in server/copy-review.ts and
 * server/outcome-scoring-defaults.ts.
 *
 * Part A: isValidTransition (pure state-machine logic — no DB needed)
 * Part B: getEntryCopyStatus aggregate logic (DB-backed via real SQLite)
 * Part C: resolveScoringConfig deep-merge logic (pure function)
 */

import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';

// ── Mocks required by copy-review module imports ─────────────────────────────
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/voice-calibration.js', () => ({
  addVoiceSample: vi.fn(),
  getVoiceProfile: vi.fn().mockReturnValue(null),
  deleteVoiceSample: vi.fn(),
}));

import {
  isValidTransition,
  getEntryCopyStatus,
  initializeSections,
  updateSectionStatus,
  saveGeneratedCopy,
} from '../../server/copy-review.js';
import { resolveScoringConfig, DEFAULT_SCORING_CONFIG } from '../../server/outcome-scoring-defaults.js';
import type { CopySectionStatus } from '../../shared/types/copy-pipeline.js';
import type { SectionPlanItem } from '../../shared/types/page-strategy.js';

// ── R3-PR2 fold: the parallel VALID_TRANSITIONS map is deleted; copy-review now
// reads the shared COPY_SECTION_TRANSITIONS table from state-machines.ts ──────────
describe('copy-review parallel-validator fold (R3-PR2)', () => {
  const COPY_REVIEW_SRC = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/copy-review.ts'),
    'utf8',
  );

  it('no longer declares its own VALID_TRANSITIONS map', () => {
    expect(COPY_REVIEW_SRC).not.toContain('const VALID_TRANSITIONS');
  });

  it('imports COPY_SECTION_TRANSITIONS + validateTransition from state-machines.ts', () => {
    expect(COPY_REVIEW_SRC).toContain('COPY_SECTION_TRANSITIONS');
    expect(COPY_REVIEW_SRC).toContain("from './state-machines.js'");
    expect(COPY_REVIEW_SRC).toContain('validateTransition(');
  });
});

// ── Part A: isValidTransition ─────────────────────────────────────────────────

describe('isValidTransition', () => {
  // ── Valid transitions ────────────────────────────────────────────────────────

  describe('valid transitions (should return true)', () => {
    it('pending → draft', () => {
      expect(isValidTransition('pending', 'draft')).toBe(true);
    });

    it('draft → client_review', () => {
      expect(isValidTransition('draft', 'client_review')).toBe(true);
    });

    it('draft → approved (skip-ahead shortcut)', () => {
      expect(isValidTransition('draft', 'approved')).toBe(true);
    });

    it('client_review → approved', () => {
      expect(isValidTransition('client_review', 'approved')).toBe(true);
    });

    it('client_review → revision_requested', () => {
      expect(isValidTransition('client_review', 'revision_requested')).toBe(true);
    });

    it('revision_requested → draft (back to editing)', () => {
      expect(isValidTransition('revision_requested', 'draft')).toBe(true);
    });
  });

  // ── Invalid transitions ──────────────────────────────────────────────────────

  describe('invalid transitions from pending', () => {
    it('pending → pending (self-transition)', () => {
      expect(isValidTransition('pending', 'pending')).toBe(false);
    });

    it('pending → approved (skipping draft)', () => {
      expect(isValidTransition('pending', 'approved')).toBe(false);
    });

    it('pending → client_review (skipping draft)', () => {
      expect(isValidTransition('pending', 'client_review')).toBe(false);
    });

    it('pending → revision_requested', () => {
      expect(isValidTransition('pending', 'revision_requested')).toBe(false);
    });
  });

  describe('invalid transitions from draft', () => {
    it('draft → draft (self)', () => {
      expect(isValidTransition('draft', 'draft')).toBe(false);
    });

    it('draft → pending (backward)', () => {
      expect(isValidTransition('draft', 'pending')).toBe(false);
    });

    it('draft → revision_requested (invalid forward)', () => {
      expect(isValidTransition('draft', 'revision_requested')).toBe(false);
    });
  });

  describe('invalid transitions from client_review', () => {
    it('client_review → pending (backward)', () => {
      expect(isValidTransition('client_review', 'pending')).toBe(false);
    });

    it('client_review → draft (backward — must go through revision_requested)', () => {
      expect(isValidTransition('client_review', 'draft')).toBe(false);
    });

    it('client_review → client_review (self)', () => {
      expect(isValidTransition('client_review', 'client_review')).toBe(false);
    });
  });

  describe('invalid transitions from approved (terminal state)', () => {
    it('approved → pending', () => {
      expect(isValidTransition('approved', 'pending')).toBe(false);
    });

    it('approved → draft', () => {
      expect(isValidTransition('approved', 'draft')).toBe(false);
    });

    it('approved → client_review', () => {
      expect(isValidTransition('approved', 'client_review')).toBe(false);
    });

    it('approved → approved (terminal self-transition)', () => {
      expect(isValidTransition('approved', 'approved')).toBe(false);
    });
  });

  describe('invalid transitions from revision_requested', () => {
    it('revision_requested → pending (wrong direction)', () => {
      expect(isValidTransition('revision_requested', 'pending')).toBe(false);
    });

    it('revision_requested → approved (skipping draft)', () => {
      expect(isValidTransition('revision_requested', 'approved')).toBe(false);
    });

    it('revision_requested → client_review (skipping)', () => {
      expect(isValidTransition('revision_requested', 'client_review')).toBe(false);
    });

    it('revision_requested → revision_requested (self)', () => {
      expect(isValidTransition('revision_requested', 'revision_requested')).toBe(false);
    });
  });

  // ── Exhaustive matrix — exactly 6 valid transitions total ───────────────────

  it('exhaustive matrix: total valid transitions is exactly 6', () => {
    const STATUSES: CopySectionStatus[] = [
      'pending',
      'draft',
      'client_review',
      'approved',
      'revision_requested',
    ];
    const validCount = STATUSES
      .flatMap(from => STATUSES.map(to => isValidTransition(from, to)))
      .filter(Boolean).length;
    expect(validCount).toBe(6);
  });
});

// ── Part B: getEntryCopyStatus (DB-backed) ────────────────────────────────────

describe('getEntryCopyStatus', () => {
  let workspaceId = '';
  let blueprintId = '';
  let entryId = '';

  // Three-item section plan so we have enough sections to test percentages
  const sectionPlan: SectionPlanItem[] = [
    { id: 'sp_tr_hero', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 60, order: 0 },
    { id: 'sp_tr_cta', sectionType: 'cta', narrativeRole: 'call-to-action', wordCountTarget: 40, order: 1 },
    { id: 'sp_tr_faq', sectionType: 'faq', narrativeRole: 'support', wordCountTarget: 80, order: 2 },
  ];

  // Four-item section plan for percentage edge cases
  const fourItemPlan: SectionPlanItem[] = [
    { id: 'sp_tr_a', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 60, order: 0 },
    { id: 'sp_tr_b', sectionType: 'cta', narrativeRole: 'call-to-action', wordCountTarget: 40, order: 1 },
    { id: 'sp_tr_c', sectionType: 'faq', narrativeRole: 'support', wordCountTarget: 80, order: 2 },
    { id: 'sp_tr_d', sectionType: 'problem', narrativeRole: 'problem', wordCountTarget: 100, order: 3 },
  ];

  beforeAll(() => {
    const suffix = randomUUID().slice(0, 8);
    workspaceId = `ws_cr_trans_${suffix}`;
    blueprintId = `bp_cr_trans_${suffix}`;
    entryId = `entry_cr_trans_${suffix}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(workspaceId, 'CopyReviewTransitions', `cr-trans-${suffix}`, 'free', now);

    db.prepare(
      `INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at) VALUES (?, ?, ?, 1, 'draft', ?, ?)`,
    ).run(blueprintId, workspaceId, 'Trans Blueprint', now, now);

    db.prepare(
      `INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, sort_order, is_collection, primary_keyword, section_plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'included', 0, 0, ?, ?, ?, ?)`,
    ).run(entryId, blueprintId, 'Trans Entry', 'service', 'test keyword', JSON.stringify(sectionPlan), now, now);
  });

  afterAll(() => {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  });

  // Re-initialize sections before each individual test so they all start fresh
  beforeEach(() => {
    db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(workspaceId);
  });

  // ── Helper: advance a section to a given status via valid transitions ────────

  function advanceTo(sectionId: string, targetStatus: CopySectionStatus): void {
    // All sections start at 'pending'. Walk them through valid transitions.
    if (targetStatus === 'pending') return; // already there

    // pending → draft: use saveGeneratedCopy which handles the pending→draft transition
    saveGeneratedCopy(sectionId, workspaceId, {
      generatedCopy: 'Test copy.',
      aiAnnotation: 'Test annotation.',
      aiReasoning: 'Test reasoning.',
    });
    if (targetStatus === 'draft') return;

    if (targetStatus === 'client_review') {
      updateSectionStatus(sectionId, workspaceId, 'client_review');
      return;
    }

    if (targetStatus === 'approved') {
      updateSectionStatus(sectionId, workspaceId, 'client_review');
      updateSectionStatus(sectionId, workspaceId, 'approved');
      return;
    }

    if (targetStatus === 'revision_requested') {
      updateSectionStatus(sectionId, workspaceId, 'client_review');
      updateSectionStatus(sectionId, workspaceId, 'revision_requested');
      return;
    }
  }

  it('0 sections → overallStatus pending, totalSections 0, approvalPercentage 0', () => {
    // No initializeSections call — entry has no sections
    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('pending');
    expect(status.totalSections).toBe(0);
    expect(status.approvalPercentage).toBe(0);
  });

  it('all approved → overallStatus approved, 100%', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    for (const s of sections) advanceTo(s.id, 'approved');

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('approved');
    expect(status.approvedSections).toBe(3);
    expect(status.approvalPercentage).toBe(100);
  });

  it('any revision_requested → overallStatus revision_requested (even if others approved)', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    // hero → approved, cta → approved, faq → revision_requested
    advanceTo(sections[0].id, 'approved');
    advanceTo(sections[1].id, 'approved');
    advanceTo(sections[2].id, 'revision_requested');

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('revision_requested');
    expect(status.revisionSections).toBe(1);
  });

  it('all in client_review (no pending, no draft) → overallStatus client_review', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    for (const s of sections) advanceTo(s.id, 'client_review');

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('client_review');
    expect(status.clientReviewSections).toBe(3);
    expect(status.pendingSections).toBe(0);
    expect(status.draftSections).toBe(0);
  });

  it('client_review + pending → overallStatus draft (pending present blocks client_review branch; draft branch fires because clientReview > 0)', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    // hero → client_review, cta + faq stay pending
    advanceTo(sections[0].id, 'client_review');
    // sections[1] and sections[2] remain pending

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('draft');
    expect(status.clientReviewSections).toBe(1);
    expect(status.pendingSections).toBe(2);
  });

  it('mix of draft + pending → overallStatus draft', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    // hero → draft, cta + faq stay pending
    advanceTo(sections[0].id, 'draft');

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('draft');
    expect(status.draftSections).toBe(1);
    expect(status.pendingSections).toBe(2);
  });

  it('all pending → overallStatus pending (fallback stays pending)', () => {
    initializeSections(workspaceId, entryId, sectionPlan);

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.overallStatus).toBe('pending');
    expect(status.pendingSections).toBe(3);
    expect(status.approvalPercentage).toBe(0);
  });

  it('approvalPercentage: 1/3 approved → 33%', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    advanceTo(sections[0].id, 'approved');

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.approvalPercentage).toBe(33);
  });

  it('approvalPercentage: 2/3 approved → 67%', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);
    advanceTo(sections[0].id, 'approved');
    advanceTo(sections[1].id, 'approved');

    const status = getEntryCopyStatus(entryId, workspaceId);
    expect(status.approvalPercentage).toBe(67);
  });

  it('approvalPercentage: 1/4 approved → 25%', () => {
    // Use a dedicated entry for 4-section tests to avoid interference
    const suffix4 = randomUUID().slice(0, 8);
    const entryId4 = `entry_cr_four_${suffix4}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, sort_order, is_collection, primary_keyword, section_plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'included', 0, 0, ?, ?, ?, ?)`,
    ).run(entryId4, blueprintId, 'Four Section Entry', 'service', 'test keyword', JSON.stringify(fourItemPlan), now, now);

    try {
      const sections = initializeSections(workspaceId, entryId4, fourItemPlan);
      advanceTo(sections[0].id, 'approved');

      const status = getEntryCopyStatus(entryId4, workspaceId);
      expect(status.totalSections).toBe(4);
      expect(status.approvedSections).toBe(1);
      expect(status.approvalPercentage).toBe(25);
    } finally {
      db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(entryId4);
    }
  });
});

// ── Part C: resolveScoringConfig ──────────────────────────────────────────────

describe('resolveScoringConfig', () => {
  it('null → returns exactly DEFAULT_SCORING_CONFIG', () => {
    expect(resolveScoringConfig(null)).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it('undefined → same as null', () => {
    expect(resolveScoringConfig(undefined)).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it('empty object → same as null', () => {
    expect(resolveScoringConfig({})).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it('null returns a value equal to the default (reference may vary)', () => {
    // The implementation returns DEFAULT_SCORING_CONFIG directly for null/undefined,
    // and a new object for non-null overrides. Assert it equals the default.
    const result = resolveScoringConfig(null);
    expect(result).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it('full override of one key replaces that key entirely; other keys are unchanged defaults', () => {
    const result = resolveScoringConfig({
      content_published: {
        primary_metric: 'clicks',
        thresholds: { strong_win: 50, win: 20, neutral_band: 5 },
      },
    });

    expect(result.content_published).toEqual({
      primary_metric: 'clicks',
      thresholds: { strong_win: 50, win: 20, neutral_band: 5 },
    });

    // All other keys must be unchanged
    expect(result.insight_acted_on).toEqual(DEFAULT_SCORING_CONFIG.insight_acted_on);
    expect(result.strategy_keyword_added).toEqual(DEFAULT_SCORING_CONFIG.strategy_keyword_added);
    expect(result.schema_deployed).toEqual(DEFAULT_SCORING_CONFIG.schema_deployed);
    expect(result.audit_fix_applied).toEqual(DEFAULT_SCORING_CONFIG.audit_fix_applied);
    expect(result.content_refreshed).toEqual(DEFAULT_SCORING_CONFIG.content_refreshed);
    expect(result.internal_link_added).toEqual(DEFAULT_SCORING_CONFIG.internal_link_added);
    expect(result.meta_updated).toEqual(DEFAULT_SCORING_CONFIG.meta_updated);
    expect(result.brief_created).toEqual(DEFAULT_SCORING_CONFIG.brief_created);
    expect(result.voice_calibrated).toEqual(DEFAULT_SCORING_CONFIG.voice_calibrated);
  });

  it('partial override (only primary_metric) deep-merges — default thresholds are preserved', () => {
    const result = resolveScoringConfig({
      content_published: {
        primary_metric: 'clicks',
      } as { primary_metric: 'clicks' },
    });

    // primary_metric is overridden
    expect(result.content_published.primary_metric).toBe('clicks');
    // thresholds come from the default because the override omitted them
    expect(result.content_published.thresholds).toEqual(
      DEFAULT_SCORING_CONFIG.content_published.thresholds,
    );
  });

  it('override of multiple keys — both changed, rest unchanged', () => {
    const result = resolveScoringConfig({
      content_published: {
        primary_metric: 'ctr',
        thresholds: { strong_win: 99, win: 50, neutral_band: 10 },
      },
      meta_updated: {
        primary_metric: 'impressions',
        thresholds: { strong_win: 100, win: 50, neutral_band: 25 },
      },
    });

    expect(result.content_published).toEqual({
      primary_metric: 'ctr',
      thresholds: { strong_win: 99, win: 50, neutral_band: 10 },
    });
    expect(result.meta_updated).toEqual({
      primary_metric: 'impressions',
      thresholds: { strong_win: 100, win: 50, neutral_band: 25 },
    });

    // Unrelated keys stay at defaults
    expect(result.schema_deployed).toEqual(DEFAULT_SCORING_CONFIG.schema_deployed);
    expect(result.brief_created).toEqual(DEFAULT_SCORING_CONFIG.brief_created);
  });

  it('non-empty override returns a new object (not the same reference as DEFAULT_SCORING_CONFIG)', () => {
    const result = resolveScoringConfig({
      content_published: {
        primary_metric: 'clicks',
        thresholds: { strong_win: 50, win: 20, neutral_band: 5 },
      },
    });
    expect(result).not.toBe(DEFAULT_SCORING_CONFIG);
  });
});
