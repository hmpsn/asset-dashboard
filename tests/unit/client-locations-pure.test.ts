// tests/unit/client-locations-pure.test.ts
// Pure unit tests for server/client-locations.ts
// Exercises the rowToLocation mapper behaviour and the nullableString helper
// by driving the exported functions with a fully-mocked DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLIENT_LOCATION_STATUS } from '../../shared/types/local-seo.js';

// ── DB mock ──────────────────────────────────────────────────────────────────
// Use vi.hoisted() so that the mock references are available when vi.mock()
// factories are hoisted to the top of the file by vitest's transformer.

const { mockRun, mockGet, mockAll } = vi.hoisted(() => ({
  mockRun: vi.fn().mockReturnValue({ changes: 1 }),
  mockGet: vi.fn().mockReturnValue(null),
  mockAll: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({
      all: mockAll,
      get: mockGet,
      run: mockRun,
    }),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<{
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state_or_region: string | null;
  country: string | null;
  is_primary: number;
  status: string;
  gbp_place_id: string | null;
  primary_market_id: string | null;
  page_target_path: string | null;
  page_target_keyword_id: string | null;
  created_at: string;
  updated_at: string;
}> = {}) {
  return {
    id: 'loc-1',
    workspace_id: 'ws-1',
    name: 'Main Office',
    domain: null,
    phone: null,
    street_address: null,
    city: null,
    state_or_region: null,
    country: null,
    is_primary: 0,
    status: CLIENT_LOCATION_STATUS.NEEDS_REVIEW,
    gbp_place_id: null,
    primary_market_id: null,
    page_target_path: null,
    page_target_keyword_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Import module under test (after mocks are hoisted) ───────────────────────

import {
  getClientLocations,
  getClientLocationById,
  createClientLocation,
  updateClientLocation,
  deleteClientLocation,
  countClientLocations,
} from '../../server/client-locations.js';

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReturnValue({ changes: 1 });
  mockGet.mockReturnValue(null);
  mockAll.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// getClientLocations — list mapping
// ---------------------------------------------------------------------------
describe('getClientLocations', () => {
  it('returns an empty array when the DB returns no rows', () => {
    mockAll.mockReturnValue([]);
    expect(getClientLocations('ws-1')).toEqual([]);
  });

  it('maps a single DB row to a ClientLocation', () => {
    const row = makeRow({ id: 'loc-1', name: 'HQ', is_primary: 1 });
    mockAll.mockReturnValue([row]);

    const [loc] = getClientLocations('ws-1');
    expect(loc.id).toBe('loc-1');
    expect(loc.name).toBe('HQ');
    expect(loc.workspaceId).toBe('ws-1');
    expect(loc.isPrimary).toBe(true);
  });

  it('converts is_primary=0 to isPrimary=false', () => {
    mockAll.mockReturnValue([makeRow({ is_primary: 0 })]);
    const [loc] = getClientLocations('ws-1');
    expect(loc.isPrimary).toBe(false);
  });

  it('converts is_primary=1 to isPrimary=true', () => {
    mockAll.mockReturnValue([makeRow({ is_primary: 1 })]);
    const [loc] = getClientLocations('ws-1');
    expect(loc.isPrimary).toBe(true);
  });

  it('converts null DB fields to undefined on the returned object', () => {
    const row = makeRow({
      domain: null, phone: null, street_address: null,
      city: null, state_or_region: null, country: null,
      gbp_place_id: null, primary_market_id: null,
      page_target_path: null, page_target_keyword_id: null,
    });
    mockAll.mockReturnValue([row]);
    const [loc] = getClientLocations('ws-1');

    expect(loc.domain).toBeUndefined();
    expect(loc.phone).toBeUndefined();
    expect(loc.streetAddress).toBeUndefined();
    expect(loc.city).toBeUndefined();
    expect(loc.stateOrRegion).toBeUndefined();
    expect(loc.country).toBeUndefined();
    expect(loc.gbpPlaceId).toBeUndefined();
    expect(loc.primaryMarketId).toBeUndefined();
    expect(loc.pageTargetPath).toBeUndefined();
    expect(loc.pageTargetKeywordId).toBeUndefined();
  });

  it('preserves non-null optional string fields', () => {
    const row = makeRow({
      domain: 'example.com', phone: '555-0100',
      street_address: '123 Main St', city: 'Austin',
      state_or_region: 'TX', country: 'US',
      gbp_place_id: 'gbp-abc', primary_market_id: 'mkt-1',
      page_target_path: '/austin', page_target_keyword_id: 'kw-1',
    });
    mockAll.mockReturnValue([row]);
    const [loc] = getClientLocations('ws-1');

    expect(loc.domain).toBe('example.com');
    expect(loc.phone).toBe('555-0100');
    expect(loc.streetAddress).toBe('123 Main St');
    expect(loc.city).toBe('Austin');
    expect(loc.stateOrRegion).toBe('TX');
    expect(loc.country).toBe('US');
    expect(loc.gbpPlaceId).toBe('gbp-abc');
    expect(loc.primaryMarketId).toBe('mkt-1');
    expect(loc.pageTargetPath).toBe('/austin');
    expect(loc.pageTargetKeywordId).toBe('kw-1');
  });

  it('maps multiple rows and returns them all', () => {
    mockAll.mockReturnValue([
      makeRow({ id: 'a', name: 'A' }),
      makeRow({ id: 'b', name: 'B' }),
      makeRow({ id: 'c', name: 'C' }),
    ]);
    const locs = getClientLocations('ws-1');
    expect(locs).toHaveLength(3);
    expect(locs.map(l => l.id)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Status normalisation — unknown values fall back to NEEDS_REVIEW
// ---------------------------------------------------------------------------
describe('rowToLocation status normalisation', () => {
  it('accepts a known status "confirmed"', () => {
    mockAll.mockReturnValue([makeRow({ status: CLIENT_LOCATION_STATUS.CONFIRMED })]);
    const [loc] = getClientLocations('ws-1');
    expect(loc.status).toBe('confirmed');
  });

  it('accepts a known status "needs_review"', () => {
    mockAll.mockReturnValue([makeRow({ status: CLIENT_LOCATION_STATUS.NEEDS_REVIEW })]);
    const [loc] = getClientLocations('ws-1');
    expect(loc.status).toBe('needs_review');
  });

  it('falls back to needs_review for an unknown status string', () => {
    mockAll.mockReturnValue([makeRow({ status: 'bogus_status' })]);
    const [loc] = getClientLocations('ws-1');
    expect(loc.status).toBe(CLIENT_LOCATION_STATUS.NEEDS_REVIEW);
  });

  it('falls back to needs_review for an empty status string', () => {
    mockAll.mockReturnValue([makeRow({ status: '' })]);
    const [loc] = getClientLocations('ws-1');
    expect(loc.status).toBe(CLIENT_LOCATION_STATUS.NEEDS_REVIEW);
  });
});

// ---------------------------------------------------------------------------
// getClientLocationById
// ---------------------------------------------------------------------------
describe('getClientLocationById', () => {
  it('returns undefined when DB get returns null', () => {
    mockGet.mockReturnValue(null);
    expect(getClientLocationById('loc-1', 'ws-1')).toBeUndefined();
  });

  it('returns a mapped ClientLocation when DB get returns a row', () => {
    const row = makeRow({ id: 'loc-1', name: 'Branch', is_primary: 1 });
    mockGet.mockReturnValue(row);
    const loc = getClientLocationById('loc-1', 'ws-1');
    expect(loc).toBeDefined();
    expect(loc!.id).toBe('loc-1');
    expect(loc!.name).toBe('Branch');
    expect(loc!.isPrimary).toBe(true);
  });

  it('preserves timestamps from the DB row', () => {
    const row = makeRow({
      created_at: '2024-03-15T10:00:00.000Z',
      updated_at: '2024-04-20T12:00:00.000Z',
    });
    mockGet.mockReturnValue(row);
    const loc = getClientLocationById('loc-1', 'ws-1')!;
    expect(loc.createdAt).toBe('2024-03-15T10:00:00.000Z');
    expect(loc.updatedAt).toBe('2024-04-20T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// createClientLocation
// ---------------------------------------------------------------------------
describe('createClientLocation', () => {
  it('returns the newly created location returned by getClientLocationById', () => {
    const row = makeRow({ id: 'new-id', name: 'New Location' });
    // First call to mockGet comes from getClientLocationById inside createClientLocation
    mockGet.mockReturnValue(row);

    const loc = createClientLocation('ws-1', { name: 'New Location' });
    expect(loc.name).toBe('New Location');
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it('throws when getClientLocationById returns undefined after insert', () => {
    mockGet.mockReturnValue(null);
    expect(() => createClientLocation('ws-1', { name: 'X' })).toThrow('Client location insert failed');
  });

  it('defaults status to needs_review when no status is provided', () => {
    const row = makeRow({ status: 'needs_review' });
    mockGet.mockReturnValue(row);

    createClientLocation('ws-1', { name: 'NoStatus' });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.status).toBe('needs_review');
  });

  it('uses provided status when given', () => {
    const row = makeRow({ status: 'confirmed' });
    mockGet.mockReturnValue(row);

    createClientLocation('ws-1', { name: 'WithStatus', status: 'confirmed' });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.status).toBe('confirmed');
  });

  it('converts isPrimary=true to is_primary=1 in the DB insert', () => {
    const row = makeRow({ is_primary: 1 });
    mockGet.mockReturnValue(row);

    createClientLocation('ws-1', { name: 'Primary', isPrimary: true });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.is_primary).toBe(1);
  });

  it('converts isPrimary=false to is_primary=0 in the DB insert', () => {
    const row = makeRow({ is_primary: 0 });
    mockGet.mockReturnValue(row);

    createClientLocation('ws-1', { name: 'NotPrimary', isPrimary: false });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.is_primary).toBe(0);
  });

  it('stores empty optional string fields as null', () => {
    const row = makeRow();
    mockGet.mockReturnValue(row);

    createClientLocation('ws-1', { name: 'Min' });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.domain).toBeNull();
    expect(runArg.phone).toBeNull();
    expect(runArg.street_address).toBeNull();
    expect(runArg.city).toBeNull();
    expect(runArg.state_or_region).toBeNull();
    expect(runArg.country).toBeNull();
    expect(runArg.gbp_place_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateClientLocation
// ---------------------------------------------------------------------------
describe('updateClientLocation', () => {
  it('returns null when the location does not exist', () => {
    mockGet.mockReturnValue(null);
    const result = updateClientLocation('loc-x', 'ws-1', { name: 'New' });
    expect(result).toBeNull();
  });

  it('calls update and then returns refreshed location', () => {
    const existing = makeRow({ id: 'loc-1', name: 'Old Name' });
    const updated = makeRow({ id: 'loc-1', name: 'New Name' });
    // First get (inside update to fetch existing), second get (after update run)
    mockGet.mockReturnValueOnce(existing).mockReturnValueOnce(updated);

    const result = updateClientLocation('loc-1', 'ws-1', { name: 'New Name' });
    expect(result?.name).toBe('New Name');
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it('preserves existing name when name is not provided in the update', () => {
    const existing = makeRow({ id: 'loc-1', name: 'Existing Name' });
    mockGet.mockReturnValueOnce(existing).mockReturnValueOnce(existing);

    updateClientLocation('loc-1', 'ws-1', { city: 'Austin' });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.name).toBe('Existing Name');
  });

  it('merges isPrimary from update input when provided', () => {
    const existing = makeRow({ id: 'loc-1', is_primary: 0 });
    mockGet.mockReturnValueOnce(existing).mockReturnValueOnce(existing);

    updateClientLocation('loc-1', 'ws-1', { isPrimary: true });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.is_primary).toBe(1);
  });

  it('falls back to existing isPrimary when not provided in update', () => {
    const existing = makeRow({ id: 'loc-1', is_primary: 1 });
    mockGet.mockReturnValueOnce(existing).mockReturnValueOnce(existing);

    updateClientLocation('loc-1', 'ws-1', { name: 'Same Primary' });

    const runArg = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runArg.is_primary).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deleteClientLocation
// ---------------------------------------------------------------------------
describe('deleteClientLocation', () => {
  it('returns true when DB reports one change', () => {
    mockRun.mockReturnValue({ changes: 1 });
    expect(deleteClientLocation('loc-1', 'ws-1')).toBe(true);
  });

  it('returns false when DB reports zero changes (not found)', () => {
    mockRun.mockReturnValue({ changes: 0 });
    expect(deleteClientLocation('missing', 'ws-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countClientLocations
// ---------------------------------------------------------------------------
describe('countClientLocations', () => {
  it('returns the count from the DB row', () => {
    mockGet.mockReturnValue({ count: 5 });
    expect(countClientLocations('ws-1')).toBe(5);
  });

  it('returns 0 when DB row has count=0', () => {
    mockGet.mockReturnValue({ count: 0 });
    expect(countClientLocations('ws-1')).toBe(0);
  });
});
