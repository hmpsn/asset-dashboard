/**
 * Integration tests for server/routes/webflow-schema.ts
 *
 * Covers:
 * - GET /api/webflow/schema-snapshot/:siteId — pure DB read; unknown siteId → null
 * - GET /api/webflow/schema-page-types/:siteId — pure DB read; unknown siteId → empty array
 * - PUT /api/webflow/schema-page-types/:siteId — Zod validation errors on missing fields
 * - GET /api/webflow/schema-plan/:siteId — pure DB read; unknown siteId → null
 * - GET /api/webflow/schema-history/:siteId/:pageId — pure DB read; unknown → empty history
 * - GET /api/webflow/schema-graph-validation/:siteId — pure DB read; unknown → valid structure
 * - POST /api/webflow/schema-validate/:siteId — Zod validation; missing fields → 400
 * - GET /api/webflow/schema-validation/:siteId — missing pageId query param → 400
 * - GET /api/webflow/schema-validations/:siteId — unknown site → returns array
 * - DELETE /api/webflow/schema-validation/:siteId — missing pageId → 400
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);

const FAKE_SITE_ID = 'fake-site-schema-test-13455';

let workspaceId = '';

beforeAll(async () => {
  const ws = createWorkspace('schema-validation-test-ws-13455');
  workspaceId = ws.id;
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  if (workspaceId) deleteWorkspace(workspaceId);
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-snapshot/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-snapshot/:siteId', () => {
  it('returns null for an unknown siteId (no snapshot stored)', async () => {
    const res = await ctx.api(`/api/webflow/schema-snapshot/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-page-types/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-page-types/:siteId', () => {
  it('returns pageTypes object (empty) for an unknown siteId', async () => {
    const res = await ctx.api(`/api/webflow/schema-page-types/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { pageTypes: Record<string, string> };
    expect(body).toHaveProperty('pageTypes');
    // getPageTypes returns Record<string, string> — not an array
    expect(typeof body.pageTypes).toBe('object');
    expect(Array.isArray(body.pageTypes)).toBe(false);
    // For an unknown siteId, no page types are stored → empty object
    expect(Object.keys(body.pageTypes)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/webflow/schema-page-types/:siteId — Zod validation
// ---------------------------------------------------------------------------

describe('PUT /api/webflow/schema-page-types/:siteId', () => {
  it('returns 400 when body is empty (missing pageId and pageType)', async () => {
    const res = await ctx.api(`/api/webflow/schema-page-types/${FAKE_SITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when pageId is missing', async () => {
    const res = await ctx.api(`/api/webflow/schema-page-types/${FAKE_SITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageType: 'BlogPosting' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when pageType is missing', async () => {
    const res = await ctx.api(`/api/webflow/schema-page-types/${FAKE_SITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-1' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when pageId is an empty string', async () => {
    const res = await ctx.api(`/api/webflow/schema-page-types/${FAKE_SITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: '', pageType: 'BlogPosting' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('succeeds with valid pageId and pageType', async () => {
    const res = await ctx.api(`/api/webflow/schema-page-types/${FAKE_SITE_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-xyz', pageType: 'BlogPosting' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-plan/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-plan/:siteId', () => {
  it('returns null for an unknown siteId (no plan stored)', async () => {
    const res = await ctx.api(`/api/webflow/schema-plan/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-history/:siteId/:pageId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-history/:siteId/:pageId', () => {
  it('returns an object with history array for unknown site/page', async () => {
    const res = await ctx.api(`/api/webflow/schema-history/${FAKE_SITE_ID}/fake-page-id`);
    expect(res.status).toBe(200);
    const body = await res.json() as { history: unknown[] };
    expect(body).toHaveProperty('history');
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-graph-validation/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-graph-validation/:siteId', () => {
  it('returns a validation result structure for an unknown siteId', async () => {
    const res = await ctx.api(`/api/webflow/schema-graph-validation/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Should return validation result (object), not null
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/schema-validate/:siteId — Zod validation
// ---------------------------------------------------------------------------

describe('POST /api/webflow/schema-validate/:siteId', () => {
  it('returns 400 when body is empty (missing pageId and schema)', async () => {
    const res = await ctx.postJson(`/api/webflow/schema-validate/${FAKE_SITE_ID}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when pageId is missing', async () => {
    const res = await ctx.postJson(`/api/webflow/schema-validate/${FAKE_SITE_ID}`, {
      schema: { '@context': 'https://schema.org', '@graph': [] },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when schema is missing', async () => {
    const res = await ctx.postJson(`/api/webflow/schema-validate/${FAKE_SITE_ID}`, {
      pageId: 'page-1',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when pageId is an empty string', async () => {
    const res = await ctx.postJson(`/api/webflow/schema-validate/${FAKE_SITE_ID}`, {
      pageId: '',
      schema: { '@context': 'https://schema.org', '@graph': [] },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('validates a valid schema and returns a validation result', async () => {
    const res = await ctx.postJson(`/api/webflow/schema-validate/${FAKE_SITE_ID}`, {
      pageId: 'page-valid',
      schema: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebPage',
            '@id': 'https://example.com/page#webpage',
            name: 'Test Page',
            url: 'https://example.com/page',
            description: 'A test page',
            isPartOf: { '@id': 'https://example.com/#website' },
            inLanguage: 'en',
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body).toHaveProperty('status');
    expect(['valid', 'warnings', 'errors']).toContain(body.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-validation/:siteId — missing pageId → 400
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-validation/:siteId', () => {
  it('returns 400 when pageId query param is missing', async () => {
    const res = await ctx.api(`/api/webflow/schema-validation/${FAKE_SITE_ID}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/pageId/i);
  });

  it('returns null for a page with no stored validation', async () => {
    const res = await ctx.api(`/api/webflow/schema-validation/${FAKE_SITE_ID}?pageId=nonexistent-page`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/webflow/schema-validations/:siteId
// ---------------------------------------------------------------------------

describe('GET /api/webflow/schema-validations/:siteId', () => {
  it('returns an array (possibly empty) for an unknown siteId', async () => {
    const res = await ctx.api(`/api/webflow/schema-validations/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/webflow/schema-validation/:siteId — missing pageId → 400
// ---------------------------------------------------------------------------

describe('DELETE /api/webflow/schema-validation/:siteId', () => {
  it('returns 400 when pageId query param is missing', async () => {
    const res = await ctx.del(`/api/webflow/schema-validation/${FAKE_SITE_ID}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/pageId/i);
  });

  it('returns deleted:false for a page with no stored validation', async () => {
    const res = await ctx.del(`/api/webflow/schema-validation/${FAKE_SITE_ID}?pageId=nonexistent`);
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body).toHaveProperty('deleted');
    expect(body.deleted).toBe(false);
  });
});
