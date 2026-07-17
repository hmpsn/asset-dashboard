import type { MatrixGenerationBudgetUsage } from '../../../../shared/types/matrix-generation.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';

const PROVIDER_COST_MICROS_PER_TOKEN = {
  anthropic: { input: 3, output: 15 },
  openai: { input: 5, output: 30 },
} as const;

const PROVIDER_FRAMING_TOKEN_CEILING = 512;
const ESTIMATED_UTF8_BYTES_PER_INPUT_TOKEN = 4;

/**
 * Matrix-specific application envelope for one exact rendered provider input.
 * This is not a provider-native context-window claim. Preview uses the same
 * bound for estimates and the worker enforces it against serialized UTF-8
 * immediately before reserving and dispatching each paid call.
 * Output remains independently bounded by each stage's maxOutputTokens and by
 * the accepted batch output-token limit; these input bytes do not reserve
 * completion context.
 */
export const MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES = 2 * 1_024 * 1_024;
// Leaves room for the bounded 25-candidate set-audit input while holding the
// frozen authority slice to 128 KiB across every individual dispatch.
export const MATRIX_GENERATION_NON_AUTHORITY_HEADROOM_UTF8_BYTES = 1_920 * 1_024;
export const MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING =
  MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES
  - MATRIX_GENERATION_NON_AUTHORITY_HEADROOM_UTF8_BYTES;

export class MatrixGenerationProviderInputEnvelopeError extends Error {
  readonly actualUtf8Bytes: number;
  readonly maxUtf8Bytes = MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES;

  constructor(actualUtf8Bytes: number) {
    super('Matrix generation provider input exceeds its application envelope');
    this.name = 'MatrixGenerationProviderInputEnvelopeError';
    this.actualUtf8Bytes = actualUtf8Bytes;
  }
}

export function matrixGenerationInputReservationCeiling(serializedUtf8Bytes: number): number {
  return Math.ceil(serializedUtf8Bytes / ESTIMATED_UTF8_BYTES_PER_INPUT_TOKEN)
    + PROVIDER_FRAMING_TOKEN_CEILING;
}

export const MATRIX_GENERATION_PROVIDER_INPUT_TOKEN_RESERVATION_CEILING =
  matrixGenerationInputReservationCeiling(MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES);
export const MATRIX_GENERATION_PROVIDER_FRAMING_TOKEN_RESERVATION =
  matrixGenerationInputReservationCeiling(0);
export const MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET =
  matrixGenerationInputReservationCeiling(MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING)
  - MATRIX_GENERATION_PROVIDER_FRAMING_TOKEN_RESERVATION;

export function matrixGenerationProjectionTokenEstimate(value: string): number {
  return matrixGenerationInputReservationCeiling(Buffer.byteLength(value, 'utf8'))
    - MATRIX_GENERATION_PROVIDER_FRAMING_TOKEN_RESERVATION;
}

export function assertMatrixGenerationEstimatedProviderInput(inputTokens: number): void {
  if (inputTokens > MATRIX_GENERATION_PROVIDER_INPUT_TOKEN_RESERVATION_CEILING) {
    const estimatedBytes = Math.max(
      0,
      (inputTokens - MATRIX_GENERATION_PROVIDER_FRAMING_TOKEN_RESERVATION)
        * ESTIMATED_UTF8_BYTES_PER_INPUT_TOKEN,
    );
    throw new MatrixGenerationProviderInputEnvelopeError(estimatedBytes);
  }
}

export function matrixGenerationRenderedInputUtf8Bytes(
  dispatch: BoundedProviderDispatch,
): number {
  return Buffer.byteLength(JSON.stringify({
    system: dispatch.renderedInput.system,
    messages: dispatch.renderedInput.messages,
  }), 'utf8');
}

/** OpenAI-rate ceiling used by preview so exact accepted cost never rounds below runtime. */
export function matrixGenerationEstimatedUsdCeiling(inputTokens: number, outputTokens: number): number {
  const micros = (inputTokens * PROVIDER_COST_MICROS_PER_TOKEN.openai.input)
    + (outputTokens * PROVIDER_COST_MICROS_PER_TOKEN.openai.output);
  return Math.ceil(micros / 100) / 10_000;
}

/** Pessimistic reservation for the exact rendered dispatch using the shared 4:1 estimate. */
export function matrixGenerationProviderReservation(
  dispatch: BoundedProviderDispatch,
): MatrixGenerationBudgetUsage {
  const serializedUtf8Bytes = matrixGenerationRenderedInputUtf8Bytes(dispatch);
  if (serializedUtf8Bytes > MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES) {
    throw new MatrixGenerationProviderInputEnvelopeError(serializedUtf8Bytes);
  }
  const inputTokens = matrixGenerationInputReservationCeiling(serializedUtf8Bytes);
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
