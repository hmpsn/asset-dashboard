/**
 * Regression tests for PR #167 — voice authority in `server/internal-links.ts`.
 *
 * The bug: `analyzeInternalLinks` used to fall back to raw `workspace.brandVoice`
 * via `const brandCtx = brandVoiceBlock || (wsObj?.brandVoice ? ... : '')` when
 * `effectiveBrandVoiceBlock` was empty. For workspaces with a calibrated voice
 * profile but no samples, this re-injected the legacy voice text into the OpenAI
 * prompt — violating the voice-authority rule (once a profile is calibrated, the
 * legacy `workspace.brandVoice` column is no longer authoritative).
 *
 * These tests lock in the fix by asserting:
 *   (a) calibrated-empty scenario → prompt contains NO raw legacy brandVoice text
 *   (b) non-calibrated scenario → prompt contains the effectiveBrandVoiceBlock text
 *       exactly as pre-formatted by `buildSeoContext`
 *   (c) effective block is the authority even when raw brandVoice diverges
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  getCapturedOpenAICalls,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

const LEGACY_SENTINEL = 'LEGACY_SENTINEL_VOICE_DO_NOT_APPEAR_IN_PROMPT';
const AUTHORITATIVE_BLOCK =
  '\n\nBRAND VOICE REFERENCE (match this voice based on the samples):\n- Authoritative sample voice with MATCH_ME sentinel.';

// Hoisted mutable fixture — shared by all mocked modules via closure.
// `vi.hoisted()` guarantees this is initialized BEFORE `vi.mock` factories run,
// so we can reference it safely from inside the factories.
const seoFixture = vi.hoisted(() => ({
  effectiveBrandVoiceBlock: '',
  brandVoice: '',
}));

// ── Module-level mocks ──────────────────────────────────────────────────────

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn((_id: string) => ({
    id: 'ws-test',
    name: 'Test Workspace',
    brandVoice: seoFixture.brandVoice, // raw legacy voice text
    liveDomain: 'example.com',
  })),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({
    version: 1,
    workspaceId: 'ws-test',
    assembledAt: new Date().toISOString(),
    seoContext: {
      strategy: null,
      brandVoice: seoFixture.brandVoice,
      effectiveBrandVoiceBlock: seoFixture.effectiveBrandVoiceBlock,
      businessContext: '',
      knowledgeBase: null,
      personas: [],
      pageKeywords: null,
    },
    pageProfile: null,
  })),
  formatPersonasForPrompt: vi.fn(() => ''),
  formatKnowledgeBaseForPrompt: vi.fn(() => ''),
}));

vi.mock('../../server/webflow.js', () => ({
  getSiteSubdomain: vi.fn(async () => 'test-site'),
  discoverCmsUrls: vi.fn(async () => ({ cmsUrls: [] })),
  buildStaticPathSet: vi.fn(() => new Set<string>()),
}));

vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: vi.fn(async () => []),
}));

vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: vi.fn(() => []),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { analyzeInternalLinks } from '../../server/internal-links.js';

// ── fetch mock: sitemap + page HTML ─────────────────────────────────────────

function makeSitemapXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/services/seo</loc></url>
  <url><loc>https://example.com/blog/seo-tips</loc></url>
</urlset>`;
}

function makePageHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function setupFetchRouter(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith('/sitemap.xml')) {
      return new Response(makeSitemapXml(), {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    if (url.includes('/services/seo')) {
      return new Response(
        makePageHtml('SEO Services', 'We offer professional SEO services for your business.'),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    }

    if (url.includes('/blog/seo-tips')) {
      return new Response(
        makePageHtml('SEO Tips', 'Ten proven SEO tips to improve your rankings.'),
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    }

    // Unknown URL — fail loudly
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('analyzeInternalLinks brand voice authority (PR #167 regression)', () => {
  beforeEach(() => {
    resetOpenAIMocks();
    setupFetchRouter();
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.WEBFLOW_API_TOKEN = 'test-token';
    // Preload a valid empty JSON array so analyzeInternalLinks doesn't fail parsing
    mockOpenAIJsonResponse('internal-links', []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    seoFixture.effectiveBrandVoiceBlock = '';
    seoFixture.brandVoice = '';
  });

  it('calibrated-empty path: does NOT leak raw workspace.brandVoice into the prompt', async () => {
    // Arrange: simulate calibrated voice profile with zero samples. `buildSeoContext`
    // would have returned an empty `brandVoiceBlock` because `buildVoiceProfileContext`
    // returns '' for calibrated-no-samples profiles (DNA skipped, guardrails skipped,
    // no samples to render). The raw legacy brandVoice is still populated on the
    // workspace row but must NOT reach the prompt.
    seoFixture.effectiveBrandVoiceBlock = '';
    seoFixture.brandVoice = LEGACY_SENTINEL;

    await analyzeInternalLinks('site-id', 'ws-test');

    const calls = getCapturedOpenAICalls();
    expect(calls).toHaveLength(1);
    const userMessage = calls[0].messages.find(m => m.role === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage!.content).not.toContain(LEGACY_SENTINEL);
  });

  it('non-calibrated path: effectiveBrandVoiceBlock reaches the prompt verbatim', async () => {
    // Arrange: workspace has no voice profile, so `buildSeoContext` returns the legacy
    // block inside `effectiveBrandVoiceBlock`. This block must appear in the prompt.
    seoFixture.effectiveBrandVoiceBlock = AUTHORITATIVE_BLOCK;
    seoFixture.brandVoice = 'raw text (should not appear separately — only via effective block)';

    await analyzeInternalLinks('site-id', 'ws-test');

    const calls = getCapturedOpenAICalls();
    expect(calls).toHaveLength(1);
    const userMessage = calls[0].messages.find(m => m.role === 'user');
    expect(userMessage).toBeDefined();
    // The authoritative sentinel must be present (flattened — internal-links.ts strips
    // newlines when building the parenthetical hint).
    expect(userMessage!.content).toContain('MATCH_ME sentinel');
  });

  it('legacy raw brandVoice is never the authority source, even when effectiveBrandVoiceBlock differs', async () => {
    // Arrange: effective block has FRESH content, but raw brandVoice has STALE content.
    // The prompt must reflect the effective block (authority), not the raw field.
    seoFixture.effectiveBrandVoiceBlock =
      '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nFRESH_VOICE_WINS';
    seoFixture.brandVoice = 'STALE_VOICE_LOSES';

    await analyzeInternalLinks('site-id', 'ws-test');

    const calls = getCapturedOpenAICalls();
    const userMessage = calls[0].messages.find(m => m.role === 'user');
    expect(userMessage!.content).toContain('FRESH_VOICE_WINS');
    expect(userMessage!.content).not.toContain('STALE_VOICE_LOSES');
  });
});
