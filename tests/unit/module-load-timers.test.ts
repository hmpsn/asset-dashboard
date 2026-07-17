import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Module-load timers must never hold the event loop open.
 *
 * server/ai-deduplication.ts, server/middleware.ts (x2) and server/mcp/handles.ts
 * start in-process cache-sweeper timers at IMPORT time. That is deliberate and is
 * registered in server/cron-registry.ts as a `stopHook: false` exemption — every
 * consumer of createApp() relies on them running immediately, so they are NOT
 * lazily start()-able (see the cron-registry header comment).
 *
 * Starting at import time is fine. Being REF'd is not: a ref'd interval keeps the
 * Node event loop alive forever, so any CLI script that transitively imports the
 * AI/server stack never exits. On 2026-07-16 this hung `npm run seed:demo` for
 * 18+ minutes (scripts → content-brief → ai-deduplication), and was worked around
 * at the call site instead of fixed at the source.
 *
 * The fix is `.unref()` — the timer still starts at import and still fires for the
 * whole life of a real server (the HTTP listener keeps the loop alive), but it can
 * no longer be the *only* thing keeping a process alive. server/mcp/handles.ts has
 * always done this correctly and is the reference pattern.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every module known to start a timer in its top-level scope. Keep in sync with
 *  MODULE_LEVEL_TIMER_MODULES in tests/contract/cron-registry-census.test.ts. */
const MODULE_LOAD_TIMER_MODULES = [
  'server/ai-deduplication.ts',
  'server/middleware.ts',
  'server/mcp/handles.ts',
] as const;

function readModule(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/** Find timers started in the MODULE's top-level scope (column 0 = not nested in
 *  a function). `bare` calls discard the handle and so can never be unref'd. */
function topLevelTimers(src: string): { bare: number; named: string[] } {
  const named: string[] = [];
  let bare = 0;
  for (const line of src.split('\n')) {
    const assigned = /^(?:const|let|var)\s+(\w+)\s*=\s*setInterval\(/.exec(line);
    if (assigned) {
      named.push(assigned[1]);
      continue;
    }
    if (/^setInterval\(/.test(line)) bare++;
  }
  return { bare, named };
}

describe('module-load timers do not hold the event loop open', () => {
  // Static guard: cheap, and covers modules (middleware.ts) whose import graph
  // reaches server/db/index.ts and would open the real SQLite DB if spawned.
  it.each(MODULE_LOAD_TIMER_MODULES)('every top-level setInterval in %s is unref()d', relPath => {
    const src = readModule(relPath);
    const { bare, named } = topLevelTimers(src);

    expect(
      bare,
      `${relPath} calls setInterval() at module scope without keeping the handle, so it can never be unref()d. `
        + 'Assign it (`const t = setInterval(...)`) and call `t.unref()`.',
    ).toBe(0);

    for (const name of named) {
      expect(
        new RegExp(`\\b${name}\\.unref\\(\\)`).test(src),
        `${relPath} starts module-load timer \`${name}\` but never calls \`${name}.unref()\` — `
          + 'a ref\'d module-load timer makes every CLI that imports this module hang forever.',
      ).toBe(true);
    }
  });

  // Behavioural proof of the actual bug: importing the module must not, by itself,
  // keep a Node process alive. Only ai-deduplication is spawned — its import graph
  // is just logger + crypto, so the timer is the only thing that could hold the
  // loop. (middleware.ts pulls in server/db/index.ts, which opens the real DB.)
  it('importing server/ai-deduplication.ts lets the process exit on its own', () => {
    const target = path.join(REPO_ROOT, 'server/ai-deduplication.ts');
    // No top-level await: `tsx -e` transforms to CJS, which rejects TLA outright.
    const result = spawnSync('npx', ['tsx', '-e', `import(${JSON.stringify(target)}).then(() => {});`], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
      // NODE_ENV=production makes pino skip its pino-pretty transport worker, so
      // the module's own timer is the only thing that could hold the loop open.
      env: { ...process.env, NODE_ENV: 'production' },
    });

    // spawnSync reports a timeout as error.code === 'ETIMEDOUT' (and signal SIGTERM).
    // Diagnose that case first — it IS the bug, and reporting it as a spawn failure
    // would send the next reader chasing their tsx install instead of the timer.
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
      || result.signal !== null;
    expect(
      timedOut,
      'importing server/ai-deduplication.ts never exited and had to be killed — its module-load '
        + 'cleanup interval is still ref\'d and is holding the event loop open. Call .unref() on it '
        + '(see server/mcp/handles.ts for the reference pattern).',
    ).toBe(false);

    expect(result.error, `failed to spawn tsx: ${result.error?.message}`).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  }, 45_000);
});
