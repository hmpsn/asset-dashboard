/**
 * Unified usage tracking & rate limiting per workspace per calendar month.
 *
 * Tracks: ai_chats, strategy_generations
 * Limits vary by tier (free / growth / premium).
 *
 * NOTE: content_briefs and content_posts are NOT tracked here — they are
 * paid add-ons purchased via Stripe. Activity logging tracks generation events.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── Feature keys ──
export type UsageFeature =
  | 'ai_chats'
  | 'strategy_generations'
  | 'brandscript_generations'
  | 'voice_calibrations';

// ── Per-tier monthly limits (Infinity = unlimited) ──
const LIMITS: Record<string, Record<UsageFeature, number>> = {
  free:    { ai_chats: 3,        strategy_generations: 0, brandscript_generations: 0,        voice_calibrations: 0        },
  growth:  { ai_chats: 50,       strategy_generations: 3, brandscript_generations: 5,        voice_calibrations: 10       },
  premium: { ai_chats: Infinity, strategy_generations: Infinity, brandscript_generations: Infinity, voice_calibrations: Infinity },
};

export function getLimit(tier: string, feature: UsageFeature): number {
  return LIMITS[tier]?.[feature] ?? LIMITS.free[feature];
}

// ── Prepared statements (lazy) ──

const stmts = createStmtCache(() => ({
  getCount: db.prepare<[workspaceId: string, month: string, feature: string]>(`
    SELECT count FROM usage_tracking
    WHERE workspace_id = ? AND month = ? AND feature = ?
  `),
  upsert: db.prepare(`
    INSERT INTO usage_tracking (workspace_id, month, feature, count)
    VALUES (@workspace_id, @month, @feature, @count)
    ON CONFLICT(workspace_id, month, feature) DO UPDATE SET count = @count
  `),
}));

// Wraps check+increment in a single synchronous transaction to eliminate the
// TOCTOU race where two concurrent async handlers both read the same count
// before either has a chance to increment.
const atomicIncrementTxn = db.transaction(
  (workspaceId: string, month: string, feature: string, limit: number): boolean => {
    const row = stmts().getCount.get(workspaceId, month, feature) as { count: number } | undefined;
    const current = row?.count || 0;
    if (current >= limit) return false;
    stmts().upsert.run({ workspace_id: workspaceId, month, feature, count: current + 1 });
    return true;
  },
);

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── Public API ──

/** Get current month's count for a feature. */
export function getUsageCount(workspaceId: string, feature: UsageFeature): number {
  const month = currentMonth();
  const row = stmts().getCount.get(workspaceId, month, feature) as { count: number } | undefined;
  return row?.count || 0;
}

/** Increment the count. Call AFTER a successful action. */
export function incrementUsage(workspaceId: string, feature: UsageFeature): number {
  const month = currentMonth();
  const current = getUsageCount(workspaceId, feature);
  const newCount = current + 1;
  stmts().upsert.run({
    workspace_id: workspaceId,
    month,
    feature,
    count: newCount,
  });
  return newCount;
}

const atomicDecrementTxn = db.transaction(
  (workspaceId: string, month: string, feature: string): void => {
    const row = stmts().getCount.get(workspaceId, month, feature) as { count: number } | undefined;
    const current = row?.count || 0;
    if (current <= 0) return;
    stmts().upsert.run({ workspace_id: workspaceId, month, feature, count: current - 1 });
  },
);

/**
 * Decrement the count by 1. Call to refund a pre-increment when the AI action
 * fails after incrementIfAllowed() already reserved a slot.
 */
export function decrementUsage(workspaceId: string, feature: UsageFeature): void {
  const month = currentMonth();
  atomicDecrementTxn(workspaceId, month, feature);
}

/**
 * Atomically check the limit and increment if allowed. Returns true if the
 * slot was reserved, false if the limit is already reached.
 *
 * Use this instead of checkUsageLimit + incrementUsage to eliminate the TOCTOU
 * race where two concurrent async handlers both pass the check before either
 * increments. Pattern:
 *
 *   if (!incrementIfAllowed(wsId, tier, feature)) return res.status(429)...;
 *   try { ...AI call... }
 *   catch { decrementUsage(wsId, feature); throw; }
 */
export function incrementIfAllowed(workspaceId: string, tier: string, feature: UsageFeature): boolean {
  const effectiveTier = tier || 'free';
  const limit = getLimit(effectiveTier, feature);
  if (limit === Infinity) {
    incrementUsage(workspaceId, feature);
    return true;
  }
  const month = currentMonth();
  return atomicIncrementTxn(workspaceId, month, feature, limit) as boolean;
}

/** Check if a workspace can use a feature. Returns { allowed, used, limit, remaining }. */
export function checkUsageLimit(
  workspaceId: string,
  tier: string,
  feature: UsageFeature,
): { allowed: boolean; used: number; limit: number; remaining: number } {
  const effectiveTier = tier || 'free';
  const limit = getLimit(effectiveTier, feature);
  const used = getUsageCount(workspaceId, feature);
  const remaining = Math.max(0, limit - used);
  return { allowed: remaining > 0 || limit === Infinity, used, limit, remaining };
}

/** Get full usage summary for a workspace (all features). */
export function getUsageSummary(
  workspaceId: string,
  tier: string,
): Record<UsageFeature, { used: number; limit: number; remaining: number }> {
  const features: UsageFeature[] = ['ai_chats', 'strategy_generations', 'brandscript_generations', 'voice_calibrations'];
  const result = {} as Record<UsageFeature, { used: number; limit: number; remaining: number }>;
  for (const f of features) {
    const { used, limit, remaining } = checkUsageLimit(workspaceId, tier, f);
    result[f] = { used, limit, remaining };
  }
  return result;
}
