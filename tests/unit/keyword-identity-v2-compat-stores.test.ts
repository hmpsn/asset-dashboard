import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  addTrackedKeyword,
  addTrackedKeywords,
  getTrackedKeywords,
  removeTrackedKeyword,
} from '../../server/rank-tracking.js';
import {
  deleteAllTrackedKeywordRows,
  listTrackedKeywordRows,
  replaceAllTrackedKeywordRows,
} from '../../server/tracked-keywords-store.js';
import {
  deleteAllSiteKeywordMetrics,
  listSiteKeywordMetrics,
  replaceAllSiteKeywordMetrics,
} from '../../server/site-keyword-metrics.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
} from '../../shared/types/rank-tracking.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`Keyword identity v2 stores ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

function tracked(query: string, overrides: Partial<TrackedKeyword> = {}): TrackedKeyword {
  return {
    query,
    pinned: false,
    addedAt: '2026-07-13T12:00:00.000Z',
    source: TRACKED_KEYWORD_SOURCE.MANUAL,
    status: TRACKED_KEYWORD_STATUS.ACTIVE,
    ...overrides,
  };
}

describe('tracked keyword v2 compatibility store', () => {
  it('keeps punctuation and Unicode identities distinct while rebuilding the lossy v1 projection', () => {
    addTrackedKeywords(workspaceId, ['C', 'C#', 'C++', 'F#', '.NET', '東京'].map(query => ({ query })));

    expect(getTrackedKeywords(workspaceId, { includeInactive: true }).map(row => row.query))
      .toEqual(['C', 'C#', 'C++', 'F#', '.NET', '東京']);
    expect((db.prepare(
      'SELECT COUNT(*) AS count FROM tracked_keywords_v2_compat WHERE workspace_id = ? AND is_canonical = 1',
    ).get(workspaceId) as { count: number }).count).toBe(6);
    expect((db.prepare(
      'SELECT COUNT(*) AS count FROM tracked_keywords WHERE workspace_id = ?',
    ).get(workspaceId) as { count: number }).count).toBe(3);

    removeTrackedKeyword(workspaceId, 'C#');
    expect(getTrackedKeywords(workspaceId, { includeInactive: true }).map(row => row.query))
      .toEqual(['C', 'C++', 'F#', '.NET', '東京']);
    expect((db.prepare(
      "SELECT query FROM tracked_keywords WHERE workspace_id = ? AND normalized_query = 'c'",
    ).get(workspaceId) as { query: string }).query).toBe('C++');
  });

  it('retains full raw variants, elects deterministically, and promotes an explicitly touched raw', () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    replaceAllTrackedKeywordRows(workspaceId, [
      tracked(decomposed, { source: TRACKED_KEYWORD_SOURCE.UNKNOWN }),
      tracked(composed, { pinned: true, sourceGapKey: '' }),
    ]);

    const rows = db.prepare(`
      SELECT query, pinned, source, is_canonical, source_gap_key_v2
      FROM tracked_keywords_v2_compat WHERE workspace_id = ? ORDER BY query COLLATE BINARY
    `).all(workspaceId) as Array<{
      query: string; pinned: number; source: string; is_canonical: number; source_gap_key_v2: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.query === composed)).toMatchObject({ pinned: 1, is_canonical: 1 });
    expect(rows.find(row => row.query === decomposed)).toMatchObject({ source: TRACKED_KEYWORD_SOURCE.UNKNOWN, is_canonical: 0 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.source_gap_key_v2 === null)).toBe(true); // every-ok -- rows length asserted above

    addTrackedKeyword(workspaceId, decomposed, { source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED });
    expect(listTrackedKeywordRows(workspaceId)[0].query).toBe(decomposed);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM tracked_keywords_v2_compat
      WHERE workspace_id = ? AND normalized_query_v2 = ?
    `).get(workspaceId, 'caf\u00e9') as { count: number }).count).toBe(2);
  });

  it('retains and promotes a never-before-seen explicitly touched raw variant', () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    replaceAllTrackedKeywordRows(workspaceId, [tracked(composed)]);

    addTrackedKeyword(workspaceId, decomposed, { source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED });

    const rows = db.prepare(`
      SELECT query, is_canonical FROM tracked_keywords_v2_compat
      WHERE workspace_id = ? ORDER BY query COLLATE BINARY
    `).all(workspaceId) as Array<{ query: string; is_canonical: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.query === decomposed)?.is_canonical).toBe(1);
    expect(rows.find(row => row.query === composed)?.is_canonical).toBe(0);
    expect(listTrackedKeywordRows(workspaceId)[0].query).toBe(decomposed);
  });

  it('assigns deterministic projection order and advances only the touched identity', () => {
    addTrackedKeywords(workspaceId, [{ query: 'C' }, { query: 'C#' }]);
    const firstProjection = (db.prepare(`
      SELECT query FROM tracked_keywords WHERE workspace_id = ? AND normalized_query = 'c'
    `).get(workspaceId) as { query: string }).query;
    const before = new Map((db.prepare(`
      SELECT normalized_query_v2, write_order FROM tracked_keywords_v2_compat
      WHERE workspace_id = ? AND is_canonical = 1
    `).all(workspaceId) as Array<{ normalized_query_v2: string; write_order: number }>)
      .map(row => [row.normalized_query_v2, row.write_order]));

    addTrackedKeyword(workspaceId, 'C', { pinned: true });
    const after = new Map((db.prepare(`
      SELECT normalized_query_v2, write_order FROM tracked_keywords_v2_compat
      WHERE workspace_id = ? AND is_canonical = 1
    `).all(workspaceId) as Array<{ normalized_query_v2: string; write_order: number }>)
      .map(row => [row.normalized_query_v2, row.write_order]));
    expect(after.get('c')).toBeGreaterThan(before.get('c')!);
    expect(after.get('c sharp')).toBe(before.get('c sharp'));
    expect((db.prepare(`
      SELECT query FROM tracked_keywords WHERE workspace_id = ? AND normalized_query = 'c'
    `).get(workspaceId) as { query: string }).query).toBe('C');

    deleteAllTrackedKeywordRows(workspaceId);
    addTrackedKeywords(workspaceId, [{ query: 'C#' }, { query: 'C' }]);
    expect((db.prepare(`
      SELECT query FROM tracked_keywords WHERE workspace_id = ? AND normalized_query = 'c'
    `).get(workspaceId) as { query: string }).query).toBe(firstProjection);
  });

  it('keeps the v1 projection stable when a retained composed alias group is reversed beside its plain sibling', () => {
    const reverseWorkspaceId = createWorkspace(`Tracked projection reverse ${Date.now()}`).id;
    const composed = 'Caf\u00e9';
    const decomposed = 'Cafe\u0301';
    const forward = [tracked(composed), tracked(decomposed, { pinned: true }), tracked('Cafe')];
    try {
      replaceAllTrackedKeywordRows(workspaceId, [tracked(decomposed)]);
      replaceAllTrackedKeywordRows(reverseWorkspaceId, [tracked(decomposed)]);
      replaceAllTrackedKeywordRows(workspaceId, forward);
      replaceAllTrackedKeywordRows(reverseWorkspaceId, [...forward].reverse());

      const projection = (id: string) => db.prepare(`
        SELECT normalized_query, query FROM tracked_keywords
        WHERE workspace_id = ? ORDER BY normalized_query COLLATE BINARY
      `).all(id);
      expect(projection(reverseWorkspaceId)).toEqual(projection(workspaceId));
      expect(projection(workspaceId)).toEqual([{ normalized_query: 'cafe', query: decomposed }]);
    } finally {
      deleteWorkspace(reverseWorkspaceId);
    }
  });

  it('accepts only explicit v2 provenance, never leaks it, and rolls both projections back together', () => {
    replaceAllTrackedKeywordRows(workspaceId, [tracked('C#', { sourceGapKey: 'c' })]);
    expect((db.prepare(`
      SELECT source_gap_key_v2 FROM tracked_keywords_v2_compat WHERE workspace_id = ?
    `).get(workspaceId) as { source_gap_key_v2: string | null }).source_gap_key_v2).toBeNull();

    addTrackedKeyword(workspaceId, 'C#', { sourceGapKeyV2: 'c sharp' });
    expect((db.prepare(`
      SELECT source_gap_key_v2 FROM tracked_keywords_v2_compat WHERE workspace_id = ?
    `).get(workspaceId) as { source_gap_key_v2: string }).source_gap_key_v2).toBe('c sharp');
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })[0]).not.toHaveProperty('sourceGapKeyV2');
    expect(getTrackedKeywords(workspaceId, { includeInactive: true })[0]).not.toHaveProperty('sourceGapKey');

    expect(() => db.transaction(() => {
      replaceAllTrackedKeywordRows(workspaceId, [tracked('東京')]);
      throw new Error('rollback');
    })()).toThrow('rollback');
    expect(listTrackedKeywordRows(workspaceId).map(row => row.query)).toEqual(['C#']);
    expect((db.prepare(
      'SELECT query FROM tracked_keywords WHERE workspace_id = ?',
    ).get(workspaceId) as { query: string }).query).toBe('C#');
  });
});

describe('site keyword metric v2 compatibility store', () => {
  it('preserves colliding v1 identities and v2-only identities', () => {
    replaceAllSiteKeywordMetrics(workspaceId, [
      { keyword: 'C', volume: 10, difficulty: 1 },
      { keyword: 'C#', volume: 20, difficulty: 2 },
      { keyword: 'C++', volume: 30, difficulty: 3 },
      { keyword: '東京', volume: 40, difficulty: 4 },
    ]);

    expect(listSiteKeywordMetrics(workspaceId).map(row => row.keyword))
      .toEqual(['東京', 'C++', 'C#', 'C']);
    expect((db.prepare(
      'SELECT COUNT(*) AS count FROM site_keyword_metrics_v2_compat WHERE workspace_id = ? AND is_canonical = 1',
    ).get(workspaceId) as { count: number }).count).toBe(4);
    expect((db.prepare(
      'SELECT COUNT(*) AS count FROM site_keyword_metrics WHERE workspace_id = ?',
    ).get(workspaceId) as { count: number }).count).toBe(1);

    replaceAllSiteKeywordMetrics(workspaceId, [
      { keyword: 'C', volume: 10, difficulty: 1 },
      { keyword: 'C#', volume: 20, difficulty: 2 },
      { keyword: '東京', volume: 40, difficulty: 4 },
    ]);
    expect(listSiteKeywordMetrics(workspaceId).map(row => row.keyword)).toEqual(['東京', 'C#', 'C']);
    expect((db.prepare(
      "SELECT keyword FROM site_keyword_metrics WHERE workspace_id = ? AND normalized_query = 'c'",
    ).get(workspaceId) as { keyword: string }).keyword).toBe('C#');
  });

  it('stores complete variants and elects the richer payload independent of input order', () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    replaceAllSiteKeywordMetrics(workspaceId, [
      { keyword: decomposed, volume: 10, difficulty: 20 },
      { keyword: composed, volume: 100, difficulty: 30 },
    ]);
    expect(listSiteKeywordMetrics(workspaceId)).toEqual([
      { keyword: composed, volume: 100, difficulty: 30 },
    ]);
    expect(db.prepare(`
      SELECT keyword, volume, difficulty, is_canonical
      FROM site_keyword_metrics_v2_compat WHERE workspace_id = ? ORDER BY keyword COLLATE BINARY
    `).all(workspaceId)).toHaveLength(2);
  });

  it('keeps rollback projection deterministic when distinct v2 siblings are reversed', () => {
    const forward = [
      { keyword: 'C', volume: 10, difficulty: 1 },
      { keyword: 'C#', volume: 20, difficulty: 2 },
      { keyword: 'C++', volume: 30, difficulty: 3 },
    ];
    replaceAllSiteKeywordMetrics(workspaceId, forward);
    const firstProjection = (db.prepare(`
      SELECT keyword FROM site_keyword_metrics WHERE workspace_id = ? AND normalized_query = 'c'
    `).get(workspaceId) as { keyword: string }).keyword;

    deleteAllSiteKeywordMetrics(workspaceId);
    replaceAllSiteKeywordMetrics(workspaceId, [...forward].reverse());
    expect((db.prepare(`
      SELECT keyword FROM site_keyword_metrics WHERE workspace_id = ? AND normalized_query = 'c'
    `).get(workspaceId) as { keyword: string }).keyword).toBe(firstProjection);
  });

  it('keeps the v1 projection stable when a retained composed metric group is reversed beside its plain sibling', () => {
    const reverseWorkspaceId = createWorkspace(`Site projection reverse ${Date.now()}`).id;
    const composed = 'Caf\u00e9';
    const decomposed = 'Cafe\u0301';
    const forward = [
      { keyword: composed, volume: 10, difficulty: 20 },
      { keyword: decomposed, volume: 10, difficulty: 20 },
      { keyword: 'Cafe', volume: 10, difficulty: 20 },
    ];
    try {
      replaceAllSiteKeywordMetrics(workspaceId, [{ keyword: decomposed, volume: 5, difficulty: 20 }]);
      replaceAllSiteKeywordMetrics(reverseWorkspaceId, [{ keyword: decomposed, volume: 5, difficulty: 20 }]);
      replaceAllSiteKeywordMetrics(workspaceId, forward);
      replaceAllSiteKeywordMetrics(reverseWorkspaceId, [...forward].reverse());

      const projection = (id: string) => db.prepare(`
        SELECT normalized_query, keyword FROM site_keyword_metrics
        WHERE workspace_id = ? ORDER BY normalized_query COLLATE BINARY
      `).all(id);
      expect(projection(reverseWorkspaceId)).toEqual(projection(workspaceId));
      expect(projection(workspaceId)).toEqual([{ normalized_query: 'cafe', keyword: decomposed }]);
    } finally {
      deleteWorkspace(reverseWorkspaceId);
    }
  });

  it('uses SQLite BINARY-compatible UTF-8 ordering for a supplementary Unicode tie', () => {
    const fullwidthA = '\uff21';
    const mathematicalScriptA = '\ud835\udc9c';
    replaceAllSiteKeywordMetrics(workspaceId, [
      { keyword: mathematicalScriptA, volume: 10, difficulty: 20 },
      { keyword: fullwidthA, volume: 10, difficulty: 20 },
    ]);

    expect(listSiteKeywordMetrics(workspaceId)).toEqual([
      { keyword: fullwidthA, volume: 10, difficulty: 20 },
    ]);
    expect(Buffer.compare(Buffer.from(fullwidthA, 'utf8'), Buffer.from(mathematicalScriptA, 'utf8')))
      .toBeLessThan(0);
  });
});
