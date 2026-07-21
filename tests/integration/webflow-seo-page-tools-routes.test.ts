/**
 * Integration tests for server/routes/webflow-seo-page-tools.ts
 *
 * Routes tested:
 *   GET  /api/webflow/page-html/:siteId?path=
 *   POST /api/webflow/seo-copy
 *
 * Strategy: inline Express server (vi.mock hoisted before imports) so that
 * mocks for the creative dispatcher and `getSiteSubdomain` take effect at load time.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Mock getSiteSubdomain (re-exported via webflow.ts barrel) ────────────────
// Hoisted before any server imports so the route module sees the mock.
const state = vi.hoisted(() => ({
  siteSubdomain: null as string | null,
  aiText: null as string | null,
}));

// The route imports getSiteSubdomain from the `server/webflow.js` BARREL (which re-exports it
// via `export * from './webflow-pages.js'`). Mocking the underlying webflow-pages.js module did
// NOT reliably propagate through the `export *` re-export — under some test-shard evaluation
// orders the barrel bound the real function before the mock applied, so getSiteSubdomain returned
// null and the "404 when subdomain resolved" case got a 400. Mock the exact module the route
// imports from (the barrel) so interception is order-independent.
vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    getSiteSubdomain: vi.fn(async () => state.siteSubdomain),
  };
});

vi.mock('../../server/content-posts-ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/content-posts-ai.js')>();
  return {
    ...actual,
    callCreativeAI: vi.fn(async () => {
      if (!state.aiText) throw new Error('creative AI: no provider configured');
      return state.aiText;
    }),
  };
});

// ── Server lifecycle ─────────────────────────────────────────────────────────

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalAppPassword = process.env.APP_PASSWORD;

let server: http.Server | undefined;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  // Disable APP_PASSWORD gate so admin routes are open.
  process.env.APP_PASSWORD = '';
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close((err) => (err ? reject(err) : resolve())),
  );
  server = undefined;
}

async function api(pathname: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, opts);
}

async function postJson(pathname: string, body: unknown): Promise<Response> {
  return api(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Test data ────────────────────────────────────────────────────────────────

const SITE_ID = 'site_seopagetools_test';
const workspaceIds: string[] = [];

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterEach(() => {
  // Reset per-test mutable state.
  state.siteSubdomain = null;
  state.aiText = null;
});

afterAll(async () => {
  // Clean up any created workspaces.
  for (const id of workspaceIds) {
    deleteWorkspace(id);
  }
  workspaceIds.length = 0;

  await stopTestServer();

  // Restore env vars.
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;

  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

// ── GET /api/webflow/page-html/:siteId ───────────────────────────────────────

describe('GET /api/webflow/page-html/:siteId', () => {
  it('returns 400 when path query param is missing', async () => {
    const res = await api(`/api/webflow/page-html/${SITE_ID}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'path query param required' });
  });

  it('normalizes empty path to "/" and proceeds past the guard (resolves to "Could not resolve site URL" with no site config)', async () => {
    // normalizePageUrl('') → '/' (truthy), so the path guard is bypassed.
    // With no workspace linked and getSiteSubdomain returning null, the URL
    // list is empty and the route returns 400 "Could not resolve site URL".
    state.siteSubdomain = null;
    const res = await api(`/api/webflow/page-html/${SITE_ID}?path=`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Could not resolve site URL' });
  });

  it('returns 400 "Could not resolve site URL" when siteId has no workspace and getSiteSubdomain returns null', async () => {
    // No workspace linked to this siteId, no live domain, getSiteSubdomain → null.
    state.siteSubdomain = null;
    const res = await api(`/api/webflow/page-html/nonexistent-site-xyz?path=/about`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Could not resolve site URL' });
  });

  it('returns 404 when subdomain is resolved but the page fetch fails', async () => {
    // Provide a subdomain so the URL list is populated; the actual HTTP fetch
    // will fail (no real server at that address) and be swallowed, leaving html=''.
    state.siteSubdomain = 'test-subdomain-unreachable';

    const res = await api(`/api/webflow/page-html/nonexistent-site-xyz?path=/about`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to fetch page from live domain or webflow.io' });
  });

  it('fetches HTML from workspace liveDomain and returns text + seo fields', async () => {
    const ws = createWorkspace('SEO Page Tools Live Domain WS');
    workspaceIds.push(ws.id);
    updateWorkspace(ws.id, { liveDomain: '' });

    // Spin up a tiny local HTTP server that serves a known HTML response.
    const htmlServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><head><title>Test Page Title</title><meta name="description" content="Test meta description"/></head><body><h1>Hello World</h1><p>Some page content here.</p></body></html>',
      );
    });
    await new Promise<void>((resolve) => htmlServer.listen(0, '127.0.0.1', resolve));
    const { port: htmlPort } = htmlServer.address() as AddressInfo;
    const liveDomain = `http://127.0.0.1:${htmlPort}`;

    updateWorkspace(ws.id, { webflowSiteId: SITE_ID, liveDomain });

    const res = await api(`/api/webflow/page-html/${SITE_ID}?path=/test-page`);

    await new Promise<void>((resolve) => htmlServer.close(() => resolve()));

    expect(res.status).toBe(200);
    const body = await res.json() as { text: string; seoTitle?: string; metaDescription?: string };
    expect(body.seoTitle).toBe('Test Page Title');
    expect(body.metaDescription).toBe('Test meta description');
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
  });
});

// ── POST /api/webflow/seo-copy ───────────────────────────────────────────────

describe('POST /api/webflow/seo-copy', () => {
  it('returns 400 when workspaceId is missing from body', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const res = await postJson('/api/webflow/seo-copy', { pagePath: '/about' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'pagePath and workspaceId required' });
  });

  it('returns 400 when pagePath is missing from body', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const res = await postJson('/api/webflow/seo-copy', { workspaceId: 'ws_any' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'pagePath and workspaceId required' });
  });

  it('returns 400 when both pagePath and workspaceId are missing', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const res = await postJson('/api/webflow/seo-copy', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'pagePath and workspaceId required' });
  });

  it('returns a generic AI failure when no creative provider is configured', async () => {
    delete process.env.OPENAI_API_KEY;

    const ws = createWorkspace('SEO Copy No Key WS');
    workspaceIds.push(ws.id);

    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: ws.id,
      pagePath: '/about',
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'SEO copy generation failed' });
  });

  it('calls the canonical creative operation and returns parsed SEO copy fields', async () => {
    process.env.OPENAI_API_KEY = 'test-key-configured';

    const ws = createWorkspace('SEO Copy Valid WS');
    workspaceIds.push(ws.id);

    const mockAIPayload = {
      seoTitle: 'Optimized Title Tag Here',
      metaDescription: 'A compelling meta description that invites clicks and stays within limits.',
      h1: 'Clear H1 Heading',
      introParagraph: 'A well-crafted intro paragraph that draws readers in.',
      internalLinkSuggestions: [],
      changes: ['Added primary keyword to title', 'Improved meta description CTA'],
    };

    state.aiText = JSON.stringify(mockAIPayload);

    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: ws.id,
      pagePath: '/services',
      pageTitle: 'Our Services',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as typeof mockAIPayload;
    expect(body.seoTitle).toBe('Optimized Title Tag Here');
    expect(body.metaDescription).toBe(
      'A compelling meta description that invites clicks and stays within limits.',
    );
    expect(body.h1).toBe('Clear H1 Heading');
    expect(body.introParagraph).toBe('A well-crafted intro paragraph that draws readers in.');
    expect(body.internalLinkSuggestions).toEqual([]);
    expect(body.changes).toEqual(['Added primary keyword to title', 'Improved meta description CTA']);
  });

  it('truncates seoTitle to 60 characters at a word boundary', async () => {
    process.env.OPENAI_API_KEY = 'test-key-configured';

    const ws = createWorkspace('SEO Copy Title Truncation WS');
    workspaceIds.push(ws.id);

    // 72-char title: route should trim to ≤60 at last word boundary after char 36.
    const longTitle = 'Extremely Long SEO Title That Exceeds The Sixty Character Limit Here';
    state.aiText = JSON.stringify({
      seoTitle: longTitle,
      metaDescription: 'Short desc.',
      h1: 'H1',
      introParagraph: 'A clear page introduction with useful detail.',
      internalLinkSuggestions: [],
      changes: [],
    });

    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: ws.id,
      pagePath: '/long-title',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { seoTitle: string };
    expect(body.seoTitle.length).toBeLessThanOrEqual(60);
  });

  it('truncates metaDescription to 160 characters at a word boundary', async () => {
    process.env.OPENAI_API_KEY = 'test-key-configured';

    const ws = createWorkspace('SEO Copy Meta Truncation WS');
    workspaceIds.push(ws.id);

    // Build a 180-char description.
    const longMeta = 'A very long meta description that goes well beyond the one hundred and sixty character limit and must be trimmed to fit within the required boundaries correctly.';
    state.aiText = JSON.stringify({
      seoTitle: 'Title',
      metaDescription: longMeta,
      h1: 'H1',
      introParagraph: 'A clear page introduction with useful detail.',
      internalLinkSuggestions: [],
      changes: [],
    });

    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: ws.id,
      pagePath: '/long-meta',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { metaDescription: string };
    expect(body.metaDescription.length).toBeLessThanOrEqual(160);
  });

  it('returns a generic error without a padded response when AI returns invalid JSON', async () => {
    process.env.OPENAI_API_KEY = 'test-key-configured';

    const ws = createWorkspace('SEO Copy Bad JSON WS');
    workspaceIds.push(ws.id);

    state.aiText = 'this is not json at all';

    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: ws.id,
      pagePath: '/bad-json',
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: 'SEO copy generation failed' });
  });

  it('filters out internal link suggestions that reference the current page path', async () => {
    process.env.OPENAI_API_KEY = 'test-key-configured';

    const ws = createWorkspace('SEO Copy Self-Link Filter WS');
    workspaceIds.push(ws.id);

    state.aiText = JSON.stringify({
      seoTitle: 'Title',
      metaDescription: 'Meta',
      h1: 'H1',
      introParagraph: 'A clear page introduction with useful detail.',
      internalLinkSuggestions: [
        { targetPath: '/services', anchorText: 'Self Link', context: 'Links to itself' },
        { targetPath: '/about', anchorText: 'About Us', context: 'Links to about page — not in pageMap, filtered' },
      ],
      changes: [],
    });

    const res = await postJson('/api/webflow/seo-copy', {
      workspaceId: ws.id,
      pagePath: '/services',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { internalLinkSuggestions: Array<{ targetPath: string }> };
    // /services is filtered as a self-reference; /about is not in the verified page-map census.
    expect(body.internalLinkSuggestions).toEqual([]);
  });
});
