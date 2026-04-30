/**
 * Unit tests for fetchImageAsBase64 — converts a remote image URL into a
 * data: URL suitable for OpenAI vision message content. Must never throw;
 * caller (AI classifier) needs to fall through to rule-based when fetch
 * fails or content-type is unsupported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchImageAsBase64 } from '../../../../server/schema/extractors/page-elements/image-fetch.js';

describe('fetchImageAsBase64', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns a data: URL on a successful image fetch', async () => {
    const fakeBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
    globalThis.fetch = vi.fn(async () => new Response(fakeBytes, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    })) as typeof globalThis.fetch;

    const result = await fetchImageAsBase64('https://example.com/img.jpg');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    expect(result!.length).toBeGreaterThan('data:image/jpeg;base64,'.length);
  });

  it('returns null on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 })) as typeof globalThis.fetch;
    const result = await fetchImageAsBase64('https://example.com/missing.jpg');
    expect(result).toBeNull();
  });

  it('returns null on unsupported content-type', async () => {
    globalThis.fetch = vi.fn(async () => new Response('text', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })) as typeof globalThis.fetch;
    const result = await fetchImageAsBase64('https://example.com/page.html');
    expect(result).toBeNull();
  });

  it('returns null on fetch throw (network failure)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as typeof globalThis.fetch;
    const result = await fetchImageAsBase64('https://unreachable.example/img.jpg');
    expect(result).toBeNull();
  });

  it('respects 5-second timeout via AbortController', async () => {
    let abortFired = false;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      // Listen for abort; resolve never (would hang) unless aborted.
      return await new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            abortFired = true;
            reject(new Error('aborted'));
          });
        }
      });
    }) as typeof globalThis.fetch;

    const result = await fetchImageAsBase64('https://example.com/slow.jpg', { timeoutMs: 50 });
    expect(result).toBeNull();
    expect(abortFired).toBe(true);
  });

  it('accepts known image content-types: jpeg, png, webp, gif', async () => {
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    for (const ct of types) {
      globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': ct },
      })) as typeof globalThis.fetch;
      const result = await fetchImageAsBase64(`https://example.com/x.${ct.split('/')[1]}`);
      expect(result).toMatch(new RegExp(`^data:${ct.replace('/', '\\/')};base64,`));
    }
  });
});
