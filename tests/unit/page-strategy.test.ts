import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  addEntry,
  bulkAddEntries,
  createBlueprint,
  createVersion,
  deleteBlueprint,
  getBlueprint,
  getEntry,
  listBlueprints,
  listVersions,
  removeEntry,
  reorderEntries,
  updateBlueprint,
  updateEntry,
} from '../../server/page-strategy.js';
import type { GeneratedBlueprintEntry, SectionPlanItem } from '../../shared/types/page-strategy.js';

const WS_ID = `ws_page_strategy_${Date.now()}`;
const OTHER_WS_ID = `ws_page_strategy_other_${Date.now()}`;

const SECTION_PLAN: SectionPlanItem[] = [
  {
    id: 'hero-plan',
    sectionType: 'hero',
    narrativeRole: 'hook',
    wordCountTarget: 80,
    order: 1,
  },
  {
    id: 'cta-plan',
    sectionType: 'cta',
    narrativeRole: 'call-to-action',
    wordCountTarget: 60,
    order: 2,
  },
];

function cleanupWorkspace(workspaceId: string): void {
  db.prepare(`
    DELETE FROM blueprint_versions
    WHERE blueprint_id IN (SELECT id FROM site_blueprints WHERE workspace_id = ?)
  `).run(workspaceId);
  db.prepare(`
    DELETE FROM blueprint_entries
    WHERE blueprint_id IN (SELECT id FROM site_blueprints WHERE workspace_id = ?)
  `).run(workspaceId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(workspaceId);
}

beforeEach(() => {
  cleanupWorkspace(WS_ID);
  cleanupWorkspace(OTHER_WS_ID);
});

describe('page-strategy store', () => {
  it('creates, lists, updates, clears nullable fields, and deletes blueprints', () => {
    const blueprint = createBlueprint({
      workspaceId: WS_ID,
      name: 'Service Page Plan',
      status: 'active',
      brandscriptId: 'brand_123',
      industryType: 'analytics',
      generationInputs: {
        industryType: 'analytics',
        domain: 'example.com',
        targetPageCount: 4,
        includeContentPages: true,
      },
      notes: 'Initial notes',
    });

    expect(blueprint.version).toBe(1);
    expect(listBlueprints(WS_ID).map(item => item.id)).toEqual([blueprint.id]);
    expect(getBlueprint(OTHER_WS_ID, blueprint.id)).toBeNull();

    const updated = updateBlueprint(WS_ID, blueprint.id, {
      name: 'Updated Service Page Plan',
      brandscriptId: null,
      generationInputs: null,
      notes: null,
    });

    expect(updated?.name).toBe('Updated Service Page Plan');
    expect(updated?.brandscriptId).toBeUndefined();
    expect(updated?.generationInputs).toBeUndefined();
    expect(updated?.notes).toBeUndefined();

    expect(deleteBlueprint(OTHER_WS_ID, blueprint.id)).toBe(false);
    expect(deleteBlueprint(WS_ID, blueprint.id)).toBe(true);
    expect(getBlueprint(WS_ID, blueprint.id)).toBeNull();
  });

  it('adds, updates, retrieves, reorders, and removes entries within their workspace blueprint', () => {
    const blueprint = createBlueprint({ workspaceId: WS_ID, name: 'Entry Plan' });
    const first = addEntry(WS_ID, blueprint.id, {
      name: 'Home',
      pageType: 'homepage',
      scope: 'included',
      primaryKeyword: 'home keyword',
      secondaryKeywords: ['brand seo', 'homepage seo'],
      keywordSource: 'manual',
      sectionPlan: SECTION_PLAN,
      notes: 'Homepage notes',
    });
    const second = addEntry(WS_ID, blueprint.id, {
      name: 'Services',
      pageType: 'service',
      isCollection: true,
    });

    expect(first?.sortOrder).toBe(1);
    expect(second?.sortOrder).toBe(2);
    expect(getEntry(OTHER_WS_ID, blueprint.id, first!.id)).toBeNull();

    const updated = updateEntry(WS_ID, blueprint.id, first!.id, {
      name: 'Homepage',
      primaryKeyword: null,
      secondaryKeywords: null,
      templateId: 'template_123',
      briefId: 'brief_123',
      notes: null,
    });

    expect(updated?.name).toBe('Homepage');
    expect(updated?.primaryKeyword).toBeUndefined();
    expect(updated?.secondaryKeywords).toBeUndefined();
    expect(updated?.templateId).toBe('template_123');
    expect(updated?.briefId).toBe('brief_123');
    expect(updated?.notes).toBeUndefined();

    expect(reorderEntries(WS_ID, blueprint.id, [second!.id])).toBe(false);
    expect(reorderEntries(WS_ID, blueprint.id, [second!.id, 'missing_entry'])).toBe(false);
    expect(reorderEntries(WS_ID, blueprint.id, [second!.id, first!.id])).toBe(true);

    const reordered = getBlueprint(WS_ID, blueprint.id)?.entries ?? [];
    expect(reordered.map(entry => entry.id)).toEqual([second!.id, first!.id]);
    expect(reordered.map(entry => entry.sortOrder)).toEqual([1, 2]);

    expect(removeEntry(OTHER_WS_ID, blueprint.id, first!.id)).toBe(false);
    expect(removeEntry(WS_ID, blueprint.id, first!.id)).toBe(true);
    expect(getEntry(WS_ID, blueprint.id, first!.id)).toBeNull();
  });

  it('creates version snapshots and bumps the blueprint version atomically', () => {
    const blueprint = createBlueprint({ workspaceId: WS_ID, name: 'Versioned Plan' });
    const entry = addEntry(WS_ID, blueprint.id, {
      name: 'Landing',
      pageType: 'landing',
      sectionPlan: SECTION_PLAN,
    });

    const version = createVersion(WS_ID, blueprint.id, 'Initial version');

    expect(version).not.toBeNull();
    expect(version!.version).toBe(1);
    expect(version!.snapshot.blueprint.name).toBe('Versioned Plan');
    expect(version!.snapshot.entries.map(item => item.id)).toEqual([entry!.id]);
    expect(version!.changeNotes).toBe('Initial version');
    expect(getBlueprint(WS_ID, blueprint.id)?.version).toBe(2);
    expect(listVersions(WS_ID, blueprint.id)?.map(item => item.id)).toEqual([version!.id]);
    expect(createVersion(OTHER_WS_ID, blueprint.id)).toBeNull();
  });

  it('bulk-adds generated entries with assigned section ids and continuing sort order', () => {
    const blueprint = createBlueprint({ workspaceId: WS_ID, name: 'Generated Plan' });
    addEntry(WS_ID, blueprint.id, { name: 'Existing', pageType: 'homepage' });

    const generated: GeneratedBlueprintEntry[] = [
      {
        name: 'Audit Services',
        pageType: 'service',
        scope: 'included',
        isCollection: false,
        primaryKeyword: 'seo audit',
        secondaryKeywords: ['technical audit'],
        rationale: 'Important revenue page',
        sectionPlan: [
          { sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 75, order: 99 },
          { sectionType: 'faq', wordCountTarget: 120, order: 99 },
        ],
      },
      {
        name: 'Analytics Resources',
        pageType: 'resource',
        scope: 'recommended',
        isCollection: true,
        rationale: 'Useful content hub',
        sectionPlan: [{ sectionType: 'content-body', wordCountTarget: 300, order: 99 }],
      },
    ];

    const inserted = bulkAddEntries(WS_ID, blueprint.id, generated);

    expect(inserted).toHaveLength(2);
    expect(inserted.map(entry => entry.sortOrder)).toEqual([2, 3]);
    expect(inserted.map(entry => entry.keywordSource)).toEqual(['ai_suggested', 'ai_suggested']);
    expect(inserted[0].notes).toBe('Important revenue page');
    expect(inserted[0].sectionPlan.map(section => section.order)).toEqual([1, 2]);
    expect(inserted[0].sectionPlan.map(section => section.id)).toHaveLength(2);
    expect(inserted[0].sectionPlan.map(section => section.id)).not.toContain('');
    expect(bulkAddEntries(OTHER_WS_ID, blueprint.id, generated)).toEqual([]);
  });
});
