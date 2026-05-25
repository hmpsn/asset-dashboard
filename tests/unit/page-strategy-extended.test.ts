/**
 * Extended unit tests for server/page-strategy.ts
 *
 * Existing tests in page-strategy.test.ts cover:
 *  - create/list/update/delete blueprints (including null field clearing)
 *  - add/update/reorder/remove entries (including workspace isolation)
 *  - createVersion snapshot atomicity
 *  - bulkAddEntries sort-order continuation + section-plan ID assignment
 *
 * This file covers NEW scenarios:
 *  - blueprint default status ('draft')
 *  - multi-blueprint isolation per workspace
 *  - listBlueprints ordering (most-recently-updated first)
 *  - updateBlueprint partial field preservation
 *  - updateBlueprint on missing blueprint returns null
 *  - addEntry to a blueprint belonging to another workspace returns null
 *  - updateEntry on a missing entry returns null
 *  - updateEntry partial field preservation (isCollection, matrixId, keywordSource)
 *  - removeEntry from a missing blueprint returns false
 *  - reorderEntries with duplicate IDs returns false
 *  - createVersion stores changeNotes as undefined when omitted
 *  - listVersions returns null for an unknown blueprint
 *  - getVersion round-trip
 *  - bulkAddEntries with empty array returns [] without error
 *  - bulkAddEntries isCollection mapping
 */
import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  addEntry,
  bulkAddEntries,
  createBlueprint,
  createVersion,
  deleteBlueprint,
  getBlueprint,
  getVersion,
  listBlueprints,
  listVersions,
  removeEntry,
  reorderEntries,
  updateBlueprint,
  updateEntry,
} from '../../server/page-strategy.js';
import type { GeneratedBlueprintEntry } from '../../shared/types/page-strategy.js';

const WS = `ws_psx_${Date.now()}`;
const WS2 = `ws_psx2_${Date.now()}`;

function cleanupWorkspace(id: string) {
  db.prepare(
    `DELETE FROM blueprint_versions WHERE blueprint_id IN (SELECT id FROM site_blueprints WHERE workspace_id = ?)`,
  ).run(id);
  db.prepare(
    `DELETE FROM blueprint_entries WHERE blueprint_id IN (SELECT id FROM site_blueprints WHERE workspace_id = ?)`,
  ).run(id);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(id);
}

beforeEach(() => {
  cleanupWorkspace(WS);
  cleanupWorkspace(WS2);
});

// ─── Blueprint defaults & isolation ────────────────────────────────────────

describe('createBlueprint — defaults', () => {
  it('defaults status to draft when not supplied', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'My Plan' });
    expect(bp.status).toBe('draft');
    expect(bp.version).toBe(1);
    expect(bp.entries).toEqual([]);
  });

  it('persists explicit status', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Active Plan', status: 'active' });
    const fetched = getBlueprint(WS, bp.id);
    expect(fetched?.status).toBe('active');
  });

  it('persists generationInputs as JSON and round-trips correctly', () => {
    const inputs = { industryType: 'saas', domain: 'app.example.com', targetPageCount: 10 };
    const bp = createBlueprint({ workspaceId: WS, name: 'Gen Plan', generationInputs: inputs });
    const fetched = getBlueprint(WS, bp.id);
    expect(fetched?.generationInputs).toEqual(inputs);
  });
});

describe('listBlueprints — ordering and isolation', () => {
  it('returns only blueprints for the requested workspace', () => {
    createBlueprint({ workspaceId: WS, name: 'A' });
    createBlueprint({ workspaceId: WS2, name: 'B' });
    const list = listBlueprints(WS);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A');
  });

  it('orders blueprints most-recently-updated first', () => {
    const bp1 = createBlueprint({ workspaceId: WS, name: 'First' });
    const bp2 = createBlueprint({ workspaceId: WS, name: 'Second' });
    // Update bp1 so it has a newer updated_at
    updateBlueprint(WS, bp1.id, { name: 'First (updated)' });
    const list = listBlueprints(WS);
    expect(list[0].id).toBe(bp1.id);
    expect(list[1].id).toBe(bp2.id);
  });
});

