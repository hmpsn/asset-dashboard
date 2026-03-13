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

// ── Feature keys ──
export type UsageFeature = 'ai_chats' | 'strategy_generations';

// ── Per-tier monthly limits (Infinity = unlimited) ──
const LIMITS: Record<string, Record<UsageFeature, number>> = {
  free:    { ai_chats: 3,        strategy_generations: 0 },
  growth:  { ai_chats: 50,       strategy_generations: 3 },
  premium: { ai_chats: Infinity, strategy_generations: Infinity },
};

export function getLimit(tier: string, feature: UsageFeature): number {
  return LIMITS[tier]?.[feature] ?? LIMITS.free[feature];
}

// ── Prepared statements (lazy) ──

let _getCount: ReturnType<typeof db.prepare> | null = null;
function getCountStmt() {
  if (!_getCount) {
    _getCount = db.prepare(`
      SELECT count FROM usage_tracking
      WHERE workspace_id = ? AND month = ? AND feature = ?
    `);
  }
  return _getCount;
}

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT INTO usage_tracking (workspace_id, month, feature, count)
      VALUES (@workspace_id, @month, @feature, @count)
      ON CONFLICT(workspace_id, month, feature) DO UPDATE SET count = @count
    `);
  }
  return _upsert;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── Public API ──

/** Get current month's count for a feature. */
export function getUsageCount(workspaceId: string, feature: UsageFeature): number {
  const month = currentMonth();
  const row = getCountStmt().get(workspaceId, month, feature) as { count: number } | undefined;
  return row?.count || 0;
}

/** Increment the count. Call AFTER a successful action. */
export function incrementUsage(workspaceId: string, feature: UsageFeature): number {
  const month = currentMonth();
  const current = getUsageCount(workspaceId, feature);
  const newCount = current + 1;
  upsertStmt().run({
    workspace_id: workspaceId,
    month,
    feature,
    count: newCount,
  });
  return newCount;
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
  const features: UsageFeature[] = ['ai_chats', 'strategy_generations'];
  const result = {} as Record<UsageFeature, { used: number; limit: number; remaining: number }>;
  for (const f of features) {
    const { used, limit, remaining } = checkUsageLimit(workspaceId, tier, f);
    result[f] = { used, limit, remaining };
  }
  return result;
}
