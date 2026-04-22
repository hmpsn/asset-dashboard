// tests/integration/webflow-seo-bulk-slugless.test.ts
//
// Regression guard: bulk SEO fix for pages WITHOUT slug or publishedPath must
// NOT fetch the homepage HTML as a substitute for the missing page URL.
// Without the guard (PR #slug-path-hardening), `fetch(\`${baseUrl}\`)` was
// issued for every path-less page — polluting prompts with homepage content
// and wasting bandwidth.
//
// This test intercepts `global.fetch` so we can assert:
//   - pages with slug → live-domain fetch IS issued (control)
//   - pages with NO slug and NO publishedPath → NO live-domain fetch issued
//
// The bulk-fix route still returns 200; the slug-less page is just processed
// without a content excerpt. The AI response itself is mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  setupOpenAIMocks,
  mockOpenAIResponse,
  resetOpenAIMocks,
} from '../mocks/openai.js';
import {
  setupAnthropicMocks,
  mockAnthropicResponse,
  resetAnthropicMocks,
} from '../mocks/anthropic.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

setupOpenAIMocks();
setupAnthropicMocks();

// ── Test server ──────────────────────────────────────────────────────────────

async function startTestServer(): Promise<{ server: http.Server; baseUrl: string; stop: () => void }> {
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const stop = () => server.close();
  return { server, baseUrl, stop };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ── Fetch interceptor ────────────────────────────────────────────────────────
// Capture outbound URLs that target the workspace's live domain so we can
// assert no slug-less page triggered a homepage fetch.

const LIVE_DOMAIN = 'test.example.com';

let capturedLiveFetches: string[] = [];
let originalFetch: typeof fetch;

function installFetchCapture(): void {
  originalFetch = globalThis.fetch;
  const stub: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes(LIVE_DOMAIN)) {
      capturedLiveFetches.push(url);
      // Return a synthetic 200 HTML so the route still behaves sensibly
      return Promise.resolve(new Response('<html><body>mock</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));
    }
    return originalFetch(input as Parameters<typeof fetch>[0], init);
  };
  globalThis.fetch = stub;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
  capturedLiveFetches = [];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('bulk SEO fix — slug-less page fetch guard', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    // Route short-circuits with 500 if OPENAI_API_KEY is unset — mocks intercept the SDK
    // but the route only checks env presence. Set a dummy key for the test.
    process.env.OPENAI_API_KEY = 'test-openai-key';
    resetOpenAIMocks();
    resetAnthropicMocks();
    capturedLiveFetches = [];
    ws = seedWorkspace();
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
    installFetchCapture();
  });

  afterEach(() => {
    restoreFetch();
    stopServer();
    ws.cleanup();
  });

  it('does NOT fetch the homepage for a page with no slug and no publishedPath', async () => {
    // Mock the bulk-fix AI response so the route completes
    // Route uses feature:'seo-bulk-fix' with callCreativeAI (Anthropic first, OpenAI fallback)
    mockAnthropicResponse('seo-bulk-fix', 'Mocked SEO Title');
    mockOpenAIResponse('seo-bulk-fix', 'Mocked SEO Title');

    const { status } = await postJson(baseUrl, `/api/webflow/seo-bulk-fix/${ws.webflowSiteId}`, {
      workspaceId: ws.workspaceId,
      field: 'title',
      pages: [
        // slug-less, publishedPath-less page — must NOT trigger homepage fetch
        { pageId: 'page-no-path', title: 'Orphan Page' },
      ],
    });

    expect(status).toBe(200);

    // The only live-domain fetch that would happen is `${baseUrl}/` — the homepage.
    // Guard ensures no fetch is issued at all for this page.
    const homepageFetches = capturedLiveFetches.filter(u => {
      // "${baseUrl}" (empty path) or "${baseUrl}/" both count as homepage
      const trimmed = u.replace(/^https?:\/\/[^/]+/, '');
      return trimmed === '' || trimmed === '/';
    });
    expect(homepageFetches).toHaveLength(0);
  });

  it('DOES fetch the page URL when slug is present (control)', async () => {
    // Route uses feature:'seo-bulk-fix' with callCreativeAI (Anthropic first, OpenAI fallback)
    mockAnthropicResponse('seo-bulk-fix', 'Mocked SEO Title');
    mockOpenAIResponse('seo-bulk-fix', 'Mocked SEO Title');

    const { status } = await postJson(baseUrl, `/api/webflow/seo-bulk-fix/${ws.webflowSiteId}`, {
      workspaceId: ws.workspaceId,
      field: 'title',
      pages: [
        { pageId: 'page-with-slug', title: 'Services', slug: 'services' },
      ],
    });

    expect(status).toBe(200);

    // Expect at least one live-domain fetch, and it should NOT be the bare homepage
    const pageFetches = capturedLiveFetches.filter(u => {
      const trimmed = u.replace(/^https?:\/\/[^/]+/, '');
      return trimmed === '/services';
    });
    expect(pageFetches.length).toBeGreaterThan(0);
  });

  it('does NOT fetch the homepage for a slug-less page even when mixed with slug-ful pages', async () => {
    // Route uses feature:'seo-bulk-fix' with callCreativeAI (Anthropic first, OpenAI fallback)
    mockAnthropicResponse('seo-bulk-fix', 'Mocked SEO Title');
    mockOpenAIResponse('seo-bulk-fix', 'Mocked SEO Title');

    const { status } = await postJson(baseUrl, `/api/webflow/seo-bulk-fix/${ws.webflowSiteId}`, {
      workspaceId: ws.workspaceId,
      field: 'title',
      pages: [
        { pageId: 'orphan', title: 'No Slug' },
        { pageId: 'about', title: 'About', slug: 'about' },
      ],
    });

    expect(status).toBe(200);

    const homepageFetches = capturedLiveFetches.filter(u => {
      const trimmed = u.replace(/^https?:\/\/[^/]+/, '');
      return trimmed === '' || trimmed === '/';
    });
    expect(homepageFetches).toHaveLength(0);

    const aboutFetches = capturedLiveFetches.filter(u => u.includes('/about'));
    expect(aboutFetches.length).toBeGreaterThan(0);
  });
});
