/**
 * Integration tests for server/routes/webflow-audit.ts
 *
 * Covers:
 * - GET /api/webflow/audit/:siteId — route reachability and response shape
 * - GET /api/webflow/page-weight/:siteId — route reachability and response shape
 * - GET /api/webflow/page-weight-snapshot/:siteId — pure DB read behavior
 *
 * Note: The audit and page-weight routes call the Webflow API (listAssets, scanAssetUsage).
 * In test environments, a WEBFLOW_API_TOKEN may be set as a fallback, causing these routes
 * to succeed (200) rather than error (500). We test the observable contract: the route is
 * reachable, returns valid JSON, and the response shape is consistent on both success and
 * error paths. The page-weight-snapshot route is a pure DB read.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);

const FAKE_SITE_ID = 'fake-site-audit-routes-test-13457-unique';

let workspaceId = '';

beforeAll(async () => {
  const ws = createWorkspace('audit-routes-test-ws-13457');
  workspaceId = ws.id;
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  if (workspaceId) deleteWorkspace(workspaceId);
});

// ---------------------------------------------------------------------------
// GET /api/webflow/audit/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/audit/:siteId', () => {
  it('route is reachable — returns a JSON response (not 404)', async () => {
    const res = await ctx.api(`/api/webflow/audit/${FAKE_SITE_ID}`);
    expect(res.status).not.toBe(404);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(typeof body).toBe('object');
  });

  it('on success returns audit summary shape with numeric fields', async () => {
    const res = await ctx.api(`/api/webflow/audit/${FAKE_SITE_ID}`);
    if (res.status === 200) {
      const body = await res.json() as Record<string, unknown>;
      // Audit success shape: numeric summary + issues array
      expect(typeof body.totalAssets).toBe('number');
      expect(typeof body.issueCount).toBe('number');
      expect(Array.isArray(body.issues)).toBe(true);
    }
  });

  it('on error path, response has an "error" property with a string', async () => {
    const res = await ctx.api(`/api/webflow/audit/${FAKE_SITE_ID}`);
    const body = await res.json() as Record<string, unknown>;
    if (res.status >= 400) {
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    }
  });

  it('status is either 200 (success) or 500 (Webflow API error)', async () => {
    const res = await ctx.api(`/api/webflow/audit/${FAKE_SITE_ID}`);
    expect([200, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/page-weight/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/page-weight/:siteId', () => {
  it('route is reachable — returns a JSON response (not 404)', async () => {
    const res = await ctx.api(`/api/webflow/page-weight/${FAKE_SITE_ID}`);
    expect(res.status).not.toBe(404);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('on success returns page weight summary shape', async () => {
    const res = await ctx.api(`/api/webflow/page-weight/${FAKE_SITE_ID}`);
    if (res.status === 200) {
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.totalPages).toBe('number');
      expect(typeof body.totalAssetSize).toBe('number');
      expect(Array.isArray(body.pages)).toBe(true);
    }
  });

  it('on error path, response has an "error" property', async () => {
    const res = await ctx.api(`/api/webflow/page-weight/${FAKE_SITE_ID}`);
    const body = await res.json() as Record<string, unknown>;
    if (res.status >= 400) {
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    }
  });

  it('status is either 200 (success) or 500 (Webflow API error)', async () => {
    const res = await ctx.api(`/api/webflow/page-weight/${FAKE_SITE_ID}`);
    expect([200, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/page-weight-snapshot/:siteId — pure DB read
// ---------------------------------------------------------------------------

describe('GET /api/webflow/page-weight-snapshot/:siteId', () => {
  it('route is reachable for any siteId and returns 200', async () => {
    // Use a siteId that is completely unique and has never had data saved
    const uniqueSite = `never-stored-site-${Date.now()}`;
    const res = await ctx.api(`/api/webflow/page-weight-snapshot/${uniqueSite}`);
    expect(res.status).toBe(200);
  });

  it('returns null for a siteId with no stored snapshot', async () => {
    const uniqueSite = `no-snapshot-site-${Date.now()}-${Math.random()}`;
    const res = await ctx.api(`/api/webflow/page-weight-snapshot/${uniqueSite}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns a Snapshot object after page-weight has been computed for the same siteId', async () => {
    // First, trigger a page-weight request to populate the snapshot (if it succeeds)
    const populateSiteId = `audit-test-snapshot-${Date.now()}`;
    const pwRes = await ctx.api(`/api/webflow/page-weight/${populateSiteId}`);

    if (pwRes.status === 200) {
      // The route saves the result as a snapshot — verify it can be retrieved
      const snapRes = await ctx.api(`/api/webflow/page-weight-snapshot/${populateSiteId}`);
      expect(snapRes.status).toBe(200);
      const body = await snapRes.json() as Record<string, unknown>;
      // Snapshot shape: { siteId, createdAt, result }
      expect(body).not.toBeNull();
      expect(body).toHaveProperty('siteId');
      expect(body).toHaveProperty('createdAt');
      expect(body).toHaveProperty('result');
    }
    // If page-weight returned 500, snapshot stays null — already covered by previous test
  });
});
