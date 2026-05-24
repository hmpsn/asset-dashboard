/**
 * Integration tests for POST /api/webflow/seo-rewrite.
 *
 * Tests focus on input validation — missing/invalid input → 400 or 500.
 * External API calls (OpenAI, Webflow) are never triggered by these paths.
 *
 * Port: 13545 (range 13545–13559 exclusively assigned to wave-23-a1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13545); // port-ok: assigned range 13545-13559
const { postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Webflow SEO Rewrite Validation 13545');
  workspaceId = ws.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// POST /api/webflow/seo-rewrite
// ---------------------------------------------------------------------------

describe('POST /api/webflow/seo-rewrite — input validation', () => {
  it('returns 400 when pageTitle is missing', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      currentSeoTitle: 'Old Title',
      field: 'title',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('returns 400 when pageTitle is an empty string', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: '',
      field: 'title',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('returns 500 (OPENAI_API_KEY not configured) when pageTitle is present', async () => {
    // In test environment, OPENAI_API_KEY is not set, so the route should pass validation
    // but fail at the AI key check.
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'My Test Page',
      field: 'title',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
  });

  it('returns 500 for description field when pageTitle present but no AI key', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'Test Page Description',
      currentDescription: 'Old description text',
      field: 'description',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
  });

  it('returns 500 for "both" field mode when pageTitle present but no AI key', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'Test Page Both',
      field: 'both',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
  });

  it('returns 400 when body is completely empty', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('does not call AI (returns 500 key error) even when workspaceId is an unknown workspace', async () => {
    // Unknown workspaceId: getWorkspace returns undefined → brandName = '' → no crash,
    // just proceeds to OPENAI_API_KEY check.
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId: 'nonexistent-workspace-id',
      pageTitle: 'Some Page',
      field: 'title',
    });
    // Should hit OPENAI_API_KEY check (500) not 400 or crash
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
  });

  it('returns 400 when pageTitle is null (falsy check)', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: null,
      field: 'title',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('accepts pagePath as optional and still validates pageTitle', async () => {
    // pagePath is optional; missing pageTitle is still rejected
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pagePath: '/services',
      field: 'title',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('passes validation and hits AI key check when full valid body is provided', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'Services Page',
      currentSeoTitle: 'Old SEO Title',
      currentDescription: 'Old meta description text here',
      pageContent: 'We offer professional services to clients worldwide.',
      siteContext: 'A digital agency',
      field: 'title',
      pagePath: '/services',
    });
    // Passes all validation → reaches AI key check
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
  });
});
