import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Shared mocks for DB prepared statements ───────────────────────────────────

const mockGet = vi.fn();
const mockRun = vi.fn(() => ({ changes: 0 }));
const mockPrepare = vi.fn(() => ({ get: mockGet, run: mockRun }));
const mockTransaction = vi.fn((fn: () => void) => fn);

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
// json-validation parseJsonFallback: just parse the raw string, falling back to default
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: <T>(raw: unknown, fallback: T): T => {
    if (typeof raw !== 'string') return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMetricRow(overrides: Record<string, unknown> = {}) {
  return {
    identity_version: 'v2',
    identity_key: 'emergency plumber austin',
    raw_keyword: 'emergency plumber austin',
    database_region: 'us',
    volume: 320,
    difficulty: 42,
    cpc: 18.5,
    competition: 0.7,
    results: 12000000,
    trend: JSON.stringify([100, 110, 105, 120]),
    cached_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMetrics(overrides: Record<string, unknown> = {}) {
  return {
    keyword: 'emergency plumber austin',
    volume: 320,
    difficulty: 42,
    cpc: 18.5,
    competition: 0.7,
    results: 12000000,
    trend: [100, 110, 105, 120],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getCachedMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset lazy-init statement cache between test runs by re-mocking prepare
    mockPrepare.mockReturnValue({ get: mockGet, run: mockRun });
    mockTransaction.mockImplementation((fn: () => void) => fn);
  });

  it('returns null when no row is found in the DB', async () => {
    mockGet.mockReturnValue(undefined);
    const { getCachedMetrics } = await import('../../server/keyword-metrics-cache.js');
    expect(getCachedMetrics('emergency plumber austin')).toBeNull();
  });

  it('returns null when the cached row is stale', async () => {
    const staleDate = new Date(Date.now() - 800 * 60 * 60 * 1000).toISOString(); // 800h ago > 720h TTL
    mockGet.mockReturnValue(makeMetricRow({ cached_at: staleDate }));

    const { getCachedMetrics } = await import('../../server/keyword-metrics-cache.js');
    expect(getCachedMetrics('emergency plumber austin')).toBeNull();
  });

  it('returns cached metrics when the row is fresh', async () => {
    mockGet.mockReturnValue(makeMetricRow());

    const { getCachedMetrics } = await import('../../server/keyword-metrics-cache.js');
    const result = getCachedMetrics('emergency plumber austin');

    expect(result).not.toBeNull();
    expect(result!.volume).toBe(320);
    expect(result!.difficulty).toBe(42);
    expect(result!.trend).toEqual([100, 110, 105, 120]);
  });

  it('respects a custom maxAgeHours override', async () => {
    // Cached 2 hours ago — stale for maxAgeHours=1 but fresh for maxAgeHours=24
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockGet.mockReturnValue(makeMetricRow({ cached_at: twoHoursAgo }));

    const { getCachedMetrics } = await import('../../server/keyword-metrics-cache.js');
    expect(getCachedMetrics('emergency plumber austin', 'us', 1)).toBeNull();
    expect(getCachedMetrics('emergency plumber austin', 'us', 24)).not.toBeNull();
  });

  it('uses the default "us" database region when none is specified', async () => {
    mockGet.mockReturnValue(undefined);
    const { getCachedMetrics } = await import('../../server/keyword-metrics-cache.js');
    getCachedMetrics('emergency plumber austin');
    // The get call should have been made with the normalized key and 'us'
    expect(mockGet).toHaveBeenCalledWith('v2', expect.any(String), 'us');
  });
});

describe('getCachedMetricsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ get: mockGet, run: mockRun });
    mockTransaction.mockImplementation((fn: () => void) => fn);
  });

  it('returns an empty Map for an empty keyword list', async () => {
    const { getCachedMetricsBatch } = await import('../../server/keyword-metrics-cache.js');
    expect(getCachedMetricsBatch([])).toEqual(new Map());
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns only fresh hits and excludes stale / missing entries', async () => {
    const freshRow = makeMetricRow({ keyword: 'pipe repair austin' });
    const staleRow = makeMetricRow({ keyword: 'cheap plumber', cached_at: new Date(Date.now() - 800 * 60 * 60 * 1000).toISOString() });

    mockGet.mockImplementation((_version: string, _key: string, _db: string) => {
      if (_key === 'pipe repair austin') return freshRow;
      if (_key === 'cheap plumber') return staleRow;
      return undefined;
    });

    const { getCachedMetricsBatch } = await import('../../server/keyword-metrics-cache.js');
    const result = getCachedMetricsBatch(['pipe repair austin', 'cheap plumber', 'nonexistent']);

    expect(result.size).toBe(1);
    expect(result.has('pipe repair austin')).toBe(true);
    expect(result.has('cheap plumber')).toBe(false);
  });
});