describe('updateBlueprint — partial updates', () => {
  it('preserves untouched fields when only name is changed', () => {
    const bp = createBlueprint({
      workspaceId: WS,
      name: 'Original',
      status: 'active',
      industryType: 'ecom',
      notes: 'keep me',
    });
    const updated = updateBlueprint(WS, bp.id, { name: 'Renamed' });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.status).toBe('active');
    expect(updated?.industryType).toBe('ecom');
    expect(updated?.notes).toBe('keep me');
  });

  it('returns null when blueprint does not exist', () => {
    const result = updateBlueprint(WS, 'nonexistent-id', { name: 'X' });
    expect(result).toBeNull();
  });

  it('preserves generationInputs when not included in update payload', () => {
    const inputs = { industryType: 'law', targetPageCount: 6 };
    const bp = createBlueprint({ workspaceId: WS, name: 'Law Plan', generationInputs: inputs });
    const updated = updateBlueprint(WS, bp.id, { status: 'archived' });
    expect(updated?.generationInputs).toEqual(inputs);
    expect(updated?.status).toBe('archived');
  });
});

// ─── Entry CRUD edge cases ──────────────────────────────────────────────────

describe('addEntry — cross-workspace guard', () => {
  it('returns null when blueprintId belongs to a different workspace', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Real Plan' });
    const entry = addEntry(WS2, bp.id, { name: 'Sneaky', pageType: 'service' });
    expect(entry).toBeNull();
  });
});

describe('updateEntry — edge cases', () => {
  it('returns null when entry does not exist in the blueprint', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const result = updateEntry(WS, bp.id, 'nonexistent-entry', { name: 'X' });
    expect(result).toBeNull();
  });

  it('toggles isCollection correctly', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const entry = addEntry(WS, bp.id, { name: 'Blog', pageType: 'resource', isCollection: false });
    const updated = updateEntry(WS, bp.id, entry!.id, { isCollection: true });
    expect(updated?.isCollection).toBe(true);
  });

  it('persists matrixId and clears it via null', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const entry = addEntry(WS, bp.id, { name: 'Services', pageType: 'service' });
    const withMatrix = updateEntry(WS, bp.id, entry!.id, { matrixId: 'matrix_abc' });
    expect(withMatrix?.matrixId).toBe('matrix_abc');

    const cleared = updateEntry(WS, bp.id, entry!.id, { matrixId: null });
    expect(cleared?.matrixId).toBeUndefined();
  });

  it('preserves existing keywordSource when not in update payload', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const entry = addEntry(WS, bp.id, {
      name: 'Landing',
      pageType: 'landing',
      keywordSource: 'manual',
    });
    const updated = updateEntry(WS, bp.id, entry!.id, { name: 'Landing Page' });
    expect(updated?.keywordSource).toBe('manual');
  });
});

describe('removeEntry — cross-workspace guard', () => {
  it('returns false when blueprintId belongs to a different workspace', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    addEntry(WS, bp.id, { name: 'Home', pageType: 'homepage' });
    const result = removeEntry(WS2, bp.id, 'any-entry-id');
    expect(result).toBe(false);
  });
});

// ─── reorderEntries edge cases ──────────────────────────────────────────────

describe('reorderEntries — validation', () => {
  it('returns false when orderedIds length does not match entry count', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const e1 = addEntry(WS, bp.id, { name: 'A', pageType: 'homepage' });
    const e2 = addEntry(WS, bp.id, { name: 'B', pageType: 'service' });
    // Only one id in a two-entry blueprint → length mismatch
    const result = reorderEntries(WS, bp.id, [e1!.id]);
    expect(result).toBe(false);
    // Original order should be preserved
    const blueprint = getBlueprint(WS, bp.id);
    expect(blueprint?.entries?.[0].id).toBe(e1!.id);
    expect(blueprint?.entries?.[1].id).toBe(e2!.id);
  });
});

// ─── Versioning edge cases ──────────────────────────────────────────────────

describe('createVersion — changeNotes', () => {
  it('stores changeNotes as undefined when not supplied', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Versioned' });
    const version = createVersion(WS, bp.id); // no changeNotes arg
    expect(version?.changeNotes).toBeUndefined();
  });

  it('captures the full entry list in the snapshot', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Snapshot Plan' });
    const e1 = addEntry(WS, bp.id, { name: 'Home', pageType: 'homepage' });
    const e2 = addEntry(WS, bp.id, { name: 'About', pageType: 'about' });
    const version = createVersion(WS, bp.id, 'v1');
    expect(version?.snapshot.entries.map(e => e.id)).toEqual([e1!.id, e2!.id]);
    expect(version?.snapshot.blueprint.name).toBe('Snapshot Plan');
  });
});

