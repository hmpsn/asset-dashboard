import { abortableDelay, throwIfSignalAborted } from './abort-helpers.js';

interface RetryLogger {
  info: (message: string) => void;
}

interface RetryableProviderErrorOptions {
  retryLog: string;
  waitMs: number;
}

export class RetryableProviderError extends Error {
  readonly retryLog: string;
  readonly waitMs: number;

  constructor(message: string, opts: RetryableProviderErrorOptions) {
    super(message);
    this.name = 'RetryableProviderError';
    this.retryLog = opts.retryLog;
    this.waitMs = opts.waitMs;
  }
}

export function buildProviderRetryDelayMs(opts: {
  attempt: number;
  retryAfterHeader?: string | null;
  retryAfterUnit?: 'seconds' | 'milliseconds';
  baseMs?: number;
  capMs?: number;
}): number {
  const {
    attempt,
    retryAfterHeader,
    retryAfterUnit = 'seconds',
    baseMs = 2000,
    capMs = 30_000,
  } = opts;

  let waitMs = Math.min(baseMs * Math.pow(2, attempt), capMs);
  if (!retryAfterHeader) return waitMs;

  const parsed = Number.parseInt(retryAfterHeader, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return waitMs;

  const retryAfterMs = retryAfterUnit === 'milliseconds'
    ? parsed + 500
    : (parsed * 1000) + 500;
  return Math.max(retryAfterMs, waitMs);
}

export async function withProviderRetry<T>(opts: {
  feature: string;
  providerLabel: string;
  logger: RetryLogger;
  maxRetries: number;
  signal?: AbortSignal;
  cancelMessage?: string;
  attemptDenominator?: number;
  run: (attempt: number) => Promise<T>;
}): Promise<T> {
  const {
    feature,
    providerLabel,
    logger,
    maxRetries,
    signal,
    cancelMessage = 'AI request cancelled',
    attemptDenominator = maxRetries,
    run,
  } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      throwIfSignalAborted(signal, cancelMessage);
      return await run(attempt);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt === maxRetries) throw err;

      if (err instanceof RetryableProviderError) {
        logger.info(err.retryLog);
        await abortableDelay(err.waitMs, signal, cancelMessage);
        continue;
      }

      if (err instanceof Error && err.name === 'TimeoutError') {
        logger.info(`[${feature}] ${providerLabel} timeout, retrying (attempt ${attempt + 1}/${attemptDenominator})`);
        await abortableDelay(2000 * (attempt + 1), signal, cancelMessage);
        continue;
      }

      const message = err instanceof Error ? err.message : String(err);
      logger.info(`[${feature}] ${providerLabel} error: ${message}, retrying (attempt ${attempt + 1}/${attemptDenominator})`);
      await abortableDelay(2000 * Math.pow(2, attempt), signal, cancelMessage);
    }
  }

  throw new Error(`[${feature}] ${providerLabel} call failed after ${maxRetries} retries`);
}