describe('cacheMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ get: mockGet, run: mockRun });
    mockTransaction.mockImplementation((fn: () => void) => fn);
  });

  it('calls the upsert statement with normalized keyword key and provided fields', async () => {
    const { cacheMetrics } = await import('../../server/keyword-metrics-cache.js');
    cacheMetrics(makeMetrics() as Parameters<typeof cacheMetrics>[0]);

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_version: 'v2',
        identity_key: 'emergency plumber austin',
        raw_keyword: 'emergency plumber austin',
        database_region: 'us',
        volume: 320,
        difficulty: 42,
      }),
    );
  });

  it('serializes trend array to JSON string for storage', async () => {
    const { cacheMetrics } = await import('../../server/keyword-metrics-cache.js');
    cacheMetrics(makeMetrics({ trend: [90, 100, 110] }) as Parameters<typeof cacheMetrics>[0]);

    const call = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call['trend']).toBe('string');
    expect(JSON.parse(call['trend'] as string)).toEqual([90, 100, 110]);
  });
});

describe('cacheMetricsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ get: mockGet, run: mockRun });
    // transaction returns the fn itself (callable)
    mockTransaction.mockImplementation((fn: () => void) => fn);
  });

  it('does nothing when given an empty array', async () => {
    const { cacheMetricsBatch } = await import('../../server/keyword-metrics-cache.js');
    cacheMetricsBatch([]);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('runs once per item inside a transaction', async () => {
    const { cacheMetricsBatch } = await import('../../server/keyword-metrics-cache.js');
    const items = [
      makeMetrics({ keyword: 'emergency plumber austin' }),
      makeMetrics({ keyword: 'pipe repair austin' }),
      makeMetrics({ keyword: '24 hour plumber' }),
    ] as Parameters<typeof cacheMetricsBatch>[0];

    cacheMetricsBatch(items);

    // transaction fn should have been called once
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // run should have been called for each item
    expect(mockRun).toHaveBeenCalledTimes(3);
  });
});

describe('cleanupStaleEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReturnValue({ changes: 5 });
    mockPrepare.mockReturnValue({ get: mockGet, run: mockRun });
    mockTransaction.mockImplementation((fn: () => void) => fn);
  });

  it('returns the number of deleted entries', async () => {
    const { cleanupStaleEntries } = await import('../../server/keyword-metrics-cache.js');
    const deleted = cleanupStaleEntries(60);
    expect(deleted).toBe(5);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('passes a cutoff date string derived from maxAgeDays to the DELETE statement', async () => {
    const { cleanupStaleEntries } = await import('../../server/keyword-metrics-cache.js');
    const before = Date.now();
    cleanupStaleEntries(30);
    const after = Date.now();

    const [cutoff] = mockRun.mock.calls[0] as [string];
    const cutoffMs = new Date(cutoff).getTime();
    // cutoff should be roughly 30 days ago
    const expectedApprox = before - 30 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedApprox - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 30 * 24 * 60 * 60 * 1000 + 1000);
  });
});
