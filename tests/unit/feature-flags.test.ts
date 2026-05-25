import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_CATALOG,
} from '../../shared/types/feature-flags.js';

// Mock DB module before importing feature-flags
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
    transaction: vi.fn((fn: (arg: unknown) => unknown) => fn),
  },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn(() => false),
}));

describe('feature-flags shared types', () => {
  it('all feature flags default to false', () => {
    for (const value of Object.values(FEATURE_FLAGS)) {
      expect(value).toBe(false);
    }
  });

  it('FEATURE_FLAG_KEYS contains all keys from FEATURE_FLAGS', () => {
    const flagKeys = Object.keys(FEATURE_FLAGS);
    expect(FEATURE_FLAG_KEYS).toEqual(expect.arrayContaining(flagKeys));
    expect(FEATURE_FLAG_KEYS).toHaveLength(flagKeys.length);
  });

  it('every key in FEATURE_FLAG_KEYS has a catalog entry', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(FEATURE_FLAG_CATALOG[key]).toBeDefined();
      expect(FEATURE_FLAG_CATALOG[key].label).toBeTruthy();
      expect(FEATURE_FLAG_CATALOG[key].group).toBeTruthy();
    }
  });

  it('catalog entries have required lifecycle fields', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const entry = FEATURE_FLAG_CATALOG[key];
      expect(entry.lifecycle.owner).toBeTruthy();
      expect(entry.lifecycle.createdAt).toBeTruthy();
      expect(entry.lifecycle.rolloutTarget).toBeTruthy();
      expect(entry.lifecycle.removalCondition).toBeTruthy();
    }
  });

  it('known flag copy-engine defaults to false', () => {
    expect(FEATURE_FLAGS['copy-engine']).toBe(false);
  });

  it('known flag new-inbox-ia defaults to false', () => {
    expect(FEATURE_FLAGS['new-inbox-ia']).toBe(false);
  });
});

describe('isFeatureEnabled', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns false for a flag with no DB override and no env var (default)', async () => {
    // Ensure env var is not set
    delete process.env['FEATURE_COPY_ENGINE'];

    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('copy-engine')).toBe(false);
  });

  it('returns true when DB override enables a flag', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => [{ key: 'copy-engine', enabled: 1 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('copy-engine')).toBe(true);
  });

  it('returns false when DB override disables a flag', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => [{ key: 'copy-engine', enabled: 0 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('copy-engine')).toBe(false);
  });
});

describe('getAllFlags', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns an object with all feature flag keys', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { getAllFlags } = await import('../../server/feature-flags.js');
    const flags = getAllFlags();
    for (const key of FEATURE_FLAG_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(flags, key)).toBe(true);
      expect(typeof flags[key]).toBe('boolean');
    }
  });
});

describe('getAllFlagsWithMeta', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns metadata for every flag including source', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { getAllFlagsWithMeta } = await import('../../server/feature-flags.js');
    const meta = getAllFlagsWithMeta();
    expect(meta).toHaveLength(FEATURE_FLAG_KEYS.length);
    for (const entry of meta) {
      expect(['db', 'env', 'default']).toContain(entry.source);
      expect(typeof entry.enabled).toBe('boolean');
      expect(entry.label).toBeTruthy();
    }
  });

  it('reports source=default when no DB override or env var present', async () => {
    delete process.env['FEATURE_COPY_ENGINE'];
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { getAllFlagsWithMeta } = await import('../../server/feature-flags.js');
    const meta = getAllFlagsWithMeta();
    const copyEngineEntry = meta.find(m => m.key === 'copy-engine');
    expect(copyEngineEntry?.source).toBe('default');
    expect(copyEngineEntry?.enabled).toBe(false);
  });

  it('reports source=db when DB override is set', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => [{ key: 'deep-diagnostics', enabled: 1 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { getAllFlagsWithMeta } = await import('../../server/feature-flags.js');
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(m => m.key === 'deep-diagnostics');
    expect(entry?.source).toBe('db');
    expect(entry?.enabled).toBe(true);
  });
});
