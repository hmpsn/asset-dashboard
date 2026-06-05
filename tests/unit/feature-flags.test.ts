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

  it('known flag keyword-hub defaults to false', () => {
    expect(FEATURE_FLAGS['keyword-hub']).toBe(false);
  });

  it('known flag white-label defaults to false', () => {
    expect(FEATURE_FLAGS['white-label']).toBe(false);
  });
});

describe('isFeatureEnabled', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns false for a flag with no DB override and no env var (default)', async () => {
    // Ensure env var is not set
    delete process.env['FEATURE_KEYWORD_HUB'];

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
    expect(isFeatureEnabled('keyword-hub')).toBe(false);
  });

  it('returns true when DB override enables a flag', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => [{ key: 'keyword-hub', enabled: 1 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('keyword-hub')).toBe(true);
  });

  it('returns false when DB override disables a flag', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => [{ key: 'keyword-hub', enabled: 0 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('keyword-hub')).toBe(false);
  });
});

describe('isFeatureEnabled — per-workspace dimension', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // Build a SQL-aware mock so the global (feature_flag_overrides) and per-workspace
  // (feature_flag_workspace_overrides) prepared statements can return distinct rows.
  async function mockDbBySql(opts: {
    globalRows?: Array<{ key: string; enabled: number }>;
    workspaceRows?: Array<{ key: string; enabled: number }>;
  }): Promise<void> {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as { prepare: ReturnType<typeof vi.fn> };
    mockDb.prepare.mockImplementation((sql: string) => {
      const isWorkspaceTable = /feature_flag_workspace_overrides/.test(sql);
      return {
        all: vi.fn(() => (isWorkspaceTable ? (opts.workspaceRows ?? []) : (opts.globalRows ?? []))),
        get: vi.fn(() => undefined),
        run: vi.fn(),
      };
    });
  }

  it('ignores per-workspace overrides when no workspaceId is passed (backward-compatible)', async () => {
    delete process.env['FEATURE_KEYWORD_HUB'];
    await mockDbBySql({ globalRows: [], workspaceRows: [{ key: 'keyword-hub', enabled: 1 }] });
    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    // No workspaceId → per-workspace layer is skipped → global default false.
    expect(isFeatureEnabled('keyword-hub')).toBe(false);
  });

  it('per-workspace override (enabled) wins over the global default', async () => {
    delete process.env['FEATURE_KEYWORD_HUB'];
    await mockDbBySql({ globalRows: [], workspaceRows: [{ key: 'keyword-hub', enabled: 1 }] });
    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('keyword-hub', 'ws-1')).toBe(true);
  });

  it('per-workspace override (disabled) wins over a global DB override that enables it', async () => {
    await mockDbBySql({
      globalRows: [{ key: 'keyword-hub', enabled: 1 }],
      workspaceRows: [{ key: 'keyword-hub', enabled: 0 }],
    });
    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    // Global says ON, per-workspace says OFF → per-workspace wins for this workspace.
    expect(isFeatureEnabled('keyword-hub', 'ws-1')).toBe(false);
    // The global resolution (no workspaceId) still reflects the global override.
    expect(isFeatureEnabled('keyword-hub')).toBe(true);
  });

  it('falls back to the global chain when the workspace has no override for the flag', async () => {
    await mockDbBySql({
      globalRows: [{ key: 'keyword-hub', enabled: 1 }],
      workspaceRows: [], // workspace has no per-flag override
    });
    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    expect(isFeatureEnabled('keyword-hub', 'ws-1')).toBe(true);
  });

  it('setWorkspaceFlagOverride is exported and invokes a DB write', async () => {
    let lastRun: unknown[] = [];
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as { prepare: ReturnType<typeof vi.fn> };
    mockDb.prepare.mockImplementation(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn((...args: unknown[]) => { lastRun = args; }),
    }));
    const { setWorkspaceFlagOverride } = await import('../../server/feature-flags.js');
    setWorkspaceFlagOverride('keyword-hub', 'ws-9', true);
    expect(lastRun).toEqual(['keyword-hub', 'ws-9', 1]);
    setWorkspaceFlagOverride('keyword-hub', 'ws-9', null); // delete path
    expect(lastRun).toEqual(['keyword-hub', 'ws-9']);
  });
});

describe('keyword-hub catalog entry', () => {
  it('is registered, defaults false, and is in the Keyword Hub group', () => {
    expect(FEATURE_FLAGS['keyword-hub']).toBe(false);
    expect(FEATURE_FLAG_CATALOG['keyword-hub'].group).toBe('Keyword Hub');
    expect(FEATURE_FLAG_CATALOG['keyword-hub'].lifecycle.linkedRoadmapItemId)
      .toBe('keyword-hub-wave4');
  });
});

