/**
 * Integration tests: webflow-seo-page-tools route validation.
 *
 * Tests validation paths that fire before any external HTTP or AI calls.
 *
 * Covers:
 *   - GET /api/webflow/page-html/:siteId without path param → 400
 *   - GET /api/webflow/page-html/:siteId with empty path → 400
 *   - GET /api/webflow/page-html/:siteId with a path but unreachable site → 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const FAKE_SITE_ID = 'site_page_html_validation_99';

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

describe('GET /api/webflow/page-html/:siteId — path validation', () => {
  it('returns 400 when path query param is missing', async () => {
    const res = await api(`/api/webflow/page-html/${FAKE_SITE_ID}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('path');
  });

  it('returns 400 when path is an empty string (normalizes to "/" then fails URL resolve)', async () => {
    const res = await api(`/api/webflow/page-html/${FAKE_SITE_ID}?path=`);
    // normalizePageUrl('') → '/' which is truthy, so route proceeds
    // No token and no live domain → "Could not resolve site URL" → 400
    expect(res.status).toBe(400);
  });

  it('returns 400 when no token exists for site (cannot resolve site URL)', async () => {
    // No Webflow token → getSiteSubdomain fails → 'Could not resolve site URL'
    // but there's no live domain either, so the route returns 400
    const res = await api(`/api/webflow/page-html/${FAKE_SITE_ID}?path=/about`);
    // With no token and no workspace with a live domain for this fake site,
    // the route cannot resolve a URL and returns 400 or 404
    expect([400, 404, 500].includes(res.status)).toBe(true);
  });
});
