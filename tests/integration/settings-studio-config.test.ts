/**
 * Integration tests: settings + studio-config routes.
 *
 * Covers:
 *   - GET /api/settings → 200 with shape {hasWebflowToken, hasAnthropicKey, webflowToken}
 *   - PATCH /api/studio-config missing bookingUrl → 400
 *   - PATCH /api/studio-config invalid URL → 400
 *   - PATCH /api/studio-config non-http protocol → 400
 *   - PATCH /api/studio-config valid https URL → 200
 *   - PATCH /api/studio-config empty string (clear) → 200
 *   - GET /api/studio-config → 200 {bookingUrl}
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, authApi, authPatchJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
  ctx.setAuthToken('test-token');
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

describe('GET /api/settings', () => {
  it('returns 200 with required boolean fields', async () => {
    const res = await authApi('/api/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as { hasWebflowToken: boolean; hasAnthropicKey: boolean; webflowToken: string };
    expect(typeof body.hasWebflowToken).toBe('boolean');
    expect(typeof body.hasAnthropicKey).toBe('boolean');
    expect(typeof body.webflowToken).toBe('string');
  });
});

describe('GET /api/studio-config', () => {
  it('returns 200 with bookingUrl field', async () => {
    const res = await api('/api/studio-config');
    expect(res.status).toBe(200);
    const body = await res.json() as { bookingUrl: string };
    expect(typeof body.bookingUrl).toBe('string');
  });
});

describe('PATCH /api/studio-config', () => {
  it('returns 400 when bookingUrl is missing from body', async () => {
    const res = await authPatchJson('/api/studio-config', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('bookingUrl');
  });

  it('returns 400 for non-URL string', async () => {
    const res = await authPatchJson('/api/studio-config', { bookingUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid URL');
  });

  it('returns 400 for non-http(s) protocol', async () => {
    const res = await authPatchJson('/api/studio-config', { bookingUrl: 'ftp://example.com/book' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid URL');
  });

  it('returns 200 with a valid https URL', async () => {
    const res = await authPatchJson('/api/studio-config', { bookingUrl: 'https://calendly.com/test/30min' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; bookingUrl: string };
    expect(body.ok).toBe(true);
    expect(body.bookingUrl).toBe('https://calendly.com/test/30min');
  });

  it('returns 200 and clears bookingUrl when empty string passed', async () => {
    const res = await authPatchJson('/api/studio-config', { bookingUrl: '' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; bookingUrl: string | null };
    expect(body.ok).toBe(true);
    // Empty string clears the booking URL — route returns null or empty
    expect(body.bookingUrl == null || body.bookingUrl === '').toBe(true);
  });
});
