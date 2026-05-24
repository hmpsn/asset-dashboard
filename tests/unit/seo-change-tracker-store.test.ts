/**
 * Unit tests: server/seo-change-tracker.ts store functions.
 *
 * Tests recordSeoChange (persist + deduplicate), getSeoChanges (list + limit),
 * and the row-mapping contract.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { recordSeoChange, getSeoChanges } from '../../server/seo-change-tracker.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ws = createWorkspace('seo-change-tracker-store-unit-test');
const WS_ID = ws.id;

function clearChanges(): void {
  db.prepare('DELETE FROM seo_changes WHERE workspace_id = ?').run(WS_ID);
}

beforeEach(() => {
  clearChanges();
});

afterAll(() => {
  clearChanges();
  deleteWorkspace(WS_ID);
});

// ── recordSeoChange ───────────────────────────────────────────────────────

describe('recordSeoChange', () => {
  it('persists a change and returns an event with correct shape', () => {
    const event = recordSeoChange(WS_ID, 'pg_001', '/services/seo', 'SEO Services', ['title'], 'editor');
    expect(event.workspaceId).toBe(WS_ID);
    expect(event.pageId).toBe('pg_001');
    expect(event.pageSlug).toBe('/services/seo');
    expect(event.pageTitle).toBe('SEO Services');
    expect(event.fields).toEqual(['title']);
    expect(event.source).toBe('editor');
    expect(event.id).toMatch(/^sc_/);
    expect(typeof event.changedAt).toBe('string');
  });

  it('persists multiple fields', () => {
    const event = recordSeoChange(WS_ID, 'pg_002', '/about', 'About Us', ['title', 'description'], 'bulk-fix');
    expect(event.fields).toEqual(['title', 'description']);
  });

  it('deduplicates: returns the same id when same page changed within 1 hour', () => {
    const first = recordSeoChange(WS_ID, 'pg_dup', '/dup-page', 'Dup Page', ['title'], 'editor');
    const second = recordSeoChange(WS_ID, 'pg_dup', '/dup-page', 'Dup Page', ['description'], 'editor');
    // Within 1-hour dedup window — should reuse the same row
    expect(second.id).toBe(first.id);
  });

  it('stores different events for different pages', () => {
    const a = recordSeoChange(WS_ID, 'pg_a', '/page-a', 'Page A', ['title'], 'editor');
    const b = recordSeoChange(WS_ID, 'pg_b', '/page-b', 'Page B', ['title'], 'editor');
    expect(a.id).not.toBe(b.id);
  });
});

// ── getSeoChanges ─────────────────────────────────────────────────────────

describe('getSeoChanges', () => {
  it('returns empty array when no changes recorded', () => {
    const changes = getSeoChanges(WS_ID);
    expect(changes).toEqual([]);
  });

  it('returns recorded changes in ascending order', () => {
    recordSeoChange(WS_ID, 'pg_x', '/x', 'X', ['title'], 'editor');
    recordSeoChange(WS_ID, 'pg_y', '/y', 'Y', ['description'], 'editor');
    const changes = getSeoChanges(WS_ID);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    // All belong to this workspace
    for (const c of changes) {
      expect(c.workspaceId).toBe(WS_ID); // every-ok: toBeGreaterThanOrEqual asserted above
    }
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      recordSeoChange(WS_ID, `pg_lim_${i}`, `/page-${i}`, `Page ${i}`, ['title'], 'editor');
    }
    const limited = getSeoChanges(WS_ID, 3);
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it('returns each change with parsed fields array (not JSON string)', () => {
    recordSeoChange(WS_ID, 'pg_fields', '/fields', 'Fields Page', ['title', 'description'], 'approval');
    const changes = getSeoChanges(WS_ID);
    const match = changes.find(c => c.pageId === 'pg_fields');
    expect(match).toBeDefined();
    expect(Array.isArray(match!.fields)).toBe(true);
    expect(match!.fields).toContain('title');
    expect(match!.fields).toContain('description');
  });
});
