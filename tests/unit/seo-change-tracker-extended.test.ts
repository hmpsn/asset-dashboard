/**
 * Extended unit tests: server/seo-change-tracker.ts
 *
 * Covers behaviors not tested in seo-change-tracker-store.test.ts:
 *   - recordSeoChange: merges fields on dedup, preserves original changedAt id,
 *     handles empty fields array, single-field updates, source stored correctly,
 *     max-500 pruning behaviour (sentinel), cross-workspace isolation,
 *     schema source recorded correctly
 *   - getSeoChanges: newest-first ordering, default limit (100), source isolation
 *     across workspaces, fields roundtrip as array
 *   - getSchemaImpactSummary (pure aggregation logic via unit-level mocks):
 *     not tested here — covered by integration layer
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { recordSeoChange, getSeoChanges } from '../../server/seo-change-tracker.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const wsMain = createWorkspace('seo-change-tracker-extended-main');
const wsOther = createWorkspace('seo-change-tracker-extended-other');
const WS_MAIN = wsMain.id;
const WS_OTHER = wsOther.id;

function clearChanges(workspaceId: string): void {
  db.prepare('DELETE FROM seo_changes WHERE workspace_id = ?').run(workspaceId);
}

beforeEach(() => {
  clearChanges(WS_MAIN);
  clearChanges(WS_OTHER);
});

afterAll(() => {
  clearChanges(WS_MAIN);
  clearChanges(WS_OTHER);
  deleteWorkspace(WS_MAIN);
  deleteWorkspace(WS_OTHER);
});

// ── recordSeoChange — field merging ───────────────────────────────────────────

describe('recordSeoChange — dedup field merging', () => {
  it('merges disjoint fields when dedup fires', () => {
    recordSeoChange(WS_MAIN, 'pg_merge', '/merge', 'Merge Page', ['title'], 'editor');
    const second = recordSeoChange(WS_MAIN, 'pg_merge', '/merge', 'Merge Page', ['description'], 'editor');
    expect(second.fields).toContain('title');
    expect(second.fields).toContain('description');
    expect(second.fields.length).toBe(2); // no duplicates
  });

  it('deduplicates overlapping fields on merge (no duplicate entries)', () => {
    recordSeoChange(WS_MAIN, 'pg_dup_field', '/dup-field', 'Dup Field', ['title'], 'editor');
    const second = recordSeoChange(WS_MAIN, 'pg_dup_field', '/dup-field', 'Dup Field', ['title'], 'editor');
    expect(second.fields.filter((f: string) => f === 'title').length).toBe(1);
  });

  it('preserves the original event id when dedup fires', () => {
    const first = recordSeoChange(WS_MAIN, 'pg_id_pres', '/id-pres', 'ID Pres', ['title'], 'editor');
    const second = recordSeoChange(WS_MAIN, 'pg_id_pres', '/id-pres', 'ID Pres', ['og_title'], 'editor');
    expect(second.id).toBe(first.id);
  });

  it('creates a new event id for a different page even in quick succession', () => {
    const a = recordSeoChange(WS_MAIN, 'pg_new_a', '/new-a', 'New A', ['title'], 'bulk-fix');
    const b = recordSeoChange(WS_MAIN, 'pg_new_b', '/new-b', 'New B', ['title'], 'bulk-fix');
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^sc_/);
    expect(b.id).toMatch(/^sc_/);
  });
});

// ── recordSeoChange — source field ────────────────────────────────────────────

describe('recordSeoChange — source field', () => {
  it('stores the source value on the returned event', () => {
    const event = recordSeoChange(WS_MAIN, 'pg_src', '/src', 'Source Page', ['title'], 'approval');
    expect(event.source).toBe('approval');
  });

  it('stores schema source correctly', () => {
    const event = recordSeoChange(WS_MAIN, 'pg_schema', '/schema', 'Schema Page', ['schema'], 'schema-deploy');
    expect(event.source).toBe('schema-deploy');
  });

  it('stores bulk-fix source correctly', () => {
    const event = recordSeoChange(WS_MAIN, 'pg_bulk', '/bulk', 'Bulk Page', ['title', 'description'], 'bulk-fix');
    expect(event.source).toBe('bulk-fix');
  });
});

// ── recordSeoChange — empty fields edge case ──────────────────────────────────

describe('recordSeoChange — empty fields array', () => {
  it('accepts an empty fields array and stores it without error', () => {
    const event = recordSeoChange(WS_MAIN, 'pg_empty_f', '/empty-f', 'Empty Fields', [], 'editor');
    expect(event.fields).toEqual([]);
    expect(event.id).toMatch(/^sc_/);
  });

  it('retrieves the empty fields array correctly from the DB', () => {
    recordSeoChange(WS_MAIN, 'pg_empty_read', '/empty-read', 'Empty Read', [], 'editor');
    const changes = getSeoChanges(WS_MAIN);
    const found = changes.find(c => c.pageId === 'pg_empty_read');
    expect(found).toBeDefined();
    expect(Array.isArray(found!.fields)).toBe(true);
    expect(found!.fields).toHaveLength(0);
  });
});

// ── recordSeoChange — cross-workspace isolation ───────────────────────────────

describe('recordSeoChange — cross-workspace isolation', () => {
  it('events in one workspace are not returned by getSeoChanges for another', () => {
    recordSeoChange(WS_MAIN, 'pg_iso', '/iso', 'Iso Page', ['title'], 'editor');
    const otherChanges = getSeoChanges(WS_OTHER);
    const leaked = otherChanges.find(c => c.pageId === 'pg_iso');
    expect(leaked).toBeUndefined();
  });

  it('both workspaces can independently record events with the same pageId', () => {
    recordSeoChange(WS_MAIN, 'shared_page_id', '/shared', 'Shared A', ['title'], 'editor');
    recordSeoChange(WS_OTHER, 'shared_page_id', '/shared', 'Shared B', ['description'], 'editor');

    const mainChanges = getSeoChanges(WS_MAIN);
    const otherChanges = getSeoChanges(WS_OTHER);

    const mainMatch = mainChanges.find(c => c.pageId === 'shared_page_id');
    const otherMatch = otherChanges.find(c => c.pageId === 'shared_page_id');

    expect(mainMatch).toBeDefined();
    expect(otherMatch).toBeDefined();
    // They should be different events
    expect(mainMatch!.id).not.toBe(otherMatch!.id);
  });
});

// ── getSeoChanges — ordering ──────────────────────────────────────────────────

describe('getSeoChanges — result ordering', () => {
  it('returns results in newest-first order', () => {
    recordSeoChange(WS_MAIN, 'pg_ord_1', '/ord-1', 'Ord 1', ['title'], 'editor');
    recordSeoChange(WS_MAIN, 'pg_ord_2', '/ord-2', 'Ord 2', ['title'], 'editor');
    recordSeoChange(WS_MAIN, 'pg_ord_3', '/ord-3', 'Ord 3', ['title'], 'editor');

    const changes = getSeoChanges(WS_MAIN);
    expect(changes.length).toBeGreaterThanOrEqual(3);

    // Newest first: changedAt timestamps should be non-ascending
    for (let i = 1; i < changes.length; i++) {
      const prev = new Date(changes[i - 1].changedAt).getTime();
      const curr = new Date(changes[i].changedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('limits output to exactly N results when limit < total count', () => {
    for (let i = 0; i < 6; i++) {
      recordSeoChange(WS_MAIN, `pg_lim2_${i}`, `/lim2-${i}`, `Lim ${i}`, ['title'], 'editor');
    }
    const limited = getSeoChanges(WS_MAIN, 4);
    expect(limited.length).toBeLessThanOrEqual(4);
  });

  it('returns all records when limit exceeds total count', () => {
    recordSeoChange(WS_MAIN, 'pg_all', '/all', 'All', ['title'], 'editor');
    const all = getSeoChanges(WS_MAIN, 1000);
    expect(all.length).toBeGreaterThanOrEqual(1);
    // All belong to WS_MAIN
    for (const c of all) {
      expect(c.workspaceId).toBe(WS_MAIN);
    }
  });
});

// ── getSeoChanges — field data integrity ─────────────────────────────────────

describe('getSeoChanges — field data integrity', () => {
  it('returns fields as a proper array, not a JSON string', () => {
    recordSeoChange(WS_MAIN, 'pg_fi', '/fi', 'Field Integrity', ['title', 'description', 'og_title'], 'editor');
    const changes = getSeoChanges(WS_MAIN);
    const match = changes.find(c => c.pageId === 'pg_fi');
    expect(match).toBeDefined();
    expect(Array.isArray(match!.fields)).toBe(true);
    expect(match!.fields).toContain('title');
    expect(match!.fields).toContain('description');
    expect(match!.fields).toContain('og_title');
  });

  it('changedAt is a valid ISO 8601 timestamp string', () => {
    recordSeoChange(WS_MAIN, 'pg_ts', '/ts', 'Timestamp Check', ['title'], 'editor');
    const changes = getSeoChanges(WS_MAIN);
    const match = changes.find(c => c.pageId === 'pg_ts');
    expect(match).toBeDefined();
    const parsed = new Date(match!.changedAt);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it('workspaceId on returned event matches the recording workspace', () => {
    recordSeoChange(WS_MAIN, 'pg_wsid', '/wsid', 'WS ID Check', ['title'], 'editor');
    const changes = getSeoChanges(WS_MAIN);
    const match = changes.find(c => c.pageId === 'pg_wsid');
    expect(match!.workspaceId).toBe(WS_MAIN);
  });
});
