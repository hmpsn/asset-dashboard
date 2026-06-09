/**
 * Unit tests for server/openai-helpers.ts — pure helpers, token tracking,
 * cost estimation, and parseAIJson.
 *
 * All external I/O (fs, fetch) is mocked so no actual HTTP calls or disk writes happen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mocks before imports ──────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => [] as string[]),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  getDataDir: vi.fn(() => '/fake/ai-usage'),
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
  AIRequestDeduplicator: { createKey: vi.fn(() => 'dedupe-key') },
  aiDeduplicator: { deduplicate: vi.fn((_key: string, fn: () => unknown) => fn()) },
  stripCodeFences: vi.fn((s: string) => s),
  abortableDelay: vi.fn(),
  composeTimeoutSignal: vi.fn(() => undefined),
  throwIfSignalAborted: vi.fn(),
  recordOperationTrace: vi.fn(),
  isLocalFakeProviderModeEnabled: vi.fn(() => false),
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
    readdirSync: mocks.readdirSync,
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
  },
}));

vi.mock('../../server/data-dir.js', () => ({ getDataDir: mocks.getDataDir }));
vi.mock('../../server/logger.js', () => ({ createLogger: mocks.createLogger }));
vi.mock('../../server/ai-deduplication.js', () => ({
  AIRequestDeduplicator: mocks.AIRequestDeduplicator,
  aiDeduplicator: mocks.aiDeduplicator,
}));
vi.mock('../../server/helpers.js', () => ({ stripCodeFences: mocks.stripCodeFences }));
vi.mock('../../server/abort-helpers.js', () => ({
  abortableDelay: mocks.abortableDelay,
  composeTimeoutSignal: mocks.composeTimeoutSignal,
  throwIfSignalAborted: mocks.throwIfSignalAborted,
}));
vi.mock('../../server/platform-observability.js', () => ({
  recordOperationTrace: mocks.recordOperationTrace,
}));
vi.mock('../../server/local-provider-mode.js', () => ({
  isLocalFakeProviderModeEnabled: mocks.isLocalFakeProviderModeEnabled,
}));

import {
  callOpenAI,
  parseAIJson,
  logTokenUsage,
  flushToDisk,
  getTokenUsage,
  getUsageByDay,
  getUsageByFeature,
  getTimeSaved,
  type TokenUsage,
} from '../../server/openai-helpers.js';

// ── parseAIJson ──────────────────────────────────────────────────────────────

describe('parseAIJson', () => {
  beforeEach(() => {
    // Default: stripCodeFences passes through as-is
    mocks.stripCodeFences.mockImplementation((s: string) => s);
  });

  it('parses clean JSON object', () => {
    const result = parseAIJson<{ ok: boolean }>('{"ok":true}');
    expect(result).toEqual({ ok: true });
  });

  it('parses clean JSON array', () => {
    const result = parseAIJson<number[]>('[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('calls stripCodeFences before parsing', () => {
    mocks.stripCodeFences.mockReturnValue('{"stripped":true}');
    const result = parseAIJson<{ stripped: boolean }>('```json\n{"stripped":true}\n```');
    expect(mocks.stripCodeFences).toHaveBeenCalled();
    expect(result).toEqual({ stripped: true });
  });

  it('trims whitespace from stripped output before parsing', () => {
    mocks.stripCodeFences.mockReturnValue('  {"spaced":1}  ');
    const result = parseAIJson<{ spaced: number }>('  {"spaced":1}  ');
    expect(result).toEqual({ spaced: 1 });
  });

  it('throws SyntaxError on invalid JSON', () => {
    expect(() => parseAIJson('not-json')).toThrow(SyntaxError);
  });

  it('parses nested JSON correctly', () => {
    const input = '{"a":{"b":{"c":42}}}';
    const result = parseAIJson<{ a: { b: { c: number } } }>(input);
    expect(result.a.b.c).toBe(42);
  });
});

// ── logTokenUsage / flushToDisk ──────────────────────────────────────────────

describe('logTokenUsage + flushToDisk', () => {
  beforeEach(() => {
    mocks.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mocks.writeFileSync.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Force-flush any pending writes to reset module state
    flushToDisk();
    mocks.writeFileSync.mockReset();
  });

  it('does not write when there are no pending writes', () => {
    flushToDisk();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it('writes to disk when pending entries reach 20', () => {
    for (let i = 0; i < 20; i++) {
      logTokenUsage({
        promptTokens: 10, completionTokens: 5, totalTokens: 15,
        model: 'gpt-5.4-mini', feature: 'test-feature',
      });
    }
    expect(mocks.writeFileSync).toHaveBeenCalled();
  });

  it('flushToDisk writes all pending entries to disk', () => {
    logTokenUsage({ promptTokens: 5, completionTokens: 3, totalTokens: 8, model: 'gpt-5.4-mini', feature: 'test' });
    logTokenUsage({ promptTokens: 7, completionTokens: 2, totalTokens: 9, model: 'gpt-5.5', feature: 'other' });
    flushToDisk();
    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mocks.writeFileSync.mock.calls[0][1] as string) as TokenUsage[];
    expect(written.length).toBeGreaterThanOrEqual(2);
    expect(written.some((e: TokenUsage) => e.feature === 'test')).toBe(true);
    expect(written.some((e: TokenUsage) => e.feature === 'other')).toBe(true);
  });

  it('entries include a timestamp ISO string', () => {
    logTokenUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15, model: 'gpt-5.4', feature: 'ts-check' });
    flushToDisk();
    const written = JSON.parse(mocks.writeFileSync.mock.calls[0][1] as string) as TokenUsage[];
    const entry = written.find((e: TokenUsage) => e.feature === 'ts-check');
    expect(entry?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── getTokenUsage ────────────────────────────────────────────────────────────

describe('getTokenUsage', () => {
  beforeEach(() => {
    mocks.readdirSync.mockReturnValue([]);
    mocks.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mocks.writeFileSync.mockReset();
    // No pending entries — flush any leftover state
    flushToDisk();
  });

  it('returns empty result when no files exist', () => {
    const result = getTokenUsage();
    expect(result.entries).toEqual([]);
    expect(result.totalTokens).toBe(0);
    expect(result.estimatedCost).toBe(0);
  });

  it('filters by workspaceId', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-5.4-mini', feature: 'chat', workspaceId: 'ws-A', timestamp: `${today}T10:00:00.000Z` },
      { promptTokens: 200, completionTokens: 80, totalTokens: 280, model: 'gpt-5.4-mini', feature: 'chat', workspaceId: 'ws-B', timestamp: `${today}T11:00:00.000Z` },
    ]));
    const result = getTokenUsage('ws-A');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].workspaceId).toBe('ws-A');
    expect(result.totalTokens).toBe(150);
  });

  it('computes non-zero estimatedCost for real entries', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, model: 'gpt-5.4-mini', feature: 'audit', workspaceId: 'ws-X', timestamp: `${today}T08:00:00.000Z` },
    ]));
    const result = getTokenUsage('ws-X');
    expect(result.estimatedCost).toBeGreaterThan(0);
  });
});

// ── getUsageByFeature ────────────────────────────────────────────────────────

describe('getUsageByFeature', () => {
  beforeEach(() => {
    mocks.writeFileSync.mockReset();
    flushToDisk();
  });

  it('returns entries grouped by feature + provider', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 50, completionTokens: 30, totalTokens: 80, model: 'gpt-5.4-mini', feature: 'seo-audit', workspaceId: 'ws-1', timestamp: `${today}T09:00:00.000Z` },
      { promptTokens: 40, completionTokens: 20, totalTokens: 60, model: 'gpt-5.4-mini', feature: 'seo-audit', workspaceId: 'ws-1', timestamp: `${today}T10:00:00.000Z` },
      { promptTokens: 100, completionTokens: 60, totalTokens: 160, model: 'claude-sonnet-4-6', feature: 'content-brief', workspaceId: 'ws-1', timestamp: `${today}T11:00:00.000Z` },
    ]));

    const result = getUsageByFeature('ws-1');
    const seoEntry = result.find(r => r.feature === 'seo-audit');
    const briefEntry = result.find(r => r.feature === 'content-brief');
    expect(seoEntry?.calls).toBe(2);
    expect(briefEntry?.calls).toBe(1);
    expect(briefEntry?.provider).toBe('anthropic');
  });

  it('sorts results by cost descending', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: 'gpt-5.4-mini', feature: 'cheap', workspaceId: null, timestamp: `${today}T09:00:00.000Z` },
      { promptTokens: 10000, completionTokens: 5000, totalTokens: 15000, model: 'gpt-5.5', feature: 'expensive', workspaceId: null, timestamp: `${today}T10:00:00.000Z` },
    ]));
    const result = getUsageByFeature();
    expect(result[0].feature).toBe('expensive');
    expect(result[result.length - 1].feature).toBe('cheap');
  });
});

// ── getTimeSaved ─────────────────────────────────────────────────────────────

describe('getTimeSaved', () => {
  beforeEach(() => {
    mocks.writeFileSync.mockReset();
    flushToDisk();
  });

  it('returns zeros when no entries exist', () => {
    mocks.readdirSync.mockReturnValue([]);
    const result = getTimeSaved();
    expect(result.totalMinutesSaved).toBe(0);
    expect(result.totalHoursSaved).toBe(0);
    expect(result.operationCount).toBe(0);
  });

  it('uses known feature minutes for content-brief (150 min)', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-5.4-mini', feature: 'content-brief', workspaceId: 'ws-1', timestamp: `${today}T10:00:00.000Z` },
    ]));
    const result = getTimeSaved('ws-1');
    expect(result.totalMinutesSaved).toBe(150);
    expect(result.byFeature['content-brief'].minutesSaved).toBe(150);
  });

  it('uses default 10 minutes for unknown features', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: 'gpt-5.4-mini', feature: 'unknown-feature-xyz', workspaceId: 'ws-2', timestamp: `${today}T10:00:00.000Z` },
    ]));
    const result = getTimeSaved('ws-2');
    expect(result.totalMinutesSaved).toBe(10);
  });

  it('computes totalHoursSaved rounded to 1 decimal', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    // keyword-strategy = 240 min = 4 hours exactly
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-5.4', feature: 'keyword-strategy', workspaceId: 'ws-3', timestamp: `${today}T10:00:00.000Z` },
    ]));
    const result = getTimeSaved('ws-3');
    expect(result.totalHoursSaved).toBe(4);
  });

  it('accumulates minutes across multiple operations', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    // seo-rewrite=15, alt-text=5
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: 'gpt-5.4-mini', feature: 'seo-rewrite', workspaceId: 'ws-4', timestamp: `${today}T10:00:00.000Z` },
      { promptTokens: 10, completionTokens: 5, totalTokens: 15, model: 'gpt-5.4-mini', feature: 'seo-rewrite', workspaceId: 'ws-4', timestamp: `${today}T11:00:00.000Z` },
      { promptTokens: 5, completionTokens: 2, totalTokens: 7, model: 'gpt-5.4-nano', feature: 'alt-text', workspaceId: 'ws-4', timestamp: `${today}T12:00:00.000Z` },
    ]));
    const result = getTimeSaved('ws-4');
    expect(result.totalMinutesSaved).toBe(35); // 15+15+5
    expect(result.operationCount).toBe(3);
  });
});

// ── getUsageByDay ─────────────────────────────────────────────────────────────

describe('getUsageByDay', () => {
  beforeEach(() => {
    mocks.writeFileSync.mockReset();
    flushToDisk();
    mocks.readdirSync.mockReturnValue([]);
  });

  it('always returns an array of day objects (even with no data)', () => {
    const result = getUsageByDay(undefined, 7);
    // Should have entries for each of the 7 days + today
    expect(result.length).toBeGreaterThanOrEqual(7);
    for (const day of result) {
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('totalTokens');
      expect(day).toHaveProperty('cost');
      expect(day).toHaveProperty('calls');
      expect(day).toHaveProperty('openaiCost');
      expect(day).toHaveProperty('anthropicCost');
    }
  });

  it('aggregates openai vs anthropic tokens/cost separately', () => {
    const today = new Date().toISOString().slice(0, 10);
    mocks.readdirSync.mockReturnValue([`${today}.json`]);
    mocks.readFileSync.mockReturnValue(JSON.stringify([
      { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'gpt-5.4-mini', feature: 'chat', workspaceId: null, timestamp: `${today}T10:00:00.000Z` },
      { promptTokens: 200, completionTokens: 100, totalTokens: 300, model: 'claude-sonnet-4-6', feature: 'content-post', workspaceId: null, timestamp: `${today}T10:30:00.000Z` },
    ]));
    const result = getUsageByDay(undefined, 1);
    const todayEntry = result.find(r => r.date === today);
    expect(todayEntry?.openaiTokens).toBe(150);
    expect(todayEntry?.anthropicTokens).toBe(300);
    expect(todayEntry?.openaiCost).toBeGreaterThan(0);
    expect(todayEntry?.anthropicCost).toBeGreaterThan(0);
  });
});

describe('callOpenAI retry behavior', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    mocks.isLocalFakeProviderModeEnabled.mockReturnValue(false);
    mocks.abortableDelay.mockReset();
    mocks.composeTimeoutSignal.mockReset();
    mocks.composeTimeoutSignal.mockReturnValue(undefined);
    mocks.throwIfSignalAborted.mockReset();
    mocks.recordOperationTrace.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it('retries 429 responses using retry-after-ms before succeeding', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
        headers: { get: (name: string) => name === 'retry-after-ms' ? '2500' : null },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
        }),
      } as Response);

    const result = await callOpenAI({
      messages: [{ role: 'user', content: 'retry me' }],
      feature: 'openai-retry-test',
      maxRetries: 1,
    });

    expect(result.text).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mocks.abortableDelay).toHaveBeenCalledWith(3000, undefined, 'AI request cancelled');
    expect(mocks.recordOperationTrace).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'openai-retry-test',
      status: 'success',
    }));
  });

  it('does not record an error trace when the caller cancels the request', async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.throwIfSignalAborted.mockImplementationOnce(() => {
      throw new Error('AI request cancelled');
    });

    await expect(callOpenAI({
      messages: [{ role: 'user', content: 'cancel me' }],
      feature: 'openai-cancel-test',
      maxRetries: 1,
      signal: controller.signal,
    })).rejects.toThrow('AI request cancelled');

    expect(mocks.recordOperationTrace).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: 'openai-cancel-test',
      status: 'error',
    }));
  });
});
