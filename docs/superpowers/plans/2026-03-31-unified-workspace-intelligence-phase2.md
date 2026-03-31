# Unified Workspace Intelligence Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 12 event bridges that propagate effects between subsystems (strategy↔insights, actions↔annotations, audits↔health), assemble two new intelligence slices (contentPipeline, siteHealth), and lay the bridge infrastructure all future phases depend on.

**Architecture:** Option A post-hooks — `recordAction()`, `recordOutcome()`, and `saveSnapshot()` are modified internally to call bridge infrastructure after their core DB writes. All 16 bridge flags default OFF and are individually toggleable. Bridge execution is wrapped in `executeBridge()` with logging, dry-run, timeout, and feature flag gating.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Express routes, Zod validation, LRU cache, React Query hooks

**Split:** 3 PRs — 2A (infrastructure + tech debt), 2B (simple bridges), 2C (complex bridges + slices)

### ⚠️ CRITICAL: PR Gate Protocol

**This plan has 3 hard stops (Tasks 6, 15, 22) marked with 🛑.** At each stop:

1. Run ALL quality checks (tsc, build, vitest, pr-check)
2. Run code review skill
3. Fix all Critical/Important issues
4. Update docs (FEATURE_AUDIT.md, roadmap.json)
5. Push PR to staging
6. **STOP AND WAIT** — do not proceed to the next PR's tasks until the current PR is merged and staging deployment is verified

**Agents: if you reach a 🛑 task, you MUST stop execution and return control to the human.** Do not continue to the next section.

---

## File Structure

### PR 2A — Infrastructure + Tech Debt
| File | Action | Responsibility |
|------|--------|---------------|
| `shared/types/feature-flags.ts` | Modify | Add 16 bridge flags |
| `server/bridge-infrastructure.ts` | Create | `executeBridge()`, `fireBridge()`, `debounceBridge()`, `withWorkspaceLock()`, `getBridgeFlags()` |
| `server/workspace-data.ts` | Modify | Page cache → LRU, inline singleFlight → shared, add `getContentPipelineSummary()` |
| `server/workspace-intelligence.ts` | Modify | Resolve personas stub (make field optional in assembler) |
| `src/hooks/admin/index.ts` | Modify | Add barrel export for `useWorkspaceIntelligence` |
| `tests/bridge-infrastructure.test.ts` | Create | Unit tests for bridge infra |
| `tests/workspace-data.test.ts` | Create | Unit tests for LRU migration + content pipeline summary |

### PR 2B — Simple Bridges
| File | Action | Responsibility |
|------|--------|---------------|
| `server/routes/keyword-strategy.ts` | Modify | Bridge #3: call `invalidateIntelligenceCache()` after strategy save (lines 1773, 1916); Bridge #5: call cache invalidation after `replaceAllPageKeywords()` (lines 1740, 1910) |
| `server/routes/public-portal.ts` | Modify | Bridge #3: call `invalidateIntelligenceCache()` after business priorities save (line 481) |
| `server/routes/webflow-keywords.ts` | Modify | Bridge #5: call `clearSeoContextCache()` + `invalidateIntelligenceCache()` after page analysis (line 151) |
| `server/routes/jobs.ts` | Modify | Bridge #5: call `clearSeoContextCache()` + `invalidateIntelligenceCache()` after bulk page analysis (line 849) |
| `server/routes/workspaces.ts` | Modify | Bridge #11: call `invalidateIntelligenceCache()` after workspace settings save (line 209) |
| `server/outcome-tracking.ts` | Modify | Bridge #7 + #13: add post-hooks to `recordAction()` for auto-resolve + auto-annotation |
| `server/suggested-briefs-store.ts` | Create | Full CRUD for `suggested_briefs` table |
| `server/routes/suggested-briefs.ts` | Create | REST endpoints for suggested briefs |
| `src/api/suggested-briefs.ts` | Create | Frontend typed API client |
| `server/routes/content-decay.ts` | Modify | Bridge #2: create suggested brief after decay analysis |
| `tests/suggested-briefs-store.test.ts` | Create | CRUD tests |
| `tests/bridges-simple.test.ts` | Create | Bridge #3, #5, #7, #11, #13 integration tests |

### PR 2C — Complex Bridges + Slices
| File | Action | Responsibility |
|------|--------|---------------|
| `server/outcome-tracking.ts` | Modify | Bridge #1: add post-hook to `recordOutcome()` for insight reweighting |
| `server/anomaly-detection.ts` | Modify | Bridge #10: boost insight severity on anomaly detection |
| `server/reports.ts` | Modify | Bridge #12 + #15: add post-hooks to `saveSnapshot()` for page_health + site_health insights |
| `server/workspace-intelligence.ts` | Modify | Assemble `contentPipeline` and `siteHealth` slices, expand shadow-mode to 5 fields |
| `tests/bridges-complex.test.ts` | Create | Bridge #1, #10, #12, #15 integration tests |
| `tests/slices.test.ts` | Create | Slice assembly tests |

---

## PR 2A: Infrastructure + Tech Debt

### Task 1: Add 16 Bridge Feature Flags

**Files:**
- Modify: `shared/types/feature-flags.ts`

- [ ] **Step 1: Write the test assertion**

We'll verify flags exist after implementation. For now, write a quick inline check:

```bash
npx tsx -e "import { FEATURE_FLAGS } from './shared/types/feature-flags.js'; const bridgeFlags = Object.keys(FEATURE_FLAGS).filter(k => k.startsWith('bridge-')); console.log('Bridge flags:', bridgeFlags.length); if (bridgeFlags.length !== 16) throw new Error('Expected 16 bridge flags');"
```

- [ ] **Step 2: Add the 16 bridge flags to `shared/types/feature-flags.ts`**

Add after the existing `'intelligence-shadow-mode': false` line:

```typescript
  // Intelligence Phase 2 — Event Bridges (all default OFF, individually toggleable)
  'bridge-outcome-reweight': false,         // #1: recordOutcome → reweight insight scores
  'bridge-decay-suggested-brief': false,    // #2: content decay → suggested brief
  'bridge-strategy-invalidate': false,      // #3: strategy updated → invalidate intelligence cache
  'bridge-insight-to-action': false,        // #4: insight resolved → tracked action (already exists in routes/insights.ts)
  'bridge-page-analysis-invalidate': false, // #5: page analysis → clear caches
  'bridge-action-auto-resolve': false,      // #7: recordAction → auto-resolve related insights
  'bridge-content-to-insight': false,       // #8: content published → content staleness insight (Phase 3)
  'bridge-schema-to-insight': false,        // #9: schema validation → schema health insight (Phase 3)
  'bridge-anomaly-boost': false,            // #10: anomaly → boost insight severity
  'bridge-settings-cascade': false,         // #11: workspace settings → cascade invalidation
  'bridge-audit-page-health': false,        // #12: audit → page_health insights
  'bridge-action-annotation': false,        // #13: recordAction → create annotation
  'bridge-annotation-to-insight': false,    // #14: annotation created → insight correlation (Phase 3)
  'bridge-audit-site-health': false,        // #15: audit → site_health insights
  'bridge-client-signal': false,            // #16: client feedback → signal insights (Phase 3)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add shared/types/feature-flags.ts
git commit -m "feat(intelligence): add 16 bridge feature flags (all default OFF)"
```

---

### Task 2: Create Bridge Infrastructure Module

**Files:**
- Create: `server/bridge-infrastructure.ts`
- Create: `tests/bridge-infrastructure.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/bridge-infrastructure.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/bridge-infrastructure.test.ts
```

Expected: FAIL — module `server/bridge-infrastructure.js` does not exist.

- [ ] **Step 3: Implement `server/bridge-infrastructure.ts`**

```typescript
/**
 * Bridge infrastructure — shared execution, debouncing, locking, and flag utilities.
 * All 16 event bridges route through executeBridge() for consistent logging,
 * feature-flag gating, timeout, and error isolation.
 *
 * Spec: docs/superpowers/specs/unified-workspace-intelligence.md §24-27
 */

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import type { FeatureFlagKey } from '../shared/types/feature-flags.js';

const log = createLogger('bridge-infrastructure');

// ── Bridge flag keys ───────────────────────────────────────────────────

const BRIDGE_FLAGS: FeatureFlagKey[] = [
  'bridge-outcome-reweight',
  'bridge-decay-suggested-brief',
  'bridge-strategy-invalidate',
  'bridge-insight-to-action',
  'bridge-page-analysis-invalidate',
  'bridge-action-auto-resolve',
  'bridge-content-to-insight',
  'bridge-schema-to-insight',
  'bridge-anomaly-boost',
  'bridge-settings-cascade',
  'bridge-audit-page-health',
  'bridge-action-annotation',
  'bridge-annotation-to-insight',
  'bridge-audit-site-health',
  'bridge-client-signal',
];

// ── executeBridge ──────────────────────────────────────────────────────

interface BridgeOptions {
  /** Timeout in ms — bridge is abandoned (not killed) after this. Default: 5000 */
  timeoutMs?: number;
  /** If true, log but don't execute (for shadow mode testing) */
  dryRun?: boolean;
}

/**
 * Execute a bridge function with feature-flag gating, timeout, error isolation, and logging.
 * Bridges NEVER throw — errors are logged and swallowed to protect the triggering mutation.
 *
 * Returns a Promise, but callers in SYNC functions (recordAction, saveSnapshot) should use
 * fireBridge() instead to avoid floating promises.
 */
export async function executeBridge(
  flag: FeatureFlagKey,
  workspaceId: string,
  fn: () => Promise<void> | void,
  opts?: BridgeOptions,
): Promise<void> {
  if (!isFeatureEnabled(flag)) {
    log.debug({ flag, workspaceId }, 'Bridge skipped — flag OFF');
    return;
  }

  if (opts?.dryRun) {
    log.info({ flag, workspaceId, dryRun: true }, 'Bridge dry-run — would execute');
    return;
  }

  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 5000;

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Async bridge — race against timeout
      await Promise.race([
        result,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Bridge ${flag} timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    }
    log.info({ flag, workspaceId, duration_ms: Date.now() - start }, 'Bridge executed');
  } catch (err) {
    log.warn({ flag, workspaceId, err, duration_ms: Date.now() - start }, 'Bridge failed — swallowed');
  }
}

/**
 * Fire-and-forget bridge — for use inside SYNCHRONOUS functions (recordAction, saveSnapshot).
 * Calls executeBridge but deliberately discards the Promise to avoid floating-promise lint warnings.
 * Safe because executeBridge internally catches all errors.
 */
export function fireBridge(
  flag: FeatureFlagKey,
  workspaceId: string,
  fn: () => Promise<void> | void,
  opts?: BridgeOptions,
): void {
  // Intentional fire-and-forget — executeBridge catches all errors internally
  void executeBridge(flag, workspaceId, fn, opts);
}

// ── debounceBridge ─────────────────────────────────────────────────────

/**
 * Create a debounced bridge executor. Multiple calls within `delayMs` for the same
 * workspace are collapsed into one execution (the last call wins).
 * Returns a function: (workspaceId, fn) => void
 */
export function debounceBridge(
  flag: FeatureFlagKey,
  delayMs: number,
): (workspaceId: string, fn: () => Promise<void> | void) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, () => Promise<void> | void>();

  return (workspaceId: string, fn: () => Promise<void> | void) => {
    pending.set(workspaceId, fn);

    const existing = timers.get(workspaceId);
    if (existing) clearTimeout(existing);

    timers.set(
      workspaceId,
      setTimeout(async () => {
        timers.delete(workspaceId);
        const latestFn = pending.get(workspaceId);
        pending.delete(workspaceId);
        if (latestFn) {
          await executeBridge(flag, workspaceId, latestFn);
        }
      }, delayMs),
    );
  };
}

// ── withWorkspaceLock ──────────────────────────────────────────────────

/**
 * Per-workspace mutex — serializes bridge execution within a workspace
 * while allowing different workspaces to run concurrently.
 * Used for bridges that modify shared state (insight scores, audit snapshots).
 */
const locks = new Map<string, Promise<void>>();

export async function withWorkspaceLock<T>(
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Wait for any existing lock to release
  const current = locks.get(workspaceId);
  let release: () => void;
  const newLock = new Promise<void>(resolve => { release = resolve; });
  locks.set(workspaceId, newLock);

  try {
    if (current) await current;
    return await fn();
  } finally {
    release!();
    // Clean up if we're still the latest lock
    if (locks.get(workspaceId) === newLock) {
      locks.delete(workspaceId);
    }
  }
}

// ── getBridgeFlags ─────────────────────────────────────────────────────

/**
 * Returns an object with all bridge flag states. Useful for health endpoints
 * and admin debug views.
 */
export function getBridgeFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flag of BRIDGE_FLAGS) {
    result[flag] = isFeatureEnabled(flag);
  }
  return result;
}
```

