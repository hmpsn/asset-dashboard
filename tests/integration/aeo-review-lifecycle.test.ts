/**
 * Integration tests — AEO review lifecycle.
 *
 * port-ok: unique in integration suite (13868)
 *
 * Covers areas NOT already tested by aeo-review-routes.test.ts:
 *  - GET returns null when no review has been saved
 *  - GET returns saved review after site review
 *  - POST page with full http:// URL used directly
 *  - POST page with AEO issues enriched from snapshot
 *  - POST page writes activity log entry
 *  - POST page requires liveDomain or full http URL
 *  - POST site returns 404 for unknown workspace
 *  - POST page returns 404 for unknown workspace
 *  - POST site with no live domain returns 400
 *  - POST site with zero discovered pages returns empty result
 *  - POST site with default maxPages (omitted body) uses 10
 *  - POST site replaces previous saved review on re-generate
 *  - POST site writes activity log entry
 *  - POST site excludes pages matched by isExcludedPage
 *  - POST site prioritises content pages over non-content pages
 *  - Response shape — AeoPageReview fields present in site result
 *  - Response shape — AeoSiteReview top-level fields
 *  - Cross-workspace isolation: saved review not readable from different workspace
 *  - POST site falls back to snapshot pages when page discovery throws
 *
 * Uses the inline server pattern (vi.mock + dynamic import of createApp) rather
 * than createTestContext(), because createTestContext() spawns a subprocess that
 * cannot share vi.mock state with the test process.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getDataDir } from '../../server/data-dir.js';
import { listActivity } from '../../server/activity-log.js';
import db from '../../server/db/index.js';

// ─── Mocked module state ──────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  reviewPageCalls: [] as Array<{ pageUrl: string; pageTitle: string; workspaceId: string; issuesCount: number }>,
  reviewSiteCalls: [] as Array<{ workspaceId: string; pageCount: number; pageUrls: string[] }>,
  publishedPages: [] as Array<{ slug: string; title: string; url?: string }>,
  cmsUrls: [] as Array<{ url: string; path: string; pageName: string }>,
  snapshot: null as null | {
    audit: {
      pages: Array<{
        slug: string;
        url?: string;
        page: string;
        issues: Array<{ check: string; severity: string; message: string; recommendation: string }>;
      }>;
    };
  },
  discoveryThrows: false,
}));

vi.mock('../../server/aeo-page-review.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/aeo-page-review.js')>();
  return {
    ...actual,
    reviewPage: vi.fn(async (pageUrl: string, pageTitle: string, _html: string, issues: unknown[], workspaceId: string) => {
      state.reviewPageCalls.push({ pageUrl, pageTitle, workspaceId, issuesCount: (issues as unknown[]).length });
      return {
        pageUrl,
        pageTitle,
        reviewedAt: '2026-05-26T00:00:00.000Z',
        overallScore: 75,
        summary: 'Good AEO baseline with some gaps.',
        changes: [
          {
            id: 'chg-1',
            changeType: 'rewrite_intro',
            location: 'Below the H1',
            suggestedChange: 'Rewrite the intro to directly answer the target question.',
            rationale: 'Direct answers increase AI citation likelihood.',
            effort: 'quick' as const,
            priority: 'high' as const,
            aeoImpact: 'Makes intro extractable as a cited snippet.',
          },
        ],
        quickWinCount: 1,
        estimatedTimeMinutes: 15,
      };
    }),
    reviewSitePages: vi.fn(async (workspaceId: string, pages: Array<{ url: string }>) => {
      state.reviewSiteCalls.push({ workspaceId, pageCount: pages.length, pageUrls: pages.map((p) => p.url) });
      return {
        workspaceId,
        generatedAt: '2026-05-26T00:00:00.000Z',
        pages: pages.map((p, index) => ({
          pageUrl: p.url,
          pageTitle: `Page ${index + 1}`,
          reviewedAt: '2026-05-26T00:00:00.000Z',
          overallScore: 70,
          summary: 'Decent AEO baseline.',
          changes: [],
          quickWinCount: 0,
          estimatedTimeMinutes: 0,
        })),
        sitewideSummary: `Reviewed ${pages.length} pages`,
        totalChanges: 0,
        quickWins: 0,
      };
    }),
  };
});

vi.mock('../../server/workspace-data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-data.js')>();
  return {
    ...actual,
    getWorkspacePages: vi.fn(async () => {
      if (state.discoveryThrows) throw new Error('Page discovery failed');
      return state.publishedPages;
    }),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    buildStaticPathSet: vi.fn(() => new Set<string>()),
    discoverCmsUrls: vi.fn(async () => {
      if (state.discoveryThrows) throw new Error('CMS discovery failed');
      return { cmsUrls: state.cmsUrls, llmsTxtUrls: [] };
    }),
  };
});

vi.mock('../../server/reports.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/reports.js')>();
  return {
    ...actual,
    getLatestSnapshot: vi.fn(() => state.snapshot),
  };
});

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const nativeFetch = globalThis.fetch;

let server: http.Server | undefined;
let baseUrl = '';
const workspaceIds = new Set<string>();

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(pathname: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${pathname}`, opts);
}

function postJson(pathname: string, body: unknown): Promise<Response> {
  return api(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reviewFilePath(workspaceId: string): string {
  return path.join(getDataDir('aeo-reviews'), `${workspaceId}.json`);
}

function clearActivityLog(wsId: string): void {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
}

// ─── Lifecycle helpers ────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
}, 60_000);

beforeEach(() => {
  state.reviewPageCalls = [];
  state.reviewSiteCalls = [];
  state.publishedPages = [];
  state.cmsUrls = [];
  state.snapshot = null;
  state.discoveryThrows = false;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const slug = url.split('/').filter(Boolean).pop() || 'page';
    return new Response(
      `<html><head><title>${slug} title</title></head><body><h1>${slug}</h1></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  for (const wsId of workspaceIds) {
    clearActivityLog(wsId);
    deleteWorkspace(wsId);
    const file = reviewFilePath(wsId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  workspaceIds.clear();
});

afterAll(async () => {
  await stopTestServer();
});

// ─── GET /api/aeo-review/:workspaceId — load saved review ──────────────────

describe('GET /api/aeo-review/:workspaceId — load saved review', () => {
  it('returns null when no review has been saved yet', async () => {
    const ws = createWorkspace('AEO Lifecycle GET Null Workspace');
    workspaceIds.add(ws.id);

    const res = await api(`/api/aeo-review/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns the saved review after a site review is run', async () => {
    const ws = createWorkspace('AEO Lifecycle GET After Site Workspace', 'wf-get-after', 'Get After Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'example.test' });

    state.publishedPages = [{ slug: '/about', title: 'About' }];

    const siteRes = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 1 });
    expect(siteRes.status).toBe(200);

    const getRes = await api(`/api/aeo-review/${ws.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body).not.toBeNull();
    expect(body.workspaceId).toBe(ws.id);
    expect(Array.isArray(body.pages)).toBe(true);
  });

  it('does not return another workspace saved review (cross-workspace isolation)', async () => {
    const wsA = createWorkspace('AEO Lifecycle Isolation A', 'wf-iso-a', 'Isolation A');
    const wsB = createWorkspace('AEO Lifecycle Isolation B', 'wf-iso-b', 'Isolation B');
    workspaceIds.add(wsA.id);
    workspaceIds.add(wsB.id);
    updateWorkspace(wsA.id, { liveDomain: 'site-a.test' });

    state.publishedPages = [{ slug: '/about', title: 'About' }];

    // Seed a review for workspace A
    const siteRes = await postJson(`/api/aeo-review/${wsA.id}/site`, { maxPages: 1 });
    expect(siteRes.status).toBe(200);

    // Workspace B should still get null — reviews are workspace-scoped files
    const getB = await api(`/api/aeo-review/${wsB.id}`);
    expect(getB.status).toBe(200);
    const bodyB = await getB.json();
    expect(bodyB).toBeNull();
  });
});

// ─── POST /api/aeo-review/:workspaceId/page — single page review ───────────

describe('POST /api/aeo-review/:workspaceId/page — error paths', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/aeo-review/ws_nonexistent_lifecycle/page', {
      pageUrl: 'https://example.test/about',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });

  it('returns 400 when workspace has no liveDomain and pageSlug is provided (no full URL)', async () => {
    const ws = createWorkspace('AEO Page No Domain Workspace');
    workspaceIds.add(ws.id);

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageSlug: '/about',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No pageUrl provided');
  });
});

describe('POST /api/aeo-review/:workspaceId/page — happy paths', () => {
  it('accepts a full http:// pageUrl and passes it directly to reviewPage', async () => {
    const ws = createWorkspace('AEO Page Full URL Workspace', 'wf-full-url', 'Full URL Site');
    workspaceIds.add(ws.id);

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageUrl: 'https://direct.example.test/pricing',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overallScore).toBe(75);
    expect(body.pageUrl).toBe('https://direct.example.test/pricing');
    expect(state.reviewPageCalls).toHaveLength(1);
    expect(state.reviewPageCalls[0].pageUrl).toBe('https://direct.example.test/pricing');
  });

  it('enriches issues from the latest snapshot when webflowSiteId is set', async () => {
    const ws = createWorkspace('AEO Page Snapshot Enrich Workspace', 'wf-snapshot-enrich', 'Enrich Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'enrich.test' });

    state.snapshot = {
      audit: {
        pages: [
          {
            slug: '/guide',
            url: '/guide',
            page: 'Guide',
            issues: [
              {
                check: 'aeo-missing-faq',
                severity: 'warning',
                message: 'No FAQ section found',
                recommendation: 'Add a FAQ section with common questions.',
              },
              {
                check: 'title',
                severity: 'error',
                message: 'Missing page title',
                recommendation: 'Add a title tag.',
              },
            ],
          },
        ],
      },
    };

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageUrl: 'https://enrich.test/guide',
    });

    expect(res.status).toBe(200);
    expect(state.reviewPageCalls).toHaveLength(1);
    // Both AEO and non-AEO issues are passed through to reviewPage
    expect(state.reviewPageCalls[0].issuesCount).toBe(2);
  });

  it('writes an activity log entry after a successful page review', async () => {
    const ws = createWorkspace('AEO Page Activity Log Workspace', 'wf-page-activity', 'Activity Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'activity.test' });
    clearActivityLog(ws.id);

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageSlug: '/features',
    });
    expect(res.status).toBe(200);

    const entries = listActivity(ws.id, 10);
    expect(entries.length).toBeGreaterThan(0);
    const aeoEntry = entries.find((e) => e.type === 'aeo_review');
    expect(aeoEntry).toBeDefined();
    expect(aeoEntry?.title).toContain('AEO review:');
  });

  it('returns AeoPageReview shape with all expected fields', async () => {
    const ws = createWorkspace('AEO Page Shape Workspace', 'wf-page-shape', 'Shape Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'shape.test' });

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageUrl: 'https://shape.test/blog/seo-guide',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    // Top-level AeoPageReview fields
    expect(typeof body.pageUrl).toBe('string');
    expect(typeof body.pageTitle).toBe('string');
    expect(typeof body.reviewedAt).toBe('string');
    expect(typeof body.overallScore).toBe('number');
    expect(typeof body.summary).toBe('string');
    expect(Array.isArray(body.changes)).toBe(true);
    expect(typeof body.quickWinCount).toBe('number');
    expect(typeof body.estimatedTimeMinutes).toBe('number');

    // Change shape
    expect(body.changes.length).toBeGreaterThan(0);
    const change = body.changes[0];
    expect(typeof change.id).toBe('string');
    expect(typeof change.changeType).toBe('string');
    expect(typeof change.suggestedChange).toBe('string');
    expect(typeof change.rationale).toBe('string');
    expect(['quick', 'moderate', 'significant']).toContain(change.effort);
    expect(['high', 'medium', 'low']).toContain(change.priority);
  });
});

// ─── POST /api/aeo-review/:workspaceId/site — batch site review ────────────

describe('POST /api/aeo-review/:workspaceId/site — error paths', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/aeo-review/ws_nonexistent_lifecycle/site', {
      maxPages: 3,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });

  it('returns 400 when workspace has no live domain configured', async () => {
    const ws = createWorkspace('AEO Site No Domain Workspace', 'wf-site-no-domain', 'No Domain Site');
    workspaceIds.add(ws.id);
    // webflowSiteId set, but liveDomain not set

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 5 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No live domain');
  });
});

describe('POST /api/aeo-review/:workspaceId/site — page discovery', () => {
  it('returns empty result when no pages are discovered', async () => {
    const ws = createWorkspace('AEO Site Empty Pages Workspace', 'wf-empty-pages', 'Empty Pages Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'empty.test' });

    // publishedPages and cmsUrls are empty (default state)
    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 5 });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.workspaceId).toBe(ws.id);
    expect(body.pages).toHaveLength(0);
    expect(body.totalChanges).toBe(0);
    expect(body.quickWins).toBe(0);
    expect(typeof body.sitewideSummary).toBe('string');
    expect(state.reviewSiteCalls).toHaveLength(0);
  });

  it('uses default maxPages of 10 when maxPages is omitted from body', async () => {
    const ws = createWorkspace('AEO Site Default MaxPages Workspace', 'wf-default-max', 'Default Max Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'defaultmax.test' });

    // Provide 12 pages — only 10 (default) should be reviewed
    state.publishedPages = Array.from({ length: 12 }, (_, i) => ({
      slug: `/page-${i + 1}`,
      title: `Page ${i + 1}`,
    }));

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, {});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(state.reviewSiteCalls).toHaveLength(1);
    expect(state.reviewSiteCalls[0].pageCount).toBe(10);
    expect(body.pages).toHaveLength(10);
  });

  it('excludes pages matched by isExcludedPage (e.g. /404, /privacy-policy)', async () => {
    const ws = createWorkspace('AEO Site Excluded Pages Workspace', 'wf-excluded', 'Excluded Pages Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'excluded.test' });

    state.publishedPages = [
      { slug: '/about', title: 'About' },
      { slug: '/404', title: '404' },
      { slug: '/privacy-policy', title: 'Privacy Policy' },
    ];

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 10 });
    expect(res.status).toBe(200);

    // Only /about should reach reviewSitePages
    expect(state.reviewSiteCalls).toHaveLength(1);
    expect(state.reviewSiteCalls[0].pageCount).toBe(1);
    const reviewed = state.reviewSiteCalls[0].pageUrls;
    expect(reviewed.length).toBe(1);
    expect(reviewed.length).toBeGreaterThan(0); // length guard for .every() below
    expect(reviewed.every((u: string) => u.includes('/about'))).toBe(true); // every-ok
  });

  it('falls back to snapshot pages when page discovery throws', async () => {
    const ws = createWorkspace('AEO Site Fallback Snapshot Workspace', 'wf-fallback', 'Fallback Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'fallback.test' });

    state.discoveryThrows = true;
    state.snapshot = {
      audit: {
        pages: [
          { slug: '/fallback-page', url: '/fallback-page', page: 'Fallback Page', issues: [] },
        ],
      },
    };

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 5 });
    expect(res.status).toBe(200);

    const body = await res.json();
    // Should have discovered the snapshot fallback page
    expect(state.reviewSiteCalls).toHaveLength(1);
    expect(state.reviewSiteCalls[0].pageCount).toBe(1);
    expect(body.pages).toHaveLength(1);
  });

  it('prioritises content pages (blog, resources, etc.) over non-content pages', async () => {
    const ws = createWorkspace('AEO Site Priority Workspace', 'wf-priority', 'Priority Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'priority.test' });

    // Mix of content and non-content pages — maxPages=2 should pick content first
    state.publishedPages = [
      { slug: '/contact', title: 'Contact' },
      { slug: '/about', title: 'About' },
      { slug: '/blog/ai-search', title: 'AI Search Guide' },
      { slug: '/resources/faq', title: 'FAQ' },
    ];

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 2 });
    expect(res.status).toBe(200);

    expect(state.reviewSiteCalls).toHaveLength(1);
    const reviewedUrls = state.reviewSiteCalls[0].pageUrls;
    expect(reviewedUrls.length).toBe(2);
    // Both reviewed URLs should be content pages (blog/ or resources/)
    expect(reviewedUrls.length).toBeGreaterThan(0); // length guard for .every() below
    expect(reviewedUrls.every((u: string) => u.includes('/blog/') || u.includes('/resources/'))).toBe(true); // every-ok
  });
});

describe('POST /api/aeo-review/:workspaceId/site — persistence and re-generation', () => {
  it('replaces the previous saved review on re-generate', async () => {
    const ws = createWorkspace('AEO Site Re-gen Workspace', 'wf-regen', 'Re-gen Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'regen.test' });

    state.publishedPages = [{ slug: '/page-one', title: 'Page One' }];

    // First review
    const res1 = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 1 });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.pages).toHaveLength(1);
    expect(body1.pages[0].pageUrl).toContain('/page-one');

    // Second review with different pages
    state.publishedPages = [{ slug: '/page-two', title: 'Page Two' }];

    const res2 = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 1 });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.pages[0].pageUrl).toContain('/page-two');

    // GET should return the second (latest) review
    const getRes = await api(`/api/aeo-review/${ws.id}`);
    const getBody = await getRes.json();
    expect(getBody.pages[0].pageUrl).toContain('/page-two');
  });

  it('writes an activity log entry after a successful site review', async () => {
    const ws = createWorkspace('AEO Site Activity Log Workspace', 'wf-site-activity', 'Site Activity Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'siteactivity.test' });
    clearActivityLog(ws.id);

    state.publishedPages = [{ slug: '/home', title: 'Home' }];

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 1 });
    expect(res.status).toBe(200);

    const entries = listActivity(ws.id, 10);
    expect(entries.length).toBeGreaterThan(0);
    const aeoEntry = entries.find((e) => e.type === 'aeo_review');
    expect(aeoEntry).toBeDefined();
    expect(aeoEntry?.title).toContain('AEO site review:');
  });
});

describe('POST /api/aeo-review/:workspaceId/site — response shape', () => {
  it('returns all expected AeoSiteReview top-level fields', async () => {
    const ws = createWorkspace('AEO Site Shape Workspace', 'wf-site-shape', 'Site Shape Workspace');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'siteshape.test' });

    state.publishedPages = [{ slug: '/about', title: 'About' }];

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 1 });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.workspaceId).toBe(ws.id);
    expect(typeof body.generatedAt).toBe('string');
    expect(Array.isArray(body.pages)).toBe(true);
    expect(typeof body.sitewideSummary).toBe('string');
    expect(typeof body.totalChanges).toBe('number');
    expect(typeof body.quickWins).toBe('number');
  });

  it('includes AeoPageReview fields for each page result', async () => {
    const ws = createWorkspace('AEO Site Page Shape Workspace', 'wf-page-fields', 'Page Fields Workspace');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'pagefields.test' });

    state.publishedPages = [{ slug: '/services', title: 'Services' }];

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 1 });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pages.length).toBeGreaterThan(0);
    const page = body.pages[0];
    expect(typeof page.pageUrl).toBe('string');
    expect(typeof page.pageTitle).toBe('string');
    expect(typeof page.overallScore).toBe('number');
    expect(typeof page.summary).toBe('string');
    expect(Array.isArray(page.changes)).toBe(true);
    expect(typeof page.quickWinCount).toBe('number');
    expect(typeof page.estimatedTimeMinutes).toBe('number');
  });

  it('respects the maxPages cap and reviews exactly maxPages pages', async () => {
    const ws = createWorkspace('AEO Site MaxPages Cap Workspace', 'wf-cap-exact', 'Cap Exact Workspace');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'capexact.test' });

    state.publishedPages = Array.from({ length: 8 }, (_, i) => ({
      slug: `/page-${i + 1}`,
      title: `Page ${i + 1}`,
    }));

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 3 });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pages).toHaveLength(3);
    expect(state.reviewSiteCalls[0].pageCount).toBe(3);
  });
});

describe('POST /api/aeo-review/:workspaceId/site — CMS pages included', () => {
  it('includes CMS pages from discoverCmsUrls in addition to static pages', async () => {
    const ws = createWorkspace('AEO CMS Pages Workspace', 'wf-cms-pages', 'CMS Pages Workspace');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'cmspages.test' });

    state.publishedPages = [{ slug: '/about', title: 'About' }];
    state.cmsUrls = [
      { url: 'https://cmspages.test/blog/intro', path: '/blog/intro', pageName: 'Intro Post' },
    ];

    const res = await postJson(`/api/aeo-review/${ws.id}/site`, { maxPages: 5 });
    expect(res.status).toBe(200);

    expect(state.reviewSiteCalls).toHaveLength(1);
    expect(state.reviewSiteCalls[0].pageCount).toBe(2);
    const reviewedUrls = state.reviewSiteCalls[0].pageUrls;
    expect(reviewedUrls.length).toBe(2);
    expect(reviewedUrls.some((u: string) => u.includes('/about'))).toBe(true);
    expect(reviewedUrls.some((u: string) => u.includes('/blog/intro'))).toBe(true);
  });
});

describe('POST /api/aeo-review/:workspaceId/page — workspace liveDomain construction', () => {
  it('prepends https:// when liveDomain lacks a protocol', async () => {
    const ws = createWorkspace('AEO Page LiveDomain No Protocol Workspace', 'wf-no-proto', 'No Proto Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'noprotocol.test' });

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageSlug: '/team',
    });

    expect(res.status).toBe(200);
    expect(state.reviewPageCalls).toHaveLength(1);
    expect(state.reviewPageCalls[0].pageUrl).toBe('https://noprotocol.test/team');
  });

  it('uses liveDomain with existing https:// prefix as-is', async () => {
    const ws = createWorkspace('AEO Page LiveDomain With Protocol Workspace', 'wf-with-proto', 'With Proto Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'https://withprotocol.test' });

    const res = await postJson(`/api/aeo-review/${ws.id}/page`, {
      pageSlug: '/solutions',
    });

    expect(res.status).toBe(200);
    expect(state.reviewPageCalls).toHaveLength(1);
    expect(state.reviewPageCalls[0].pageUrl).toBe('https://withprotocol.test/solutions');
  });
});
