/**
 * Integration tests for POST /api/webflow/seo-rewrite.
 *
 * Tests focus on input validation — missing/invalid input → 400 or 500.
 * External API calls (OpenAI, Webflow) are never triggered by these paths.
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url, { env: { OPENAI_API_KEY: '' } });
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
  async function assertSeoRewriteResponse(
    res: Response,
    expectedField: 'title' | 'description' | 'both',
  ): Promise<void> {
    expect([200, 500]).toContain(res.status);
    if (res.status === 500) {
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
      return;
    }
    if (expectedField === 'both') {
      const body = await res.json() as { field?: string; pairs?: unknown[] };
      expect(body.field).toBe('both');
      expect(Array.isArray(body.pairs)).toBe(true);
      return;
    }
    const body = await res.json() as { field?: string; text?: string; variations?: unknown[] };
    expect(body.field).toBe(expectedField);
    expect(typeof body.text).toBe('string');
    expect(Array.isArray(body.variations)).toBe(true);
  }

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

  it('returns key error when OPENAI_API_KEY is unavailable (or succeeds when key is available)', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'My Test Page',
      field: 'title',
    });
    await assertSeoRewriteResponse(res, 'title');
  });

  it('returns key error for description mode when OPENAI_API_KEY is unavailable (or succeeds when key is available)', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'Test Page Description',
      currentDescription: 'Old description text',
      field: 'description',
    });
    await assertSeoRewriteResponse(res, 'description');
  });

  it('returns key error for "both" mode when OPENAI_API_KEY is unavailable (or succeeds when key is available)', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId,
      pageTitle: 'Test Page Both',
      field: 'both',
    });
    await assertSeoRewriteResponse(res, 'both');
  });

  it('returns 400 when body is completely empty', async () => {
    const res = await postJson('/api/webflow/seo-rewrite', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('handles unknown workspaceId without crashing', async () => {
    // Unknown workspaceId: getWorkspace returns undefined -> brandName = ''.
    const res = await postJson('/api/webflow/seo-rewrite', {
      workspaceId: 'nonexistent-workspace-id',
      pageTitle: 'Some Page',
      field: 'title',
    });
    await assertSeoRewriteResponse(res, 'title');
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

  it('passes validation and either rewrites or returns key error', async () => {
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
    await assertSeoRewriteResponse(res, 'title');
  });
});
