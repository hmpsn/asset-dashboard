import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Harness: keep the provider off disk / DB and configured via env ──
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));
vi.mock('../../server/keyword-metrics-cache.js', () => ({
  getCachedMetricsBatch: vi.fn().mockReturnValue(new Map()),
  cacheMetricsBatch: vi.fn(),
  getCachedMetrics: vi.fn().mockReturnValue(null),
  cacheMetrics: vi.fn(),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

process.env.DATAFORSEO_LOGIN = 'test-login';
process.env.DATAFORSEO_PASSWORD = 'test-password';

import {
  markCapabilityDisabled,
  isCapabilityDisabled,
  clearCapabilityDisabled,
  getBacklinksProvider,
  registerProvider,
  _resetRegistryForTest,
  type SeoDataProvider,
} from '../../server/seo-data-provider.js';
import { DataForSeoProvider } from '../../server/providers/dataforseo-provider.js';

function stubProvider(): SeoDataProvider {
  return { name: 'dataforseo', isConfigured: () => true } as unknown as SeoDataProvider;
}

describe('DataForSEO capability breaker — registry logic (P5)', () => {
  beforeEach(() => {
    _resetRegistryForTest();
    registerProvider('dataforseo', stubProvider());
  });
  afterEach(() => {
    _resetRegistryForTest();
    vi.useRealTimers();
  });

  it('getBacklinksProvider returns the provider while backlinks is enabled', () => {
    expect(getBacklinksProvider()).not.toBeNull();
  });

  it('once tripped, getBacklinksProvider short-circuits to null (the removed `!== backlinks` guard)', () => {
    markCapabilityDisabled('dataforseo', 'backlinks', 0);
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(true);
    expect(getBacklinksProvider()).toBeNull();
  });

  it('a TTL-tripped breaker auto-re-enables after the TTL elapses', () => {
    vi.useFakeTimers();
    const TTL = 6 * 60 * 60 * 1000;
    markCapabilityDisabled('dataforseo', 'backlinks', TTL);
    expect(getBacklinksProvider()).toBeNull();
    vi.advanceTimersByTime(TTL + 1);
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(false);
    expect(getBacklinksProvider()).not.toBeNull();
  });

  it('clearCapabilityDisabled re-enables immediately', () => {
    markCapabilityDisabled('dataforseo', 'backlinks', 0);
    clearCapabilityDisabled('dataforseo', 'backlinks');
    expect(getBacklinksProvider()).not.toBeNull();
  });
});

describe('DataForSEO capability breaker — provider trips it on a 40204 (P5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCapabilityDisabled('dataforseo', 'backlinks');
  });

  it('getBacklinksOverview trips the backlinks breaker on a subscription error', async () => {
    clearCapabilityDisabled('dataforseo', 'backlinks');
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(false);

    const provider = new DataForSeoProvider();
    // task-level 40204 subscription error → isSubscriptionError → handleError trips breaker.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tasks: [{ status_code: 40204, status_message: 'subscription required — 40204', cost: 0 }] }),
    } as Response);

    const result = await provider.getBacklinksOverview('example.test', 'ws-breaker');

    expect(result).toBeNull();
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(true);
  });
});
