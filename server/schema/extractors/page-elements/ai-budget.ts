/**
 * Per-regenerate AI call budget tracker. Bounds the cost of AI-assisted
 * extractors (image role classifier in PR2; HowTo-list AI fallback in
 * PR2) so a single regenerate-all run can't blow up the OpenAI bill.
 *
 * Lifecycle: one budget per regenerate-all trigger. Created in
 * generator.ts (Task 13); passed through extractor opts.
 */
export interface AiBudget {
  /** Maximum AI calls allowed for this run. */
  max: number;
  /** Calls used so far. */
  used: number;
  /** True once max is hit (further requests fall through to rule-based). */
  exhausted: boolean;
}

export function createAiBudget(max: number): AiBudget {
  return { max, used: 0, exhausted: false };
}

/**
 * Try to consume one budget slot. Returns true when an AI call is
 * permitted; false when budget is exhausted (caller should fall back).
 */
export function tryConsumeAiBudget(budget: AiBudget): boolean {
  if (budget.used >= budget.max) {
    budget.exhausted = true;
    return false;
  }
  budget.used += 1;
  if (budget.used >= budget.max) budget.exhausted = true;
  return true;
}
