/**
 * Integration tests for server/routes/webflow-seo-audit.ts
 * Port: 13456
 *
 * Covers:
 * - GET /api/webflow/seo-audit/:siteId — route reachability and response shape
 *   - Route is registered and responds (not 404)
 *   - When no Webflow token is available for a site, returns 500 with a meaningful error
 *   - When a default WEBFLOW_API_TOKEN env var is set, the route attempts the audit
 *     and returns either 200 (with audit data) or 500 (with error) — never 404
 *
 * Note: This route makes live Webflow API calls. In test environments, a WEBFLOW_API_TOKEN
 * may or may not be configured. We test the route's observable contract: it is reachable,
 * and returns a consistent JSON response shape on both success and failure paths.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const PORT = 13456;
const ctx = createTestContext(PORT);

const FAKE_SITE_ID = 'fake-site-seo-audit-test-13456';

let workspaceId = '';

beforeAll(async () => {
  const ws = createWorkspace('seo-audit-test-ws-13456');
  workspaceId = ws.id;
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  if (workspaceId) deleteWorkspace(workspaceId);
});

// ---------------------------------------------------------------------------
// GET /api/webflow/seo-audit/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/seo-audit/:siteId', () => {
  it('route is reachable — returns a JSON response (not 404)', async () => {
    const res = await ctx.api(`/api/webflow/seo-audit/${FAKE_SITE_ID}`);
    expect(res.status).not.toBe(404);
    // Must be valid JSON
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(typeof body).toBe('object');
  });

  it('on error path, response has an "error" property with a string', async () => {
    const res = await ctx.api(`/api/webflow/seo-audit/${FAKE_SITE_ID}`);
    // If this siteId has no real Webflow token or the API call fails, returns 500 with error
    // If the env has a token and the audit somehow succeeds, returns 200 with audit data
    // Either way the response must be parseable JSON
    const body = await res.json() as Record<string, unknown>;
    if (res.status >= 400) {
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    }
  });

  it('passes skipLinkCheck query param and route still responds', async () => {
    const res = await ctx.api(`/api/webflow/seo-audit/${FAKE_SITE_ID}?skipLinkCheck=true`);
    expect(res.status).not.toBe(404);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('with no Webflow token at all — returns error about missing token', async () => {
    // Use a siteId that cannot possibly have a workspace with a stored token
    // and also assume WEBFLOW_API_TOKEN env var is not set (may be set in CI).
    // This test verifies the no-token error path is correct when it is hit.
    const res = await ctx.api(`/api/webflow/seo-audit/${FAKE_SITE_ID}`);
    // Status is either 200 (env token available) or 500 (no token at all)
    expect([200, 500]).toContain(res.status);
    const body = await res.json() as Record<string, unknown>;
    if (res.status === 500) {
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
      expect(body.error as string).toMatch(/token|audit failed/i);
    }
  });
});
