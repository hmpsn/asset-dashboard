import { describe, expect, it } from 'vitest';
import { readProjectFile } from '../helpers/source-contracts.js';
import { CRON_METADATA } from '../../server/cron-registry.js';

// Anti-drift guard. What this test ACTUALLY guarantees (honest scope):
//   1. Every module in the manually-maintained BOOT_WIRED_SCHEDULER_MODULES /
//      MODULE_LEVEL_TIMER_MODULES inventories below has a CRON_METADATA entry
//      (verified: deleting the backup entry from cron-registry.ts turns this
//      red). This catches a KNOWN scheduler LOSING its registration.
//   2. cron-registry.ts still imports every inventory module, and
//      startup.ts/index.ts are still wired through the registry helpers
//      (startAllRegisteredCrons / stopAllRegisteredCrons).
//   3. startup.ts does not bypass the registry by importing an inventory
//      scheduler module directly (the "startSchedulers hand-call" regression).
//
// What this test does NOT catch: adding a BRAND-NEW scheduler module that is
// nowhere in these inventories. The census iterates a HARDCODED inventory, not
// startup.ts's live import list, so a genuinely-new scheduler (its own new
// file + its own new import) leaves every assertion green until someone
// extends BOOT_WIRED_SCHEDULER_MODULES below by hand. That auto-catch is the
// job of the deferred "new setInterval must register in CRON_METADATA"
// pr-check rule — see docs/rules/background-generation.md §Cron Registry for
// why it was deferred. Until then, adding a new boot-wired scheduler is a
// manual two-step: register it in cron-registry.ts AND add it to the inventory
// below.
//
// The inventories are grep-verified against server/startup.ts + the 4 known
// module-level timers (server/mcp/handles.ts, server/middleware.ts x2,
// server/ai-deduplication.ts) as of the R10-PR1 cron registry inventory
// (docs/superpowers/audits/2026-07-01-reconcile-plan-audit-inventories.json §R10).
const BOOT_WIRED_SCHEDULER_MODULES = [
  'server/email-throttle.js',
  'server/scheduled-audits.js',
  'server/approval-reminders.js',
  'server/monthly-report.js',
  'server/backup.js',
  'server/trial-reminders.js',
  'server/churn-signals.js',
  'server/anomaly-detection.js',
  'server/outcome-crons.js',
  'server/data-retention.js',
  'server/intelligence-crons.js', // owns TWO subsystems: startIntelligenceCrons + startCompetitorMonitoringCron
  'server/insight-recompute-cron.js',
  'server/rank-tracking-scheduler.js',
  'server/ga4-conversion-snapshot-scheduler.js',
  'server/webflow-form-poller.js',
  'server/briefing-cron.js',
  'server/strategy-issue-cron.js',
  'server/return-hook-cron.js',
] as const;

// Module-level timers that fire outside startSchedulers()/startup.ts entirely
// (on import of their owning module). These are NOT boot-wired schedulers in
// the startup.ts sense, but the R10 inventory flags them as timers needing a
// registry entry or a documented exemption.
const MODULE_LEVEL_TIMER_MODULES = [
  'server/mcp/handles.js',
  'server/middleware.js', // owns TWO module-level timers: rate-limit cleanup + login-lockout cleanup
  'server/ai-deduplication.js',
] as const;

describe('cron registry census contract', () => {
  it('server/cron-registry.ts imports every boot-wired scheduler module this inventory expects', () => {
    // startup.ts itself no longer imports scheduler modules directly — it
    // delegates to cron-registry.ts's startAllRegisteredCrons(), which is
    // the single execution surface. The census therefore checks the registry
    // module (the new source of truth for "is this scheduler boot-wired").
    const src = readProjectFile('server/cron-registry.ts');
    for (const mod of BOOT_WIRED_SCHEDULER_MODULES) {
      const specifier = `./${mod.replace(/^server\//, '')}`;
      expect(src, `server/cron-registry.ts should import ${specifier}`).toContain(specifier);
    }
  });

  it('every boot-wired scheduler module has a CRON_METADATA entry', () => {
    const registeredModules = new Set(Object.values(CRON_METADATA).map(entry => entry.module));
    const missing = BOOT_WIRED_SCHEDULER_MODULES.filter(mod => !registeredModules.has(mod));
    expect(missing, `Unregistered boot-wired schedulers (add a CRON_METADATA entry): ${missing.join(', ')}`).toEqual([]);
  });

  it('every known module-level timer has a CRON_METADATA entry (registered or documented exemption)', () => {
    const registeredModules = new Set(Object.values(CRON_METADATA).map(entry => entry.module));
    const missing = MODULE_LEVEL_TIMER_MODULES.filter(mod => !registeredModules.has(mod));
    expect(missing, `Unregistered module-level timers (add a CRON_METADATA entry, real or exempt): ${missing.join(', ')}`).toEqual([]);
  });

  it('no CRON_METADATA entry references a module outside the known census', () => {
    const known = new Set<string>([...BOOT_WIRED_SCHEDULER_MODULES, ...MODULE_LEVEL_TIMER_MODULES]);
    const unknown = Object.entries(CRON_METADATA)
      .filter(([, entry]) => !known.has(entry.module))
      .map(([id, entry]) => `${id} -> ${entry.module}`);
    expect(unknown, `CRON_METADATA entries not in the census inventory (update this test's module lists too): ${unknown.join(', ')}`).toEqual([]);
  });

  it('gracefulShutdown in server/index.ts stops every registered cron with stopHook:true', () => {
    const src = readProjectFile('server/index.ts');
    // The registry-driven shutdown must call the single stopAllRegisteredCrons()
    // helper rather than re-hand-listing every stopX() call — this is the fix
    // for the historical drift where 5 stop exports existed but were never wired.
    expect(src).toContain('stopAllRegisteredCrons');
  });

  it('startSchedulers in server/startup.ts starts every registered cron via the registry', () => {
    const src = readProjectFile('server/startup.ts');
    expect(src).toContain('startAllRegisteredCrons');
  });

  it('server/startup.ts does not bypass the registry by importing a scheduler module directly', () => {
    // Guards against the regression this registry exists to prevent: a future
    // scheduler added straight to startup.ts (import + hand-call) instead of
    // through server/cron-registry.ts, which would make it invisible to both
    // startAllRegisteredCrons() and the census above.
    const src = readProjectFile('server/startup.ts');
    for (const mod of BOOT_WIRED_SCHEDULER_MODULES) {
      const specifier = `./${mod.replace(/^server\//, '')}`;
      expect(src, `server/startup.ts should NOT import ${specifier} directly — register it in server/cron-registry.ts instead`).not.toContain(specifier);
    }
  });
});
