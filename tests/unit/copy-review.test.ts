import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  addClientSuggestion,
  addSteeringEntry,
  getEntryCopyStatus,
  getSectionsForEntry,
  initializeSections,
  saveGeneratedCopy,
  updateCopyText,
  updateSectionStatus,
} from '../../server/copy-review.js';
import type { SectionPlanItem } from '../../shared/types/page-strategy.js';

describe('copy-review store', () => {
  let workspaceId = '';
  let blueprintId = '';
  let entryId = '';

  const sectionPlan: SectionPlanItem[] = [
    {
      id: 'sp_test_hero',
      sectionType: 'hero',
      narrativeRole: 'hook',
      wordCountTarget: 60,
      order: 0,
    },
    {
      id: 'sp_test_cta',
      sectionType: 'cta',
      narrativeRole: 'call-to-action',
      wordCountTarget: 40,
      order: 1,
    },
  ];

  beforeEach(() => {
    const suffix = randomUUID().slice(0, 8);
    workspaceId = `ws_copy_review_${suffix}`;
    blueprintId = `bp_copy_review_${suffix}`;
    entryId = `entry_copy_review_${suffix}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO workspaces (id, name, folder, tier, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspaceId, 'Copy Review Test', `copy-review-${suffix}`, 'free', now);

    db.prepare(`
      INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'draft', ?, ?)
    `).run(blueprintId, workspaceId, 'Copy Review Blueprint', now, now);

    db.prepare(`
      INSERT INTO blueprint_entries (
        id, blueprint_id, name, page_type, scope, sort_order, is_collection,
        primary_keyword, section_plan_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'included', 0, 0, ?, ?, ?, ?)
    `).run(
      entryId,
      blueprintId,
      'Emergency Plumbing',
      'service',
      'emergency plumber',
      JSON.stringify(sectionPlan),
      now,
      now,
    );
  });

  afterEach(() => {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  });

  it('initializes sections from the section plan in plan order', () => {
    const sections = initializeSections(workspaceId, entryId, sectionPlan);

    expect(sections.map(s => [s.sectionPlanItemId, s.status, s.version])).toEqual([
      ['sp_test_hero', 'pending', 0],
      ['sp_test_cta', 'pending', 0],
    ]);
    expect(getSectionsForEntry(entryId, workspaceId).map(s => s.sectionPlanItemId)).toEqual([
      'sp_test_hero',
      'sp_test_cta',
    ]);
  });

  it('preserves steering history, client suggestions, and createdAt when reinitializing sections', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    const withSteering = addSteeringEntry(hero.id, workspaceId, {
      type: 'note',
      note: 'Make this more specific.',
      resultVersion: 0,
    });
    expect(withSteering).not.toBeNull();
    const withSuggestion = addClientSuggestion(hero.id, workspaceId, {
      originalText: 'Old line',
      suggestedText: 'Sharper line',
    });
    expect(withSuggestion).not.toBeNull();

    const reinitialized = initializeSections(workspaceId, entryId, sectionPlan);
    const heroAgain = reinitialized.find(s => s.sectionPlanItemId === 'sp_test_hero');

    expect(heroAgain?.id).not.toBe(hero.id);
    expect(heroAgain?.createdAt).toBe(hero.createdAt);
    expect(heroAgain?.steeringHistory).toHaveLength(1);
    expect(heroAgain?.steeringHistory[0].note).toBe('Make this more specific.');
    expect(heroAgain?.clientSuggestions).toHaveLength(1);
    expect(heroAgain?.clientSuggestions?.[0].suggestedText).toBe('Sharper line');
  });

  it('enforces section status transitions', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);

    expect(updateSectionStatus(hero.id, workspaceId, 'approved')).toBeNull();

    const draft = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Fast emergency plumbing help.',
      aiAnnotation: 'Hero focuses on urgency.',
      aiReasoning: 'Matches service intent.',
    });
    expect(draft?.status).toBe('draft');
    expect(draft?.version).toBe(1);

    const inReview = updateSectionStatus(hero.id, workspaceId, 'client_review');
    expect(inReview?.status).toBe('client_review');

    const approved = updateSectionStatus(hero.id, workspaceId, 'approved');
    expect(approved?.status).toBe('approved');
    expect(updateCopyText(hero.id, workspaceId, 'Edit after approval')).toBeNull();
  });

  it('moves client-review sections to revision_requested when a client suggestion is added', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Fast emergency plumbing help.',
      aiAnnotation: 'Hero focuses on urgency.',
      aiReasoning: 'Matches service intent.',
    });
    updateSectionStatus(hero.id, workspaceId, 'client_review');

    const result = addClientSuggestion(hero.id, workspaceId, {
      originalText: 'Fast emergency plumbing help.',
      suggestedText: 'Same-day emergency plumbing help.',
    });

    expect(result?.status).toBe('revision_requested');
    expect(result?.clientSuggestions).toHaveLength(1);
    expect(result?.clientSuggestions?.[0]).toEqual(expect.objectContaining({
      originalText: 'Fast emergency plumbing help.',
      suggestedText: 'Same-day emergency plumbing help.',
      status: 'pending',
    }));
  });

  it('derives entry copy status counts and approval percentage', () => {
    const [hero, cta] = initializeSections(workspaceId, entryId, sectionPlan);
    saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Fast emergency plumbing help.',
      aiAnnotation: 'Hero focuses on urgency.',
      aiReasoning: 'Matches service intent.',
    });
    saveGeneratedCopy(cta.id, workspaceId, {
      generatedCopy: 'Call now.',
      aiAnnotation: 'CTA is concise.',
      aiReasoning: 'Direct conversion prompt.',
    });
    updateSectionStatus(hero.id, workspaceId, 'client_review');
    updateSectionStatus(hero.id, workspaceId, 'approved');

    const status = getEntryCopyStatus(entryId, workspaceId);

    expect(status).toEqual(expect.objectContaining({
      entryId,
      totalSections: 2,
      draftSections: 1,
      approvedSections: 1,
      overallStatus: 'draft',
      approvalPercentage: 50,
    }));
  });
});
