import { describe, expect, it } from 'vitest';
import { awaitSuccessfulRefetches } from '../../src/lib/reactQueryRefresh.js';

describe('awaitSuccessfulRefetches', () => {
  it('resolves when every React Query refetch result is successful', async () => {
    await expect(awaitSuccessfulRefetches([
      Promise.resolve({ error: null }),
      Promise.resolve({ error: null }),
    ])).resolves.toBeUndefined();
  });

  it('throws when refetch resolves with an error result', async () => {
    const error = new Error('provider unavailable');
    await expect(awaitSuccessfulRefetches([
      Promise.resolve({ error: null }),
      Promise.resolve({ error }),
    ])).rejects.toBe(error);
  });

  it('preserves a rejected refetch promise', async () => {
    const error = new Error('request aborted');
    await expect(awaitSuccessfulRefetches([
      Promise.reject(error),
    ])).rejects.toBe(error);
  });
});
