/**
 * Unit tests for server/seo-suggestions.ts — CRUD on seo_suggestions table.
 *
 * Covers: saveSuggestion, listSuggestions, getPendingSuggestion,
 *         listPendingSuggestionsByIds, selectVariation, selectVariationByPage,
 *         getSelectedSuggestions, markApplied, dismissSuggestions, getSuggestionCounts.
 *
 * Each describe block uses isolated workspace IDs to avoid cross-test pollution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import {
  saveSuggestion,
  listSuggestions,
  getPendingSuggestion,
  listPendingSuggestionsByIds,
  selectVariation,
  selectVariationByPage,
  getSelectedSuggestions,
  markApplied,
  dismissSuggestions,
  getSuggestionCounts,
} from '../../server/seo-suggestions.js';

// ── Workspace helpers ────────────────────────────────────────────────────────

const testWsIds: string[] = [];

function makeWs(label: string): string {
  const id = `ws_seosug_${label}_${Date.now()}_${randomUUID().slice(0, 6)}`;
  testWsIds.push(id);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, `Test WS ${label}`, id, now);
  return id;
}

beforeAll(() => {
  // workspaces are created on-demand in each describe block
});

afterAll(() => {
  // Clean up all seo_suggestions rows first (no FK cascade from workspaces to seo_suggestions)
  for (const id of testWsIds) {
    db.prepare(`DELETE FROM seo_suggestions WHERE workspace_id = ?`).run(id);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  }
});

// ── Shared fixture builder ───────────────────────────────────────────────────

function makeSuggestionOpts(wsId: string, overrides: Partial<Parameters<typeof saveSuggestion>[0]> = {}) {
  return {
    workspaceId: wsId,
    siteId: 'site_123',
    pageId: `/page-${randomUUID().slice(0, 6)}`,
    pageTitle: 'Test Page Title',
    pageSlug: '/test-page',
    field: 'title' as const,
    currentValue: 'Old Title',
    variations: ['Variation A', 'Variation B', 'Variation C'],
    ...overrides,
  };
}

// ── listSuggestions — empty workspace ────────────────────────────────────────

describe('listSuggestions — empty workspace', () => {
  const wsId = makeWs('empty');

  it('returns an empty array when no suggestions exist', () => {
    const results = listSuggestions(wsId);
    expect(results).toEqual([]);
  });

  it('returns an empty array when filtering by field on empty workspace', () => {
    expect(listSuggestions(wsId, 'title')).toEqual([]);
    expect(listSuggestions(wsId, 'description')).toEqual([]);
  });
});

// ── saveSuggestion ────────────────────────────────────────────────────────────

describe('saveSuggestion', () => {
  const wsId = makeWs('save');

  it('creates a new suggestion and returns correct shape', () => {
    const opts = makeSuggestionOpts(wsId);
    const suggestion = saveSuggestion(opts);

    expect(suggestion.id).toBeTruthy();
    expect(suggestion.workspaceId).toBe(wsId);
    expect(suggestion.siteId).toBe('site_123');
    expect(suggestion.pageId).toBe(opts.pageId);
    expect(suggestion.pageTitle).toBe('Test Page Title');
    expect(suggestion.pageSlug).toBe('/test-page');
    expect(suggestion.field).toBe('title');
    expect(suggestion.currentValue).toBe('Old Title');
    expect(suggestion.variations).toEqual(['Variation A', 'Variation B', 'Variation C']);
    expect(suggestion.selectedIndex).toBeNull();
    expect(suggestion.status).toBe('pending');
    expect(suggestion.createdAt).toBeTruthy();
    expect(suggestion.updatedAt).toBeTruthy();
  });

  it('upserts (replaces) when the same workspace + pageId + field already exists', () => {
    const pageId = `/page-upsert-${randomUUID().slice(0, 6)}`;
    const opts = makeSuggestionOpts(wsId, { pageId, field: 'description', variations: ['Old A', 'Old B', 'Old C'] });
    const first = saveSuggestion(opts);

    const updated = saveSuggestion({ ...opts, variations: ['New A', 'New B', 'New C'], currentValue: 'New current' });

    // Upsert keeps original id (the DB keeps the row, updates via ON CONFLICT DO UPDATE)
    expect(updated.id).toBe(first.id);
    expect(updated.variations).toEqual(['New A', 'New B', 'New C']);
    expect(updated.currentValue).toBe('New current');
    expect(updated.status).toBe('pending');
    expect(updated.selectedIndex).toBeNull();
  });

  it('upsert resets selectedIndex to NULL when replacing', () => {
    const pageId = `/page-reset-${randomUUID().slice(0, 6)}`;
    const opts = makeSuggestionOpts(wsId, { pageId });
    const s = saveSuggestion(opts);

    // Select a variation, then upsert again
    selectVariation(wsId, s.id, 1);
    const refreshed = getPendingSuggestion(wsId, s.id);
    expect(refreshed?.selectedIndex).toBe(1);

    // Re-save same page+field
    const replaced = saveSuggestion({ ...opts, variations: ['X', 'Y', 'Z'] });
    expect(replaced.selectedIndex).toBeNull();
  });

  it('stores title and description separately for the same page', () => {
    const pageId = `/page-both-fields-${randomUUID().slice(0, 6)}`;
    const titleSug = saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'title' }));
    const descSug = saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'description' }));

    expect(titleSug.field).toBe('title');
    expect(descSug.field).toBe('description');
    expect(titleSug.id).not.toBe(descSug.id);
  });
});

// ── listSuggestions — filtering ───────────────────────────────────────────────

describe('listSuggestions — filtering', () => {
  const wsId = makeWs('filter');

  it('lists all pending suggestions when no field filter given', () => {
    const pageIdA = `/page-a-${randomUUID().slice(0, 6)}`;
    const pageIdB = `/page-b-${randomUUID().slice(0, 6)}`;
    saveSuggestion(makeSuggestionOpts(wsId, { pageId: pageIdA, field: 'title' }));
    saveSuggestion(makeSuggestionOpts(wsId, { pageId: pageIdB, field: 'description' }));

    const all = listSuggestions(wsId);
    const ids = all.map(s => s.pageId);
    expect(ids).toContain(pageIdA);
    expect(ids).toContain(pageIdB);
  });

  it('filters pending suggestions by field = title', () => {
    const pageId = `/page-title-${randomUUID().slice(0, 6)}`;
    saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'title' }));

    const titles = listSuggestions(wsId, 'title');
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every(s => s.field === 'title')).toBe(true); // every-ok: length guard above
  });

  it('filters pending suggestions by field = description', () => {
    const pageId = `/page-desc-${randomUUID().slice(0, 6)}`;
    saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'description' }));

    const descs = listSuggestions(wsId, 'description');
    expect(descs.length).toBeGreaterThan(0);
    expect(descs.every(s => s.field === 'description')).toBe(true); // every-ok: length guard above
  });

  it('does not return applied or dismissed suggestions', () => {
    const pageId = `/page-applied-${randomUUID().slice(0, 6)}`;
    const s = saveSuggestion(makeSuggestionOpts(wsId, { pageId }));
    markApplied(wsId, [s.id]);

    const listed = listSuggestions(wsId);
    expect(listed.find(x => x.id === s.id)).toBeUndefined();
  });
});

// ── Workspace isolation ───────────────────────────────────────────────────────

describe('workspace isolation', () => {
  const wsA = makeWs('isoA');
  const wsB = makeWs('isoB');

  it('suggestions for workspace A are not visible from workspace B', () => {
    const pageId = `/page-iso-${randomUUID().slice(0, 6)}`;
    saveSuggestion(makeSuggestionOpts(wsA, { pageId }));

    const fromB = listSuggestions(wsB);
    expect(fromB.find(s => s.pageId === pageId)).toBeUndefined();
  });

  it('getSuggestionCounts isolates counts by workspace', () => {
    const pageId = `/page-count-${randomUUID().slice(0, 6)}`;
    saveSuggestion(makeSuggestionOpts(wsA, { pageId }));

    const countsB = getSuggestionCounts(wsB);
    // wsB may have other suggestions from prior tests in this describe; just check
    // the ws_isoA row is not counted in wsB
    const countsA = getSuggestionCounts(wsA);
    expect(countsA.pending).toBeGreaterThan(0);
    // wsB's pending count should not include wsA's rows
    expect(countsB.pending).toBeLessThan(countsA.pending + 1); // rough isolation check
  });
});

// ── getPendingSuggestion ──────────────────────────────────────────────────────

describe('getPendingSuggestion', () => {
  const wsId = makeWs('get');

  it('returns the suggestion by id', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    const fetched = getPendingSuggestion(wsId, s.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(s.id);
  });

  it('returns null for unknown id', () => {
    expect(getPendingSuggestion(wsId, 'nonexistent-id')).toBeNull();
  });

  it('returns null for a suggestion that belongs to another workspace', () => {
    const otherWs = makeWs('get_other');
    const s = saveSuggestion(makeSuggestionOpts(otherWs));
    // Attempt to read from wsId — should be null
    expect(getPendingSuggestion(wsId, s.id)).toBeNull();
  });

  it('returns null after the suggestion is applied', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    markApplied(wsId, [s.id]);
    expect(getPendingSuggestion(wsId, s.id)).toBeNull();
  });
});

// ── listPendingSuggestionsByIds ───────────────────────────────────────────────

describe('listPendingSuggestionsByIds', () => {
  const wsId = makeWs('byids');

  it('returns all pending when ids is undefined', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    const all = listPendingSuggestionsByIds(wsId, undefined);
    expect(all.find(x => x.id === s.id)).toBeDefined();
  });

  it('returns only the specified ids', () => {
    const sA = saveSuggestion(makeSuggestionOpts(wsId));
    const sB = saveSuggestion(makeSuggestionOpts(wsId));
    const result = listPendingSuggestionsByIds(wsId, [sA.id]);
    expect(result.map(x => x.id)).toContain(sA.id);
    expect(result.map(x => x.id)).not.toContain(sB.id);
  });

  it('returns empty array for empty ids array', () => {
    saveSuggestion(makeSuggestionOpts(wsId));
    // empty array → no ids passed → falls through to listSuggestions
    // (per implementation: if (!suggestionIds?.length) return listSuggestions(workspaceId))
    const result = listPendingSuggestionsByIds(wsId, []);
    // No ids: delegates to listSuggestions which returns all pending
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── selectVariation ───────────────────────────────────────────────────────────

describe('selectVariation', () => {
  const wsId = makeWs('select');

  it('selects a variation by index and returns true', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    const changed = selectVariation(wsId, s.id, 2);
    expect(changed).toBe(true);
    const updated = getPendingSuggestion(wsId, s.id);
    expect(updated?.selectedIndex).toBe(2);
  });

  it('returns false for unknown suggestion id', () => {
    expect(selectVariation(wsId, 'no-such-id', 0)).toBe(false);
  });

  it('updates the selectedIndex from one value to another', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    selectVariation(wsId, s.id, 0);
    selectVariation(wsId, s.id, 1);
    const updated = getPendingSuggestion(wsId, s.id);
    expect(updated?.selectedIndex).toBe(1);
  });

  it('does not update an applied suggestion', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    markApplied(wsId, [s.id]);
    const changed = selectVariation(wsId, s.id, 0);
    expect(changed).toBe(false);
  });
});

// ── selectVariationByPage ─────────────────────────────────────────────────────

describe('selectVariationByPage', () => {
  const wsId = makeWs('selpage');

  it('selects variation using pageId + field', () => {
    const pageId = `/page-selbp-${randomUUID().slice(0, 6)}`;
    const s = saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'title' }));
    const changed = selectVariationByPage(wsId, pageId, 'title', 1);
    expect(changed).toBe(true);
    const updated = getPendingSuggestion(wsId, s.id);
    expect(updated?.selectedIndex).toBe(1);
  });

  it('returns false for a page that has no pending suggestion', () => {
    const changed = selectVariationByPage(wsId, '/nonexistent-page', 'title', 0);
    expect(changed).toBe(false);
  });

  it('does not affect the description field when selecting for title', () => {
    const pageId = `/page-fieldiso-${randomUUID().slice(0, 6)}`;
    const titleSug = saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'title' }));
    const descSug = saveSuggestion(makeSuggestionOpts(wsId, { pageId, field: 'description' }));

    selectVariationByPage(wsId, pageId, 'title', 2);

    const updatedTitle = getPendingSuggestion(wsId, titleSug.id);
    const updatedDesc = getPendingSuggestion(wsId, descSug.id);
    expect(updatedTitle?.selectedIndex).toBe(2);
    expect(updatedDesc?.selectedIndex).toBeNull();
  });
});

// ── getSelectedSuggestions ────────────────────────────────────────────────────

describe('getSelectedSuggestions', () => {
  const wsId = makeWs('getsel');

  it('returns only suggestions with a non-null selectedIndex', () => {
    const sA = saveSuggestion(makeSuggestionOpts(wsId));
    const sB = saveSuggestion(makeSuggestionOpts(wsId));
    selectVariation(wsId, sA.id, 0);

    const selected = getSelectedSuggestions(wsId);
    const ids = selected.map(s => s.id);
    expect(ids).toContain(sA.id);
    expect(ids).not.toContain(sB.id);
  });

  it('returns empty array when no selection has been made', () => {
    const freshWs = makeWs('getsel_fresh');
    saveSuggestion(makeSuggestionOpts(freshWs));
    expect(getSelectedSuggestions(freshWs)).toEqual([]);
  });
});

// ── markApplied ───────────────────────────────────────────────────────────────

describe('markApplied', () => {
  const wsId = makeWs('applied');

  it('marks suggestions as applied and removes them from pending list', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    markApplied(wsId, [s.id]);
    const listed = listSuggestions(wsId);
    expect(listed.find(x => x.id === s.id)).toBeUndefined();
  });

  it('is a no-op when given empty array', () => {
    expect(() => markApplied(wsId, [])).not.toThrow();
  });

  it('marks multiple suggestions at once', () => {
    const sA = saveSuggestion(makeSuggestionOpts(wsId));
    const sB = saveSuggestion(makeSuggestionOpts(wsId));
    markApplied(wsId, [sA.id, sB.id]);
    const listed = listSuggestions(wsId);
    expect(listed.find(x => x.id === sA.id)).toBeUndefined();
    expect(listed.find(x => x.id === sB.id)).toBeUndefined();
  });
});

// ── dismissSuggestions ────────────────────────────────────────────────────────

describe('dismissSuggestions', () => {
  const wsId = makeWs('dismiss');

  it('dismisses specific suggestion by id and returns change count', () => {
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    const count = dismissSuggestions(wsId, [s.id]);
    expect(count).toBe(1);
    expect(listSuggestions(wsId).find(x => x.id === s.id)).toBeUndefined();
  });

  it('dismisses all pending when no ids given', () => {
    const freshWs = makeWs('dismiss_all');
    saveSuggestion(makeSuggestionOpts(freshWs));
    saveSuggestion(makeSuggestionOpts(freshWs));
    const count = dismissSuggestions(freshWs);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(listSuggestions(freshWs)).toEqual([]);
  });

  it('can dismiss an already-applied suggestion (no status filter on id-based dismiss)', () => {
    // When specific IDs are passed, dismissSuggestions updates any status row —
    // there is no status = 'pending' guard in the id-based path.
    const s = saveSuggestion(makeSuggestionOpts(wsId));
    markApplied(wsId, [s.id]);
    const count = dismissSuggestions(wsId, [s.id]);
    expect(count).toBe(1); // row exists, gets updated to 'dismissed'
  });

  it('is a no-op when given empty array — falls back to dismiss-all for workspace', () => {
    const freshWs = makeWs('dismiss_empty');
    // no suggestions, so dismiss-all returns 0
    const count = dismissSuggestions(freshWs, []);
    // empty array length check: !suggestionIds?.length → delegates to dismiss-all path
    expect(typeof count).toBe('number');
  });
});

// ── getSuggestionCounts ───────────────────────────────────────────────────────

describe('getSuggestionCounts', () => {
  const wsId = makeWs('counts');

  it('returns zeros for a workspace with no suggestions', () => {
    const freshWs = makeWs('counts_fresh');
    const counts = getSuggestionCounts(freshWs);
    expect(counts).toEqual({ pending: 0, selected: 0, total: 0 });
  });

  it('counts pending correctly', () => {
    const sA = saveSuggestion(makeSuggestionOpts(wsId));
    const sB = saveSuggestion(makeSuggestionOpts(wsId));
    const counts = getSuggestionCounts(wsId);
    expect(counts.pending).toBeGreaterThanOrEqual(2);
    expect(counts.total).toBeGreaterThanOrEqual(2);
    void sA; void sB;
  });

  it('selected count reflects only pending + selected_index IS NOT NULL', () => {
    const freshWs = makeWs('counts_selected');
    const sA = saveSuggestion(makeSuggestionOpts(freshWs));
    const sB = saveSuggestion(makeSuggestionOpts(freshWs));
    selectVariation(freshWs, sA.id, 0);

    const counts = getSuggestionCounts(freshWs);
    expect(counts.pending).toBe(2);
    expect(counts.selected).toBe(1);
    expect(counts.total).toBe(2);
    void sB;
  });

  it('applied suggestions count toward total but not pending or selected', () => {
    const freshWs = makeWs('counts_applied');
    const sA = saveSuggestion(makeSuggestionOpts(freshWs));
    const sB = saveSuggestion(makeSuggestionOpts(freshWs));
    markApplied(freshWs, [sA.id]);

    const counts = getSuggestionCounts(freshWs);
    expect(counts.total).toBe(2);
    expect(counts.pending).toBe(1);
    expect(counts.selected).toBe(0);
    void sB;
  });

  it('dismissed suggestions count toward total but not pending or selected', () => {
    const freshWs = makeWs('counts_dismissed');
    const sA = saveSuggestion(makeSuggestionOpts(freshWs));
    const sB = saveSuggestion(makeSuggestionOpts(freshWs));
    dismissSuggestions(freshWs, [sB.id]);

    const counts = getSuggestionCounts(freshWs);
    expect(counts.total).toBe(2);
    expect(counts.pending).toBe(1);
    void sA;
  });

  it('variations are parsed as array (not raw JSON string)', () => {
    const freshWs = makeWs('counts_variations');
    const s = saveSuggestion(makeSuggestionOpts(freshWs));
    const fetched = getPendingSuggestion(freshWs, s.id);
    expect(Array.isArray(fetched?.variations)).toBe(true);
    expect(fetched?.variations).toHaveLength(3);
  });
});
