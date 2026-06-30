import { createLogger } from './logger.js';
import { getWorkspace, computeEffectiveTier } from './workspaces.js';
import { getDataForSeoUsage } from './providers/dataforseo-provider.js';
import type { UsageTier } from '../shared/types/usage.js';

const log = createLogger('credit-budget-gate');

/**
 * Per-tier monthly DataForSEO credit budgets (SEO Decision Engine P5). Premium is
 * unlimited. Tunable in ONE place; these drive the health-card status + the WARN /
 * would-block evaluation. Owner decision (2026-06-24): observe-first launch posture
 * (see {@link isBudgetEnforcementEnabled}).
 */
export const CREDIT_BUDGETS: Record<UsageTier, number> = {
  free: 0,
  growth: 2000,
  premium: Infinity,
};

/**
 * Launch enforcement posture (P5). `false` = OBSERVE-ONLY: {@link assertCreditBudget}
 * computes and LOGS the would-block but never throws, so no live workspace is
 * retroactively blocked. Flip the initializer to `true` (single edit) to hard-enforce
 * once the per-tier budgets are validated — routes then return 429 and background
 * jobs surface a "budget reached" message via NotificationBell. This is the only
 * switch; P6–P8 call `assertCreditBudget` unchanged regardless of its value.
 */
let budgetEnforcementEnabled = false;

/** Whether the budget gate hard-blocks (true) or only observes/logs (false). */
export function isBudgetEnforcementEnabled(): boolean {
  return budgetEnforcementEnabled;
}

/** TEST-ONLY: toggle enforcement to exercise the hard-block path. */
export function __setBudgetEnforcementForTesting(enabled: boolean): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setBudgetEnforcementForTesting must not be called in production');
  }
  budgetEnforcementEnabled = enabled;
}

export type CreditBudgetStatus = 'ok' | 'warning' | 'critical';

/** Fraction of budget at which status escalates from `ok` to `warning`. */
const WARNING_RATIO = 0.8;

export interface CreditBudgetEvaluation {
  tier: UsageTier;
  /** Monthly budget for the tier; `Infinity` for premium. */
  budget: number;
  /** Month-to-date credits consumed by this workspace. */
  mtdCredits: number;
  /** `budget - mtdCredits`; `Infinity` for premium, negative if over budget. */
  remaining: number;
  /** `ok` < 80% · `warning` ≥ 80% · `critical` ≥ 100% of budget. */
  status: CreditBudgetStatus;
  /** True while month-to-date credits are strictly under the tier budget. */
  withinBudget: boolean;
}

/**
 * Thrown by {@link assertCreditBudget} ONLY when {@link isBudgetEnforcementEnabled}
 * is on and the workspace is over budget. The stable `code` lets route handlers map
 * to HTTP 429 and background jobs branch on `err.code === 'credit_budget_exceeded'`
 * to set a user-readable `job.message`.
 */
export class CreditBudgetError extends Error {
  readonly code = 'credit_budget_exceeded' as const;
  readonly tier: UsageTier;
  readonly endpoint: string;
  constructor(tier: UsageTier, endpoint: string, message: string) {
    super(message);
    this.name = 'CreditBudgetError';
    this.tier = tier;
    this.endpoint = endpoint;
  }
}

/** First-of-month UTC ISO timestamp — the month-to-date usage window boundary. */
function monthStartIso(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function resolveTier(workspaceId: string): UsageTier {
  const ws = getWorkspace(workspaceId);
  // computeEffectiveTier honors the free-trial → growth promotion; never pass raw ws.tier.
  return ws ? computeEffectiveTier(ws) : 'free';
}

/**
 * Short-lived memo of month-to-date credits so the documented per-paid-fetch gate
 * path (P6–P8 call assertCreditBudget before each fetch) does not re-scan the whole
 * credit directory on every call. `getDataForSeoUsage` does a synchronous
 * readdir+readFile over up to ~31 daily files; this bounds that to once per
 * workspace+month per TTL window. A few seconds of staleness is acceptable for a soft
 * cost-governance gate (the disk usage write is itself non-transactional).
 */
const MTD_CACHE_TTL_MS = 30_000;
const mtdCreditsCache = new Map<string, { credits: number; expiresAt: number }>();

function readMtdCredits(workspaceId: string, monthStart: string): number {
  const key = `${workspaceId}:${monthStart}`;
  const now = Date.now();
  const cached = mtdCreditsCache.get(key);
  if (cached && now < cached.expiresAt) return cached.credits;
  const { totalCredits } = getDataForSeoUsage(workspaceId, monthStart);
  mtdCreditsCache.set(key, { credits: totalCredits, expiresAt: now + MTD_CACHE_TTL_MS });
  return totalCredits;
}

/** TEST-ONLY: clear the MTD memo so successive evaluations re-read mocked usage. */
export function __resetCreditBudgetCacheForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCreditBudgetCacheForTesting must not be called in production');
  }
  mtdCreditsCache.clear();
}

/**
 * Evaluate a workspace's month-to-date DataForSEO credit budget. Pure read — never
 * throws, never blocks. Powers the DataForSEO health-card quota status, the
 * AIUsageSection budget chip, and {@link assertCreditBudget}. Pass `tier` to override
 * the resolved effective tier (e.g. in tests).
 */
export function evaluateCreditBudget(workspaceId: string, tier?: UsageTier): CreditBudgetEvaluation {
  const resolvedTier = tier ?? resolveTier(workspaceId);
  const budget = CREDIT_BUDGETS[resolvedTier];
  const mtdCredits = readMtdCredits(workspaceId, monthStartIso());

  if (budget === Infinity) {
    return { tier: resolvedTier, budget, mtdCredits, remaining: Infinity, status: 'ok', withinBudget: true };
  }

  const remaining = budget - mtdCredits;
  // ratio: with a 0 budget, any spend is already critical (free tier should not be
  // hitting the paid API at all once enforcement is on).
  const ratio = budget > 0 ? mtdCredits / budget : (mtdCredits > 0 ? Infinity : 0);
  const status: CreditBudgetStatus = ratio >= 1 ? 'critical' : ratio >= WARNING_RATIO ? 'warning' : 'ok';
  return { tier: resolvedTier, budget, mtdCredits, remaining, status, withinBudget: mtdCredits < budget };
}

/**
 * Cross-phase budget gate (P5 contract; P6–P8 call this before each PAID DataForSEO
 * fetch). OBSERVE-ONLY at launch: logs the would-block and returns. When
 * {@link isBudgetEnforcementEnabled} is on, throws {@link CreditBudgetError} for an
 * over-budget workspace.
 *
 * Call this ONLY on the network-call path — cached reads are 0-cost and must not be
 * gated (a budget-exhausted workspace should still serve already-warmed data).
 */
export function assertCreditBudget(workspaceId: string, endpoint: string, tier?: UsageTier): void {
  const evaluation = evaluateCreditBudget(workspaceId, tier);
  if (evaluation.withinBudget) return;

  const message = `DataForSEO monthly credit budget reached for the ${evaluation.tier} tier (${evaluation.mtdCredits.toFixed(2)} / ${evaluation.budget})`;
  const ctx = {
    workspaceId,
    endpoint,
    tier: evaluation.tier,
    mtdCredits: evaluation.mtdCredits,
    budget: evaluation.budget,
  };

  if (budgetEnforcementEnabled) {
    log.warn(ctx, 'credit budget exceeded — blocking call');
    throw new CreditBudgetError(evaluation.tier, endpoint, message);
  }
  log.info(ctx, 'credit budget would-block (observe-only; enforcement disabled)');
}
