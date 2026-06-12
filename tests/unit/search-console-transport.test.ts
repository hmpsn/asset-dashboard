import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getValidToken: vi.fn<[], Promise<string | null>>(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../server/google-auth.js', () => ({
  getValidToken: mocks.getValidToken,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => mocks.logger,
}));

import {
  inspectUrlForRichResults,
  listGscSites,
} from '../../server/search-console.js';

beforeEach(() => {
  mocks.getValidToken.mockResolvedValue('valid-token');
  mocks.logger.warn.mockReset();
  mocks.logger.error.mockReset();
  mocks.logger.info.mockReset();
  mocks.logger.debug.mockReset();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listGscSites', () => {
  it('returns site entries from the shared Google client', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      siteEntry: [
        { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(listGscSites('site-1')).resolves.toEqual([
      { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
    ]);
  });

  it('preserves the GSC HTTP error envelope on provider failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    })));

    await expect(listGscSites('site-1')).rejects.toThrow('GSC API error (403): Forbidden');
  });

  it('surfaces invalid JSON with the shared provider error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(listGscSites('site-1')).rejects.toThrow('GSC API error (invalid-json): ');
  });
});

describe('inspectUrlForRichResults', () => {
  it('returns null when the provider reports quota exhaustion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Quota exhausted', {
      status: 429,
      headers: { 'Content-Type': 'text/plain' },
    })));

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/page', 'sc-domain:example.com'),
    ).resolves.toBeNull();
  });

  it('throws a dedicated authentication error for 401/403 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    })));

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/page', 'sc-domain:example.com'),
    ).rejects.toThrow('GSC URL Inspection authentication error (401): invalid_grant');
  });

  it('treats other client-side provider failures as no_gsc', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })));

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/page', 'sc-domain:example.com'),
    ).resolves.toBeNull();
  });

  it('throws the inspection error envelope for 5xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('backend unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })));

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/page', 'sc-domain:example.com'),
    ).rejects.toThrow('GSC URL Inspection error (503): backend unavailable');
  });

  it('throws a timeout envelope for non-HTTP transport failures', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abortError;
    }));

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/page', 'sc-domain:example.com'),
    ).rejects.toThrow('GSC URL Inspection error (timeout): ');
  });
});
