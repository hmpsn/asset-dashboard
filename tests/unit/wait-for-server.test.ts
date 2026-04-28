import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForServer } from '../integration/helpers.js';

describe('waitForServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves immediately when /api/health returns 200 on the first attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    await expect(
      waitForServer('http://localhost:9999', { maxRetries: 3, intervalMs: 10 })
    ).resolves.toBeUndefined();
  });

  it('polls the /api/health path specifically', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);
    await waitForServer('http://localhost:9999', { maxRetries: 1, intervalMs: 10 });
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:9999/api/health');
  });

  it('retries on non-200 and resolves when 200 eventually arrives', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    // Attach assertion before advancing timers to avoid unhandled rejection window
    const promise = waitForServer('http://localhost:9999', { maxRetries: 5, intervalMs: 10 });
    const assertion = expect(promise).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries when fetch throws (ECONNREFUSED) and resolves on eventual 200', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    // Attach assertion before advancing timers to avoid unhandled rejection window
    const promise = waitForServer('http://localhost:9999', { maxRetries: 5, intervalMs: 10 });
    const assertion = expect(promise).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503 }));

    // Attach rejection handler before advancing timers to avoid unhandled rejection window
    const promise = waitForServer('http://localhost:9999', { maxRetries: 3, intervalMs: 10 });
    const assertion = expect(promise).rejects.toThrow('did not become healthy after 3 retries');
    await vi.runAllTimersAsync();
    await assertion;
  });
});
