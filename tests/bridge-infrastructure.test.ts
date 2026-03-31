import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock feature-flags before importing bridge infrastructure
vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

describe('bridge-infrastructure', () => {
  let executeBridge: typeof import('../server/bridge-infrastructure.js').executeBridge;
  let fireBridge: typeof import('../server/bridge-infrastructure.js').fireBridge;
  let debounceBridge: typeof import('../server/bridge-infrastructure.js').debounceBridge;
  let withWorkspaceLock: typeof import('../server/bridge-infrastructure.js').withWorkspaceLock;
  let getBridgeFlags: typeof import('../server/bridge-infrastructure.js').getBridgeFlags;
  let isFeatureEnabled: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    const flags = await import('../server/feature-flags.js');
    isFeatureEnabled = flags.isFeatureEnabled as ReturnType<typeof vi.fn>;
    const mod = await import('../server/bridge-infrastructure.js');
    executeBridge = mod.executeBridge;
    fireBridge = mod.fireBridge;
    debounceBridge = mod.debounceBridge;
    withWorkspaceLock = mod.withWorkspaceLock;
    getBridgeFlags = mod.getBridgeFlags;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('executeBridge', () => {
    it('skips execution when feature flag is OFF', async () => {
      isFeatureEnabled.mockReturnValue(false);
      const fn = vi.fn();
      await executeBridge('bridge-strategy-invalidate', 'ws-1', fn);
      expect(fn).not.toHaveBeenCalled();
    });

    it('executes bridge function when flag is ON', async () => {
      isFeatureEnabled.mockReturnValue(true);
      const fn = vi.fn().mockResolvedValue(undefined);
      await executeBridge('bridge-strategy-invalidate', 'ws-1', fn);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('catches and logs errors without throwing', async () => {
      isFeatureEnabled.mockReturnValue(true);
      const fn = vi.fn().mockRejectedValue(new Error('bridge failed'));
      // Should not throw
      await executeBridge('bridge-strategy-invalidate', 'ws-1', fn);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('respects timeout and aborts long-running bridges', async () => {
      isFeatureEnabled.mockReturnValue(true);
      const fn = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10_000)));
      const promise = executeBridge('bridge-strategy-invalidate', 'ws-1', fn, { timeoutMs: 100 });
      vi.advanceTimersByTime(200);
      await promise; // Should resolve (timeout catches internally)
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe('debounceBridge', () => {
    it('collapses multiple calls within debounce window', async () => {
      isFeatureEnabled.mockReturnValue(true);
      const fn = vi.fn().mockResolvedValue(undefined);
      const debounced = debounceBridge('bridge-strategy-invalidate', 300);

      debounced('ws-1', fn);
      debounced('ws-1', fn);
      debounced('ws-1', fn);

      vi.advanceTimersByTime(350);
      // Allow microtasks to flush
      await vi.runAllTimersAsync();

      // Only the last call should execute
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('executes separately for different workspaces', async () => {
      isFeatureEnabled.mockReturnValue(true);
      const fn1 = vi.fn().mockResolvedValue(undefined);
      const fn2 = vi.fn().mockResolvedValue(undefined);
      const debounced = debounceBridge('bridge-strategy-invalidate', 300);

      debounced('ws-1', fn1);
      debounced('ws-2', fn2);

      vi.advanceTimersByTime(350);
      await vi.runAllTimersAsync();

      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('withWorkspaceLock', () => {
    it('serializes concurrent calls for the same workspace', async () => {
      const order: number[] = [];
      const fn1 = async () => { order.push(1); await new Promise(r => setTimeout(r, 50)); order.push(2); };
      const fn2 = async () => { order.push(3); order.push(4); };

      const p1 = withWorkspaceLock('ws-1', fn1);
      const p2 = withWorkspaceLock('ws-1', fn2);

      vi.advanceTimersByTime(100);
      await Promise.all([p1, p2]);

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('allows concurrent calls for different workspaces', async () => {
      const order: string[] = [];
      const fn1 = async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 50)); order.push('a-end'); };
      const fn2 = async () => { order.push('b-start'); order.push('b-end'); };

      const p1 = withWorkspaceLock('ws-1', fn1);
      const p2 = withWorkspaceLock('ws-2', fn2);

      vi.advanceTimersByTime(100);
      await Promise.all([p1, p2]);

      // b should start before a ends (parallel)
      const bStartIdx = order.indexOf('b-start');
      const aEndIdx = order.indexOf('a-end');
      expect(bStartIdx).toBeLessThan(aEndIdx);
    });
  });

  describe('getBridgeFlags', () => {
    it('returns object with all bridge flag states', () => {
      isFeatureEnabled.mockReturnValue(false);
      const flags = getBridgeFlags();
      expect(flags).toHaveProperty('bridge-strategy-invalidate');
      expect(flags['bridge-strategy-invalidate']).toBe(false);
    });
  });
});
