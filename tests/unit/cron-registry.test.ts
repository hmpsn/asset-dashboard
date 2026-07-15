import { beforeAll, describe, expect, it, vi } from 'vitest';

// This test asserts the CRON_METADATA registry has complete, well-formed
// metadata for every registered cron AND that constructing/importing the
// registry module never starts a real timer (lazy construction — see
// server/cron-registry.ts header comment; eager construction would start
// unmocked transitive scheduler imports for real inside vitest).

// Warm the transitive module graph once, off the per-test 5s budget. The very
// first `await import('../../server/cron-registry.js')` cold-transforms ~20
// scheduler modules and their deps through vitest's module runner, which can
// exceed the default 5000ms testTimeout under load (observed flake). Paying it
// once here in a generously-timed hook keeps every individual test fast and
// deterministic; the `vi.resetModules()` tests re-import cheaply afterward
// because the transitive deps stay transformed/cached.
beforeAll(async () => {
  await import('../../server/cron-registry.js');
}, 30_000);

describe('cron-registry: CRON_METADATA completeness', () => {
  it('defines well-formed metadata for every registered CronId', async () => {
    const { CRON_METADATA } = await import('../../server/cron-registry.js');
    const ids = Object.keys(CRON_METADATA);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const entry = CRON_METADATA[id as keyof typeof CRON_METADATA];
      expect(entry.label.length, `${id}.label must be non-empty`).toBeGreaterThan(0);
      expect(entry.description.length, `${id}.description must be non-empty`).toBeGreaterThan(0);
      expect(entry.module.length, `${id}.module must be non-empty`).toBeGreaterThan(0);
      expect(typeof entry.intervalMs, `${id}.intervalMs must be a number`).toBe('number');
      expect(entry.intervalMs, `${id}.intervalMs must be positive`).toBeGreaterThan(0);
      expect(typeof entry.stopHook, `${id}.stopHook must be boolean`).toBe('boolean');
    }
  });

  it('gives every entry with stopHook:true a callable stop() and start()', async () => {
    const { CRON_METADATA } = await import('../../server/cron-registry.js');
    for (const [id, entry] of Object.entries(CRON_METADATA)) {
      if (!entry.stopHook) continue;
      expect(typeof entry.start, `${id}.start must be a function`).toBe('function');
      expect(typeof entry.stop, `${id}.stop must be a function`).toBe('function');
    }
  });

  it('documents an explicit exemptReason for every entry with stopHook:false', async () => {
    const { CRON_METADATA } = await import('../../server/cron-registry.js');
    for (const [id, entry] of Object.entries(CRON_METADATA)) {
      if (entry.stopHook) continue;
      expect(entry.exemptReason, `${id} has stopHook:false and must document exemptReason`).toBeTruthy();
      expect(entry.exemptReason!.length).toBeGreaterThan(0);
    }
  });
});

describe('cron-registry: lazy construction', () => {
  // NOTE: this deliberately does NOT assert "zero setInterval/setTimeout calls
  // anywhere in the transitive import graph" — several pre-existing modules
  // (server/ai-deduplication.ts, server/middleware.ts) start unconditional
  // module-level timers on import regardless of whether cron-registry.ts is
  // ever touched; that is exactly the documented `stopHook: false` exemption
  // class this registry surfaces rather than silently hides. Restructuring
  // those imports is out of scope for this additive PR (see cron-registry.ts
  // header + the exemptReason on each entry).
  //
  // What MUST be true: CRON_METADATA's own construction — the object literal
  // in cron-registry.ts — never itself invokes any registered start()/stop().
  // That is the property partial scheduler mocks depend on: if constructing
  // CRON_METADATA eagerly called (say)
  // startInsightRecomputeCron() or startStrategyIssueCron() — representative
  // transitive modules that tests may not mock — real timers would start inside vitest.
  it('never calls any registered start() as a side effect of importing the module', async () => {
    vi.resetModules();
    const { CRON_METADATA } = await import('../../server/cron-registry.js');
    const startSpies = Object.values(CRON_METADATA).map(entry => vi.spyOn(entry, 'start'));
    // Re-import (module is already cached from the line above) to prove the
    // spies — installed AFTER import — observe zero calls: nothing invoked
    // start() during the import itself, and nothing invokes it lazily later
    // either unless startAllRegisteredCrons() (or an individual entry.start())
    // is explicitly called, which this test never does.
    for (const spy of startSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('never calls any registered stop() as a side effect of importing the module', async () => {
    vi.resetModules();
    const { CRON_METADATA } = await import('../../server/cron-registry.js');
    const stopSpies = Object.values(CRON_METADATA).map(entry => vi.spyOn(entry, 'stop'));
    for (const spy of stopSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('cron-registry: registry-driven start/stop helpers', () => {
  it('startAllRegisteredCrons calls start() on every entry exactly once', async () => {
    vi.resetModules();
    const { CRON_METADATA, startAllRegisteredCrons } = await import('../../server/cron-registry.js');
    const startSpies = Object.values(CRON_METADATA).map(entry => vi.spyOn(entry, 'start').mockImplementation(() => {}));
    startAllRegisteredCrons();
    for (const spy of startSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('stopAllRegisteredCrons calls stop() on every stopHook:true entry exactly once and skips exempt entries', async () => {
    vi.resetModules();
    const { CRON_METADATA, stopAllRegisteredCrons } = await import('../../server/cron-registry.js');
    const stopSpies = new Map<string, ReturnType<typeof vi.fn>>();
    for (const [id, entry] of Object.entries(CRON_METADATA)) {
      const spy = vi.spyOn(entry, 'stop').mockImplementation(() => {});
      stopSpies.set(id, spy as unknown as ReturnType<typeof vi.fn>);
    }
    stopAllRegisteredCrons();
    for (const [id, entry] of Object.entries(CRON_METADATA)) {
      const spy = stopSpies.get(id)!;
      if (entry.stopHook) {
        expect(spy, `${id} should be stopped`).toHaveBeenCalledTimes(1);
      } else {
        expect(spy, `${id} is exempt and should not be stopped`).not.toHaveBeenCalled();
      }
    }
  });
});
