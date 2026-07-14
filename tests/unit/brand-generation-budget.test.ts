import { describe, expect, it } from 'vitest';

import {
  addBrandGenerationBudgetUsage,
  assertBrandGenerationReservationFits,
  validateBrandGenerationBudgetEstimate,
  validateBrandGenerationBudgetRequest,
} from '../../server/domains/brand/generation/budget.js';
import {
  BrandGenerationBudgetExceededError,
  BrandGenerationPersistenceContractError,
} from '../../server/domains/brand/generation/errors.js';

describe('brand generation budgets', () => {
  const limits = validateBrandGenerationBudgetRequest({
    maxProviderCalls: 114,
    maxInputTokens: 5_000_000,
    maxOutputTokens: 250_000,
    maxEstimatedCostMicros: 100_000_000,
    maxConcurrency: 3,
  });

  it('accepts the exact platform ceiling and rejects every overrun dimension', () => {
    expect(limits).toEqual({
      providerCalls: 114,
      inputTokens: 5_000_000,
      outputTokens: 250_000,
      maxEstimatedCostMicros: 100_000_000,
      maxConcurrency: 3,
    });
    for (const request of [
      { maxProviderCalls: 115, maxInputTokens: 5_000_000, maxOutputTokens: 250_000, maxEstimatedCostMicros: 100_000_000, maxConcurrency: 3 },
      { maxProviderCalls: 114, maxInputTokens: 5_000_001, maxOutputTokens: 250_000, maxEstimatedCostMicros: 100_000_000, maxConcurrency: 3 },
      { maxProviderCalls: 114, maxInputTokens: 5_000_000, maxOutputTokens: 250_001, maxEstimatedCostMicros: 100_000_000, maxConcurrency: 3 },
      { maxProviderCalls: 114, maxInputTokens: 5_000_000, maxOutputTokens: 250_000, maxEstimatedCostMicros: 100_000_001, maxConcurrency: 3 },
      { maxProviderCalls: 114, maxInputTokens: 5_000_000, maxOutputTokens: 250_000, maxEstimatedCostMicros: 100_000_000, maxConcurrency: 4 },
    ]) {
      expect(() => validateBrandGenerationBudgetRequest(request))
        .toThrow(BrandGenerationBudgetExceededError);
    }
  });

  it('requires safe integer micros/tokens and keeps estimates under caller ceilings', () => {
    expect(() => validateBrandGenerationBudgetRequest({
      maxProviderCalls: 1.5,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxEstimatedCostMicros: 100,
      maxConcurrency: 1,
    })).toThrow(BrandGenerationPersistenceContractError);
    expect(() => validateBrandGenerationBudgetEstimate({
      providerCalls: 2,
      inputTokens: 100,
      outputTokens: 100,
      estimatedCostMicros: 100,
      maxConcurrency: 1,
    }, { ...limits, providerCalls: 1 })).toThrow(BrandGenerationBudgetExceededError);
  });

  it('adds pessimistic reservations without floating-point or ceiling drift', () => {
    const next = addBrandGenerationBudgetUsage(
      { providerCalls: 2, inputTokens: 10, outputTokens: 20, estimatedCostMicros: 30 },
      { providerCalls: 1, inputTokens: 40, outputTokens: 50, estimatedCostMicros: 60 },
    );
    expect(next).toEqual({
      providerCalls: 3,
      inputTokens: 50,
      outputTokens: 70,
      estimatedCostMicros: 90,
    });
    expect(() => assertBrandGenerationReservationFits(
      { ...next, providerCalls: 115 },
      limits,
    )).toThrow(BrandGenerationBudgetExceededError);
  });
});
