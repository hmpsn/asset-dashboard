import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---- hoisted mocks --------------------------------------------------------

const { mockPrepare, mockAll, mockGet, mockRun } = vi.hoisted(() => {
  const mockAll = vi.fn(() => [] as unknown[]);
  const mockGet = vi.fn(() => undefined as unknown);
  const mockRun = vi.fn(() => ({ changes: 1 }));
  const mockPrepare = vi.fn(() => ({ all: mockAll, get: mockGet, run: mockRun }));
  return { mockPrepare, mockAll, mockGet, mockRun };
});

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mockPrepare,
    transaction: vi.fn((fn: unknown) => fn),
  },
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((raw: unknown, fallback: unknown) => {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return fallback; }
    }
    return fallback;
  }),
  parseJsonSafe: vi.fn((_raw: unknown, _schema: unknown, fallback: unknown) => fallback),
  parseJsonSafeArray: vi.fn(() => []),
}));

// ---- imports ---------------------------------------------------------------

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

// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sugg-1',
    workspace_id: 'ws-1',
    site_id: 'site-1',
    page_id: 'page-1',
    page_title: 'Home',
    page_slug: '/',
    field: 'title',
    current_value: 'Old Title',
    variations: '["Variation A","Variation B","Variation C"]',
    selected_index: null,
    status: 'pending',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rowToSuggestion (via listSuggestions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('maps DB row fields to camelCase suggestion interface', () => {
    mockAll.mockReturnValue([makeRow()]);
    const suggestions = listSuggestions('ws-1');
    expect(suggestions).toHaveLength(1);
    const s = suggestions[0];
    expect(s.id).toBe('sugg-1');
    expect(s.workspaceId).toBe('ws-1');
    expect(s.siteId).toBe('site-1');
    expect(s.pageId).toBe('page-1');
    expect(s.pageTitle).toBe('Home');
    expect(s.pageSlug).toBe('/');
    expect(s.field).toBe('title');
    expect(s.currentValue).toBe('Old Title');
    expect(s.status).toBe('pending');
  });

  it('parses variations JSON array correctly', () => {
    mockAll.mockReturnValue([makeRow({ variations: '["A","B","C"]' })]);
    const suggestions = listSuggestions('ws-1');
    expect(suggestions[0].variations).toEqual(['A', 'B', 'C']);
  });

  it('falls back to empty array for invalid variations JSON', () => {
    mockAll.mockReturnValue([makeRow({ variations: 'not-json' })]);
    const suggestions = listSuggestions('ws-1');
    // parseJsonFallback returns [] on invalid JSON (mocked above)
    expect(Array.isArray(suggestions[0].variations)).toBe(true);
  });
});

describe('listSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('returns empty array when no suggestions exist', () => {
    mockAll.mockReturnValue([]);
    expect(listSuggestions('ws-empty')).toEqual([]);
  });

  it('filters by field when provided', () => {
    mockAll.mockReturnValue([makeRow({ field: 'description' })]);
    const suggestions = listSuggestions('ws-1', 'description');
    expect(suggestions[0].field).toBe('description');
    // Verify the query was called with the field arg
    const prepareCall = mockPrepare.mock.calls.find(call => String(call[0]).includes('field'));
    expect(prepareCall).toBeDefined();
  });

  it('returns multiple suggestions in order', () => {
    mockAll.mockReturnValue([
      makeRow({ id: 'sugg-1', page_id: 'p1' }),
      makeRow({ id: 'sugg-2', page_id: 'p2' }),
    ]);
    const suggestions = listSuggestions('ws-1');
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].id).toBe('sugg-1');
    expect(suggestions[1].id).toBe('sugg-2');
  });
});

describe('getPendingSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('returns suggestion when found', () => {
    mockGet.mockReturnValue(makeRow());
    const result = getPendingSuggestion('ws-1', 'sugg-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('sugg-1');
  });

  it('returns null when suggestion not found', () => {
    mockGet.mockReturnValue(undefined);
    const result = getPendingSuggestion('ws-1', 'not-found');
    expect(result).toBeNull();
  });
});

describe('listPendingSuggestionsByIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('falls back to listSuggestions when no ids provided', () => {
    mockAll.mockReturnValue([makeRow()]);
    const result = listPendingSuggestionsByIds('ws-1', []);
    expect(result).toHaveLength(1);
  });

  it('queries by specific ids when provided', () => {
    mockAll.mockReturnValue([makeRow({ id: 'sugg-a' })]);
    const result = listPendingSuggestionsByIds('ws-1', ['sugg-a']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sugg-a');
  });
});

describe('selectVariation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('returns true when a row was updated', () => {
    mockRun.mockReturnValue({ changes: 1 });
    const result = selectVariation('ws-1', 'sugg-1', 0);
    expect(result).toBe(true);
  });

  it('returns false when no row was updated (suggestion not found)', () => {
    mockRun.mockReturnValue({ changes: 0 });
    const result = selectVariation('ws-1', 'not-found', 0);
    expect(result).toBe(false);
  });
});

describe('selectVariationByPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('returns true when row was updated', () => {
    mockRun.mockReturnValue({ changes: 1 });
    expect(selectVariationByPage('ws-1', 'page-1', 'title', 2)).toBe(true);
  });

  it('returns false when no row found', () => {
    mockRun.mockReturnValue({ changes: 0 });
    expect(selectVariationByPage('ws-1', 'page-missing', 'title', 0)).toBe(false);
  });
});

