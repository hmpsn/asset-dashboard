import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  abortableDelay: vi.fn(),
  throwIfSignalAborted: vi.fn(),
}));

vi.mock('../../server/abort-helpers.js', () => ({
  abortableDelay: mocks.abortableDelay,
  throwIfSignalAborted: mocks.throwIfSignalAborted,
}));

import {
  buildProviderRetryDelayMs,
  RetryableProviderError,
  withProviderRetry,
} from '../../server/ai-provider-retry.js';

describe('buildProviderRetryDelayMs', () => {
  it('prefers retry-after milliseconds headers when they exceed the base backoff', () => {
    expect(buildProviderRetryDelayMs({
      attempt: 0,
      retryAfterHeader: '2500',
      retryAfterUnit: 'milliseconds',
    })).toBe(3000);
  });

  it('parses retry-after seconds headers', () => {
    expect(buildProviderRetryDelayMs({
      attempt: 0,
      retryAfterHeader: '4',
      retryAfterUnit: 'seconds',
    })).toBe(4500);
  });
});

describe('withProviderRetry', () => {
  const logger = { info: vi.fn() };

  beforeEach(() => {
    logger.info.mockReset();
    mocks.abortableDelay.mockReset();
    mocks.abortableDelay.mockResolvedValue(undefined);
    mocks.throwIfSignalAborted.mockReset();
  });

  it('retries retryable provider errors before succeeding', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new RetryableProviderError('rate limited', {
        waitMs: 3200,
        retryLog: '[feature] provider 429, retrying in 3.2s (attempt 1/1)',
      }))
      .mockResolvedValueOnce('ok');

    const result = await withProviderRetry({
      feature: 'feature',
      providerLabel: 'Provider',
      logger,
      maxRetries: 1,
      run,
    });

    expect(result).toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('[feature] provider 429, retrying in 3.2s (attempt 1/1)');
    expect(mocks.abortableDelay).toHaveBeenCalledWith(3200, undefined, 'AI request cancelled');
  });

  it('retries timeout errors with linear backoff before succeeding', async () => {
    const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const run = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce('ok');

    const result = await withProviderRetry({
      feature: 'timeout-feature',
      providerLabel: 'Provider',
      logger,
      maxRetries: 1,
      run,
    });

    expect(result).toBe('ok');
    expect(logger.info).toHaveBeenCalledWith('[timeout-feature] Provider timeout, retrying (attempt 1/1)');
    expect(mocks.abortableDelay).toHaveBeenCalledWith(2000, undefined, 'AI request cancelled');
  });

  it('rethrows the final failure without another retry', async () => {
    const finalError = new Error('boom');
    const run = vi.fn().mockRejectedValue(finalError);

    await expect(withProviderRetry({
      feature: 'final-feature',
      providerLabel: 'Provider',
      logger,
      maxRetries: 0,
      run,
    })).rejects.toBe(finalError);

    expect(logger.info).not.toHaveBeenCalled();
    expect(mocks.abortableDelay).not.toHaveBeenCalled();
  });

  it('propagates cancellation during backoff without starting another attempt', async () => {
    const controller = new AbortController();
    const cancellation = new Error('AI request cancelled');
    const run = vi.fn().mockRejectedValueOnce(new RetryableProviderError('rate limited', {
      waitMs: 1500,
      retryLog: '[cancel-feature] Provider 429, retrying in 1.5s (attempt 1/1)',
    }));

    mocks.abortableDelay.mockImplementationOnce(async () => {
      controller.abort();
      throw cancellation;
    });

    await expect(withProviderRetry({
      feature: 'cancel-feature',
      providerLabel: 'Provider',
      logger,
      maxRetries: 1,
      signal: controller.signal,
      run,
    })).rejects.toBe(cancellation);

    expect(run).toHaveBeenCalledTimes(1);
  });
});
