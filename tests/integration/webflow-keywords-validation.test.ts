/**
 * Integration tests for /api/webflow/keyword-analysis routes.
 *
 * These tests focus on validation paths — missing/invalid input → 400/404/500.
 *
 * NOTE on auth behavior: with APP_PASSWORD='' and no JWT user, the auth
 * middleware (requireWorkspaceAccessFromBody) calls next() even when
 * workspaceId is absent, so route-level validation governs 400 responses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13470); // port-ok: assigned range 13470-13484
const { postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Webflow Keywords Validation 13470').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// POST /api/webflow/keyword-analysis
// ---------------------------------------------------------------------------
describe('POST /api/webflow/keyword-analysis', () => {
  it('returns 400 when pageTitle is missing (no workspaceId either)', async () => {
    // With no JWT user, auth passes through even without workspaceId.
    // Route guard: `if (!pageTitle) return res.status(400)...`
    const res = await postJson('/api/webflow/keyword-analysis', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('returns 400 when pageTitle is an empty string', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId,
      pageTitle: '',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('returns 400 when pageTitle is missing even with a valid workspaceId', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageTitle required/i);
  });

  it('reaches OPENAI_API_KEY check when pageTitle is present (500 in test env)', async () => {
    // pageTitle present → passes field guard, then hits OPENAI_API_KEY check
    // In test environment OPENAI_API_KEY is typically unset → 500
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId,
      pageTitle: 'SEO Services',
    });
    // Either 500 (key not configured) or 200 (if key is set) — not 400
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/keyword-analysis/persist
// ---------------------------------------------------------------------------
describe('POST /api/webflow/keyword-analysis/persist', () => {
  it('returns 400 when workspaceId is missing from body (Zod schema requires it)', async () => {
    // Even though auth passes through, Zod validate() requires workspaceId → 400
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      pagePath: '/services',
      analysis: {
        primaryKeyword: 'seo',
        secondaryKeywords: [],
        longTailKeywords: [],
        contentGaps: [],
        competitorKeywords: [],
        optimizationIssues: [],
        recommendations: [],
        searchIntent: 'informational',
        keywordDifficulty: 0,
        monthlyVolume: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pagePath is missing (Zod schema requires it)', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId,
      analysis: {
        primaryKeyword: 'seo services',
        secondaryKeywords: [],
        longTailKeywords: [],
        contentGaps: [],
        competitorKeywords: [],
        optimizationIssues: [],
        recommendations: [],
        searchIntent: 'informational',
        keywordDifficulty: 0,
        monthlyVolume: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when analysis field is missing (Zod)', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId,
      pagePath: '/services',
    });
    expect(res.status).toBe(400);
  });

  it('searchIntent with an invalid enum value is coerced (not 400)', async () => {
    // searchIntent uses .catch('informational') in Zod so it coerces invalid → 'informational'
    // → the route proceeds. With a valid workspaceId it should return 200.
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId,
      pagePath: '/services',
      analysis: {
        primaryKeyword: 'seo services',
        secondaryKeywords: [],
        longTailKeywords: [],
        contentGaps: [],
        competitorKeywords: [],
        optimizationIssues: [],
        recommendations: [],
        searchIntent: 'unknown-intent', // coerced by .catch()
        keywordDifficulty: 0,
        monthlyVolume: 0,
      },
    });
    // Schema coerces invalid enum → not 400 from Zod
    expect(res.status).not.toBe(400);
    // Should succeed with valid workspace
    expect(res.status).toBe(200);
  });

  it('returns 404 when workspaceId does not exist', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: 'nonexistent-ws-id-xyz',
      pagePath: '/services',
      analysis: {
        primaryKeyword: 'seo services',
        secondaryKeywords: [],
        longTailKeywords: [],
        contentGaps: [],
        competitorKeywords: [],
        optimizationIssues: [],
        recommendations: [],
        searchIntent: 'informational',
        keywordDifficulty: 0,
        monthlyVolume: 0,
      },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('succeeds (200) when all required fields are valid', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId,
      pagePath: '/services/seo',
      analysis: {
        primaryKeyword: 'seo services',
        secondaryKeywords: ['local seo', 'organic seo'],
        longTailKeywords: ['best seo services for small business'],
        contentGaps: [],
        competitorKeywords: [],
        optimizationIssues: [],
        recommendations: ['Add more internal links'],
        searchIntent: 'commercial',
        keywordDifficulty: 45,
        monthlyVolume: 1200,
        optimizationScore: 70,
        estimatedDifficulty: 'medium',
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/content-score
// ---------------------------------------------------------------------------
describe('POST /api/webflow/content-score', () => {
  it('returns 400 when both pageContent and pageTitle are missing', async () => {
    const res = await postJson('/api/webflow/content-score', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/pageContent or pageTitle required/i);
  });

  it('returns 400 when pageContent is empty and pageTitle is absent', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageContent: '',
    });
    expect(res.status).toBe(400);
  });

  it('computes a score when only pageTitle is provided', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'SEO Services for Small Businesses',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { wordCount: number };
    expect(typeof body.wordCount).toBe('number');
  });

  it('computes a score when pageContent is provided', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageContent: '<p>We help businesses grow online with proven SEO strategies.</p>',
      pageTitle: 'SEO Services',
      seoTitle: 'SEO Services | Agency Name',
      metaDescription: 'Grow your traffic with our expert SEO services. Proven results for small businesses.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      wordCount: number;
      readabilityScore: number;
      readabilityGrade: string;
      titleLength: number;
      descLength: number;
    };
    expect(typeof body.wordCount).toBe('number');
    expect(typeof body.readabilityScore).toBe('number');
    expect(['Easy', 'Moderate', 'Difficult']).toContain(body.readabilityGrade);
    expect(body.titleLength).toBeGreaterThan(0);
    expect(body.descLength).toBeGreaterThan(0);
  });

  it('returns titleOk=true for a 30-60 char title', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'My Page',
      seoTitle: 'SEO Services for Small Business',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { titleOk: boolean };
    // "SEO Services for Small Business" = 31 chars → within 30-60
    expect(body.titleOk).toBe(true);
  });

  it('returns titleOk=false for a short title', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'My Page',
      seoTitle: 'Short',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { titleOk: boolean };
    expect(body.titleOk).toBe(false);
  });

  it('returns descOk=true for a 120-160 char description', async () => {
    // Craft a 130-char description
    const desc = 'We help small businesses grow their online presence with data-driven SEO strategies that deliver measurable traffic results.';
    expect(desc.length).toBeGreaterThanOrEqual(120);
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'SEO Services',
      metaDescription: desc,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { descOk: boolean };
    expect(body.descOk).toBe(true);
  });

  it('returns headings breakdown when pageContent has headings', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageContent: '<h1>Main Title</h1><h2>Section One</h2><h2>Section Two</h2><p>Body text.</p>',
      pageTitle: 'Test Page',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { headings: { total: number; h1: number; h2: number } };
    expect(body.headings.h1).toBe(1);
    expect(body.headings.h2).toBe(2);
    expect(body.headings.total).toBe(3);
  });
});
