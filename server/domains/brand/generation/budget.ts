import {
  BRAND_GENERATION_LIMITS,
  type BrandGenerationBudgetEstimate,
  type BrandGenerationBudgetLimits,
  type BrandGenerationBudgetRequest,
  type BrandGenerationBudgetUsage,
} from '../../../../shared/types/brand-generation.js';
import {
  BrandGenerationBudgetExceededError,
  BrandGenerationPersistenceContractError,
} from './errors.js';

function requireInteger(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new BrandGenerationPersistenceContractError(
      `Brand generation ${name} must be a safe integer at least ${minimum}`,
    );
  }
}

export function validateBrandGenerationBudgetRequest(
  request: BrandGenerationBudgetRequest,
): BrandGenerationBudgetLimits {
  requireInteger('provider call limit', request.maxProviderCalls, 1);
  requireInteger('input token limit', request.maxInputTokens, 1);
  requireInteger('output token limit', request.maxOutputTokens, 1);
  requireInteger('estimated cost limit', request.maxEstimatedCostMicros, 1);
  requireInteger('concurrency limit', request.maxConcurrency, 1);

  const checks = [
    ['providerCalls', request.maxProviderCalls, BRAND_GENERATION_LIMITS.maxProviderCalls],
    ['inputTokens', request.maxInputTokens, BRAND_GENERATION_LIMITS.maxInputTokens],
    ['outputTokens', request.maxOutputTokens, BRAND_GENERATION_LIMITS.maxOutputTokens],
    ['estimatedCostMicros', request.maxEstimatedCostMicros, BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros],
    ['maxConcurrency', request.maxConcurrency, BRAND_GENERATION_LIMITS.maxConcurrency],
  ] as const;
  for (const [dimension, requested, maximum] of checks) {
    if (requested > maximum) {
      throw new BrandGenerationBudgetExceededError(dimension, requested, maximum);
    }
  }

  return {
    providerCalls: request.maxProviderCalls,
    inputTokens: request.maxInputTokens,
    outputTokens: request.maxOutputTokens,
    maxEstimatedCostMicros: request.maxEstimatedCostMicros,
    maxConcurrency: request.maxConcurrency,
  };
}

export function validateBrandGenerationBudgetEstimate(
  estimate: BrandGenerationBudgetEstimate,
  limits: BrandGenerationBudgetLimits,
): BrandGenerationBudgetEstimate {
  requireInteger('estimated provider calls', estimate.providerCalls, 0);
  requireInteger('estimated input tokens', estimate.inputTokens, 0);
  requireInteger('estimated output tokens', estimate.outputTokens, 0);
  requireInteger('estimated cost micros', estimate.estimatedCostMicros, 0);
  requireInteger('estimated concurrency', estimate.maxConcurrency, 1);

  const checks = [
    ['providerCalls', estimate.providerCalls, limits.providerCalls],
    ['inputTokens', estimate.inputTokens, limits.inputTokens],
    ['outputTokens', estimate.outputTokens, limits.outputTokens],
    ['estimatedCostMicros', estimate.estimatedCostMicros, limits.maxEstimatedCostMicros],
    ['maxConcurrency', estimate.maxConcurrency, limits.maxConcurrency],
  ] as const;
  for (const [dimension, requested, limit] of checks) {
    if (requested > limit) {
      throw new BrandGenerationBudgetExceededError(dimension, requested, limit);
    }
  }
  return estimate;
}

export function validateBrandGenerationBudgetUsage(
  usage: BrandGenerationBudgetUsage,
): BrandGenerationBudgetUsage {
  requireInteger('reserved provider calls', usage.providerCalls, 0);
  requireInteger('reserved input tokens', usage.inputTokens, 0);
  requireInteger('reserved output tokens', usage.outputTokens, 0);
  requireInteger('reserved cost micros', usage.estimatedCostMicros, 0);
  return usage;
}

export function addBrandGenerationBudgetUsage(
  current: BrandGenerationBudgetUsage,
  reservation: BrandGenerationBudgetUsage,
): BrandGenerationBudgetUsage {
  validateBrandGenerationBudgetUsage(current);
  validateBrandGenerationBudgetUsage(reservation);
  const next = {
    providerCalls: current.providerCalls + reservation.providerCalls,
    inputTokens: current.inputTokens + reservation.inputTokens,
    outputTokens: current.outputTokens + reservation.outputTokens,
    estimatedCostMicros: current.estimatedCostMicros + reservation.estimatedCostMicros,
  };
  for (const [name, value] of Object.entries(next)) {
    if (!Number.isSafeInteger(value)) {
      throw new BrandGenerationPersistenceContractError(
        `Brand generation ${name} reservation overflowed the safe-integer range`,
      );
    }
  }
  return next;
}

export function assertBrandGenerationReservationFits(
  next: BrandGenerationBudgetUsage,
  limits: BrandGenerationBudgetLimits,
): void {
  const checks = [
    ['providerCalls', next.providerCalls, limits.providerCalls],
    ['inputTokens', next.inputTokens, limits.inputTokens],
    ['outputTokens', next.outputTokens, limits.outputTokens],
    ['estimatedCostMicros', next.estimatedCostMicros, limits.maxEstimatedCostMicros],
  ] as const;
  for (const [dimension, requested, limit] of checks) {
    if (requested > limit) {
      throw new BrandGenerationBudgetExceededError(dimension, requested, limit);
    }
  }
}
