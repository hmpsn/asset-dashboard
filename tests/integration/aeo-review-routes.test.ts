import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getDataDir } from '../../server/data-dir.js';

const nativeFetch = globalThis.fetch;
const originalAppPassword = process.env.APP_PASSWORD;

const state = vi.hoisted(() => ({
  reviewPageCalls: [] as Array<{ pageUrl: string; pageTitle: string; html: string; workspaceId: string; issuesCount: number }>,
  reviewSiteCalls: [] as Array<{ workspaceId: string; pageCount: number; pageUrls: string[] }>,
  publishedPages: [] as Array<{ slug: string; title: string; url?: string }>,
  cmsUrls: [] as Array<{ url: string; path: string; pageName: string }>,
  snapshot: null as null | { audit: { pages: Array<{ slug: string; url?: string; page: string; issues: Array<{ check: string; severity: string; message: string; recommendation: string }> }> } },
}));

vi.mock('../../server/aeo-page-review.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/aeo-page-review.js')>();
  return {
    ...actual,
    reviewPage: vi.fn(async (pageUrl: string, pageTitle: string, html: string, issues: unknown[], workspaceId: string) => {
      state.reviewPageCalls.push({ pageUrl, pageTitle, html, workspaceId, issuesCount: issues.length });
      return {
        pageUrl,
        pageTitle,
        overallScore: 82,
        summary: 'AEO review completed.',
        changes: [{ id: 'c1', changeType: 'copy_edit', effort: 'quick', priority: 'high' }],
        generatedAt: '2026-05-16T00:00:00.000Z',
      };
    }),
    reviewSitePages: vi.fn(async (workspaceId: string, pages: Array<{ url: string }>) => {
      state.reviewSiteCalls.push({ workspaceId, pageCount: pages.length, pageUrls: pages.map((p) => p.url) });
      return {
        workspaceId,
        generatedAt: '2026-05-16T00:00:00.000Z',
        pages: pages.map((p, index) => ({
          pageUrl: p.url,
          pageTitle: `Page ${index + 1}`,
          overallScore: 80,
          summary: 'Looks good',
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
    getWorkspacePages: vi.fn(async () => state.publishedPages),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    buildStaticPathSet: vi.fn(() => new Set<string>()),
    discoverCmsUrls: vi.fn(async () => ({ cmsUrls: state.cmsUrls, llmsTxtUrls: [] })),
  };
});

vi.mock('../../server/reports.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/reports.js')>();
  return {
    ...actual,
    getLatestSnapshot: vi.fn(() => state.snapshot),
  };
});

let server: http.Server | undefined;
let baseUrl = '';
const workspaceIds = new Set<string>();

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
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

async function api(pathname: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${pathname}`, opts);
}

function reviewFilePath(workspaceId: string): string {
  return path.join(getDataDir('aeo-reviews'), `${workspaceId}.json`);
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

beforeEach(() => {
  state.reviewPageCalls = [];
  state.reviewSiteCalls = [];
  state.publishedPages = [];
  state.cmsUrls = [];
  state.snapshot = null;

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
  for (const workspaceId of workspaceIds) {
    deleteWorkspace(workspaceId);
    const file = reviewFilePath(workspaceId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  workspaceIds.clear();
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

describe('AEO review routes', () => {
  it('POST /api/aeo-review/:workspaceId/page requires pageUrl or pageSlug', async () => {
    const ws = createWorkspace('AEO Page Validation Workspace', 'wf-site-validation', 'Validation Site');
    workspaceIds.add(ws.id);

    const res = await api(`/api/aeo-review/${ws.id}/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'pageUrl or pageSlug required' });
  });

  it('POST /api/aeo-review/:workspaceId/page reviews a slug using workspace liveDomain', async () => {
    const ws = createWorkspace('AEO Single Page Workspace', 'wf-site-page', 'Page Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'example.test' });

    const res = await api(`/api/aeo-review/${ws.id}/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSlug: '/about' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      overallScore: 82,
      summary: 'AEO review completed.',
      changes: [{ id: 'c1' }],
    });
    expect(state.reviewPageCalls).toHaveLength(1);
    expect(state.reviewPageCalls[0]).toMatchObject({
      pageUrl: 'https://example.test/about',
      workspaceId: ws.id,
      issuesCount: 0,
    });
    expect(state.reviewPageCalls[0].pageTitle).toBe('about title');
  });

  it('POST /api/aeo-review/:workspaceId/page returns 400 when remote fetch fails', async () => {
    const ws = createWorkspace('AEO Fetch Failure Workspace', 'wf-site-fetch-failure', 'Fetch Failure Site');
    workspaceIds.add(ws.id);

    globalThis.fetch = vi.fn(async () => new Response('missing', { status: 404 })) as typeof fetch;

    const res = await api(`/api/aeo-review/${ws.id}/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageUrl: 'https://example.test/missing-page' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to fetch page: 404' });
    expect(state.reviewPageCalls).toHaveLength(0);
  });

  it('POST /api/aeo-review/:workspaceId/site rejects workspaces without a linked Webflow site', async () => {
    const ws = createWorkspace('AEO Missing Site Workspace');
    workspaceIds.add(ws.id);

    const res = await api(`/api/aeo-review/${ws.id}/site`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPages: 5 }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'No Webflow site linked' });
  });

  it('POST /api/aeo-review/:workspaceId/site reviews discovered pages and persists the result', async () => {
    const ws = createWorkspace('AEO Site Review Workspace', 'wf-site-batch', 'Batch Site');
    workspaceIds.add(ws.id);
    updateWorkspace(ws.id, { liveDomain: 'example.test' });

    state.publishedPages = [
      { slug: '/blog/ai-search', title: 'AI Search Guide' },
      { slug: '/contact', title: 'Contact' },
    ];
    state.cmsUrls = [
      { url: 'https://example.test/resources/faq', path: '/resources/faq', pageName: 'FAQ' },
    ];

    const res = await api(`/api/aeo-review/${ws.id}/site`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPages: 3 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      workspaceId: ws.id,
      sitewideSummary: 'Reviewed 3 pages',
      pages: [
        { pageUrl: 'https://example.test/blog/ai-search' },
        { pageUrl: 'https://example.test/resources/faq' },
        { pageUrl: 'https://example.test/contact' },
      ],
    });

    expect(state.reviewSiteCalls).toHaveLength(1);
    expect(state.reviewSiteCalls[0]).toMatchObject({
      workspaceId: ws.id,
      pageCount: 3,
      pageUrls: [
        'https://example.test/blog/ai-search',
        'https://example.test/resources/faq',
        'https://example.test/contact',
      ],
    });

    const saved = await api(`/api/aeo-review/${ws.id}`, { method: 'GET' });
    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.workspaceId).toBe(ws.id);
    expect(savedBody.sitewideSummary).toBe('Reviewed 3 pages');
    expect(savedBody.pages).toHaveLength(3);
    expect(savedBody.pages[0]).toMatchObject({ pageUrl: 'https://example.test/blog/ai-search' });
  });
});
