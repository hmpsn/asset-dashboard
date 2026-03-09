/**
 * Unified usage tracking & rate limiting per workspace per calendar month.
 *
 * Tracks: ai_chats, content_briefs, strategy_generations
 * Limits vary by tier (free / growth / premium).
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'usage');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Feature keys ──
export type UsageFeature = 'ai_chats' | 'content_briefs' | 'strategy_generations';

// ── Per-tier monthly limits (Infinity = unlimited) ──
const LIMITS: Record<string, Record<UsageFeature, number>> = {
  free:    { ai_chats: 3,        content_briefs: 1,        strategy_generations: 0 },
  growth:  { ai_chats: 50,       content_briefs: 10,       strategy_generations: 3 },
  premium: { ai_chats: Infinity, content_briefs: Infinity,  strategy_generations: Infinity },
};

export function getLimit(tier: string, feature: UsageFeature): number {
  return LIMITS[tier]?.[feature] ?? LIMITS.free[feature];
}

// ── Storage helpers ──
interface MonthlyUsage {
  month: string; // YYYY-MM
  counts: Partial<Record<UsageFeature, number>>;
}

function filePath(workspaceId: string): string {
  return path.join(DATA_DIR, `${workspaceId}.json`);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function readUsage(workspaceId: string): MonthlyUsage {
  const fp = filePath(workspaceId);
  const month = currentMonth();
  try {
    if (fs.existsSync(fp)) {
      const data: MonthlyUsage = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (data.month === month) return data;
    }
  } catch { /* corrupted — reset */ }
  return { month, counts: {} };
}

function writeUsage(workspaceId: string, usage: MonthlyUsage): void {
  fs.writeFileSync(filePath(workspaceId), JSON.stringify(usage, null, 2));
}

// ── Public API ──

/** Get current month's count for a feature. */
export function getUsageCount(workspaceId: string, feature: UsageFeature): number {
  const usage = readUsage(workspaceId);
  return usage.counts[feature] || 0;
}

/** Increment the count. Call AFTER a successful action. */
export function incrementUsage(workspaceId: string, feature: UsageFeature): number {
  const usage = readUsage(workspaceId);
  usage.counts[feature] = (usage.counts[feature] || 0) + 1;
  writeUsage(workspaceId, usage);
  return usage.counts[feature]!;
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
  const features: UsageFeature[] = ['ai_chats', 'content_briefs', 'strategy_generations'];
  const result = {} as Record<UsageFeature, { used: number; limit: number; remaining: number }>;
  for (const f of features) {
    const { used, limit, remaining } = checkUsageLimit(workspaceId, tier, f);
    result[f] = { used, limit, remaining };
  }
  return result;
}
