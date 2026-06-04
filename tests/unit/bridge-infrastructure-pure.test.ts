/**
 * Pure-logic unit tests for server/bridge-infrastructure.ts
 *
 * Tests focus on:
 *  - executeBridge: dryRun, timeout, sync/async callback routing, error
 *    isolation, auto-broadcast when modified > 0
 *  - fireBridge: fire-and-forget wrapper (delegates to executeBridge)
 *  - debounceBridge: last-call-wins collapsing within a workspace, separate
 *    workspace isolation
 *  - withWorkspaceLock: serialisation within a workspace, concurrent cross-workspace
 *  - getBridgeFlags: enumerates all registered bridge flags
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

const mocks = vi.hoisted(() => ({
  broadcastToWorkspace: vi.fn(),
  WS_EVENTS: { INSIGHT_BRIDGE_UPDATED: 'insight_bridge_updated' },
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  db: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) },
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));

vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.log) }));
vi.mock('../../server/db/index.js', () => ({ default: mocks.db }));
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: mocks.parseJsonFallback,
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: mocks.WS_EVENTS }));

import {
  executeBridge,
  fireBridge,
  debounceBridge,
  withWorkspaceLock,
  getBridgeFlags,
} from '../../server/bridge-infrastructure.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const WORKSPACE = 'ws_test_01';
const FLAG = 'bridge-outcome-reweight' as const;

function flushTimers() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

// ── executeBridge ──────────────────────────────────────────────────────────

describe('executeBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes callback by default', async () => {
    const cb = vi.fn().mockReturnValue(undefined);
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not throw when callback throws — swallows the error', async () => {
    const cb = vi.fn().mockRejectedValue(new Error('bridge kaboom'));
    await expect(executeBridge(FLAG, WORKSPACE, cb)).resolves.toBeUndefined();
  });

  it('does not throw when synchronous callback throws', async () => {
    const cb = vi.fn().mockImplementation(() => { throw new Error('sync error'); });
    await expect(executeBridge(FLAG, WORKSPACE, cb)).resolves.toBeUndefined();
  });
});

describe('executeBridge — dryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips execution in dryRun mode', async () => {
    const cb = vi.fn();
    await executeBridge(FLAG, WORKSPACE, cb, { dryRun: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('logs a dryRun info message', async () => {
    const cb = vi.fn();
    await executeBridge(FLAG, WORKSPACE, cb, { dryRun: true });
    expect(mocks.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      expect.any(String),
    );
  });
});

describe('executeBridge — sync callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles synchronous void return', async () => {
    const cb = vi.fn().mockReturnValue(undefined);
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('handles synchronous BridgeResult with modified === 0 — no broadcast', async () => {
    const cb = vi.fn().mockReturnValue({ modified: 0 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('auto-broadcasts when synchronous callback returns modified > 0', async () => {
    const cb = vi.fn().mockReturnValue({ modified: 3 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      WORKSPACE,
      mocks.WS_EVENTS.INSIGHT_BRIDGE_UPDATED,
      { bridge: FLAG },
    );
  });
});

describe('executeBridge — async callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits async callback', async () => {
    let resolved = false;
    const cb = vi.fn(async () => { resolved = true; });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(resolved).toBe(true);
  });

  it('auto-broadcasts when async callback resolves with modified > 0', async () => {
    const cb = vi.fn().mockResolvedValue({ modified: 5 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      WORKSPACE,
      mocks.WS_EVENTS.INSIGHT_BRIDGE_UPDATED,
      { bridge: FLAG },
    );
  });

  it('does not broadcast when async callback resolves with modified === 0', async () => {
    const cb = vi.fn().mockResolvedValue({ modified: 0 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('does not broadcast when async callback resolves with void', async () => {
    const cb = vi.fn().mockResolvedValue(undefined);
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});

describe('executeBridge — timeout handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('times out and swallows when async callback hangs past timeoutMs', async () => {
    // Use a real never-settling promise with a very short timeout
    const cb = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
    await expect(executeBridge(FLAG, WORKSPACE, cb, { timeoutMs: 20 })).resolves.toBeUndefined();
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ flag: FLAG }),
      expect.stringContaining('Bridge failed'),
    );
  }, 3000);
});

// ── fireBridge ─────────────────────────────────────────────────────────────

describe('fireBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns void synchronously', () => {
    const cb = vi.fn().mockReturnValue(undefined);
    const result = fireBridge(FLAG, WORKSPACE, cb);
    expect(result).toBeUndefined();
  });

  it('eventually executes the callback (fire-and-forget)', async () => {
    const cb = vi.fn().mockReturnValue(undefined);
    fireBridge(FLAG, WORKSPACE, cb);
    await flushTimers();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not throw if callback throws — error is swallowed internally', async () => {
    const cb = vi.fn().mockRejectedValue(new Error('ff error'));
    expect(() => fireBridge(FLAG, WORKSPACE, cb)).not.toThrow();
    await flushTimers();
  });
});

// ── debounceBridge ─────────────────────────────────────────────────────────

describe('debounceBridge', () => {
  // Note: debounceBridge uses real setTimeout internally and calls executeBridge
  // (async). We test the debounce contracts using real timers + small delays.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collapses multiple rapid calls into one execution (last-call wins)', async () => {
    const debounced = debounceBridge(FLAG, 30);
    const cbFirst = vi.fn().mockReturnValue(undefined);
    const cbLast = vi.fn().mockReturnValue(undefined);

    debounced(WORKSPACE, cbFirst);
    debounced(WORKSPACE, cbFirst);
    debounced(WORKSPACE, cbLast);

    // Wait past the debounce delay
    await new Promise(r => setTimeout(r, 80));

    // Only the last callback should have been executed
    expect(cbFirst).not.toHaveBeenCalled();
    expect(cbLast).toHaveBeenCalledOnce();
  }, 2000);

  it('executes separate callbacks for different workspaces independently', async () => {
    const debounced = debounceBridge(FLAG, 30);
    const cbA = vi.fn().mockReturnValue(undefined);
    const cbB = vi.fn().mockReturnValue(undefined);

    debounced('ws_alpha', cbA);
    debounced('ws_beta', cbB);

    await new Promise(r => setTimeout(r, 80));

    expect(cbA).toHaveBeenCalledOnce();
    expect(cbB).toHaveBeenCalledOnce();
  }, 2000);

  it('returns a callable function', () => {
    const debounced = debounceBridge(FLAG, 500);
    expect(typeof debounced).toBe('function');
  });

  it('does not fire before delay expires', async () => {
    const debounced = debounceBridge(FLAG, 200);
    const cb = vi.fn().mockReturnValue(undefined);

    debounced(WORKSPACE, cb);
    // Check immediately — timer not elapsed
    expect(cb).not.toHaveBeenCalled();
    // Clean up timer to avoid test interference
    await new Promise(r => setTimeout(r, 250));
  }, 2000);
});

// ── withWorkspaceLock ──────────────────────────────────────────────────────

describe('withWorkspaceLock', () => {
  it('executes the provided function and returns its value', async () => {
    const result = await withWorkspaceLock(WORKSPACE, async () => 42);
    expect(result).toBe(42);
  });

  it('serialises concurrent calls for the same workspace', async () => {
    const order: number[] = [];
    const first = withWorkspaceLock(WORKSPACE, async () => {
      order.push(1);
      // Simulate async work
      await new Promise(r => setTimeout(r, 10));
      order.push(2);
    });
    const second = withWorkspaceLock(WORKSPACE, async () => {
      order.push(3);
    });

    await Promise.all([first, second]);
    // First must fully complete (1, 2) before second starts (3)
    expect(order).toEqual([1, 2, 3]);
  });

  it('allows concurrent execution for different workspaces', async () => {
    const order: string[] = [];
    const wsA = withWorkspaceLock('ws_A', async () => {
      order.push('A_start');
      await new Promise(r => setTimeout(r, 10));
      order.push('A_end');
    });
    const wsB = withWorkspaceLock('ws_B', async () => {
      order.push('B_start');
      await new Promise(r => setTimeout(r, 5));
      order.push('B_end');
    });

    await Promise.all([wsA, wsB]);
    // Both can start concurrently — B may finish first
    expect(order).toContain('A_start');
    expect(order).toContain('B_start');
    expect(order).toContain('A_end');
    expect(order).toContain('B_end');
  });

  it('propagates errors from the locked function', async () => {
    await expect(
      withWorkspaceLock(WORKSPACE, async () => { throw new Error('locked failure'); }),
    ).rejects.toThrow('locked failure');
  });
});

// ── getBridgeFlags ─────────────────────────────────────────────────────────

describe('getBridgeFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object keyed by bridge source names', () => {
    const flags = getBridgeFlags();
    expect(typeof flags).toBe('object');
    expect(flags).not.toBeNull();
    expect(Object.keys(flags).length).toBeGreaterThan(0);
  });

  it('each value is a boolean', () => {
    const flags = getBridgeFlags();
    for (const val of Object.values(flags)) {
      expect(typeof val).toBe('boolean');
    }
  });

  it('includes the expected bridge flag keys', () => {
    const flags = getBridgeFlags();
    const keys = Object.keys(flags);
    expect(keys).toContain('bridge-outcome-reweight');
    expect(keys).toContain('bridge-decay-suggested-brief');
    expect(keys).toContain('bridge-strategy-invalidate');
    expect(keys).toContain('bridge-insight-to-action');
    expect(keys).toContain('bridge-client-signal');
  });

  it('marks every registered bridge source as active', () => {
    const flags = getBridgeFlags();
    for (const val of Object.values(flags)) {
      expect(val).toBe(true);
    }
  });
});
