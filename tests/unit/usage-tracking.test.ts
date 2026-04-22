/**
 * Unit tests for server/usage-tracking.ts — per-workspace usage limits.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  getLimit,
  getUsageCount,
  incrementUsage,
  checkUsageLimit,
  getUsageSummary,
  incrementIfAllowed,
  decrementUsage,
} from '../../server/usage-tracking.js';

// ── getLimit ──

describe('getLimit', () => {
  it('returns correct limits for free tier', () => {
    expect(getLimit('free', 'ai_chats')).toBe(3);
    expect(getLimit('free', 'strategy_generations')).toBe(0);
  });

  it('returns correct limits for growth tier', () => {
    expect(getLimit('growth', 'ai_chats')).toBe(50);
    expect(getLimit('growth', 'strategy_generations')).toBe(3);
  });

  it('returns correct limits for premium tier', () => {
    expect(getLimit('premium', 'ai_chats')).toBe(Infinity);
    expect(getLimit('premium', 'strategy_generations')).toBe(Infinity);
  });

  it('falls back to free tier limits for unknown tier', () => {
    expect(getLimit('unknown_tier', 'ai_chats')).toBe(3);
    expect(getLimit('unknown_tier', 'strategy_generations')).toBe(0);
  });
});

// ── Usage tracking (these use real file I/O) ──

describe('getUsageCount / incrementUsage', () => {
  const testWsId = 'ws_usage_test_' + Date.now();

  afterEach(() => {
    // Clean up SQLite rows for this test workspace
    db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(testWsId);
  });

  it('returns 0 for a workspace with no usage', () => {
    expect(getUsageCount(testWsId, 'ai_chats')).toBe(0);
  });

  it('increments usage count', () => {
    const count = incrementUsage(testWsId, 'ai_chats');
    expect(count).toBe(1);
    expect(getUsageCount(testWsId, 'ai_chats')).toBe(1);
  });

  it('increments independently per feature', () => {
    incrementUsage(testWsId, 'ai_chats');
    incrementUsage(testWsId, 'ai_chats');
    incrementUsage(testWsId, 'strategy_generations');

    expect(getUsageCount(testWsId, 'ai_chats')).toBe(2);
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(1);
  });
});

// ── checkUsageLimit ──

describe('checkUsageLimit', () => {
  const testWsId = 'ws_limit_check_' + Date.now();

  afterEach(() => {
    db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(testWsId);
  });

  it('allows usage when under the limit', () => {
    const result = checkUsageLimit(testWsId, 'free', 'ai_chats');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(3);
    expect(result.remaining).toBe(3);
  });

  it('blocks usage when at the limit', () => {
    for (let i = 0; i < 3; i++) incrementUsage(testWsId, 'ai_chats');

    const result = checkUsageLimit(testWsId, 'free', 'ai_chats');
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(3);
    expect(result.remaining).toBe(0);
  });

  it('always allows for premium tier (Infinity)', () => {
    for (let i = 0; i < 100; i++) incrementUsage(testWsId, 'ai_chats');

    const result = checkUsageLimit(testWsId, 'premium', 'ai_chats');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
  });

  it('blocks strategy_generations for free tier (limit=0)', () => {
    const result = checkUsageLimit(testWsId, 'free', 'strategy_generations');
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('defaults to free tier for empty string', () => {
    const result = checkUsageLimit(testWsId, '', 'ai_chats');
    expect(result.limit).toBe(3);
  });
});

// ── incrementIfAllowed ──

describe('incrementIfAllowed', () => {
  const testWsId = 'ws_incr_allowed_' + Date.now();

  afterEach(() => {
    db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(testWsId);
  });

  it('returns true and increments when under limit', () => {
    const result = incrementIfAllowed(testWsId, 'growth', 'strategy_generations');
    expect(result).toBe(true);
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(1);
  });

  it('returns false when at limit (does not increment)', () => {
    for (let i = 0; i < 3; i++) incrementUsage(testWsId, 'strategy_generations');
    const result = incrementIfAllowed(testWsId, 'growth', 'strategy_generations');
    expect(result).toBe(false);
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(3);
  });

  it('returns false immediately for free tier (limit=0)', () => {
    const result = incrementIfAllowed(testWsId, 'free', 'strategy_generations');
    expect(result).toBe(false);
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(0);
  });

  it('always returns true and increments for premium tier (Infinity)', () => {
    const result = incrementIfAllowed(testWsId, 'premium', 'strategy_generations');
    expect(result).toBe(true);
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(1);
  });
});

// ── decrementUsage ──

describe('decrementUsage', () => {
  const testWsId = 'ws_decr_' + Date.now();

  afterEach(() => {
    db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(testWsId);
  });

  it('decrements count by 1', () => {
    incrementUsage(testWsId, 'strategy_generations');
    incrementUsage(testWsId, 'strategy_generations');
    decrementUsage(testWsId, 'strategy_generations');
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(1);
  });

  it('is a no-op when count is already 0 (no underflow)', () => {
    decrementUsage(testWsId, 'strategy_generations');
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(0);
  });

  it('refund pattern: increment then decrement returns to original', () => {
    incrementUsage(testWsId, 'strategy_generations');
    const before = getUsageCount(testWsId, 'strategy_generations');
    incrementIfAllowed(testWsId, 'growth', 'strategy_generations');
    decrementUsage(testWsId, 'strategy_generations');
    expect(getUsageCount(testWsId, 'strategy_generations')).toBe(before);
  });
});

// ── getUsageSummary ──

describe('getUsageSummary', () => {
  const testWsId = 'ws_summary_' + Date.now();

  afterEach(() => {
    db.prepare('DELETE FROM usage_tracking WHERE workspace_id = ?').run(testWsId);
  });

  it('returns summary for all features', () => {
    const summary = getUsageSummary(testWsId, 'growth');

    expect(summary.ai_chats).toBeDefined();
    expect(summary.strategy_generations).toBeDefined();
    expect(summary.ai_chats.limit).toBe(50);
    expect(summary.strategy_generations.limit).toBe(3);
    expect(summary.ai_chats.used).toBe(0);
    expect(summary.ai_chats.remaining).toBe(50);
  });
});