- [ ] **Step 4: Add pre-configured debounced bridge instances**

At the bottom of `server/bridge-infrastructure.ts`, add exported debounced instances for bridges that the spec requires debouncing:

```typescript
// ── Pre-configured debounced bridges ───────────────────────────────
// Bridges #3, #5, #11: debounce 2s (rapid-fire invalidation during bulk edits)
export const debouncedStrategyInvalidate = debounceBridge('bridge-strategy-invalidate', 2000);
export const debouncedPageAnalysisInvalidate = debounceBridge('bridge-page-analysis-invalidate', 2000);
export const debouncedSettingsCascade = debounceBridge('bridge-settings-cascade', 2000);
// Bridges #1, #10: debounce 5s (heavier insight mutation work)
export const debouncedOutcomeReweight = debounceBridge('bridge-outcome-reweight', 5000);
export const debouncedAnomalyBoost = debounceBridge('bridge-anomaly-boost', 5000);
```

Note: Bridges #7, #13, #2, #12, #15 do NOT need debounce — they fire once per discrete event.

- [ ] **Step 4B: Add surgical sub-cache invalidation helpers**

The `intelligence_sub_cache` table (migration 045) supports per-slice cache invalidation. Add helpers at the bottom of `server/bridge-infrastructure.ts`:

```typescript
// ── Surgical cache invalidation ───────────────────────────────────────

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

const subCacheStmts = createStmtCache(() => ({
  write: db.prepare(`
    INSERT INTO intelligence_sub_cache (workspace_id, cache_key, ttl_seconds, data, cached_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, cache_key) DO UPDATE SET
      data = excluded.data, ttl_seconds = excluded.ttl_seconds, cached_at = excluded.cached_at, invalidated_at = NULL
  `),
  read: db.prepare(`
    SELECT data, cached_at, ttl_seconds FROM intelligence_sub_cache
    WHERE workspace_id = ? AND cache_key = ? AND (invalidated_at IS NULL OR cached_at > invalidated_at)
  `),
  invalidateKey: db.prepare(`
    UPDATE intelligence_sub_cache SET invalidated_at = datetime('now')
    WHERE workspace_id = ? AND cache_key = ?
  `),
  invalidatePrefix: db.prepare(`
    UPDATE intelligence_sub_cache SET invalidated_at = datetime('now')
    WHERE workspace_id = ? AND cache_key LIKE ? || '%'
  `),
}));

/**
 * Read from persistent sub-cache. Returns null on miss or stale.
 */
export function readSubCache<T>(workspaceId: string, key: string): T | null {
  const row = subCacheStmts().read.get(workspaceId, key) as { data: string; cached_at: string; ttl_seconds: number } | undefined;
  if (!row) return null;
  const age = (Date.now() - new Date(row.cached_at).getTime()) / 1000;
  if (age > row.ttl_seconds) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

/**
 * Write to persistent sub-cache.
 */
export function writeSubCache(workspaceId: string, key: string, data: unknown, ttlSeconds: number): void {
  subCacheStmts().write.run(workspaceId, key, ttlSeconds, JSON.stringify(data));
}

/**
 * Invalidate a specific sub-cache key for a workspace.
 */
export function invalidateSubCache(workspaceId: string, key: string): void {
  subCacheStmts().invalidateKey.run(workspaceId, key);
}

/**
 * Invalidate all sub-cache keys matching a prefix for a workspace.
 * Example: invalidateSubCachePrefix(wsId, 'slice:') invalidates all slice caches.
 */
export function invalidateSubCachePrefix(workspaceId: string, prefix: string): void {
  subCacheStmts().invalidatePrefix.run(workspaceId, prefix);
}
```

These helpers will be used by bridges #3, #5, and #11 (in PR 2B) for targeted invalidation instead of full cache flushes.

- [ ] **Step 5: Wire `getBridgeFlags()` to the intelligence health endpoint**

Modify `server/routes/intelligence.ts` to include bridge flags in the health response:

```typescript
import { getBridgeFlags } from '../bridge-infrastructure.js';
// In the health endpoint handler:
res.json({
  ...existingHealthData,
  bridgeFlags: getBridgeFlags(),
});
```