describe('getWorkspaceFlagsWithMeta', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // Same SQL-aware mock used by the per-workspace isFeatureEnabled tests so the
  // global (feature_flag_overrides) and per-workspace
  // (feature_flag_workspace_overrides) statements can return distinct rows.
  async function mockDbBySql(opts: {
    globalRows?: Array<{ key: string; enabled: number }>;
    workspaceRows?: Array<{ key: string; enabled: number }>;
  }): Promise<void> {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as { prepare: ReturnType<typeof vi.fn> };
    mockDb.prepare.mockImplementation((sql: string) => {
      const isWorkspaceTable = /feature_flag_workspace_overrides/.test(sql);
      return {
        all: vi.fn(() => (isWorkspaceTable ? (opts.workspaceRows ?? []) : (opts.globalRows ?? []))),
        get: vi.fn(() => undefined),
        run: vi.fn(),
      };
    });
  }

  it('returns one entry per flag with resolved value + per-workspace source', async () => {
    await mockDbBySql({ globalRows: [], workspaceRows: [] });
    const { getWorkspaceFlagsWithMeta } = await import('../../server/feature-flags.js');
    const meta = getWorkspaceFlagsWithMeta('ws-1');
    expect(meta).toHaveLength(FEATURE_FLAG_KEYS.length);
    for (const entry of meta) {
      expect(['workspace', 'db', 'env', 'default']).toContain(entry.source);
      expect(['db', 'env', 'default']).toContain(entry.inheritedSource);
      expect(typeof entry.enabled).toBe('boolean');
      expect(typeof entry.inheritedEnabled).toBe('boolean');
    }
  });

  it('marks source=workspace and resolves the workspace value when a per-workspace override exists', async () => {
    delete process.env['FEATURE_KEYWORD_HUB'];
    await mockDbBySql({ globalRows: [], workspaceRows: [{ key: 'keyword-hub', enabled: 1 }] });
    const { getWorkspaceFlagsWithMeta } = await import('../../server/feature-flags.js');
    const entry = getWorkspaceFlagsWithMeta('ws-1').find(m => m.key === 'keyword-hub');
    expect(entry?.source).toBe('workspace');
    expect(entry?.enabled).toBe(true);
    // inherited (clear target) is the global chain → default OFF
    expect(entry?.inheritedEnabled).toBe(false);
    expect(entry?.inheritedSource).toBe('default');
  });

  it('per-workspace OFF override surfaces inheritedEnabled=true when global override is ON', async () => {
    await mockDbBySql({
      globalRows: [{ key: 'keyword-hub', enabled: 1 }],
      workspaceRows: [{ key: 'keyword-hub', enabled: 0 }],
    });
    const { getWorkspaceFlagsWithMeta } = await import('../../server/feature-flags.js');
    const entry = getWorkspaceFlagsWithMeta('ws-1').find(m => m.key === 'keyword-hub');
    // Workspace forces OFF, but clearing reverts to the global override (ON).
    expect(entry?.source).toBe('workspace');
    expect(entry?.enabled).toBe(false);
    expect(entry?.inheritedEnabled).toBe(true);
    expect(entry?.inheritedSource).toBe('db');
  });

  it('falls back to the global chain (source=db) when the workspace has no override', async () => {
    await mockDbBySql({
      globalRows: [{ key: 'keyword-hub', enabled: 1 }],
      workspaceRows: [],
    });
    const { getWorkspaceFlagsWithMeta } = await import('../../server/feature-flags.js');
    const entry = getWorkspaceFlagsWithMeta('ws-1').find(m => m.key === 'keyword-hub');
    expect(entry?.source).toBe('db');
    expect(entry?.enabled).toBe(true);
    expect(entry?.inheritedEnabled).toBe(true);
    expect(entry?.inheritedSource).toBe('db');
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
    delete process.env['FEATURE_KEYWORD_HUB'];
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
    const keywordHubEntry = meta.find(m => m.key === 'keyword-hub');
    expect(keywordHubEntry?.source).toBe('default');
    expect(keywordHubEntry?.enabled).toBe(false);
  });

  it('reports source=db when DB override is set', async () => {
    const dbModule = await import('../../server/db/index.js');
    const mockDb = dbModule.default as unknown as {
      prepare: ReturnType<typeof vi.fn>;
    };
    mockDb.prepare.mockReturnValue({
      all: vi.fn(() => [{ key: 'keyword-hub', enabled: 1 }]),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    });

    const { getAllFlagsWithMeta } = await import('../../server/feature-flags.js');
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(m => m.key === 'keyword-hub');
    expect(entry?.source).toBe('db');
    expect(entry?.enabled).toBe(true);
  });
});
