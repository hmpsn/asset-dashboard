import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  addClientSuggestion,
  addSteeringEntry,
  commitGeneratedEntryCopy,
  CopySuggestionOriginalMismatchError,
  getEntryCopyStatus,
  getMetadata,
  getSection,
  getSectionsForEntry,
  initializeSections,
  saveGeneratedCopy,
  saveMetadata,
  snapshotCopyEntryGeneration,
  updateCopyText,
  updateSectionStatus,
} from '../../server/copy-review.js';
import { GenerationRevisionConflictError } from '../../server/generation-provenance.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';
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

  const provenance: GenerationProvenance = {
    runId: 'copy-run-accepted',
    executionChainId: 'copy-chain-1',
    operation: 'copy-generation',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputFingerprint: 'a'.repeat(64),
    startedAt: '2026-07-14T00:00:00.000Z',
    completedAt: '2026-07-14T00:00:01.000Z',
    executions: [{
      runId: 'copy-run-accepted',
      executionChainId: 'copy-chain-1',
      operation: 'copy-generation',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputFingerprint: 'b'.repeat(64),
      startedAt: '2026-07-14T00:00:00.000Z',
      completedAt: '2026-07-14T00:00:01.000Z',
    }],
  };

  function generatedCommit(sectionIds = sectionPlan.map(section => section.id)) {
    return sectionIds.map(sectionPlanItemId => ({
      sectionPlanItemId,
      generatedCopy: `Generated ${sectionPlanItemId}`,
      aiAnnotation: 'Grounded approach',
      aiReasoning: 'Matches the plan',
    }));
  }

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

  it('preserves stable identity, review state, and curation when reinitializing sections', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    const generated = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Old line',
      aiAnnotation: 'Initial annotation',
      aiReasoning: 'Initial reasoning',
      generationProvenance: provenance,
    });
    expect(generated).not.toBeNull();
    const withSteering = addSteeringEntry(hero.id, workspaceId, {
      type: 'note',
      note: 'Make this more specific.',
      resultVersion: generated!.version,
    });
    expect(withSteering).not.toBeNull();
    const withSuggestion = addClientSuggestion(hero.id, workspaceId, {
      originalText: 'Old line',
      suggestedText: 'Sharper line',
    });
    expect(withSuggestion).not.toBeNull();

    const reinitialized = initializeSections(workspaceId, entryId, sectionPlan);
    const heroAgain = reinitialized.find(s => s.sectionPlanItemId === 'sp_test_hero');

    expect(heroAgain?.id).toBe(hero.id);
    expect(heroAgain?.createdAt).toBe(hero.createdAt);
    expect(heroAgain?.generationRevision).toBe(withSuggestion?.generationRevision);
    expect(heroAgain?.steeringHistory).toHaveLength(1);
    expect(heroAgain?.steeringHistory[0].note).toBe('Make this more specific.');
    expect(heroAgain?.clientSuggestions).toHaveLength(1);
    expect(heroAgain?.clientSuggestions?.[0].suggestedText).toBe('Sharper line');
  });

  it('increments the generation revision exactly once for every successful section mutation', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    expect(hero.generationRevision).toBe(0);

    const generated = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Generated copy',
      aiAnnotation: 'Annotation',
      aiReasoning: 'Reasoning',
      expectedRevision: 0,
      generationProvenance: provenance,
    });
    expect(generated?.generationRevision).toBe(1);
    expect(Date.parse(generated!.updatedAt)).toBeGreaterThan(Date.parse(hero.updatedAt));
    expect(() => updateCopyText(hero.id, workspaceId, 'Stale edit', 0))
      .toThrow(GenerationRevisionConflictError);
    expect(getSection(hero.id, workspaceId)?.generationRevision).toBe(1);

    const steered = addSteeringEntry(hero.id, workspaceId, {
      type: 'note',
      note: 'Tighten this.',
      resultVersion: 1,
    }, 1);
    expect(steered?.generationRevision).toBe(2);
    expect(Date.parse(steered!.updatedAt)).toBeGreaterThan(Date.parse(generated!.updatedAt));
    expect(steered?.steeringHistory.at(-1)?.timestamp).toBe(steered?.updatedAt);

    const suggested = addClientSuggestion(hero.id, workspaceId, {
      originalText: 'Generated copy',
      suggestedText: 'Sharper',
    }, 2);
    expect(suggested?.generationRevision).toBe(3);
    expect(Date.parse(suggested!.updatedAt)).toBeGreaterThan(Date.parse(steered!.updatedAt));
    expect(suggested?.clientSuggestions?.at(-1)?.timestamp).toBe(suggested?.updatedAt);

    const edited = updateCopyText(hero.id, workspaceId, 'Operator edit wins.', 3);
    expect(edited?.generationRevision).toBe(4);
    expect(Date.parse(edited!.updatedAt)).toBeGreaterThan(Date.parse(suggested!.updatedAt));
    const inReview = updateSectionStatus(hero.id, workspaceId, 'client_review', 4);
    expect(inReview?.generationRevision).toBe(5);
    expect(Date.parse(inReview!.updatedAt)).toBeGreaterThan(Date.parse(edited!.updatedAt));
    const approved = updateSectionStatus(hero.id, workspaceId, 'approved', 5);
    expect(approved?.generationRevision).toBe(6);
    expect(Date.parse(approved!.updatedAt)).toBeGreaterThan(Date.parse(inReview!.updatedAt));
    expect(approved?.generationProvenance?.runId).toBe('copy-run-accepted');
  });

  it('rejects a suggestion whose claimed original is not the authoritative copy', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    const generated = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Authoritative generated copy.',
      aiAnnotation: 'Annotation',
      aiReasoning: 'Reasoning',
      generationProvenance: provenance,
    })!;

    expect(() => addClientSuggestion(hero.id, workspaceId, {
      originalText: 'Copy this section never contained.',
      suggestedText: 'A proposed replacement.',
    }, generated.generationRevision)).toThrow(CopySuggestionOriginalMismatchError);

    expect(getSection(hero.id, workspaceId)).toMatchObject({
      generationRevision: generated.generationRevision,
      generatedCopy: 'Authoritative generated copy.',
      clientSuggestions: null,
      status: 'draft',
    });
  });

  it('treats identical draft text as a no-op while still rejecting stale authority', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    const generated = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Already current copy',
      aiAnnotation: 'Annotation',
      aiReasoning: 'Reasoning',
      expectedRevision: 0,
      generationProvenance: provenance,
    })!;

    const unchanged = updateCopyText(
      hero.id,
      workspaceId,
      generated.generatedCopy!,
      generated.generationRevision,
    )!;

    expect(unchanged.generationRevision).toBe(generated.generationRevision);
    expect(unchanged.version).toBe(generated.version);
    expect(unchanged.updatedAt).toBe(generated.updatedAt);
    expect(() => updateCopyText(
      hero.id,
      workspaceId,
      generated.generatedCopy!,
      generated.generationRevision - 1,
    )).toThrow(GenerationRevisionConflictError);
  });

  it('classifies stale protected-state mutations as revision conflicts before lifecycle rejection', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    const generated = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Approved copy',
      aiAnnotation: 'Annotation',
      aiReasoning: 'Reasoning',
      expectedRevision: 0,
      generationProvenance: provenance,
    })!;
    const inReview = updateSectionStatus(
      hero.id,
      workspaceId,
      'client_review',
      generated.generationRevision,
    )!;
    const approved = updateSectionStatus(
      hero.id,
      workspaceId,
      'approved',
      inReview.generationRevision,
    )!;

    expect(() => updateSectionStatus(
      hero.id,
      workspaceId,
      'client_review',
      inReview.generationRevision,
    )).toThrow(GenerationRevisionConflictError);
    expect(() => updateCopyText(
      hero.id,
      workspaceId,
      'Stale replacement',
      inReview.generationRevision,
    )).toThrow(GenerationRevisionConflictError);
    expect(getSection(hero.id, workspaceId)).toMatchObject({
      status: 'approved',
      generatedCopy: 'Approved copy',
      generationRevision: approved.generationRevision,
    });
  });

  it('atomically adopts full generated copy while preserving stable section curation', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    const firstGeneration = saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'First generation',
      aiAnnotation: 'First annotation',
      aiReasoning: 'First reasoning',
      generationProvenance: provenance,
    })!;
    const steered = addSteeringEntry(hero.id, workspaceId, {
      type: 'note',
      note: 'Use a clearer promise.',
      resultVersion: firstGeneration.version,
    })!;
    const suggested = addClientSuggestion(hero.id, workspaceId, {
      originalText: 'First generation',
      suggestedText: 'Clearer promise',
    })!;
    expect(suggested.generationRevision).toBe(steered.generationRevision + 1);
    saveMetadata(entryId, workspaceId, {
      seoTitle: 'Old title',
      metaDescription: 'Old description',
      ogTitle: 'Old OG',
      ogDescription: 'Old OG description',
    });

    const snapshot = snapshotCopyEntryGeneration(workspaceId, entryId, sectionPlan);
    const committed = commitGeneratedEntryCopy(snapshot, generatedCommit(), {
      seoTitle: 'New title',
      metaDescription: 'New description',
      ogTitle: 'New OG',
      ogDescription: 'New OG description',
    }, provenance);
    const heroAfter = committed.sections.find(section => section.id === hero.id)!;

    expect(heroAfter.id).toBe(hero.id);
    expect(heroAfter.createdAt).toBe(hero.createdAt);
    expect(heroAfter.version).toBe(firstGeneration.version + 1);
    expect(heroAfter.generationRevision).toBe(suggested.generationRevision + 1);
    expect(heroAfter.status).toBe('draft');
    expect(heroAfter.steeringHistory).toEqual(steered.steeringHistory);
    expect(heroAfter.clientSuggestions).toEqual(suggested.clientSuggestions);
    expect(heroAfter.generationProvenance?.runId).toBe('copy-run-accepted');
    expect(committed.metadata.seoTitle).toBe('New title');
  });

  it('rolls back sections and metadata when an operator edits during generation', () => {
    const [hero, cta] = initializeSections(workspaceId, entryId, sectionPlan);
    saveMetadata(entryId, workspaceId, {
      seoTitle: 'Winning old title',
      metaDescription: 'Winning old description',
      ogTitle: 'Winning old OG',
      ogDescription: 'Winning old OG description',
    });
    const snapshot = snapshotCopyEntryGeneration(workspaceId, entryId, sectionPlan);
    const winningEdit = updateCopyText(hero.id, workspaceId, 'Operator edit during AI.', 0);
    expect(winningEdit?.generationRevision).toBe(1);

    expect(() => commitGeneratedEntryCopy(snapshot, generatedCommit(), {
      seoTitle: 'Stale title',
      metaDescription: 'Stale description',
      ogTitle: 'Stale OG',
      ogDescription: 'Stale OG description',
    }, provenance)).toThrow(GenerationRevisionConflictError);

    expect(getSection(hero.id, workspaceId)?.generatedCopy).toBe('Operator edit during AI.');
    expect(getSection(cta.id, workspaceId)?.status).toBe('pending');
    expect(getMetadata(entryId, workspaceId)?.seoTitle).toBe('Winning old title');
  });

  it('rejects empty-to-nonempty and plan-reorder races at the final census boundary', () => {
    const emptySnapshot = snapshotCopyEntryGeneration(workspaceId, entryId, sectionPlan);
    initializeSections(workspaceId, entryId, sectionPlan);
    expect(() => commitGeneratedEntryCopy(emptySnapshot, generatedCommit(), {
      seoTitle: 'Stale', metaDescription: 'Stale', ogTitle: 'Stale', ogDescription: 'Stale',
    }, provenance)).toThrow(GenerationRevisionConflictError);

    const populatedSnapshot = snapshotCopyEntryGeneration(workspaceId, entryId, sectionPlan);
    const reordered = [...sectionPlan].reverse();
    db.prepare(`UPDATE blueprint_entries SET section_plan_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(reordered), new Date(Date.now() + 1_000).toISOString(), entryId);
    expect(() => commitGeneratedEntryCopy(populatedSnapshot, generatedCommit(), {
      seoTitle: 'Stale', metaDescription: 'Stale', ogTitle: 'Stale', ogDescription: 'Stale',
    }, provenance)).toThrow(GenerationRevisionConflictError);
  });

  it('refuses paid full-entry generation when copy is already in client review or approved', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    saveGeneratedCopy(hero.id, workspaceId, {
      generatedCopy: 'Review copy',
      aiAnnotation: 'Annotation',
      aiReasoning: 'Reasoning',
    });
    updateSectionStatus(hero.id, workspaceId, 'client_review');
    expect(() => snapshotCopyEntryGeneration(workspaceId, entryId, sectionPlan))
      .toThrow(GenerationRevisionConflictError);
  });

  it('degrades malformed stored generation provenance to null without losing copy', () => {
    const [hero] = initializeSections(workspaceId, entryId, sectionPlan);
    db.prepare(`UPDATE copy_sections SET generated_copy = ?, generation_provenance = ? WHERE id = ?`)
      .run('Still readable', '{"bad":true}', hero.id);
    const mapped = getSection(hero.id, workspaceId);
    expect(mapped?.generatedCopy).toBe('Still readable');
    expect(mapped?.generationProvenance).toBeNull();
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
