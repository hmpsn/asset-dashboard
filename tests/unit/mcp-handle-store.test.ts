/**
 * Durability + bounds tests for the SQLite-backed MCP handle store and the
 * durable paid-call counter (server/mcp/handles.ts + paid-call-counter.ts).
 *
 * These complement the lifecycle tests in mcp-handles.test.ts / handles.test.ts:
 * they assert the persistence semantics that the in-memory store could not
 * provide — survival in the DB, single-use deletion at the row level, TTL
 * expiry, MAX_HANDLES eviction, and durable per-workspace paid-call counts.
 *
 * The shared test DB singleton is migrated by tests/db-setup.ts before this file
 * runs, so the mcp_handles + mcp_paid_call_counts tables exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import {
  __resetHandleStoreForTests,
  consumeHandle,
  HandleExpiredError,
  HandleNotFoundError,
  issueHandle,
  sweepExpiredHandles,
} from '../../server/mcp/handles.js';
import {
  __resetPaidCallCounterForTests,
  getPaidCallCount,
  recordPaidCall,
} from '../../server/mcp/paid-call-counter.js';

function countHandleRows(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM mcp_handles').get() as { n: number }).n;
}

function getHandleRow(token: string): { token: string; workspace_id: string } | undefined {
  return db.prepare('SELECT token, workspace_id FROM mcp_handles WHERE token = ?').get(token) as
    | { token: string; workspace_id: string }
    | undefined;
}

beforeEach(() => {
  __resetHandleStoreForTests();
  __resetPaidCallCounterForTests();
  delete process.env.MCP_MAX_HANDLES;
  delete process.env.MCP_PAID_CALL_WARN_AFTER;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mcp handle store — durability', () => {
  it('persists an issued handle as a real DB row (survives in storage, not a Map)', () => {
    const id = issueHandle('keyword-research', 'ws-durable', { term: 'persisted' });

    // Persisted row exists independently of any in-process cache.
    const row = getHandleRow(id);
    expect(row).toBeDefined();
    expect(row?.workspace_id).toBe('ws-durable');

    // And it is still consumable after the store is "re-read" from the DB.
    const payload = consumeHandle<{ term: string }>(id, 'keyword-research', 'ws-durable');
    expect(payload).toEqual({ term: 'persisted' });
  });

  it('round-trips structured payloads through JSON storage', () => {
    const payload = { term: 'x', volume: 100, trend: [1, 2, 3], nested: { a: true } };
    const id = issueHandle('keyword-research', 'ws-1', payload);
    expect(consumeHandle(id, 'keyword-research', 'ws-1')).toEqual(payload);
  });
});

describe('mcp handle store — single-use', () => {
  it('deletes the row on consume so a second consume fails', () => {
    const id = issueHandle('brief', 'ws-1', { briefId: 'b1' });
    expect(countHandleRows()).toBe(1);

    consumeHandle(id, 'brief', 'ws-1');

    expect(getHandleRow(id)).toBeUndefined();
    expect(countHandleRows()).toBe(0);
    expect(() => consumeHandle(id, 'brief', 'ws-1')).toThrow(HandleNotFoundError);
  });
});

describe('mcp handle store — TTL expiry + sweeper', () => {
  it('rejects an expired handle and removes it on the failed consume', () => {
    vi.useFakeTimers();
    const id = issueHandle('post', 'ws-1', { postId: 'p1' }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);

    expect(() => consumeHandle(id, 'post', 'ws-1')).toThrow(HandleExpiredError);
    // Expired-on-read also purges the row.
    expect(getHandleRow(id)).toBeUndefined();
  });

  it('sweepExpiredHandles deletes only expired rows', () => {
    vi.useFakeTimers();
    const expiring = issueHandle('post', 'ws-1', { postId: 'old' }, { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    // Issue a fresh long-lived handle after the clock advanced.
    const fresh = issueHandle('post', 'ws-1', { postId: 'new' }, { ttlMs: 60_000 });

    const removed = sweepExpiredHandles();

    expect(removed).toBe(1);
    expect(getHandleRow(expiring)).toBeUndefined();
    expect(getHandleRow(fresh)).toBeDefined();
  });
});

describe('mcp handle store — MAX_HANDLES eviction', () => {
  it('evicts the oldest rows when the bound is exceeded', () => {
    process.env.MCP_MAX_HANDLES = '3';

    const first = issueHandle('keyword-research', 'ws-1', { n: 1 });
    const second = issueHandle('keyword-research', 'ws-1', { n: 2 });
    const third = issueHandle('keyword-research', 'ws-1', { n: 3 });
    expect(countHandleRows()).toBe(3);

    // The 4th issue pushes us over the bound — oldest (first) is evicted.
    const fourth = issueHandle('keyword-research', 'ws-1', { n: 4 });

    expect(countHandleRows()).toBe(3);
    expect(getHandleRow(first)).toBeUndefined();
    expect(getHandleRow(second)).toBeDefined();
    expect(getHandleRow(third)).toBeDefined();
    expect(getHandleRow(fourth)).toBeDefined();
    expect(() => consumeHandle(first, 'keyword-research', 'ws-1')).toThrow(HandleNotFoundError);
  });
});

describe('mcp paid-call counter — durability + per-workspace', () => {
  it('persists the global aggregate across reads', () => {
    recordPaidCall(1);
    recordPaidCall(3);
    // Read is a fresh DB query each time — proves durability, not in-memory state.
    expect(getPaidCallCount()).toBe(4);
  });

  it('tracks per-workspace counts while keeping the global aggregate', () => {
    recordPaidCall(2, 'ws-a');
    recordPaidCall(5, 'ws-b');
    recordPaidCall(1, 'ws-a');

    expect(getPaidCallCount('ws-a')).toBe(3);
    expect(getPaidCallCount('ws-b')).toBe(5);
    // Global aggregate sums every recorded call.
    expect(getPaidCallCount()).toBe(8);
  });

  it('is informational only — warns at threshold but never refuses a call', () => {
    process.env.MCP_PAID_CALL_WARN_AFTER = '3';

    expect(recordPaidCall(1).warning).toBeUndefined();
    expect(recordPaidCall(1).warning).toBeUndefined();
    const atThreshold = recordPaidCall(1);
    const pastThreshold = recordPaidCall(1);

    expect(atThreshold.count).toBe(3);
    expect(atThreshold.warning).toMatch(/paid_call_count: 3 \(threshold 3; informational only\)/);
    // Still returns a normal result past the threshold — no refusal.
    expect(pastThreshold.count).toBe(4);
    expect(pastThreshold.warning).toMatch(/paid_call_count: 4/);
  });
});