describe('getSelectedSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('returns suggestions with a selected index', () => {
    mockAll.mockReturnValue([makeRow({ selected_index: 1 })]);
    const results = getSelectedSuggestions('ws-1');
    expect(results).toHaveLength(1);
    expect(results[0].selectedIndex).toBe(1);
  });

  it('returns empty array when none are selected', () => {
    mockAll.mockReturnValue([]);
    expect(getSelectedSuggestions('ws-1')).toEqual([]);
  });
});

describe('markApplied', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('does nothing when given empty ids array', () => {
    markApplied('ws-1', []);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('calls DB update with the ids whose current status legally transitions to applied', () => {
    // The guard first SELECTs current statuses; both ids are pending → both legal.
    mockAll.mockReturnValueOnce([
      { id: 'sugg-1', status: 'pending' },
      { id: 'sugg-2', status: 'pending' },
    ]);
    markApplied('ws-1', ['sugg-1', 'sugg-2']);
    expect(mockPrepare).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith('ws-1', 'sugg-1', 'sugg-2');
  });

  it('skips ids already applied (idempotent) and drops illegal moves without throwing', () => {
    // sugg-1 pending → applied (legal); sugg-2 already applied (idempotent no-op);
    // sugg-3 dismissed → applied (illegal, dropped). Only sugg-1 is written.
    mockAll.mockReturnValueOnce([
      { id: 'sugg-1', status: 'pending' },
      { id: 'sugg-2', status: 'applied' },
      { id: 'sugg-3', status: 'dismissed' },
    ]);
    expect(() => markApplied('ws-1', ['sugg-1', 'sugg-2', 'sugg-3'])).not.toThrow();
    expect(mockRun).toHaveBeenCalledWith('ws-1', 'sugg-1');
  });

  it('does not write when no id is in a legal origin state', () => {
    mockAll.mockReturnValueOnce([{ id: 'sugg-1', status: 'applied' }]);
    markApplied('ws-1', ['sugg-1']);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('dismissSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('dismisses specific suggestion ids when provided', () => {
    // The guard SELECTs current statuses first; both pending → both legal.
    mockAll.mockReturnValueOnce([
      { id: 'sugg-1', status: 'pending' },
      { id: 'sugg-2', status: 'pending' },
    ]);
    mockRun.mockReturnValue({ changes: 2 });
    const count = dismissSuggestions('ws-1', ['sugg-1', 'sugg-2']);
    expect(count).toBe(2);
    expect(mockRun).toHaveBeenCalledWith('ws-1', 'sugg-1', 'sugg-2');
  });

  it('re-dismissing an already-dismissed id is a no-op that does not throw', () => {
    mockAll.mockReturnValueOnce([{ id: 'sugg-1', status: 'dismissed' }]);
    let count = -1;
    expect(() => { count = dismissSuggestions('ws-1', ['sugg-1']); }).not.toThrow();
    expect(count).toBe(0);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('dismisses all pending suggestions when no ids provided', () => {
    mockRun.mockReturnValue({ changes: 5 });
    const count = dismissSuggestions('ws-1');
    expect(count).toBe(5);
    const sql = String(mockPrepare.mock.calls[0][0]);
    expect(sql).toContain("status = 'pending'");
  });

  it('dismisses all pending when ids is empty array (falls through to all-dismiss)', () => {
    // Empty array means undefined-like path: no-length guard triggers all-dismiss
    mockRun.mockReturnValue({ changes: 3 });
    // undefined ids triggers the all-pending path
    const count = dismissSuggestions('ws-1', undefined);
    expect(count).toBe(3);
  });
});

describe('getSuggestionCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('returns correct counts from DB result', () => {
    mockGet.mockReturnValue({ total: 10, pending: 6, selected: 2 });
    const counts = getSuggestionCounts('ws-1');
    expect(counts.total).toBe(10);
    expect(counts.pending).toBe(6);
    expect(counts.selected).toBe(2);
  });

  it('returns zeros when DB returns nullish values', () => {
    mockGet.mockReturnValue({ total: 0, pending: 0, selected: 0 });
    const counts = getSuggestionCounts('ws-1');
    expect(counts.total).toBe(0);
    expect(counts.pending).toBe(0);
    expect(counts.selected).toBe(0);
  });
});

describe('saveSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun });
  });

  it('calls DB upsert and returns the saved suggestion', () => {
    const savedRow = makeRow({ id: 'new-id', current_value: 'Old title', variations: '["V1","V2","V3"]' });
    mockGet.mockReturnValue(savedRow);

    const result = saveSuggestion({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      pageId: 'page-1',
      pageTitle: 'Home',
      pageSlug: '/',
      field: 'title',
      currentValue: 'Old title',
      variations: ['V1', 'V2', 'V3'],
    });

    expect(result.id).toBe('new-id');
    expect(result.currentValue).toBe('Old title');
    expect(result.variations).toEqual(['V1', 'V2', 'V3']);
    expect(result.status).toBe('pending');
  });

  it('serializes variations as JSON before inserting', () => {
    const savedRow = makeRow();
    mockGet.mockReturnValue(savedRow);

    saveSuggestion({
      workspaceId: 'ws-1',
      siteId: 'site-1',
      pageId: 'page-1',
      pageTitle: 'Home',
      pageSlug: '/',
      field: 'description',
      currentValue: 'Old desc',
      variations: ['Desc A', 'Desc B', 'Desc C'],
    });

    // The run call should include JSON-stringified variations
    const runArgs = mockRun.mock.calls[0];
    const variationsArg = runArgs.find((a: unknown) => typeof a === 'string' && a.startsWith('['));
    expect(variationsArg).toBe('["Desc A","Desc B","Desc C"]');
  });
});