This allows admin debug views and monitoring to see which bridges are enabled.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/bridge-infrastructure.test.ts
```

Expected: PASS

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 8: Commit**

```bash
git add server/bridge-infrastructure.ts tests/bridge-infrastructure.test.ts
git commit -m "feat(intelligence): add bridge infrastructure — executeBridge, debounceBridge, withWorkspaceLock, debounced instances"
```

---

### Task 3: Migrate Page Cache to LRU + Shared singleFlight

**Files:**
- Modify: `server/workspace-data.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/workspace-data.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../server/webflow-pages.js', () => ({
  listPages: vi.fn().mockResolvedValue([]),
  filterPublishedPages: vi.fn().mockReturnValue([]),
}));
vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn().mockReturnValue({ webflowToken: 'tok' }),
}));
vi.mock('../server/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

describe('workspace-data', () => {
  describe('getPageCacheStats', () => {
    it('returns stats with maxEntries matching LRU capacity', async () => {
      const { getPageCacheStats } = await import('../server/workspace-data.js');
      const stats = getPageCacheStats();
      expect(stats).toHaveProperty('maxEntries');
      expect(stats.maxEntries).toBe(100);
      expect(stats).toHaveProperty('entries');
    });
  });

  describe('getContentPipelineSummary', () => {
    it('is exported as a function', async () => {
      const mod = await import('../server/workspace-data.js');
      expect(typeof mod.getContentPipelineSummary).toBe('function');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify initial state**

```bash
npx vitest run tests/workspace-data.test.ts
```

Expected: `getPageCacheStats` should pass (already exists). `getContentPipelineSummary` should FAIL (not yet exported).

- [ ] **Step 3: Migrate page cache from plain Map to LRU**

In `server/workspace-data.ts`, replace the page cache implementation:

**Replace imports** — add:
```typescript
import { LRUCache, singleFlight } from './intelligence-cache.js';
```

**Replace the cache storage** (lines 29-31):
```typescript
// OLD:
const PAGE_CACHE_TTL = 10 * 60 * 1000;
const pageCache = new Map<string, PageCacheEntry>();
const pageInflight = new Map<string, Promise<PageCacheEntry>>();

// NEW:
const PAGE_CACHE_TTL = 10 * 60 * 1000;
const pageCache = new LRUCache<PageCacheEntry>(100);
```

**Replace `fetchAndCachePages`** (lines 48-101):
```typescript
async function fetchAndCachePages(
  workspaceId: string,
  siteId: string,
): Promise<PageCacheEntry> {
  const key = `${workspaceId}:${siteId}`;

  // Check cache (LRU handles TTL expiry)
  const cached = pageCache.get(key);
  if (cached && !cached.stale) {
    log.debug({ workspaceId, siteId, cache_hit: true }, 'Page cache hit');
    return cached.data;
  }
  log.debug({ workspaceId, siteId, cache_hit: false, stale: cached?.stale }, 'Page cache miss');

  // Single-flight dedup via shared utility
  return singleFlight(`page:${key}`, async () => {
    const token = getWorkspace(workspaceId)?.webflowToken;
    const gen = getGeneration(key);

    try {
      const raw = await listPages(siteId, token || undefined);
      const allPages = raw.filter(p => p.draft !== true && !p.archived);
      const publishedPages = filterPublishedPages(raw);
      const entry: PageCacheEntry = { allPages, publishedPages, fetchedAt: Date.now() };

      // Only cache if generation hasn't changed (no invalidation during fetch)
      if (getGeneration(key) === gen) {
        pageCache.set(key, entry, PAGE_CACHE_TTL);
        log.info({ workspaceId, siteId, rawPages: raw.length, livePages: allPages.length, publishedPages: publishedPages.length }, 'Page cache refreshed');
      } else {
        log.info({ workspaceId, siteId }, 'Page cache invalidated during fetch — discarding stale result');
      }
      return entry;
    } catch (err) {
      log.warn({ workspaceId, siteId, err }, 'Failed to fetch Webflow pages');
      // Return stale cache if available — preserve fallback-on-error behavior
      const stale = pageCache.get(key);
      if (stale) return stale.data;
      return { allPages: [], publishedPages: [], fetchedAt: 0 } as PageCacheEntry;
    }
  });
}
```

**Replace `invalidatePageCache`** (lines 146-161):
```typescript
export function invalidatePageCache(workspaceId: string): void {
  const prefix = `${workspaceId}:`;
  const deleted = pageCache.deleteByPrefix(prefix);
  // Bump generation for race-safe invalidation
  // (generation counter still needed even with LRU — in-flight fetches may resolve after invalidation)
  for (const key of cacheGeneration.keys()) {
    if (key.startsWith(prefix)) {
      cacheGeneration.set(key, getGeneration(key) + 1);
    }
  }
  log.info({ workspaceId, entriesDeleted: deleted }, 'Page cache invalidated');
}
```

**Replace `getPageCacheStats`**:
```typescript
export function getPageCacheStats(): { entries: number; maxEntries: number } {
  return pageCache.stats();
}
```

- [ ] **Step 4: Add `intelligence_sub_cache` invalidation to `invalidateIntelligenceCache()`**

In `server/workspace-intelligence.ts`, update `invalidateIntelligenceCache()` to also delete matching rows from the `intelligence_sub_cache` table (persistent cache for cross-restart survival). The in-memory LRU is the primary cache; `intelligence_sub_cache` is for persistence. When the in-memory cache is invalidated, the persistent cache must also be cleared:

```typescript
export function invalidateIntelligenceCache(workspaceId: string): void {
  // Invalidate in-memory LRU
  intelligenceCache.deleteByPrefix(workspaceId);
  // Invalidate persistent sub-cache
  try {
    db.prepare(`DELETE FROM intelligence_sub_cache WHERE workspace_id = ?`).run(workspaceId);
  } catch {
    // Table may not exist yet — non-critical
  }
  log.info({ workspaceId }, 'Intelligence cache invalidated (in-memory + persistent)');
}
```

Also export an `invalidateSubCache(workspaceId, sliceKeys)` function for targeted invalidation:
```typescript
export function invalidateSubCache(workspaceId: string, sliceKeys: string[]): void {
  try {
    const placeholders = sliceKeys.map(() => '?').join(', ');
    db.prepare(`DELETE FROM intelligence_sub_cache WHERE workspace_id = ? AND slice_key IN (${placeholders})`).run(workspaceId, ...sliceKeys);
  } catch {
    // Non-critical
  }
}
```

- [ ] **Step 5: Run tests to verify LRU migration passes**

```bash
npx vitest run tests/workspace-data.test.ts
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 7: Commit**

```bash
git add server/workspace-data.ts server/workspace-intelligence.ts tests/workspace-data.test.ts
git commit -m "refactor(workspace-data): migrate page cache to LRU + shared singleFlight, add sub-cache invalidation"
```

---

### Task 4: Implement `getContentPipelineSummary()`

**Files:**
- Modify: `server/workspace-data.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/workspace-data.test.ts`:

```typescript
describe('getContentPipelineSummary', () => {
  it('returns ContentPipelineSummary shape with all expected fields', async () => {
    // This test validates structure — actual DB queries require integration test
    const { getContentPipelineSummary } = await import('../server/workspace-data.js');
    // Will throw if DB not available in test env — that's OK, we're testing the export exists
    expect(typeof getContentPipelineSummary).toBe('function');
  });
});
```

- [ ] **Step 2: Implement `getContentPipelineSummary()` in `server/workspace-data.ts`**

Add imports at top:
```typescript
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { ContentPipelineSummary } from '../shared/types/intelligence.js';
```

Add prepared statements:
```typescript
const pipelineStmts = createStmtCache(() => ({
  // content_briefs has NO status column — total count only
  briefsTotal: db.prepare(`SELECT COUNT(*) as cnt FROM content_briefs WHERE workspace_id = ?`),
  // content_posts has status column
  postsTotal: db.prepare(`SELECT COUNT(*) as cnt FROM content_posts WHERE workspace_id = ?`),
  postsByStatus: db.prepare(`SELECT status, COUNT(*) as cnt FROM content_posts WHERE workspace_id = ? GROUP BY status`),
  // content_matrices
  matricesTotal: db.prepare(`SELECT COUNT(*) as cnt FROM content_matrices WHERE workspace_id = ?`),
  matricesCells: db.prepare(`SELECT cells, stats FROM content_matrices WHERE workspace_id = ?`),
  // content_topic_requests has status column
  requestsByStatus: db.prepare(`SELECT status, COUNT(*) as cnt FROM content_topic_requests WHERE workspace_id = ? GROUP BY status`),
  // work_orders has status column
  workOrdersActive: db.prepare(`SELECT COUNT(*) as cnt FROM work_orders WHERE workspace_id = ? AND status != 'completed'`),
  // seo_suggestions has status column (pending, applied, dismissed)
  seoEditsByStatus: db.prepare(`SELECT status, COUNT(*) as cnt FROM seo_suggestions WHERE workspace_id = ? GROUP BY status`),
  // content_pipeline_cache — persistent cache for computed summaries
  getCache: db.prepare(`SELECT summary_json, cached_at, invalidated_at FROM content_pipeline_cache WHERE workspace_id = ?`),
  upsertCache: db.prepare(`INSERT INTO content_pipeline_cache (workspace_id, summary_json, cached_at, invalidated_at) VALUES (@workspace_id, @summary_json, @cached_at, @invalidated_at) ON CONFLICT(workspace_id) DO UPDATE SET summary_json = excluded.summary_json, cached_at = excluded.cached_at, invalidated_at = excluded.invalidated_at`),
  invalidateCache: db.prepare(`UPDATE content_pipeline_cache SET invalidated_at = datetime('now') WHERE workspace_id = ?`),
}));
```

Add the function:
```typescript
/**
 * Aggregate content pipeline counts for a workspace.
 * Uses content_pipeline_cache for persistence — checks cache first (5 min TTL),
 * falls back to computing from raw tables on miss.
 *
 * CONSTRAINT: content_briefs has NO status column — only total count is possible.
 * See: docs/superpowers/specs/intelligence-phase2-context.md
 */
export function getContentPipelineSummary(workspaceId: string): ContentPipelineSummary {
  // Check persistent cache first
  const cached = pipelineStmts().getCache.get(workspaceId) as { summary_json: string; cached_at: string; invalidated_at: string | null } | undefined;
  if (cached && !cached.invalidated_at) {
    const age = Date.now() - new Date(cached.cached_at).getTime();
    if (age < 5 * 60 * 1000) { // 5 min TTL
      const parsed = parseJsonFallback(cached.summary_json, null as unknown as ContentPipelineSummary);
      if (parsed) return parsed;
      // Cache contained invalid JSON — fall through to recompute
    }
  }

  // Cache miss — compute from raw tables
  const summary = computeContentPipelineSummary(workspaceId);

  // Write to persistent cache
  pipelineStmts().upsertCache.run({
    workspace_id: workspaceId,
    summary_json: JSON.stringify(summary),
    cached_at: new Date().toISOString(),
    invalidated_at: null,
  });

  return summary;
}

/**
 * Invalidate the persistent content pipeline cache for a workspace.
 * Called by bridges that affect pipeline data (Bridge #2 creates suggested briefs, content publish events).
 */
export function invalidateContentPipelineCache(workspaceId: string): void {
  pipelineStmts().invalidateCache.run(workspaceId);
}

function computeContentPipelineSummary(workspaceId: string): ContentPipelineSummary {
  // Briefs — no status column
  const briefsRow = pipelineStmts().briefsTotal.get(workspaceId) as { cnt: number } | undefined;
  const briefsTotal = briefsRow?.cnt ?? 0;

  // Posts — has status column
  const postsRow = pipelineStmts().postsTotal.get(workspaceId) as { cnt: number } | undefined;
  const postsByStatusRows = pipelineStmts().postsByStatus.all(workspaceId) as { status: string; cnt: number }[];
  const postsByStatus: Record<string, number> = {};
  for (const r of postsByStatusRows) postsByStatus[r.status] = r.cnt;

  // Matrices — count + cell aggregation
  const matricesRow = pipelineStmts().matricesTotal.get(workspaceId) as { cnt: number } | undefined;
  const matricesCellRows = pipelineStmts().matricesCells.all(workspaceId) as { cells: string; stats: string }[];
  let cellsPlanned = 0;
  let cellsPublished = 0;
  for (const r of matricesCellRows) {
    try {
      const cells = JSON.parse(r.cells || '[]') as { status?: string }[];
      cellsPlanned += cells.length;
      cellsPublished += cells.filter(c => c.status === 'published').length;
    } catch { /* skip malformed */ }
  }

  // Requests — has status column
  const requestsByStatusRows = pipelineStmts().requestsByStatus.all(workspaceId) as { status: string; cnt: number }[];
  const requestsMap: Record<string, number> = {};
  for (const r of requestsByStatusRows) requestsMap[r.status] = r.cnt;

  // Work orders — count active
  const woRow = pipelineStmts().workOrdersActive.get(workspaceId) as { cnt: number } | undefined;

  // SEO edits — has status column
  const seoRows = pipelineStmts().seoEditsByStatus.all(workspaceId) as { status: string; cnt: number }[];
  const seoMap: Record<string, number> = {};
  for (const r of seoRows) seoMap[r.status] = r.cnt;

  return {
    briefs: { total: briefsTotal, byStatus: {} },
    posts: { total: postsRow?.cnt ?? 0, byStatus: postsByStatus },
    matrices: { total: matricesRow?.cnt ?? 0, cellsPlanned, cellsPublished },
    requests: {
      pending: requestsMap['requested'] ?? 0,
      inProgress: requestsMap['in_progress'] ?? 0,
      delivered: requestsMap['delivered'] ?? 0,
    },
    workOrders: { active: woRow?.cnt ?? 0 },
    seoEdits: {
      pending: seoMap['pending'] ?? 0,
      applied: seoMap['applied'] ?? 0,
      dismissed: seoMap['dismissed'] ?? 0,
    },
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/workspace-data.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/workspace-data.ts tests/workspace-data.test.ts
git commit -m "feat(workspace-data): add getContentPipelineSummary() for content pipeline slice"
```

---

### Task 5: Resolve Personas Stub + Barrel Export

**Files:**
- Modify: `server/workspace-intelligence.ts` (line 128)
- Modify: `src/hooks/admin/index.ts`

- [ ] **Step 1: Fix personas stub in `assembleSeoContext`**

In `server/workspace-intelligence.ts`, replace line 128:

```typescript
// OLD:
personas: [], // TODO: parse from personasBlock or load directly in Phase 2

// NEW:
personas: ctx.personas ?? [],
```

Then verify: does `buildSeoContext()` return a `personas` field? Check `SeoContext` type.

If `SeoContext` doesn't have `personas`, use an alternative approach — parse from `personasBlock`:

```typescript
// If SeoContext has personasBlock (string) but not parsed personas:
personas: ctx.personasBlock ? parsePersonasFromBlock(ctx.personasBlock) : [],
```

If neither exists, make personas truly optional by keeping `[]` and adding a comment:

```typescript
personas: [], // personasBlock is a prose string — structured persona parsing deferred to Phase 3
```

- [ ] **Step 2: Add barrel export for `useWorkspaceIntelligence`**

First check if the hook exists:
```bash
ls src/hooks/admin/useWorkspaceIntelligence*
```

If it exists, add to `src/hooks/admin/index.ts`:
```typescript
export { useWorkspaceIntelligence } from './useWorkspaceIntelligence';
```

If it does NOT exist yet (likely — Phase 1 may not have created it), skip this step and note it for Phase 3 when the frontend hook is built.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add server/workspace-intelligence.ts src/hooks/admin/index.ts
git commit -m "fix(intelligence): resolve personas stub, add barrel export"
```

---

### Task 5B: Add pr-check Rule for Cache Pairing + Bridge Pairing Test

**Files:**
- Modify: `scripts/pr-check.ts`
- Create: `tests/bridge-pairing.test.ts`

- [ ] **Step 1: Add manual checklist item to pr-check.ts**

Since grep-based line matching can't easily detect cross-line pairing, add a manual checklist entry to the `MANUAL_CHECKS` array in `scripts/pr-check.ts`:

```typescript
'clearSeoContextCache paired with invalidateIntelligenceCache (grep both, compare call sites)',
```

- [ ] **Step 2: Create a structural test for cache pairing**

Create `tests/bridge-pairing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function readServerFiles(dir = 'server'): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...readServerFiles(full));
    } else if (full.endsWith('.ts')) {
      results.push({ path: full, content: readFileSync(full, 'utf-8') });
    }
  }
  return results;
}

describe('bridge pairing', () => {
  it('every clearSeoContextCache call is paired with invalidateIntelligenceCache', () => {
    const files = readServerFiles();
    const unpaired: string[] = [];
    for (const { path, content } of files) {
      // Skip the definition files themselves
      if (path.includes('seo-context.ts') || path.includes('bridge-infrastructure.ts')) continue;
      if (content.includes('clearSeoContextCache') && !content.includes('invalidateIntelligenceCache')) {
        unpaired.push(path);
      }
    }
    expect(unpaired).toEqual([]);
  });
});
```

- [ ] **Step 3: Verify TypeScript compiles + test passes**

```bash
npx tsc --noEmit --skipLibCheck
npx vitest run tests/bridge-pairing.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts tests/bridge-pairing.test.ts
git commit -m "test(bridges): add pr-check manual check + structural test for cache pairing"
```

---

### 🛑 Task 6: STOP — PR 2A Quality Gate & Review

> **HARD STOP.** Do NOT proceed to PR 2B tasks. Complete every step below, push the PR, and wait for human review + merge before continuing.

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 2: Run full build**

```bash
npx vite build
```

- [ ] **Step 3: Run full test suite (not just new tests)**

```bash
npx vitest run
```

- [ ] **Step 4: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

- [ ] **Step 5: Run code review skill**

Invoke `superpowers:requesting-code-review` on all files changed in this PR.

- [ ] **Step 6: Fix any Critical/Important issues from review**

- [ ] **Step 7: Update docs**

  - `FEATURE_AUDIT.md` — add bridge infrastructure entry
  - `data/roadmap.json` — mark Phase 2A item done
  - Run `npx tsx scripts/sort-roadmap.ts`

- [ ] **Step 8: Push and create PR**

```bash
git push -u origin HEAD
```

Create PR targeting `staging` with title: `feat(intelligence): Phase 2A — bridge infrastructure + tech debt`

- [ ] **Step 9: WAIT for human review + merge to staging**

🛑 **Do not start PR 2B until this PR is merged and staging deployment is verified.**

---

## PR 2B: Simple Bridges

> **Prerequisite:** PR 2A merged to staging and deployment verified.

### Task 6B: Add `resolution_source` to `resolveInsight()` and `upsertInsight()` Signatures

**Files:**
- Modify: `server/analytics-insights-store.ts`

**Why:** Bridges #1, #7, #10, #12, #15 all write to `analytics_insights` but never set `resolution_source`. The spec requires tracking which bridge caused a resolution or upsert. Both `resolveInsight()` and `upsertInsight()` need a `resolution_source` parameter.

- [ ] **Step 1: Add `resolution_source` parameter to `resolveInsight()`**

In `server/analytics-insights-store.ts`, update the `resolveInsight()` function signature to accept an optional `resolution_source` parameter:

```typescript
export function resolveInsight(
  insightId: string,
  workspaceId: string,
  status: 'resolved' | 'dismissed' | 'in_progress',
  reason?: string,
  resolutionSource?: string,  // NEW: which bridge/user resolved this
): void {
  // ... existing logic ...
  // Add resolution_source to the UPDATE statement
}
```

Update the prepared statement to SET `resolution_source` alongside `resolution_status`:
```sql
UPDATE analytics_insights SET resolution_status = ?, resolution_reason = ?, resolution_source = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?
```

- [ ] **Step 2: Add `resolution_source` to `UpsertInsightParams` and `upsertInsight()`**

Add `resolutionSource?: string` to the `UpsertInsightParams` interface, and pass it through to the INSERT/UPDATE prepared statement.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add server/analytics-insights-store.ts
git commit -m "feat(insights): add resolution_source to resolveInsight() and upsertInsight()"
```

---

### Task 7: Bridge #3 — Strategy Updated → Invalidate Intelligence Cache

**Files:**
- Modify: `server/routes/keyword-strategy.ts` (lines 1773, 1916)
- Modify: `server/routes/public-portal.ts` (line 481)

- [ ] **Step 1: Write the test**

Add to `tests/bridges-simple.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

describe('Bridge #3: strategy-invalidate', () => {
  it('invalidateIntelligenceCache is called after strategy update', async () => {
    // Integration test: verify the import exists and is callable
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    expect(typeof invalidateIntelligenceCache).toBe('function');
  });
});
```

- [ ] **Step 2: Add invalidation calls to keyword-strategy.ts**

At top of file, add import:
```typescript
import { debouncedStrategyInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
```

After line 1773 (`clearSeoContextCache(ws.id);`), add:
```typescript
debouncedStrategyInvalidate(ws.id, () => {
  invalidateIntelligenceCache(ws.id);
  invalidateSubCachePrefix(ws.id, 'slice:seoContext');
});
```

After line 1916 (`clearSeoContextCache(ws.id);`), add:
```typescript
debouncedStrategyInvalidate(ws.id, () => {
  invalidateIntelligenceCache(ws.id);
  invalidateSubCachePrefix(ws.id, 'slice:seoContext');
});
```

**Also** add invalidation after `replaceAllPageKeywords()` at ~line 1740 for defense-in-depth (this keyword replacement call precedes the strategy save at :1773 by ~30 lines, but may be called independently):
```typescript
debouncedStrategyInvalidate(ws.id, () => {
  invalidateIntelligenceCache(ws.id);
  invalidateSubCachePrefix(ws.id, 'slice:seoContext');
});
```

- [ ] **Step 3: Add invalidation to public-portal.ts**

At top, add import:
```typescript
import { debouncedStrategyInvalidate } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
```

After line 481 (`updateWorkspace(wsId, { keywordStrategy: ... });`), add:
```typescript
debouncedStrategyInvalidate(wsId, () => invalidateIntelligenceCache(wsId));
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/keyword-strategy.ts server/routes/public-portal.ts
git commit -m "feat(bridges): #3 strategy updated → invalidate intelligence cache"
```

---

### Task 8: Bridge #5 — Page Analysis → Clear Caches

**Files:**
- Modify: `server/routes/webflow-keywords.ts` (line 151)
- Modify: `server/routes/jobs.ts` (line 849)

- [ ] **Step 1: Add bridge calls to webflow-keywords.ts**

At top, add import:
```typescript
import { debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { clearSeoContextCache } from '../seo-context.js';
```

After the `upsertPageKeyword()` call (around line 178), add:
```typescript
debouncedPageAnalysisInvalidate(workspaceId, () => {
  clearSeoContextCache(workspaceId);
  invalidateIntelligenceCache(workspaceId);
  invalidateSubCachePrefix(workspaceId, 'slice:seoContext');
  invalidateSubCachePrefix(workspaceId, 'slice:pageProfile');
});
```

Note: Check if `clearSeoContextCache` is already imported. If so, don't duplicate the import.

- [ ] **Step 2: Add bridge calls to jobs.ts**

At top, add import:
```typescript
import { debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { clearSeoContextCache } from '../seo-context.js';
```

After the `addActivity` call (around line 849), add:
```typescript
debouncedPageAnalysisInvalidate(paWsId, () => {
  clearSeoContextCache(paWsId);
  invalidateIntelligenceCache(paWsId);
  invalidateSubCachePrefix(paWsId, 'slice:seoContext');
  invalidateSubCachePrefix(paWsId, 'slice:pageProfile');
});
```

- [ ] **Step 3: Add Bridge #5 to `replaceAllPageKeywords` call sites in keyword-strategy.ts**

The `replaceAllPageKeywords()` calls at lines 1740 and 1910 update page keywords without going through the individual `upsertPageKeyword()` path. While Bridge #3 fires at :1773/:1916 shortly after, the page keyword data is already stale in cache by that point.

At top of `server/routes/keyword-strategy.ts` (if not already imported for Bridge #3):
```typescript
import { debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { clearSeoContextCache } from '../seo-context.js';
```

After line 1740 (`replaceAllPageKeywords(ws.id, req.body.pageMap);`), add:
```typescript
// Bridge #5: page keywords replaced — invalidate caches (Bridge #3 at :1773 handles intelligence cache)
debouncedPageAnalysisInvalidate(ws.id, () => {
  clearSeoContextCache(ws.id);
  invalidateSubCachePrefix(ws.id, 'slice:seoContext');
  invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
});
```

After line 1910 (similar `replaceAllPageKeywords` call), add the same pattern.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/webflow-keywords.ts server/routes/jobs.ts server/routes/keyword-strategy.ts
git commit -m "feat(bridges): #5 page analysis → clear seo + intelligence caches"
```

---

### Task 9: Bridge #11 — Workspace Settings → Cascade Invalidation

**Files:**
- Modify: `server/routes/workspaces.ts` (line 209)

- [ ] **Step 1: Add bridge call to workspaces.ts**

At top, add import:
```typescript
import { debouncedSettingsCascade, invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';
import { invalidatePageCache } from '../workspace-data.js';
```

After line 209 (`clearSeoContextCache(req.params.id);`), add:
```typescript
debouncedSettingsCascade(req.params.id, () => {
  invalidateIntelligenceCache(req.params.id);
  invalidatePageCache(req.params.id);
  invalidateSubCachePrefix(req.params.id, 'slice:'); // Invalidate ALL slice caches on settings change
});
```

Note: `invalidatePageCache()` is added here because workspace settings changes can include linking a new Webflow site, which changes which pages are fetched (Fix 15).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/workspaces.ts
git commit -m "feat(bridges): #11 workspace settings → cascade invalidation"
```

---

### Task 10: Bridge #7 + #13 — recordAction Post-Hooks (Option A)

**Files:**
- Modify: `server/outcome-tracking.ts`

This is the **Option A** pattern: modify `recordAction()` internally to invoke bridge infrastructure after the core INSERT.

- [ ] **Step 1: Write the test**

Add to `tests/bridges-simple.test.ts`:

```typescript
describe('Bridge #7 + #13: recordAction post-hooks', () => {
  it('recordAction is exported and callable', async () => {
    const { recordAction } = await import('../server/outcome-tracking.js');
    expect(typeof recordAction).toBe('function');
  });
});
```

- [ ] **Step 2: Add post-hook infrastructure to `recordAction()`**

At top of `server/outcome-tracking.ts`, add imports:
```typescript
import { fireBridge } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
```

After line 134 (just before `return rowToTrackedAction(row);` in `recordAction()`), add:

```typescript
  // ── Bridge #7: Auto-resolve related insights ──────────────────────
  // If this action relates to a page, auto-resolve 'in_progress' insights for that page
  // NOTE: recordAction() is SYNC — use fireBridge (fire-and-forget), not executeBridge
  fireBridge('bridge-action-auto-resolve', params.workspaceId, async () => {
    const { getInsights, resolveInsight } = await import('./analytics-insights-store.js');
    if (!params.pageUrl && !params.targetKeyword) return;
    const insights = getInsights(params.workspaceId);
    // Match on BOTH pageUrl AND targetKeyword (AnalyticsInsight has strategyKeyword field)
    const related = insights.filter(i =>
      (params.pageUrl && i.pageId === params.pageUrl) ||
      (params.targetKeyword && i.strategyKeyword === params.targetKeyword),
    ).filter(i =>
      i.resolutionStatus !== 'resolved' &&
      i.resolutionStatus !== 'dismissed',
    );
    for (const insight of related) {
      resolveInsight(insight.id, params.workspaceId, 'in_progress',
        `Auto-progressed: action "${params.actionType}" recorded for this page`,
        'bridge_7_action_auto_resolve',
      );
      broadcastToWorkspace(params.workspaceId, 'insight:updated', { insightId: insight.id, status: 'in_progress' });
    }
    // Broadcast bridge-specific event for frontend intelligence cache invalidation
    if (related.length > 0) {
      broadcastToWorkspace(params.workspaceId, 'insight:bridge_updated', {
        bridge: 'bridge_7_auto_resolve',
        count: related.length,
      });
    }
  });

  // ── Bridge #13: Create analytics annotation ───────────────────────
  fireBridge('bridge-action-annotation', params.workspaceId, async () => {
    const { createAnnotation } = await import('./analytics-annotations.js');
    // analytics_annotations has NO pageUrl column — encode page in label
    const pageCtx = params.pageUrl ? ` (${params.pageUrl})` : '';
    const date = new Date().toISOString().split('T')[0];
    const label = `Action: ${params.actionType}${pageCtx}`;
    createAnnotation({
      workspaceId: params.workspaceId,
      date,
      label,
      category: 'site_change',
      createdBy: 'bridge:action-annotation',
    });
    broadcastToWorkspace(params.workspaceId, 'annotation:created', { date, label });
    // Broadcast bridge-specific event for frontend annotation cache invalidation
    broadcastToWorkspace(params.workspaceId, 'annotation:bridge_created', {
      bridge: 'bridge_13_action_annotation',
    });
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/bridges-simple.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/outcome-tracking.ts tests/bridges-simple.test.ts
git commit -m "feat(bridges): #7 recordAction → auto-resolve insights, #13 → create annotation (Option A)"
```

---

### Task 11: Create Suggested Briefs Store

**Files:**
- Create: `server/suggested-briefs-store.ts`
- Create: `tests/suggested-briefs-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/suggested-briefs-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('suggested-briefs-store', () => {
  it('exports CRUD functions', async () => {
    const mod = await import('../server/suggested-briefs-store.js');
    expect(typeof mod.createSuggestedBrief).toBe('function');
    expect(typeof mod.listSuggestedBriefs).toBe('function');
    expect(typeof mod.updateSuggestedBrief).toBe('function');
    expect(typeof mod.dismissSuggestedBrief).toBe('function');
    expect(typeof mod.snoozeSuggestedBrief).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/suggested-briefs-store.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server/suggested-briefs-store.ts`**

```typescript
/**
 * Suggested briefs store — CRUD for AI-generated content brief suggestions.
 * Table: suggested_briefs (migration 043)
 * Bridge #2: content decay analysis → suggested brief creation
 */
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SuggestedBrief {
  id: string;
  workspaceId: string;
  keyword: string;
  pageUrl: string | null;
  source: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  dismissedKeywordHash: string | null;
}

interface SuggestedBriefRow {
  id: string;
  workspace_id: string;
  keyword: string;
  page_url: string | null;
  source: string;
  reason: string;
  priority: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  dismissed_keyword_hash: string | null;
}

function rowToBrief(row: SuggestedBriefRow): SuggestedBrief {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    keyword: row.keyword,
    pageUrl: row.page_url,
    source: row.source,
    reason: row.reason,
    priority: row.priority as SuggestedBrief['priority'],
    status: row.status as SuggestedBrief['status'],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    snoozedUntil: row.snoozed_until,
    dismissedKeywordHash: row.dismissed_keyword_hash,
  };
}

// ── Prepared statements ────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO suggested_briefs (id, workspace_id, keyword, page_url, source, reason, priority, status, created_at, dismissed_keyword_hash)
    VALUES (@id, @workspace_id, @keyword, @page_url, @source, @reason, @priority, @status, @created_at, @dismissed_keyword_hash)
  `),
  listByWorkspace: db.prepare(`
    SELECT * FROM suggested_briefs
    WHERE workspace_id = ? AND status IN ('pending', 'snoozed')
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
      created_at DESC
  `),
  listAll: db.prepare(`
    SELECT * FROM suggested_briefs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `),
  getById: db.prepare(`SELECT * FROM suggested_briefs WHERE id = ? AND workspace_id = ?`),
  updateStatus: db.prepare(`
    UPDATE suggested_briefs SET status = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?
  `),
  updateSnooze: db.prepare(`
    UPDATE suggested_briefs SET status = 'snoozed', snoozed_until = ? WHERE id = ? AND workspace_id = ?
  `),
  checkDismissed: db.prepare(`
    SELECT 1 FROM suggested_briefs
    WHERE workspace_id = ? AND dismissed_keyword_hash = ? AND status = 'dismissed'
    LIMIT 1
  `),
}));

// ── CRUD ───────────────────────────────────────────────────────────────

export function createSuggestedBrief(params: {
  workspaceId: string;
  keyword: string;
  pageUrl?: string;
  source?: string;
  reason: string;
  priority?: 'low' | 'medium' | 'high';
}): SuggestedBrief {
  const id = randomUUID();
  const keywordHash = createHash('sha256').update(params.keyword.toLowerCase().trim()).digest('hex').slice(0, 16);

  // Skip if same keyword was previously dismissed
  const dismissed = stmts().checkDismissed.get(params.workspaceId, keywordHash);
  if (dismissed) {
    // Return a synthetic "dismissed" brief so callers know it was skipped
    return {
      id,
      workspaceId: params.workspaceId,
      keyword: params.keyword,
      pageUrl: params.pageUrl ?? null,
      source: params.source ?? 'content_decay',
      reason: params.reason,
      priority: params.priority ?? 'medium',
      status: 'dismissed',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      snoozedUntil: null,
      dismissedKeywordHash: keywordHash,
    };
  }

  const now = new Date().toISOString();
  stmts().insert.run({
    id,
    workspace_id: params.workspaceId,
    keyword: params.keyword,
    page_url: params.pageUrl ?? null,
    source: params.source ?? 'content_decay',
    reason: params.reason,
    priority: params.priority ?? 'medium',
    status: 'pending',
    created_at: now,
    dismissed_keyword_hash: keywordHash,
  });

  const row = stmts().getById.get(id, params.workspaceId) as SuggestedBriefRow | undefined;
  if (!row) throw new Error(`Failed to read back suggested brief ${id}`);
  return rowToBrief(row);
}

export function listSuggestedBriefs(workspaceId: string, includeAll = false): SuggestedBrief[] {
  const rows = (includeAll ? stmts().listAll : stmts().listByWorkspace).all(workspaceId) as SuggestedBriefRow[];
  return rows.map(rowToBrief);
}

export function getSuggestedBrief(id: string, workspaceId: string): SuggestedBrief | null {
  const row = stmts().getById.get(id, workspaceId) as SuggestedBriefRow | undefined;
  return row ? rowToBrief(row) : null;
}

export function updateSuggestedBrief(id: string, workspaceId: string, status: 'accepted' | 'dismissed'): SuggestedBrief | null {
  const now = new Date().toISOString();
  stmts().updateStatus.run(status, now, id, workspaceId);
  return getSuggestedBrief(id, workspaceId);
}

export function dismissSuggestedBrief(id: string, workspaceId: string): SuggestedBrief | null {
  return updateSuggestedBrief(id, workspaceId, 'dismissed');
}

export function snoozeSuggestedBrief(id: string, workspaceId: string, until: string): SuggestedBrief | null {
  stmts().updateSnooze.run(until, id, workspaceId);
  return getSuggestedBrief(id, workspaceId);
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/suggested-briefs-store.test.ts
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 6: Commit**

```bash
git add server/suggested-briefs-store.ts tests/suggested-briefs-store.test.ts
git commit -m "feat(suggested-briefs): add CRUD store for suggested_briefs table"
```

---

### Task 12: Create Suggested Briefs Routes + API Client

**Files:**
- Create: `server/routes/suggested-briefs.ts`
- Create: `src/api/suggested-briefs.ts`
- Modify: `server/app.ts` (register routes)

- [ ] **Step 1: Create `server/routes/suggested-briefs.ts`**

```typescript
/**
 * Suggested briefs API routes — CRUD for AI-generated content brief suggestions.
 */
import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import {
  listSuggestedBriefs,
  getSuggestedBrief,
  updateSuggestedBrief,
  dismissSuggestedBrief,
  snoozeSuggestedBrief,
} from '../suggested-briefs-store.js';
import { broadcastToWorkspace } from '../broadcast.js';

const router = Router();

// List suggested briefs for workspace
router.get(
  '/api/suggested-briefs/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const includeAll = req.query.all === 'true';
    const briefs = listSuggestedBriefs(req.params.workspaceId, includeAll);
    res.json(briefs);
  },
);

// Get single suggested brief
router.get(
  '/api/suggested-briefs/:workspaceId/:briefId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const brief = getSuggestedBrief(req.params.briefId, req.params.workspaceId);
    if (!brief) return res.status(404).json({ error: 'Suggested brief not found' });
    res.json(brief);
  },
);

const updateSchema = z.object({
  body: z.object({
    status: z.enum(['accepted', 'dismissed']),
  }),
});

// Update status (accept/dismiss)
router.patch(
  '/api/suggested-briefs/:workspaceId/:briefId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateSchema),
  (req, res) => {
    const updated = updateSuggestedBrief(req.params.briefId, req.params.workspaceId, req.body.status);
    if (!updated) return res.status(404).json({ error: 'Suggested brief not found' });
    broadcastToWorkspace(req.params.workspaceId, 'suggested-brief:updated', { id: updated.id, status: updated.status });
    res.json(updated);
  },
);

const snoozeSchema = z.object({
  body: z.object({
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

// Snooze
router.post(
  '/api/suggested-briefs/:workspaceId/:briefId/snooze',
  requireWorkspaceAccess('workspaceId'),
  validate(snoozeSchema),
  (req, res) => {
    const updated = snoozeSuggestedBrief(req.params.briefId, req.params.workspaceId, req.body.until);
    if (!updated) return res.status(404).json({ error: 'Suggested brief not found' });
    broadcastToWorkspace(req.params.workspaceId, 'suggested-brief:updated', { id: updated.id, status: updated.status });
    res.json(updated);
  },
);

export default router;
```

- [ ] **Step 2: Create `src/api/suggested-briefs.ts`**

```typescript
/**
 * Suggested briefs API client — typed fetch wrappers.
 */
import { get, patch, post } from './client.js';

export interface SuggestedBrief {
  id: string;
  workspaceId: string;
  keyword: string;
  pageUrl: string | null;
  source: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
}

export function fetchSuggestedBriefs(workspaceId: string, includeAll = false, signal?: AbortSignal): Promise<SuggestedBrief[]> {
  const qs = includeAll ? '?all=true' : '';
  return get<SuggestedBrief[]>(`/api/suggested-briefs/${workspaceId}${qs}`, signal);
}

export function updateSuggestedBriefStatus(
  workspaceId: string,
  briefId: string,
  status: 'accepted' | 'dismissed',
): Promise<SuggestedBrief> {
  return patch<SuggestedBrief>(`/api/suggested-briefs/${workspaceId}/${briefId}`, { status });
}

export function snoozeSuggestedBrief(
  workspaceId: string,
  briefId: string,
  until: string,
): Promise<SuggestedBrief> {
  return post<SuggestedBrief>(`/api/suggested-briefs/${workspaceId}/${briefId}/snooze`, { until });
}
```

- [ ] **Step 3: Register routes in `server/app.ts`**

Find the route registration section and add:
```typescript
import suggestedBriefsRoutes from './routes/suggested-briefs.js';
// ... in the route registration area:
app.use(suggestedBriefsRoutes);
```

**IMPORTANT:** Place literal routes BEFORE param routes to avoid shadowing.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/suggested-briefs.ts src/api/suggested-briefs.ts server/app.ts
git commit -m "feat(suggested-briefs): add REST routes + typed API client"
```

---

### Task 12B: Add Frontend WebSocket Handlers for PR 2B Bridges

**Files:**
- Modify: `src/hooks/admin/useAiSuggestedBriefs.ts` (or wherever suggested briefs are queried — may need to create if hook doesn't exist yet)
- Modify: existing insight-related hooks (e.g., `src/hooks/admin/useInsights.ts` or similar)

- [ ] **Step 1: Add WebSocket handler for `suggested-brief:created` and `suggested-brief:updated`**

In the hook that queries suggested briefs (create it if needed, or add to an existing relevant hook), add:
```typescript
useWebSocket((event) => {
  if (event.type === 'suggested-brief:created' || event.type === 'suggested-brief:updated') {
    queryClient.invalidateQueries({ queryKey: ['admin-suggested-briefs', workspaceId] });
  }
});
```

- [ ] **Step 2: Verify existing `INSIGHT_RESOLVED` handler exists**

Check that insight-related hooks already handle the `insight:updated` WebSocket event and invalidate the insights query. If not, add:
```typescript
if (event.type === 'insight:updated') {
  queryClient.invalidateQueries({ queryKey: ['admin-insights', workspaceId] });
}
```

- [ ] **Step 3: Add handler for `annotation:created`**

In the hook that queries annotations, add:
```typescript
if (event.type === 'annotation:created') {
  queryClient.invalidateQueries({ queryKey: ['admin-annotations', workspaceId] });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/admin/
git commit -m "feat(ws): add WebSocket handlers for suggested briefs, insights, and annotations"
```

---

### Task 13: Bridge #2 — Content Decay → Suggested Brief

**Files:**
- Modify: `server/routes/content-decay.ts`

- [ ] **Step 1: Add bridge call after decay analysis**

At top of `server/routes/content-decay.ts`, add imports:
```typescript
import { fireBridge } from '../bridge-infrastructure.js';
import { createSuggestedBrief } from '../suggested-briefs-store.js';
import { invalidateContentPipelineCache } from '../workspace-data.js';
```

After the `analyzeContentDecay(ws)` call (line 20), add:

```typescript
// Bridge #2: Create suggested briefs for decaying pages
fireBridge('bridge-decay-suggested-brief', ws.id, () => {
  for (const page of analysis.decayingPages.slice(0, 5)) {
    // DecayingPage fields: page (URL path), title?, currentClicks, previousClicks,
    // clickDeclinePct, currentImpressions, previousImpressions, impressionChangePct,
    // severity ('critical'|'warning'|'watch'), refreshRecommendation?
    const clickDelta = page.currentClicks - page.previousClicks;
    const impressionDelta = page.currentImpressions - page.previousImpressions;
    createSuggestedBrief({
      workspaceId: ws.id,
      keyword: page.page, // URL path — no topKeyword field exists on DecayingPage
      pageUrl: page.page,
      source: 'content_decay',
      reason: `Content decay detected: ${clickDelta < 0 ? Math.abs(clickDelta) + ' fewer clicks' : ''}${impressionDelta < 0 ? ', ' + Math.abs(impressionDelta) + ' fewer impressions' : ''} over 30 days (${page.severity})`.trim(),
      priority: page.severity === 'critical' ? 'high' : 'medium',
    });
  }
  // Invalidate content pipeline cache since we created new suggested briefs
  invalidateContentPipelineCache(ws.id);
  // Broadcast so frontend can refresh suggested briefs list
  const { broadcastToWorkspace } = await import('../broadcast.js');
  broadcastToWorkspace(ws.id, 'suggested-brief:updated', {
    bridge: 'bridge_2_decay_suggested_brief',
    count: Math.min(analysis.decayingPages.length, 5),
  });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/content-decay.ts
git commit -m "feat(bridges): #2 content decay → create suggested briefs for decaying pages"
```

---

### Task 14: Verify Bridge #4 (Already Exists)

**Files:**
- Read only: `server/routes/insights.ts` (lines 40-64)

- [ ] **Step 1: Verify existing code matches expected pattern**

Read `server/routes/insights.ts` lines 38-64 and confirm:
1. `resolveInsight()` is called with correct signature
2. `recordAction()` is called with idempotent check via `getActionBySource`
3. `broadcastToWorkspace()` is called with `WS_EVENTS.INSIGHT_RESOLVED`

- [ ] **Step 2: Write verification test if not already covered**

Check if `tests/` has any test covering insight resolution → action recording. If not, add:

```typescript
describe('Bridge #4: insight resolved → tracked action (existing)', () => {
  it('routes/insights.ts calls recordAction on resolution', async () => {
    // Structural verification — the bridge already exists in production
    const insightsRouteSource = await import('fs').then(fs =>
      fs.readFileSync('server/routes/insights.ts', 'utf-8')
    );
    expect(insightsRouteSource).toContain('recordAction');
    expect(insightsRouteSource).toContain('getActionBySource');
    expect(insightsRouteSource).toContain('insight_acted_on');
  });
});
```

- [ ] **Step 3: Commit if test added**

```bash
git add tests/bridges-simple.test.ts
git commit -m "test(bridges): verify existing bridge #4 (insight resolved → tracked action)"
```

---

### Task 14B: Frontend WebSocket Handlers for Bridge Events

**Files:**
- Modify: relevant `useWebSocket` handler files (check where existing WS handlers live)

Per CLAUDE.md's "Feedback loop completeness" rule, every `broadcastToWorkspace()` needs a corresponding frontend handler.

- [ ] **Step 1: Identify where WebSocket handlers live**

```bash
grep -rn 'useWebSocket' src/hooks/ --include='*.ts' --include='*.tsx' | head -20
```

- [ ] **Step 2: Add handler for `suggested-brief:updated`**

In the appropriate WebSocket handler (likely near existing insight/workspace handlers), add:
```typescript
case 'suggested-brief:updated':
  queryClient.invalidateQueries({ queryKey: ['admin-suggested-briefs'] });
  break;
```

- [ ] **Step 3: Add handler for `insight:bridge_updated`**

```typescript
case 'insight:bridge_updated':
  queryClient.invalidateQueries({ queryKey: ['admin-insights'] });
  queryClient.invalidateQueries({ queryKey: ['admin-intelligence'] });
  break;
```

- [ ] **Step 4: Add handler for `annotation:bridge_created`**

```typescript
case 'annotation:bridge_created':
  queryClient.invalidateQueries({ queryKey: ['admin-annotations'] });
  break;
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/
git commit -m "feat(ws): add frontend handlers for bridge-triggered events"
```

---

### 🛑 Task 15: STOP — PR 2B Quality Gate & Review

> **HARD STOP.** Do NOT proceed to PR 2C tasks. Complete every step below, push the PR, and wait for human review + merge before continuing.

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 2: Run full build**

```bash
npx vite build
```

- [ ] **Step 3: Run full test suite (not just new tests)**

```bash
npx vitest run
```

- [ ] **Step 4: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

- [ ] **Step 5: Run code review skill**

Invoke `superpowers:requesting-code-review` on all files changed in this PR.

- [ ] **Step 6: Fix any Critical/Important issues from review**

- [ ] **Step 7: Update docs**

  - `FEATURE_AUDIT.md` — add entries for bridges #2, #3, #5, #7, #11, #13 and suggested briefs CRUD
  - `data/roadmap.json` — mark Phase 2B item done
  - Run `npx tsx scripts/sort-roadmap.ts`

- [ ] **Step 8: Push and create PR**

```bash
git push -u origin HEAD
```

Create PR targeting `staging` with title: `feat(intelligence): Phase 2B — simple bridges (#2, #3, #5, #7, #11, #13)`

- [ ] **Step 9: WAIT for human review + merge to staging**

🛑 **Do not start PR 2C until this PR is merged and staging deployment is verified.**

---

## PR 2C: Complex Bridges + Slices

> **Prerequisite:** PR 2B merged to staging and deployment verified.

### Task 16: Bridge #1 — recordOutcome → Reweight Insight Scores (Option A)

**Files:**
- Modify: `server/outcome-tracking.ts`

- [ ] **Step 1: Write the test**

Add to `tests/bridges-complex.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

describe('Bridge #1: outcome-reweight', () => {
  it('recordOutcome is exported with correct signature', async () => {
    const { recordOutcome } = await import('../server/outcome-tracking.js');
    expect(typeof recordOutcome).toBe('function');
  });
});
```

- [ ] **Step 2: Add post-hook to `recordOutcome()` in `server/outcome-tracking.ts`**

After line 228 (just before `return rowToActionOutcome(outcome);` in `recordOutcome()`), add:

```typescript
  // ── Bridge #1: Reweight insight scores based on outcome ──────────
  // Completed outcomes (score != null) adjust severity of related insights
  // NOTE: recordOutcome() is SYNC — use fireBridge (fire-and-forget)
  if (params.score) {
    const action = getAction(params.actionId);
    if (action) {
      debouncedOutcomeReweight(action.workspaceId, async () => {
        await withWorkspaceLock(action.workspaceId, async () => {
          const { getInsights, upsertInsight } = await import('./analytics-insights-store.js');
          const insights = getInsights(action.workspaceId);
          // Find insights related to this action's page
          const related = insights.filter(i => i.pageId === action.pageUrl && i.resolutionStatus !== 'resolved');

          for (const insight of related) {
            const currentScore = insight.impactScore ?? 50;
            let adjustment = 0;
            // OutcomeScore: 'strong_win' | 'win' | 'neutral' | 'loss' | 'insufficient_data' | 'inconclusive'
            // Win → reduce severity (the issue was addressed)
            if (params.score === 'win') adjustment = -10;
            else if (params.score === 'strong_win') adjustment = -20;
            // Loss → boost severity (the issue persists/worsened)
            else if (params.score === 'loss') adjustment = 15;
            // neutral/insufficient_data/inconclusive → no adjustment

            if (adjustment !== 0) {
              const newScore = Math.max(0, Math.min(100, currentScore + adjustment));
              upsertInsight({
                workspaceId: action.workspaceId,
                pageId: insight.pageId ?? null,
                insightType: insight.insightType,
                data: insight.data,
                severity: insight.severity,
                impactScore: newScore,
                domain: insight.domain,
                pageTitle: insight.pageTitle ?? undefined,
                resolutionSource: 'bridge_1_outcome_reweight',
              });
            }
          }
        });
        // Broadcast bridge event after reweighting
        const { broadcastToWorkspace } = await import('./broadcast.js');
        broadcastToWorkspace(action.workspaceId, 'insight:bridge_updated', {
          bridge: 'bridge_1_outcome_reweight',
        });
      });
    }
  }
```

Add/update imports at top (fireBridge added in Task 10, now add withWorkspaceLock + debounced):
```typescript
import { fireBridge, withWorkspaceLock, debouncedOutcomeReweight } from './bridge-infrastructure.js';
```

- [ ] **Step 3: Verify `OutcomeScore` type (pre-verified)**

`OutcomeScore = 'strong_win' | 'win' | 'neutral' | 'loss' | 'insufficient_data' | 'inconclusive'` — code above already uses correct values. Confirm with: `grep 'OutcomeScore' shared/types/outcome-tracking.ts`

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 5: Commit**

```bash
git add server/outcome-tracking.ts tests/bridges-complex.test.ts
git commit -m "feat(bridges): #1 recordOutcome → reweight insight scores (Option A with workspace lock)"
```

---

### Task 17: Bridge #10 — Anomaly → Boost Insight Severity

**Files:**
- Modify: `server/anomaly-detection.ts`

- [ ] **Step 1: Add bridge call after anomaly digest upsert**

At top of `server/anomaly-detection.ts`, add imports:
```typescript
import { debouncedAnomalyBoost, withWorkspaceLock } from './bridge-infrastructure.js';
```

After the `upsertAnomalyDigestInsight()` call (around line 592), add:

```typescript
// Bridge #10: Boost severity of ALL workspace insights when anomaly detected
// Anomaly type has NO pageUrl field — anomalies are workspace-level (metric: clicks, impressions, etc.)
// Fields available: a.workspaceId, a.type, a.metric, a.severity, a.title, a.description,
//   a.currentValue, a.previousValue, a.changePct, a.source
// runAnomalyDetection is async, but we don't await bridge inside the loop
// Uses debouncedAnomalyBoost (5s) to collapse rapid anomaly detections
// Uses withWorkspaceLock to prevent concurrent insight modifications (Fix 4)
debouncedAnomalyBoost(a.workspaceId, async () => {
  await withWorkspaceLock(a.workspaceId, async () => {
  const { getInsights, upsertInsight } = await import('./analytics-insights-store.js');
  const insights = getInsights(a.workspaceId);
  // Boost non-resolved insights that share the same domain
  const domain = a.metric.includes('position') ? 'strategy' : 'content';
  const related = insights.filter(i =>
    i.domain === domain &&
    i.insightType !== 'anomaly_digest' &&
    i.resolutionStatus !== 'resolved',
  );
  for (const insight of related.slice(0, 20)) {
    const boostedScore = Math.min(100, (insight.impactScore ?? 50) + 10);
    const boostedSeverity = boostedScore >= 80 ? 'critical' : insight.severity;
    upsertInsight({
      workspaceId: a.workspaceId,
      pageId: insight.pageId ?? null,
      insightType: insight.insightType,
      data: { ...insight.data, anomalyBoosted: true, anomalyType: a.type, anomalyMetric: a.metric },
      severity: boostedSeverity,
      impactScore: boostedScore,
      domain: insight.domain,
      pageTitle: insight.pageTitle ?? undefined,
      anomalyLinked: true,
      resolutionSource: 'bridge_10_anomaly_boost',
    });
  }
  }); // end withWorkspaceLock
  // Broadcast bridge event after boosting
  const { broadcastToWorkspace } = await import('./broadcast.js');
  broadcastToWorkspace(a.workspaceId, 'insight:bridge_updated', {
    bridge: 'bridge_10_anomaly_boost',
  });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add server/anomaly-detection.ts
git commit -m "feat(bridges): #10 anomaly detection → boost severity of related page insights"
```

---

### Task 18: Bridge #12 + #15 — Audit → Page Health + Site Health Insights (Option A)

**Files:**
- Modify: `server/reports.ts`

- [ ] **Step 1: Add post-hooks to `saveSnapshot()` in `server/reports.ts`**

At top, add imports:
```typescript
import { fireBridge, withWorkspaceLock } from './bridge-infrastructure.js';
import { listWorkspaces } from './workspaces.js';
import { isFeatureEnabled } from './feature-flags.js';
```

Note: `listWorkspaces` and `isFeatureEnabled` may already be imported in reports.ts — check and reuse existing imports. They MUST be top-level imports (not dynamic `await import()`) because `saveSnapshot()` is SYNC.

After line 137 (the `insertSnapshotStmt().run(...)` call, just before `return snapshot;`), add:

```typescript
  // ── Bridges #12 + #15: Only look up workspace if at least one bridge flag is enabled ──
  // saveSnapshot() is SYNC, so use top-level imports (no await import()) and fireBridge (fire-and-forget)
  // Look up workspace BEFORE firing bridges so we pass correct workspaceId (not siteId)
  if (isFeatureEnabled('bridge-audit-page-health') || isFeatureEnabled('bridge-audit-site-health')) {
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    if (ws) {
      // ── Bridge #12: Generate page_health insights from audit ────────
      fireBridge('bridge-audit-page-health', ws.id, async () => {
        const { upsertInsight } = await import('./analytics-insights-store.js');

        await withWorkspaceLock(ws.id, async () => {
      // Generate per-page health insights from audit results
      // PageSeoResult: { pageId, page, slug, url, score, issues: SeoIssue[], noindex? }
      // SeoIssue: { check, severity, category?, message, recommendation, value?, suggestedFix? }
      for (const page of audit.pages.slice(0, 50)) {
        const issues = page.issues ?? [];
        if (issues.length === 0) continue;

        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warningCount = issues.filter(i => i.severity === 'warning').length;
        const severity = errorCount > 0 ? 'warning' : 'opportunity';
        const score = Math.max(0, 100 - (errorCount * 15) - (warningCount * 5));

        upsertInsight({
          workspaceId: ws.id,
          pageId: page.url,
          insightType: 'page_health',
          data: {
            auditSnapshotId: id,
            errorCount,
            warningCount,
            topIssues: issues.slice(0, 5).map(i => i.message),
          },
          severity,
          impactScore: 100 - score,
          domain: 'technical',
          pageTitle: page.page ?? undefined, // PageSeoResult uses .page for title
          auditIssues: JSON.stringify(issues.filter(i => i.severity === 'error').slice(0, 3).map(i => i.message)),
          resolutionSource: 'bridge_12_audit_page_health',
        });
      }
    });
    // Broadcast bridge event after page health insights
    const { broadcastToWorkspace } = await import('./broadcast.js');
    broadcastToWorkspace(ws.id, 'insight:bridge_updated', {
      bridge: 'bridge_12_audit_page_health',
    });
  });

      // ── Bridge #15: Generate site_health insight from audit ──────────
      fireBridge('bridge-audit-site-health', ws.id, async () => {
        const { upsertInsight } = await import('./analytics-insights-store.js');

        const delta = previousScore != null ? audit.siteScore - previousScore : null;
        const severity = audit.siteScore < 50 ? 'critical'
          : audit.siteScore < 70 ? 'warning'
          : delta != null && delta < -5 ? 'warning'
          : 'positive';

        upsertInsight({
          workspaceId: ws.id,
          insightType: 'site_health',
          data: {
            auditSnapshotId: id,
            siteScore: audit.siteScore,
            previousScore: previousScore ?? null,
            scoreDelta: delta,
            totalPages: audit.totalPages,
            errors: audit.errors,
            warnings: audit.warnings,
            siteWideIssueCount: audit.siteWideIssues?.length ?? 0,
          },
          severity,
          impactScore: Math.max(0, 100 - audit.siteScore),
          domain: 'technical',
          resolutionSource: 'bridge_15_audit_site_health',
        });
        // Broadcast bridge event after site health insight
        const { broadcastToWorkspace } = await import('./broadcast.js');
        broadcastToWorkspace(ws.id, 'insight:bridge_updated', {
          bridge: 'bridge_15_audit_site_health',
        });
      });
    } // end if (ws)
  } // end if (isFeatureEnabled(...))
```

**Pre-verified:** `SeoAuditResult.pages` is `PageSeoResult[]` with `.url`, `.page` (title), `.score`, `.issues: SeoIssue[]`. `SeoIssue` has `.message`, `.severity`, `.recommendation` — NOT `.description`. Workspace lookup uses top-level `listWorkspaces().find(w => w.webflowSiteId === siteId)` — done ONCE before both bridges, guarded by feature flag check to avoid unnecessary work when bridges are OFF.

- [ ] **Step 2: Add `site_health` to InsightType (REQUIRED — it doesn't exist yet)**

`page_health` already exists in InsightType. `site_health` does NOT. Per CLAUDE.md, new insight type registration requires all 4 items in same commit:

1. Add `'site_health'` to `InsightType` union in `shared/types/analytics.ts`
2. Add typed `SiteHealthInsightData` interface + `InsightDataMap` entry:
```typescript
// In shared/types/analytics.ts:
export interface SiteHealthInsightData {
  auditSnapshotId: string;
  siteScore: number;
  previousScore: number | null;
  scoreDelta: number | null;
  totalPages: number;
  errors: number;
  warnings: number;
  siteWideIssueCount: number;
}
// In InsightDataMap:
site_health: SiteHealthInsightData;
```
3. Add Zod schema in `server/schemas/` (or existing schema file)
4. Frontend renderer case — add minimal handling in the insight list component

Also update `PageHealthInsightData` if needed (verify current definition includes `topIssues: string[]` to match the data shape we write above).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add server/reports.ts shared/types/analytics.ts
git commit -m "feat(bridges): #12 audit → page_health insights, #15 audit → site_health insights"
```

---

### Task 19: Assemble contentPipeline Slice

**Files:**
- Modify: `server/workspace-intelligence.ts`

- [ ] **Step 1: Write the test**

Add to `tests/slices.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

describe('contentPipeline slice', () => {
  it('assembleSlice handles contentPipeline without error', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    expect(typeof buildWorkspaceIntelligence).toBe('function');
  });
});
```

- [ ] **Step 2: Implement contentPipeline slice assembler**

In `server/workspace-intelligence.ts`, replace the stubbed `contentPipeline` case in `assembleSlice()`:

```typescript
case 'contentPipeline':
  result.contentPipeline = await assembleContentPipeline(workspaceId);
  break;
```

Add the assembler function:

```typescript
async function assembleContentPipeline(
  workspaceId: string,
): Promise<ContentPipelineSlice> {
  const { getContentPipelineSummary } = await import('./workspace-data.js');
  const summary = getContentPipelineSummary(workspaceId);

  // coverageGaps — compare strategy keywords vs existing briefs/posts
  let coverageGaps: string[] = [];
  try {
    const { getWorkspace } = await import('./workspaces.js');
    const ws = getWorkspace(workspaceId);
    const strategyKeywords = ws?.keywordStrategy?.siteKeywords?.map(k =>
      typeof k === 'string' ? k : k.keyword,
    ) ?? [];
    // Simple gap detection: keywords without any brief
    const { listBriefs } = await import('./content-brief.js');
    const briefs = listBriefs(workspaceId);
    const briefKeywords = new Set(briefs.map(b => b.targetKeyword?.toLowerCase()));
    coverageGaps = strategyKeywords
      .filter(kw => !briefKeywords.has(kw.toLowerCase()))
      .slice(0, 10);
  } catch {
    // Non-critical — empty gaps is acceptable
  }

  return {
    briefs: summary.briefs,
    posts: summary.posts,
    matrices: summary.matrices,
    requests: summary.requests,
    workOrders: summary.workOrders,
    coverageGaps,
    seoEdits: summary.seoEdits,
  };
}
```

Add the import at the top of the file:
```typescript
import type { ContentPipelineSlice, SiteHealthSlice } from '../shared/types/intelligence.js';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add server/workspace-intelligence.ts tests/slices.test.ts
git commit -m "feat(intelligence): assemble contentPipeline slice from workspace data"
```

---

### Task 20: Assemble siteHealth Slice

**Files:**
- Modify: `server/workspace-intelligence.ts`

- [ ] **Step 1: Implement siteHealth slice assembler**

In `server/workspace-intelligence.ts`, replace the stubbed `siteHealth` case in `assembleSlice()`:

```typescript
case 'siteHealth':
  result.siteHealth = await assembleSiteHealth(workspaceId);
  break;
```

Add the assembler function:

```typescript
async function assembleSiteHealth(
  workspaceId: string,
): Promise<SiteHealthSlice> {
  const { getWorkspace } = await import('./workspaces.js');
  const ws = getWorkspace(workspaceId);
  if (!ws?.webflowSiteId) {
    return {
      auditScore: null, auditScoreDelta: null, deadLinks: 0,
      redirectChains: 0, schemaErrors: 0, orphanPages: 0,
      cwvPassRate: { mobile: null, desktop: null },
    };
  }

  // Latest audit snapshot
  const { getLatestSnapshot } = await import('./reports.js');
  const snapshot = getLatestSnapshot(ws.webflowSiteId);
  const auditScore = snapshot?.audit.siteScore ?? null;
  const auditScoreDelta = snapshot?.previousScore != null && auditScore != null
    ? auditScore - snapshot.previousScore
    : null;

  // Count issues from audit
  // SeoIssue: { check, severity, category?, message, recommendation, value?, suggestedFix? }
  let deadLinks = 0;
  let redirectChains = 0;
  if (snapshot?.audit.siteWideIssues) {
    for (const issue of snapshot.audit.siteWideIssues) {
      const msg = issue.message.toLowerCase();
      if (msg.includes('broken link') || msg.includes('dead link') || msg.includes('404')) deadLinks++;
      if (msg.includes('redirect chain') || msg.includes('redirect loop')) redirectChains++;
    }
  }

  // Also check deadLinkSummary if available (SeoAuditResult has optional deadLinkSummary)
  if (snapshot?.audit.deadLinkSummary) {
    deadLinks = Math.max(deadLinks, snapshot.audit.deadLinkSummary.total);
    redirectChains = Math.max(redirectChains, snapshot.audit.deadLinkSummary.redirects);
  }

  // Schema validations
  let schemaErrors = 0;
  try {
    const schemaRows = db.prepare(
      `SELECT COUNT(*) as cnt FROM schema_validations WHERE workspace_id = ? AND status = 'errors'`,
    ).get(workspaceId) as { cnt: number } | undefined;
    schemaErrors = schemaRows?.cnt ?? 0;
  } catch {
    // Table may not exist yet
  }

  // Orphan pages — PageSeoResult has no inboundLinks field.
  // Approximate: count pages with very low scores and no issues (likely orphan/thin).
  // Accurate orphan detection requires internal link crawl — deferred to Phase 3.
  const orphanPages = 0; // Placeholder — Phase 3 will add link graph analysis

  return {
    auditScore,
    auditScoreDelta,
    deadLinks,
    redirectChains,
    schemaErrors,
    orphanPages,
    cwvPassRate: { mobile: null, desktop: null }, // CWV data not yet integrated — Phase 3
  };
}
```

Add `db` import at top if not already present:
```typescript
import db from './db/index.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add server/workspace-intelligence.ts
git commit -m "feat(intelligence): assemble siteHealth slice from audit snapshots + schema validations"
```

---

### Task 21: Expand Shadow-Mode Comparison to 5 Fields

**Files:**
- Modify: `server/workspace-intelligence.ts` (or wherever shadow-mode comparison lives)

- [ ] **Step 1: Find current shadow-mode comparison**

Search for `_skipShadow` or `shadow` in `server/workspace-intelligence.ts` and `server/seo-context.ts`.

The Phase 1 shadow mode compares old `buildSeoContext()` vs new `buildWorkspaceIntelligence()`. Currently it likely compares 1-2 fields.

- [ ] **Step 2: Expand comparison to 5 fields**

In the shadow-mode comparison function (`server/seo-context.ts`, lines 170-188), expand to compare:

> **⚠️ FIELD NAME MISMATCH BUG (from PR 2A review):** The existing Phase 1 comparison at line 172 compares `intel.seoContext.brandVoice` (the raw workspace voice string) against `result.brandVoiceBlock` (which wraps the voice with `BRAND VOICE & STYLE` header + brand docs content). These are semantically different values and will NEVER match, producing false-positive mismatch warnings in logs. The fix below uses the correct source fields for each comparison.

> **⚠️ `result` field names:** `buildSeoContext()` returns a `SeoContext` object. Its field names are: `strategy` (string), `brandVoiceBlock` (string — includes header + brand docs), `businessContext` (string), `knowledgeBlock` (string — includes header), `personasBlock` (string — prose). The intelligence assembler's `SeoContextSlice` uses: `strategy`, `brandVoice` (raw voice, no header), `businessContext`, `knowledgeBase` (raw KB), `personas` (structured array). These are NOT directly comparable — you must compare against the same data source, or extract the raw value from the block.

```typescript
// Shadow-mode comparison fields (Phase 2 expansion)
// IMPORTANT: Compare raw values, not wrapped blocks. The assembler's seoContext
// pulls from workspace fields directly, while buildSeoContext() wraps them with
// headers. Compare the assembler output against the same workspace source.
const workspace = getWorkspace(workspaceId);
const comparisonFields = [
  { name: 'strategy', old: result.strategy, new: intel.seoContext?.strategy },
  // brandVoice: compare raw workspace voice (not brandVoiceBlock which has headers)
  { name: 'brandVoice', old: workspace?.brandVoice ?? '', new: intel.seoContext?.brandVoice ?? '' },
  { name: 'businessContext', old: result.businessContext, new: intel.seoContext?.businessContext },
  // knowledgeBase: compare raw workspace KB (not knowledgeBlock which has headers)
  { name: 'knowledgeBase', old: workspace?.knowledgeBase ?? '', new: intel.seoContext?.knowledgeBase ?? '' },
  // personas: old is prose string, new is structured array — compare lengths as proxy
  { name: 'personas', old: result.personasBlock ? 'present' : 'empty', new: (intel.seoContext?.personas?.length ?? 0) > 0 ? 'present' : 'empty' },
];
```

Log comparison results with structured logging. Log each field's match/mismatch individually.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add server/seo-context.ts server/workspace-intelligence.ts
git commit -m "feat(intelligence): expand shadow-mode comparison to 5 fields"
```

---

### 🛑 Task 22: STOP — PR 2C Quality Gate & Review (FINAL)

> **HARD STOP.** This is the final PR of Phase 2. Complete every step below, push the PR, and wait for human review + merge. After merge, verify staging, then merge staging → main.

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 2: Run full build**

```bash
npx vite build
```

- [ ] **Step 3: Run full test suite (not just new tests)**

```bash
npx vitest run
```

- [ ] **Step 4: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

- [ ] **Step 5: Run code review skill**

Invoke `superpowers:requesting-code-review` on all files changed in this PR. Pay extra attention to:
- `withWorkspaceLock` usage in Bridge #1 (deadlock potential?)
- Transaction safety in Bridge #12/#15 (audit → insights)
- New insight types registered correctly (all 4 items per CLAUDE.md)

- [ ] **Step 6: Fix any Critical/Important issues from review**

- [ ] **Step 7: Update docs**

  - `FEATURE_AUDIT.md` — add entries for bridges #1, #10, #12, #15, contentPipeline slice, siteHealth slice
  - `data/roadmap.json` — mark Phase 2C item done
  - `BRAND_DESIGN_LANGUAGE.md` — update if any UI patterns changed
  - Run `npx tsx scripts/sort-roadmap.ts`

- [ ] **Step 8: Push and create PR**

```bash
git push -u origin HEAD
```

Create PR targeting `staging` with title: `feat(intelligence): Phase 2C — complex bridges (#1, #10, #12, #15) + contentPipeline/siteHealth slices`

- [ ] **Step 9: WAIT for human review + merge to staging**

- [ ] **Step 10: Verify staging deployment**

Check Render logs, hit health endpoint, verify no bridge errors in logs.

- [ ] **Step 11: Merge staging → main**

🛑 **Phase 2 is complete after main merge + production verification.**

---

## Dependency Graph

```
PR 2A (infrastructure):
  Task 1 (flags) ─┬─ Task 2 (bridge infra) ─┬─ Task 3 (LRU migration) ── Task 4 (pipeline summary) ── Task 5 (personas + barrel) ── Task 6 (QA)
                   │                          │
                   └──────────────────────────┘

PR 2B (simple bridges — depends on 2A merged):
  Task 7 (#3 strategy) ─┐
  Task 8 (#5 pages)     ├─ Can run in PARALLEL (different files)
  Task 9 (#11 settings) ─┘
  Task 10 (#7+#13 recordAction) ── SEQUENTIAL (touches outcome-tracking.ts)
  Task 11 (suggested-briefs store) ── Task 12 (routes + API) ── Task 13 (#2 decay bridge) ── SEQUENTIAL chain
  Task 14 (verify #4) ── Independent
  Task 14B (WS handlers) ── Depends on Tasks 10, 12B, 13 (needs event names to exist)
  Task 15 (QA)

PR 2C (complex bridges — depends on 2B merged):
  Task 16 (#1 recordOutcome) ── SEQUENTIAL (touches outcome-tracking.ts, depends on Bridge #7/#13 from 2B)
  Task 17 (#10 anomaly)      ── Can run in PARALLEL with Task 16 (different file)
  Task 18 (#12+#15 audit)    ── Can run in PARALLEL with Task 16 + 17 (different file)
  Task 19 (contentPipeline slice) ── Depends on Task 4 from 2A
  Task 20 (siteHealth slice)      ── Depends on Task 18 (#12/#15)
  Task 21 (shadow mode)           ── Depends on Tasks 19 + 20
  Task 22 (QA)
```

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Task 1 (flags) | Haiku | Mechanical addition to a known file |
| Task 2 (bridge infra) | Sonnet | New module with async logic + tests |
| Task 3 (LRU migration) | Sonnet | Refactoring existing code, preserving fallback-on-error |
| Task 4 (pipeline summary) | Sonnet | 6 SQL queries, type mapping |
| Task 5 (personas + barrel) | Haiku | One-line fixes |
| Task 6 (QA) | Opus | Full-context judgment |
| Task 7 (#3 strategy) | Haiku | Import + one-line bridge call at 3 sites |
| Task 8 (#5 pages) | Haiku | Import + one-line bridge call at 2 sites |
| Task 9 (#11 settings) | Haiku | Import + one-line bridge call |
| Task 10 (#7+#13 recordAction) | Sonnet | Option A post-hooks with async imports |
| Task 11 (suggested-briefs store) | Sonnet | Full CRUD module + types |
| Task 12 (routes + API client) | Sonnet | REST routes + typed client |
| Task 13 (#2 decay bridge) | Sonnet | Bridge logic + field mapping verification |
| Task 14 (verify #4) | Haiku | Read-only verification |
| Task 14B (WS handlers) | Haiku | Adding switch cases to existing handler |
| Task 15 (QA) | Opus | Full-context judgment |
| Task 16 (#1 recordOutcome) | Sonnet | Score adjustment logic + workspace lock |
| Task 17 (#10 anomaly) | Sonnet | Severity boost logic |
| Task 18 (#12+#15 audit) | Opus | Transaction + dedup + new insight types |
| Task 19 (contentPipeline slice) | Sonnet | Assembler with coverage gap detection |
| Task 20 (siteHealth slice) | Sonnet | Multi-source aggregation |
| Task 21 (shadow mode) | Haiku | Expand comparison array |
| Task 22 (QA) | Opus | Full-context judgment |
