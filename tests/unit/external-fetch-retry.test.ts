import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.stubGlobal('fetch', mocks.fetchMock);

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}));

import { ExternalFetchError, fetchProviderJson } from '../../server/external-fetch.js';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return okResponse(body); },
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    clone() {
      return { text: async () => `error body ${status}` } as unknown as Response;
    },
  } as unknown as Response;
}

const URL_UNDER_TEST = 'https://api.dataforseo.example/v3/keywords';
// Tiny backoff keeps the retry tests sub-millisecond.
const FAST_RETRY = { maxRetries: 2, baseDelayMs: 1 };

describe('external-fetch bounded retry (P5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient 429 then succeeds (does not collapse to empty)', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse({ ok: 1 }));

    const result = await fetchProviderJson<{ ok: number }>({ url: URL_UNDER_TEST, retry: FAST_RETRY });

    expect(result).toEqual({ ok: 1 });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries on persistent 429 (FM-2: surfaced, never silent-empty)', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(errResponse(429));

    await expect(fetchProviderJson({ url: URL_UNDER_TEST, retry: FAST_RETRY }))
      .rejects.toMatchObject({ kind: 'http', status: 429 });
    // maxRetries 2 → 3 total attempts.
    expect(mocks.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a permanent 402 (credit-exhausted) — fails immediately', async () => {
    mocks.fetchMock.mockResolvedValueOnce(errResponse(402));

    await expect(fetchProviderJson({ url: URL_UNDER_TEST, retry: FAST_RETRY }))
      .rejects.toBeInstanceOf(ExternalFetchError);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a permanent 401 (auth) — fails immediately', async () => {
    mocks.fetchMock.mockResolvedValueOnce(errResponse(401));

    await expect(fetchProviderJson({ url: URL_UNDER_TEST, retry: FAST_RETRY }))
      .rejects.toMatchObject({ status: 401 });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network error then succeeds', async () => {
    mocks.fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse({ recovered: true }));

    const result = await fetchProviderJson<{ recovered: boolean }>({ url: URL_UNDER_TEST, retry: FAST_RETRY });

    expect(result).toEqual({ recovered: true });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a timeout / abort (respects per-attempt budget + caller cancellation)', async () => {
    const abort = new Error('aborted by signal');
    (abort as Error & { name: string }).name = 'AbortError';
    mocks.fetchMock.mockRejectedValueOnce(abort);

    await expect(fetchProviderJson({ url: URL_UNDER_TEST, retry: FAST_RETRY }))
      .rejects.toMatchObject({ kind: 'timeout' });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes a single attempt when retry is omitted (maxRetries 0)', async () => {
    mocks.fetchMock.mockResolvedValueOnce(errResponse(503));

    await expect(fetchProviderJson({ url: URL_UNDER_TEST, retry: { maxRetries: 0 } }))
      .rejects.toMatchObject({ status: 503 });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });
});
