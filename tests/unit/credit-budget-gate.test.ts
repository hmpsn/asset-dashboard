import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../server/logger.js', () => ({ createLogger: () => loggerMocks }));

// credit-budget-gate reads month-to-date credits from the provider's usage
// aggregator. Mock it so we control mtdCredits without touching disk.
vi.mock('../../server/providers/dataforseo-provider.js', () => ({
  getDataForSeoUsage: vi.fn(),
}));

import { getDataForSeoUsage } from '../../server/providers/dataforseo-provider.js';
import {
  CREDIT_BUDGETS,
  CreditBudgetError,
  assertCreditBudget,
  evaluateCreditBudget,
  __setBudgetEnforcementForTesting,
  __resetCreditBudgetCacheForTesting,
} from '../../server/credit-budget-gate.js';

const mockUsage = vi.mocked(getDataForSeoUsage);

function setMtdCredits(credits: number): void {
  mockUsage.mockReturnValue({ totalCredits: credits, totalCalls: 1, cachedCalls: 0, entries: [] });
}

describe('credit-budget-gate (P5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setBudgetEnforcementForTesting(false); // default observe-only
    __resetCreditBudgetCacheForTesting();    // drop the MTD memo so each test re-reads mocked usage
  });

  afterEach(() => {
    __setBudgetEnforcementForTesting(false);
  });

  it('exposes per-tier budgets: free 0, growth 2000, premium unlimited', () => {
    expect(CREDIT_BUDGETS.free).toBe(0);
    expect(CREDIT_BUDGETS.growth).toBe(2000);
    expect(CREDIT_BUDGETS.premium).toBe(Infinity);
  });

  describe('evaluateCreditBudget', () => {
    it('premium is always ok / within budget regardless of usage', () => {
      setMtdCredits(999_999);
      const e = evaluateCreditBudget('ws-1', 'premium');
      expect(e).toMatchObject({ tier: 'premium', budget: Infinity, status: 'ok', withinBudget: true, remaining: Infinity });
    });

    it('growth: under 80% → ok', () => {
      setMtdCredits(1000); // of 2000 = 50%
      expect(evaluateCreditBudget('ws-1', 'growth')).toMatchObject({ status: 'ok', withinBudget: true, remaining: 1000 });
    });

    it('growth: at 80% → warning (still within budget)', () => {
      setMtdCredits(1600); // 80%
      expect(evaluateCreditBudget('ws-1', 'growth')).toMatchObject({ status: 'warning', withinBudget: true });
    });

    it('growth: at/over 100% → critical, not within budget', () => {
      setMtdCredits(2000);
      expect(evaluateCreditBudget('ws-1', 'growth')).toMatchObject({ status: 'critical', withinBudget: false, remaining: 0 });
    });

    it('free: any spend is critical (budget 0)', () => {
      setMtdCredits(0.5);
      expect(evaluateCreditBudget('ws-1', 'free')).toMatchObject({ status: 'critical', withinBudget: false });
    });

    it('free: zero spend is healthy status but has no paid allowance (withinBudget false → gate blocks paid calls)', () => {
      setMtdCredits(0);
      // budget 0 → `0 < 0` is false, so a free workspace cannot make a NEW paid call,
      // but with nothing spent the health status is still ok (not an error condition).
      expect(evaluateCreditBudget('ws-1', 'free')).toMatchObject({ status: 'ok', withinBudget: false });
    });
  });

  describe('assertCreditBudget', () => {
    it('observe-only (default): never throws even when over budget', () => {
      setMtdCredits(5000); // way over growth
      expect(() => assertCreditBudget('ws-1', 'dataforseo_labs/google/ranked_keywords/live', 'growth')).not.toThrow();
    });

    it('observe-only over budget: logs the would-block with the operational context fields (no warn)', () => {
      setMtdCredits(5000);
      assertCreditBudget('ws-log', 'serp/google/organic/live/advanced', 'growth');
      expect(loggerMocks.info).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-log', endpoint: 'serp/google/organic/live/advanced', tier: 'growth', mtdCredits: 5000, budget: 2000 }),
        expect.stringMatching(/would-block/i),
      );
      // The enforce-path warn log must NOT fire in observe-only mode.
      expect(loggerMocks.warn).not.toHaveBeenCalled();
    });

    it('enforcement on + over budget: throws CreditBudgetError with stable code', () => {
      __setBudgetEnforcementForTesting(true);
      setMtdCredits(2500);
      try {
        assertCreditBudget('ws-1', 'serp/google/organic/live/advanced', 'growth');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CreditBudgetError);
        expect((err as CreditBudgetError).code).toBe('credit_budget_exceeded');
        expect((err as CreditBudgetError).tier).toBe('growth');
        expect((err as CreditBudgetError).endpoint).toBe('serp/google/organic/live/advanced');
      }
    });

    it('enforcement on + within budget: does not throw', () => {
      __setBudgetEnforcementForTesting(true);
      setMtdCredits(100);
      expect(() => assertCreditBudget('ws-1', 'endpoint', 'growth')).not.toThrow();
    });

    it('enforcement on + premium: never throws (unlimited)', () => {
      __setBudgetEnforcementForTesting(true);
      setMtdCredits(1_000_000);
      expect(() => assertCreditBudget('ws-1', 'endpoint', 'premium')).not.toThrow();
    });
  });
});