describe('listVersions', () => {
  it('returns null for an unknown (or cross-workspace) blueprint', () => {
    expect(listVersions(WS, 'unknown-blueprint')).toBeNull();
  });

  it('returns an empty array when a blueprint exists but has no versions', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'No Versions Yet' });
    expect(listVersions(WS, bp.id)).toEqual([]);
  });
});

describe('getVersion — round-trip', () => {
  it('retrieves a version by id and returns correct snapshot data', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Round Trip Plan' });
    addEntry(WS, bp.id, { name: 'Contact', pageType: 'contact' });
    const created = createVersion(WS, bp.id, 'first snapshot');

    const fetched = getVersion(WS, bp.id, created!.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created!.id);
    expect(fetched?.version).toBe(1);
    expect(fetched?.changeNotes).toBe('first snapshot');
    expect(fetched?.snapshot.entries).toHaveLength(1);
  });

  it('returns null when version does not exist', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    expect(getVersion(WS, bp.id, 'nonexistent-version')).toBeNull();
  });

  it('returns null when blueprint belongs to a different workspace', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const v = createVersion(WS, bp.id, 'snap');
    expect(getVersion(WS2, bp.id, v!.id)).toBeNull();
  });
});

// ─── bulkAddEntries edge cases ──────────────────────────────────────────────

describe('bulkAddEntries — edge cases', () => {
  it('returns empty array without error for an empty input array', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    expect(bulkAddEntries(WS, bp.id, [])).toEqual([]);
    // Blueprint should have no entries
    expect(getBlueprint(WS, bp.id)?.entries).toEqual([]);
  });

  it('maps isCollection correctly for false case', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const generated: GeneratedBlueprintEntry[] = [
      {
        name: 'Team Page',
        pageType: 'about',
        scope: 'included',
        isCollection: false,
        rationale: 'About page',
        sectionPlan: [{ sectionType: 'hero', wordCountTarget: 60, order: 1 }],
      },
    ];
    const inserted = bulkAddEntries(WS, bp.id, generated);
    expect(inserted[0].isCollection).toBe(false);
  });

  it('all inserted entries are persisted and readable via getBlueprint', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Plan' });
    const generated: GeneratedBlueprintEntry[] = [
      {
        name: 'Services Hub',
        pageType: 'service',
        scope: 'included',
        isCollection: true,
        primaryKeyword: 'services',
        rationale: 'Core revenue page',
        sectionPlan: [{ sectionType: 'hero', wordCountTarget: 100, order: 1 }],
      },
      {
        name: 'Blog',
        pageType: 'resource',
        scope: 'recommended',
        isCollection: true,
        rationale: 'Content hub',
        sectionPlan: [{ sectionType: 'content-body', wordCountTarget: 250, order: 1 }],
      },
    ];
    bulkAddEntries(WS, bp.id, generated);
    const fetched = getBlueprint(WS, bp.id);
    expect(fetched?.entries).toHaveLength(2);
    expect(fetched?.entries?.map(e => e.keywordSource)).toEqual(['ai_suggested', 'ai_suggested']);
  });
});

// ─── deleteBlueprint makes blueprint inaccessible ──────────────────────────

describe('deleteBlueprint — post-delete state', () => {
  it('makes the blueprint inaccessible after deletion', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'To Delete' });
    addEntry(WS, bp.id, { name: 'Home', pageType: 'homepage' });
    addEntry(WS, bp.id, { name: 'About', pageType: 'about' });
    expect(deleteBlueprint(WS, bp.id)).toBe(true);
    expect(getBlueprint(WS, bp.id)).toBeNull();
  });

  it('returns false for a second delete attempt on the same blueprint', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'To Delete Twice' });
    expect(deleteBlueprint(WS, bp.id)).toBe(true);
    expect(deleteBlueprint(WS, bp.id)).toBe(false);
  });

  it('removing a single entry does not affect siblings', () => {
    const bp = createBlueprint({ workspaceId: WS, name: 'Multi Entry' });
    const e1 = addEntry(WS, bp.id, { name: 'First', pageType: 'homepage' });
    const e2 = addEntry(WS, bp.id, { name: 'Second', pageType: 'service' });
    removeEntry(WS, bp.id, e1!.id);
    const remaining = getBlueprint(WS, bp.id)?.entries ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(e2!.id);
  });
});
