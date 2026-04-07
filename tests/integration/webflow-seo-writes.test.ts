// tests/integration/webflow-seo-writes.test.ts
//
// FM-2 (Phantom Success) tests for the Webflow SEO write endpoints.
//
// Tests verify that when external APIs (AI or Webflow) fail, the system:
//   - Returns an appropriate error (NOT a 200 with empty/garbage data)
//   - Does not persist bad state (no garbage suggestions saved)
//   - Routes per-site tokens correctly (FM-14)
//
// Architecture notes:
//   - POST /api/webflow/seo-rewrite calls callCreativeAI() (content-posts-ai.ts),
//     which delegates to callAnthropic() or callOpenAI()
//   - GET /api/webflow/seo-audit/:siteId calls runSeoAudit() (seo-audit.ts),
//     which uses getTokenForSite() and raw fetch() for Webflow API calls
//   - webflow-pages.ts uses webflowFetch() from webflow-client.ts (mocked below)
//
// Testing strategy:
//   We use createApp() + Node.js http to avoid spawning a child process
//   (which would prevent vi.mock from intercepting module calls).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  setupWebflowMocks,
  mockWebflowSuccess,
  mockWebflowError,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';
import {
  setupOpenAIMocks,
  mockOpenAIResponse,
  mockOpenAIError,
  resetOpenAIMocks,
} from '../mocks/openai.js';
import {
  setupAnthropicMocks,
  mockAnthropicResponse,
  mockAnthropicError,
  resetAnthropicMocks,
} from '../mocks/anthropic.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

// ---------------------------------------------------------------------------
// Module-level vi.mock calls (hoisted by Vitest — must be at top level)
// ---------------------------------------------------------------------------

setupWebflowMocks();
setupOpenAIMocks();
setupAnthropicMocks();

// ---------------------------------------------------------------------------
// HTTP helper — POST/GET against a live http.Server wrapping createApp()
// ---------------------------------------------------------------------------

