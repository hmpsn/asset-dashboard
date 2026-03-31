/**
 * Bridge infrastructure — shared execution, debouncing, locking, and flag utilities.
 * All event bridges route through executeBridge() for consistent logging,
 * feature-flag gating, timeout, and error isolation.
 *
 * Spec: docs/superpowers/specs/unified-workspace-intelligence.md §24-27
 */

import { createLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
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
      // Async bridge — race against timeout, clear timer on settle to avoid leaks
      let timeoutId: ReturnType<typeof setTimeout>;
      const cleanup = () => clearTimeout(timeoutId);
      await Promise.race([
        result.then((v: void) => { cleanup(); return v; }, (e: unknown) => { cleanup(); throw e; }),
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Bridge ${flag} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
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
      setTimeout(() => {
        timers.delete(workspaceId);
        const latestFn = pending.get(workspaceId);
        pending.delete(workspaceId);
        if (latestFn) {
          // executeBridge catches all errors internally — safe to discard promise
          void executeBridge(flag, workspaceId, latestFn);
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

// ── Pre-configured debounced bridges ───────────────────────────────
// Bridges #3, #5, #11: debounce 2s (rapid-fire invalidation during bulk edits)
export const debouncedStrategyInvalidate = debounceBridge('bridge-strategy-invalidate', 2000);
export const debouncedPageAnalysisInvalidate = debounceBridge('bridge-page-analysis-invalidate', 2000);
export const debouncedSettingsCascade = debounceBridge('bridge-settings-cascade', 2000);
// Bridges #1, #10: debounce 5s (heavier insight mutation work)
export const debouncedOutcomeReweight = debounceBridge('bridge-outcome-reweight', 5000);
export const debouncedAnomalyBoost = debounceBridge('bridge-anomaly-boost', 5000);

// ── Surgical cache invalidation ───────────────────────────────────────

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
  return parseJsonFallback<T>(row.data, null as unknown as T);
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
