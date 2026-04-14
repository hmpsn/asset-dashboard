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
import type * as Broadcast from './broadcast.js';
import type * as WsEvents from './ws-events.js';

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
  'bridge-audit-auto-resolve',
  'bridge-client-signal',
];

// ── executeBridge ──────────────────────────────────────────────────────

interface BridgeOptions {
  /** Timeout in ms — bridge is abandoned (not killed) after this. Default: 5000 */
  timeoutMs?: number;
  /** If true, log but don't execute (for shadow mode testing) */
  dryRun?: boolean;
}

/** Return from bridge callbacks to trigger auto-broadcast when modified > 0 */
export interface BridgeResult {
  /** Number of insights/records modified. When > 0, infrastructure broadcasts automatically. */
  modified: number;
}

type BridgeCallback = () => Promise<BridgeResult | void> | BridgeResult | void;

/**
 * Execute a bridge function with feature-flag gating, timeout, error isolation, and logging.
 * Bridges NEVER throw — errors are logged and swallowed to protect the triggering mutation.
 *
 * Returns a Promise, but callers in SYNC functions (recordAction, saveSnapshot) should use
 * fireBridge() instead to avoid floating promises.
 *
 * When the callback returns a BridgeResult with modified > 0, broadcasts INSIGHT_BRIDGE_UPDATED
 * automatically — bridge callbacks no longer need to handle their own broadcasts.
 */
export async function executeBridge(
  flag: FeatureFlagKey,
  workspaceId: string,
  fn: BridgeCallback,
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
    let bridgeResult: BridgeResult | void = undefined;
    const result = fn();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      // Async bridge — race against timeout, clear timer on settle to avoid leaks.
      // `timedOut` suppresses re-throw in the rejection handler: if the timeout wins the
      // race and the bridge later rejects, we must NOT rethrow — doing so would create an
      // unhandled promise rejection because Promise.race has already settled and nobody is
      // awaiting the .then() chain anymore.
      let timeoutId: ReturnType<typeof setTimeout>;
      let timedOut = false;
      const cleanup = () => clearTimeout(timeoutId);
      await Promise.race([
        (result as Promise<BridgeResult | void>).then(
          (v) => { cleanup(); bridgeResult = v; },
          (e: unknown) => { cleanup(); if (!timedOut) throw e; },
        ),
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Bridge ${flag} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } else {
      // Sync bridge
      bridgeResult = result as BridgeResult | void;
    }

    log.info({ flag, workspaceId, duration_ms: Date.now() - start }, 'Bridge executed');

    // Auto-broadcast when bridge reports modifications
    if (bridgeResult && typeof bridgeResult === 'object' && 'modified' in bridgeResult && bridgeResult.modified > 0) {
      try {
        const { broadcastToWorkspace }: typeof Broadcast = await import('./broadcast.js'); // dynamic-import-ok
        const { WS_EVENTS }: typeof WsEvents = await import('./ws-events.js'); // dynamic-import-ok
        broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_BRIDGE_UPDATED, { bridge: flag });
      } catch (bcErr) {
        log.warn({ flag, workspaceId, err: bcErr }, 'Bridge auto-broadcast failed');
      }
    }
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
  fn: BridgeCallback,
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
): (workspaceId: string, fn: BridgeCallback) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, BridgeCallback>();

  return (workspaceId: string, fn: BridgeCallback) => {
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
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (UTC, no Z suffix).
  // Node.js new Date() parses that as LOCAL time without a Z. Append Z to force UTC.
  const cachedAtUtc = row.cached_at.endsWith('Z') ? row.cached_at : row.cached_at.replace(' ', 'T') + 'Z';
  const age = (Date.now() - new Date(cachedAtUtc).getTime()) / 1000;
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
