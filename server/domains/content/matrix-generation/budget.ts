import type { MatrixGenerationBudgetUsage } from '../../../../shared/types/matrix-generation.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';

const PROVIDER_COST_MICROS_PER_TOKEN = {
  anthropic: { input: 3, output: 15 },
  openai: { input: 5, output: 30 },
} as const;

const PROVIDER_FRAMING_TOKEN_CEILING = 512;

export function matrixGenerationInputReservationCeiling(serializedUtf8Bytes: number): number {
  return serializedUtf8Bytes + PROVIDER_FRAMING_TOKEN_CEILING;
}

/** OpenAI-rate ceiling used by preview so exact accepted cost never rounds below runtime. */
export function matrixGenerationEstimatedUsdCeiling(inputTokens: number, outputTokens: number): number {
  const micros = (inputTokens * PROVIDER_COST_MICROS_PER_TOKEN.openai.input)
    + (outputTokens * PROVIDER_COST_MICROS_PER_TOKEN.openai.output);
  return Math.ceil(micros / 100) / 10_000;
}

/** Pessimistic reservation for the exact rendered dispatch. UTF-8 bytes cap input tokens. */
export function matrixGenerationProviderReservation(
  dispatch: BoundedProviderDispatch,
): MatrixGenerationBudgetUsage {
  const inputTokens = matrixGenerationInputReservationCeiling(Buffer.byteLength(JSON.stringify({
    system: dispatch.renderedInput.system,
    messages: dispatch.renderedInput.messages,
  }), 'utf8'));
  const outputTokens = dispatch.maxOutputTokens;
  const rates = PROVIDER_COST_MICROS_PER_TOKEN[dispatch.provider];
  const costMicros = (inputTokens * rates.input) + (outputTokens * rates.output);
  return {
    providerCalls: 1,
    inputTokens,
    outputTokens,
    estimatedUsd: Math.ceil(costMicros) / 1_000_000,
  };
}
