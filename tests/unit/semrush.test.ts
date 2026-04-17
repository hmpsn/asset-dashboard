import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock fs so readCache/writeCache don't touch disk (private functions inside semrush.ts use fs directly)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => {
      throw new Error('ENOENT');
    }),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// Mock data-dir so getUploadRoot/getDataDir don't throw
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));

// Mock keyword-metrics-cache so SQLite DB is not accessed in unit tests
vi.mock('../../server/keyword-metrics-cache.js', () => ({
  getCachedMetricsBatch: vi.fn().mockReturnValue(new Map()),
  cacheMetricsBatch: vi.fn(),
  getCachedMetrics: vi.fn().mockReturnValue(null),
  cacheMetrics: vi.fn(),
}));

import fs from 'fs';
import { getTopReferringDomains } from '../../server/semrush.js';

function reapplyFsMocks(): void {
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
  vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT'); });
  vi.spyOn(fs, 'readdirSync').mockReturnValue([]);
}

describe('getTopReferringDomains — SEMRush date normalization', () => {
  beforeEach(() => {
    reapplyFsMocks();
    process.env.SEMRUSH_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SEMRUSH_API_KEY;
  });

  it('normalizes Unix epoch seconds from CSV to ISO-8601 strings', async () => {
    // Arrange: SEMRush CSV response with epoch-seconds first_seen / last_seen
    const csv = [
      'domain_ascore;domain;backlinks_num;first_seen;last_seen',
      '85;example.com;14;1747509061;1776200795',
      '62;another.com;3;1753374588;1776155057',
    ].join('\n');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => csv,
    } as Response);

    // Act
    const result = await getTopReferringDomains('example.test', 'ws-test-date-norm', 15);

    // Assert: dates are ISO, never Unix strings
    expect(result).toHaveLength(2);
    expect(result[0].firstSeen).toMatch(/^2025-05-17T/);
    expect(result[0].lastSeen).toMatch(/^2026-\d{2}-\d{2}T/);
    // Crucially: new Date(iso) must be valid
    expect(Number.isNaN(new Date(result[0].firstSeen).getTime())).toBe(false);
    expect(Number.isNaN(new Date(result[0].lastSeen).getTime())).toBe(false);
  });

  it('returns empty strings (not "Invalid Date") for missing date cells', async () => {
    const csv = [
      'domain_ascore;domain;backlinks_num;first_seen;last_seen',
      '50;example.com;14;;',
    ].join('\n');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => csv,
    } as Response);

    const result = await getTopReferringDomains('example.test', 'ws-test-empty', 15);
    expect(result[0].firstSeen).toBe('');
    expect(result[0].lastSeen).toBe('');
  });
});