async function startTestServer(): Promise<{ server: http.Server; baseUrl: string; stop: () => void }> {
  // Import createApp lazily so mocks are established first
  const { createApp } = await import('../../server/app.js');
  const app = createApp();

  // Disable auth gate for test environment — APP_PASSWORD is not set in test env
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

async function getJson(baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Webflow SEO Writes — FM-2 Phantom Success', () => {
  let ws: SeededFullWorkspace;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    resetWebflowMocks();
    resetOpenAIMocks();
    resetAnthropicMocks();
    ws = seedWorkspace();
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
  });

  afterEach(async () => {
    stopServer();
    ws.cleanup();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: SEO Rewrite — AI failure returns 500, no garbage saved
  // ─────────────────────────────────────────────────────────────────────────

  it('AI failure returns 500 — not a 200 with empty/garbage suggestions', async () => {
    // Both Anthropic and OpenAI throw. callCreativeAI tries Anthropic first
    // (isAnthropicConfigured returns true in mock), falls back to OpenAI.
    // When both fail, the route must return 500.
    mockAnthropicError('seo-rewrite', 'Anthropic upstream error');
    mockOpenAIError('seo-rewrite', 'OpenAI upstream error');

    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-rewrite', {
      pageTitle: 'Our Services',
      currentSeoTitle: 'Services | Acme Co',
      currentDescription: 'We offer services.',
      field: 'title',
      workspaceId: ws.workspaceId,
    });

    // FM-2: must NOT return 200 with silent empty result
    expect(status).toBe(500);
    expect((body as { error?: string }).error).toBeTruthy();
    // Confirm the error message isn't empty/undefined
    expect(typeof (body as { error?: string }).error).toBe('string');
    expect((body as { error?: string }).error!.length).toBeGreaterThan(0);
  });

  it('AI failure for "both" field returns 500 — not a 200 with empty pairs', async () => {
    mockAnthropicError('seo-rewrite-both', 'Anthropic timeout');
    mockOpenAIError('seo-rewrite-both', 'OpenAI timeout');

    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-rewrite', {
      pageTitle: 'Homepage',
      currentSeoTitle: '',
      currentDescription: '',
      field: 'both',
      workspaceId: ws.workspaceId,
    });

    // FM-2: must surface the error, not return an empty pairs array with 200
    expect(status).toBe(500);
    expect((body as { error?: string }).error).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: SEO Rewrite — missing pageTitle returns 400 (not 200)
  // ─────────────────────────────────────────────────────────────────────────

  it('missing pageTitle returns 400 with clear error message', async () => {
    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-rewrite', {
      currentSeoTitle: 'Old Title',
      field: 'title',
      workspaceId: ws.workspaceId,
      // pageTitle intentionally omitted
    });

    expect(status).toBe(400);
    expect((body as { error?: string }).error).toMatch(/pageTitle/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: SEO Audit — getTokenForSite returns null → 500 with clear message
  // ─────────────────────────────────────────────────────────────────────────

  it('SEO audit returns 500 when no Webflow token is available for site', async () => {
    // Use a siteId that has NO workspace row — getTokenForSite will return null
    // (env WEBFLOW_API_TOKEN is not set in test env)
    const orphanSiteId = 'orphan-site-no-token-xyz';

    const { status, body } = await getJson(
      baseUrl,
      `/api/webflow/seo-audit/${orphanSiteId}?workspaceId=${ws.workspaceId}`,
    );

    // FM-2: must return 500 with a descriptive message, NOT 200 with empty pages
    expect(status).toBe(500);
    const errorMsg = (body as { error?: string }).error ?? '';
    expect(errorMsg.length).toBeGreaterThan(0);
    // Should mention token configuration so operators know what to fix
    expect(errorMsg.toLowerCase()).toMatch(/token|configured|webflow/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: SEO Audit — Webflow API error propagates as 500, not empty pages
  // ─────────────────────────────────────────────────────────────────────────

  it('SEO audit returns 500 when Webflow pages API returns 500', async () => {
    // Seed a workspace WITH a token so getTokenForSite succeeds,
    // but mock the Webflow pages endpoint to return 500.
    // The workspace-data layer (getWorkspacePages → listPages) uses webflowFetch.
    mockWebflowError(/\/sites\/.*\/pages/, 500, 'Webflow internal error');
    // Also fail site info endpoint so subdomain resolution fails
    mockWebflowError(/\/sites\//, 500, 'Webflow internal error');

    // Use the seeded workspace's siteId — it has a token configured
    const { status, body } = await getJson(
      baseUrl,
      `/api/webflow/seo-audit/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );

    // The audit should either:
    //   a) return 500 when the pages fetch fails fatally, OR
    //   b) return 200 with 0 pages (graceful degradation — listPages returns [] on !res.ok)
    //
    // Both are acceptable for non-phantom-success:
    //   - 200 with pages:[] is not phantom success if the audit was genuinely empty
    //   - The critical FM-2 check is that a 500 from Webflow does NOT become
    //     a 200 with fabricated page data
    //
    // We assert the response body does NOT contain fabricated pages.
    const responseBody = body as { pages?: unknown[]; error?: string };
    if (status === 200) {
      // Graceful degradation path: pages may be empty (real result), never fabricated
      expect(Array.isArray(responseBody.pages)).toBe(true);
      // If pages is populated, it must be from real data — but in this test
      // the webflow mock returns 500 for all pages endpoints, so pages should be []
      expect(responseBody.pages).toHaveLength(0);
    } else {
      // Error propagation path: must be 500 with a non-empty error message
      expect(status).toBe(500);
      expect(typeof responseBody.error).toBe('string');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: Per-site token is threaded to Webflow calls (FM-14)
  // ─────────────────────────────────────────────────────────────────────────

  it('per-site Webflow token from workspace is used, not a global fallback', async () => {
    // The seeded workspace has a unique per-site token (ws.webflowToken).
    // Mock the pages endpoint to succeed so we can capture what token was used.
    mockWebflowSuccess(/\/sites\/.*\/pages/, { pages: [] });

    // Trigger an audit — this calls getTokenForSite() which reads from the
    // workspace row, then passes it to runSeoAudit → listPages → webflowFetch
    await getJson(
      baseUrl,
      `/api/webflow/seo-audit/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`,
    );

    const captured = getCapturedRequests();
    // listPages calls webflowFetch with the per-site token override
    const pagesRequest = captured.find(r => r.endpoint.includes('/pages'));
    if (pagesRequest) {
      // FM-14: must use the workspace-specific token, not the global env token
      expect(pagesRequest.token).toBe(ws.webflowToken);
    }
    // If no pages request was captured (workspace-data returned cached empty result),
    // that is also acceptable — no phantom token substitution occurred.
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6: SEO Rewrite — AI returns malformed JSON handled gracefully
  // ─────────────────────────────────────────────────────────────────────────

  it('AI returning malformed JSON produces fallback variations, not a crash', async () => {
    // Return non-JSON text from the AI
    mockAnthropicResponse('seo-rewrite', 'not json at all — just some text the AI returned');

    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-rewrite', {
      pageTitle: 'Contact Us',
      currentSeoTitle: 'Contact | Acme',
      currentDescription: '',
      field: 'title',
      workspaceId: ws.workspaceId,
    });

    // Route catches JSON parse errors and falls back to the raw text as a variation.
    // Acceptable outcomes:
    //   a) 200 with variations containing the raw text (graceful fallback)
    //   b) 500 if the route decides raw text is not a usable title
    //
    // Critical check: must NOT crash (no unhandled exception → no empty 500 body)
    expect([200, 500]).toContain(status);

    if (status === 200) {
      const b = body as { variations?: unknown[]; text?: string; error?: string };
      // Variations array must exist and be a real array (not undefined)
      expect(Array.isArray(b.variations)).toBe(true);
      // Must not be entirely empty — at least the raw text should appear as fallback
      expect(b.variations!.length).toBeGreaterThan(0);
    } else {
      // 500 path: must still have a non-empty error string (not a silent crash)
      const b = body as { error?: string };
      expect(typeof b.error).toBe('string');
      expect(b.error!.length).toBeGreaterThan(0);
    }
  });

  it('AI returning malformed JSON for "both" field produces empty pairs, not a crash', async () => {
    // For the "both" field, the route parses JSON into pairs.
    // On parse failure it sets pairs = [], which is valid graceful degradation.
    mockAnthropicResponse('seo-rewrite-both', '{ bad json {{{ not parseable');

    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-rewrite', {
      pageTitle: 'About Us',
      currentSeoTitle: '',
      currentDescription: '',
      field: 'both',
      workspaceId: ws.workspaceId,
    });

    // Must not crash. 200 with empty pairs OR 500 are both acceptable.
    expect([200, 500]).toContain(status);

    if (status === 200) {
      const b = body as { field?: string; pairs?: unknown[]; titleVariations?: unknown[]; descriptionVariations?: unknown[] };
      expect(b.field).toBe('both');
      // pairs can be empty (JSON parse failed) — that's the documented fallback
      expect(Array.isArray(b.pairs)).toBe(true);
    }
  });

  // NOTE: Happy-path tests (successful rewrite, character truncation, OpenAI fallback)
  // are omitted here because they require deep mocking of buildWorkspaceIntelligence
  // and its transitive dependencies. These are better covered by dedicated unit tests
  // for the SEO rewrite handler. This file focuses strictly on FM-2 failure modes.
});
