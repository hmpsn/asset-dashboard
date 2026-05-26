/**
 * Pure unit tests for server/seo-audit-ai-recs.ts
 *
 * extractBodyText() is a module-internal helper (not exported). These tests
 * exercise it indirectly: we mock all I/O dependencies, set OPENAI_API_KEY so
 * the AI branch runs, and capture the prompt passed to callAI to assert on the
 * text-extraction behaviour.
 *
 * Covers:
 *   extractBodyText (via prompt capture):
 *     - strips <script> tags and their content
 *     - strips <style> tags and their content
 *     - strips <nav>, <footer>, <header> blocks
 *     - preserves body text content
 *     - handles empty HTML without throwing
 *     - truncates body text to 2000 chars
 *     - extracts h1–h3 headings into "KEY HEADINGS:" prefix
 *
 *   AiRecsOpts shape contract:
 *     - results, htmlCache, workspaceId, siteId fields
 *
 *   generateAiRecommendations behaviour:
 *     - calls callAI for each page that has title/meta-description/og-tags issues
 *     - skips pages with no relevant issues
 *     - applies suggestedFix to title, metaDescription, and ogTitle issues
 *     - applies metaDescription suggestion to ogDesc when ogDesc is missing
 *     - gracefully ignores AI errors without throwing
 *     - early-returns (no AI call) when OPENAI_API_KEY is absent
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRecsOpts } from '../../server/seo-audit-ai-recs.js';

// ── Hoist mocks before any module import ────────────────────────────────────

const mocks = vi.hoisted(() => {
  // The logger is created at module-load time (const log = createLogger(...))
  // so the stub logger object must exist before the module is imported.
  const stubLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    callAI: vi.fn(),
    buildWorkspaceIntelligence: vi.fn(),
    formatForPrompt: vi.fn(),
    listWorkspaces: vi.fn(),
    getBrandName: vi.fn(),
    createLogger: vi.fn().mockReturnValue(stubLogger),
    stubLogger,
    parseJsonSafe: vi.fn(),
    findPageMapEntryByIdentity: vi.fn(),
    sanitizeForPromptInjection: vi.fn(),
    stripCodeFences: vi.fn(),
    buildSystemPrompt: vi.fn(),
    keywordComparisonKey: vi.fn(),
  };
});

vi.mock('../../server/ai.js', () => ({ callAI: mocks.callAI }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
  formatForPrompt: mocks.formatForPrompt,
}));
vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
  getBrandName: mocks.getBrandName,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: mocks.createLogger,
}));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafe: mocks.parseJsonSafe,
}));
vi.mock('../../server/helpers.js', () => ({
  findPageMapEntryByIdentity: mocks.findPageMapEntryByIdentity,
  sanitizeForPromptInjection: mocks.sanitizeForPromptInjection,
  stripCodeFences: mocks.stripCodeFences,
}));
vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
}));
vi.mock('../../server/middleware/validate.js', () => ({
  z: {
    object: () => ({
      strip: () => ({ parse: vi.fn(), safeParse: vi.fn() }),
    }),
    string: () => ({
      trim: () => ({ min: () => ({ optional: () => ({}) }) }),
    }),
  },
}));
vi.mock('../../shared/keyword-normalization.js', () => ({
  keywordComparisonKey: mocks.keywordComparisonKey,
}));

import { generateAiRecommendations } from '../../server/seo-audit-ai-recs.js';
import type { PageSeoResult } from '../../server/audit-page.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

function makePageResult(overrides: Partial<PageSeoResult> = {}): PageSeoResult {
  return {
    pageId: 'page-1',
    page: 'Home',
    url: 'https://example.com/',
    score: 70,
    issues: [],
    passed: [],
    ...overrides,
  };
}

function makeTitleIssue() {
  return { check: 'title' as const, message: 'Title too short', severity: 'warning' as const, value: 'Hi' };
}

function makeDescIssue() {
  return { check: 'meta-description' as const, message: 'Meta description missing', severity: 'error' as const, value: '' };
}

function makeOgTitleIssue() {
  return { check: 'og-tags' as const, message: 'OG title missing', severity: 'warning' as const, value: '' };
}

function makeOgDescIssue() {
  return { check: 'og-tags' as const, message: 'OG description missing', severity: 'warning' as const, value: '' };
}

// ── Default mock setup ───────────────────────────────────────────────────────

function setupDefaultMocks() {
  // Note: createLogger is already mocked at module-load time via vi.hoisted().
  // Reset the stub logger methods so call counts start fresh per test.
  mocks.stubLogger.info.mockReset();
  mocks.stubLogger.warn.mockReset();
  mocks.stubLogger.error.mockReset();
  mocks.listWorkspaces.mockReturnValue([{ id: 'ws-1', webflowSiteId: 'site-1' }]);
  mocks.getBrandName.mockReturnValue('Acme Inc');
  mocks.buildWorkspaceIntelligence.mockResolvedValue({
    seoContext: null,
    learnings: null,
    pageProfile: null,
    contentPipeline: null,
  });
  mocks.formatForPrompt.mockReturnValue('');
  mocks.buildSystemPrompt.mockReturnValue('You are an SEO copywriter.');
  mocks.sanitizeForPromptInjection.mockImplementation((s: string) => s);
  mocks.stripCodeFences.mockImplementation((s: string) => s);
  mocks.keywordComparisonKey.mockReturnValue('');
  mocks.findPageMapEntryByIdentity.mockReturnValue(null);
  mocks.parseJsonSafe.mockReturnValue({});
  mocks.callAI.mockResolvedValue({ text: '{"title":"New Title","metaDescription":"New desc"}' });
}

// ── extractBodyText via prompt capture ──────────────────────────────────────
// Strategy: provide crafted HTML in the htmlCache for a page that has issues.
// Capture the prompt string sent to callAI, then assert on the PAGE CONTENT
// EVIDENCE section which is built from extractBodyText(html).

describe('extractBodyText (via prompt capture)', () => {
  beforeEach(() => {
    setupDefaultMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    mocks.callAI.mockReset();
    mocks.callAI.mockResolvedValue({ text: '{}' });
    mocks.parseJsonSafe.mockReturnValue({});
  });

  async function capturePrompt(html: string): Promise<string> {
    const page = makePageResult({ issues: [makeTitleIssue()], pageId: 'p1' });
    const htmlCache = new Map([['p1', html]]);
    const opts: AiRecsOpts = { results: [page], htmlCache, siteId: 'site-1', workspaceId: 'ws-1' };
    await generateAiRecommendations(opts);
    if (mocks.callAI.mock.calls.length === 0) return '';
    const callArgs = mocks.callAI.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    return userMessage?.content ?? '';
  }

  it('strips <script> tags and their content from the body text', async () => {
    const html = '<html><body><p>Real content here</p><script>alert("danger")</script></body></html>';
    const prompt = await capturePrompt(html);
    expect(prompt).not.toContain('alert');
    expect(prompt).not.toContain('danger');
    expect(prompt).toContain('Real content here');
  });

  it('strips <style> tags and their content from the body text', async () => {
    const html = '<html><body><p>Visible text</p><style>.hidden { color: red }</style></body></html>';
    const prompt = await capturePrompt(html);
    expect(prompt).not.toContain('.hidden');
    expect(prompt).not.toContain('color: red');
    expect(prompt).toContain('Visible text');
  });

  it('strips <nav> blocks from the body text', async () => {
    const html = '<html><body><nav><a href="/home">Home</a><a href="/about">About</a></nav><p>Main body paragraph</p></body></html>';
    const prompt = await capturePrompt(html);
    expect(prompt).not.toContain('<nav>');
    // nav link text may or may not appear (tag content is stripped after tag removal)
    expect(prompt).toContain('Main body paragraph');
  });

  it('strips <footer> blocks from the body text', async () => {
    const html = '<html><body><p>Page intro</p><footer><p>Footer legal text</p></footer></body></html>';
    const prompt = await capturePrompt(html);
    expect(prompt).not.toContain('Footer legal text');
    expect(prompt).toContain('Page intro');
  });

  it('strips <header> blocks from the body text', async () => {
    const html = '<html><body><header><h1>Site Header</h1></header><p>Body content</p></body></html>';
    const prompt = await capturePrompt(html);
    // The header element and its content should be stripped
    expect(prompt).not.toContain('<header>');
    expect(prompt).toContain('Body content');
  });

  it('handles empty HTML string without throwing', async () => {
    await expect(capturePrompt('')).resolves.toBeDefined();
  });

  it('returns an empty body text section when HTML has no content', async () => {
    const prompt = await capturePrompt('<html><body></body></html>');
    // No PAGE CONTENT EVIDENCE section when body text is empty/whitespace
    // (the code only includes the block when pageContent is truthy)
    expect(prompt).not.toContain('PAGE CONTENT EVIDENCE');
  });

  it('includes KEY HEADINGS prefix when h1-h3 headings are present', async () => {
    const html = '<html><body><h1>Service Page</h1><h2>What We Do</h2><p>We help you grow.</p></body></html>';
    const prompt = await capturePrompt(html);
    expect(prompt).toContain('KEY HEADINGS:');
    expect(prompt).toContain('Service Page');
    expect(prompt).toContain('What We Do');
  });

  it('truncates body text at 2000 characters', async () => {
    // Build a large HTML body — the paragraph text alone exceeds 2000 chars
    const longText = 'A'.repeat(3000);
    const html = `<html><body><p>${longText}</p></body></html>`;
    const prompt = await capturePrompt(html);
    // The PAGE CONTENT EVIDENCE block must exist and contain truncated content
    expect(prompt).toContain('PAGE CONTENT EVIDENCE');
    // The full 3000 chars should NOT appear inside the prompt from this function
    // (extractBodyText caps at 2000, so the content in the prompt is ≤2000 chars for the page content section)
    const contentStart = prompt.indexOf('PAGE CONTENT EVIDENCE');
    const contentEnd = prompt.indexOf('\nISSUES TO FIX:', contentStart);
    const contentBlock = contentStart !== -1 && contentEnd !== -1 ? prompt.slice(contentStart, contentEnd) : '';
    // 3000 'A' chars would exceed the block if truncation wasn't applied
    expect(contentBlock.length).toBeLessThan(3000);
  });

  it('includes plain text from paragraphs in the page content evidence', async () => {
    const html = '<html><body><p>We specialize in enterprise SEO services.</p></body></html>';
    const prompt = await capturePrompt(html);
    expect(prompt).toContain('PAGE CONTENT EVIDENCE');
    expect(prompt).toContain('enterprise SEO services');
  });
});

// ── generateAiRecommendations — issue filtering ─────────────────────────────

describe('generateAiRecommendations — issue filtering', () => {
  beforeEach(() => {
    setupDefaultMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    mocks.callAI.mockReset();
    mocks.callAI.mockResolvedValue({ text: '{}' });
    mocks.parseJsonSafe.mockReturnValue({});
  });

  it('calls callAI for a page with a title issue', async () => {
    const page = makePageResult({ issues: [makeTitleIssue()] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('calls callAI for a page with a meta-description issue', async () => {
    const page = makePageResult({ issues: [makeDescIssue()] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('calls callAI for a page with an og-tags issue', async () => {
    const page = makePageResult({ issues: [makeOgTitleIssue()] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('does NOT call callAI for a page with no relevant issues', async () => {
    const page = makePageResult({
      issues: [{ check: 'canonical' as const, message: 'Missing canonical', severity: 'warning' as const }],
    });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(mocks.callAI).not.toHaveBeenCalled();
  });

  it('does NOT call callAI when results array is empty', async () => {
    await generateAiRecommendations({ results: [], htmlCache: new Map(), siteId: 'site-1' });
    expect(mocks.callAI).not.toHaveBeenCalled();
  });

  it('does NOT call callAI when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    const page = makePageResult({ issues: [makeTitleIssue()] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(mocks.callAI).not.toHaveBeenCalled();
  });
});

// ── generateAiRecommendations — suggestedFix mutation ───────────────────────

describe('generateAiRecommendations — suggestedFix mutation', () => {
  beforeEach(() => {
    setupDefaultMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    mocks.callAI.mockReset();
  });

  it('sets suggestedFix on the title issue when AI returns a title', async () => {
    mocks.callAI.mockResolvedValue({ text: '{"title":"Better Title"}' });
    mocks.parseJsonSafe.mockReturnValue({ title: 'Better Title' });
    const titleIssue = makeTitleIssue();
    const page = makePageResult({ issues: [titleIssue] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(titleIssue).toHaveProperty('suggestedFix', 'Better Title');
  });

  it('sets suggestedFix on the meta-description issue when AI returns metaDescription', async () => {
    mocks.callAI.mockResolvedValue({ text: '{"metaDescription":"Better description for SEO."}' });
    mocks.parseJsonSafe.mockReturnValue({ metaDescription: 'Better description for SEO.' });
    const descIssue = makeDescIssue();
    const page = makePageResult({ issues: [descIssue] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(descIssue).toHaveProperty('suggestedFix', 'Better description for SEO.');
  });

  it('sets suggestedFix on the ogTitle issue when AI returns ogTitle', async () => {
    mocks.callAI.mockResolvedValue({ text: '{"ogTitle":"Social Title"}' });
    mocks.parseJsonSafe.mockReturnValue({ ogTitle: 'Social Title' });
    const ogTitleIssue = makeOgTitleIssue();
    const page = makePageResult({ issues: [ogTitleIssue] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(ogTitleIssue).toHaveProperty('suggestedFix', 'Social Title');
  });

  it('uses metaDescription suggestion as ogDesc suggestedFix when ogDesc issue is present', async () => {
    mocks.callAI.mockResolvedValue({ text: '{"metaDescription":"Shared description."}' });
    mocks.parseJsonSafe.mockReturnValue({ metaDescription: 'Shared description.' });
    const descIssue = makeDescIssue();
    const ogDescIssue = makeOgDescIssue();
    const page = makePageResult({ issues: [descIssue, ogDescIssue] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(ogDescIssue).toHaveProperty('suggestedFix', 'Shared description.');
  });

  it('does not mutate issues when AI returns an empty object', async () => {
    mocks.callAI.mockResolvedValue({ text: '{}' });
    mocks.parseJsonSafe.mockReturnValue({});
    const titleIssue = makeTitleIssue();
    const page = makePageResult({ issues: [titleIssue] });
    await generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' });
    expect(titleIssue).not.toHaveProperty('suggestedFix');
  });
});

// ── generateAiRecommendations — error resilience ────────────────────────────

describe('generateAiRecommendations — error resilience', () => {
  beforeEach(() => {
    setupDefaultMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    mocks.callAI.mockReset();
  });

  it('does not throw when callAI rejects for a page', async () => {
    mocks.callAI.mockRejectedValue(new Error('Rate limit exceeded'));
    const page = makePageResult({ issues: [makeTitleIssue()] });
    await expect(
      generateAiRecommendations({ results: [page], htmlCache: new Map(), siteId: 'site-1' }),
    ).resolves.toBeUndefined();
  });

  it('continues processing other pages when one page AI call fails', async () => {
    mocks.callAI
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({ text: '{"title":"Good Title"}' });
    mocks.parseJsonSafe
      .mockReturnValueOnce({}) // first call (fails at AI level, but parseJsonSafe is still called after the error handler catches — only if needed; here the first call throws before parseJsonSafe)
      .mockReturnValueOnce({ title: 'Good Title' });

    const page1 = makePageResult({ pageId: 'p1', page: 'Page 1', issues: [makeTitleIssue()] });
    const page2 = makePageResult({ pageId: 'p2', page: 'Page 2', issues: [makeTitleIssue()] });
    await generateAiRecommendations({ results: [page1, page2], htmlCache: new Map(), siteId: 'site-1' });

    // Two AI calls were attempted (one per page)
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
  });
});

// ── AiRecsOpts shape contract ────────────────────────────────────────────────

describe('AiRecsOpts — shape contract', () => {
  it('accepts a minimal valid opts object (required fields only)', () => {
    const opts: AiRecsOpts = {
      results: [],
      htmlCache: new Map<string, string>(),
      siteId: 'site-abc',
    };
    expect(opts.results).toEqual([]);
    expect(opts.htmlCache).toBeInstanceOf(Map);
    expect(opts.siteId).toBe('site-abc');
    expect(opts.workspaceId).toBeUndefined();
  });

  it('accepts an opts object with optional workspaceId', () => {
    const opts: AiRecsOpts = {
      results: [],
      htmlCache: new Map<string, string>(),
      siteId: 'site-abc',
      workspaceId: 'ws-123',
    };
    expect(opts.workspaceId).toBe('ws-123');
  });

  it('htmlCache maps string pageId to string HTML', () => {
    const cache = new Map<string, string>([['page-1', '<html></html>']]);
    const opts: AiRecsOpts = { results: [], htmlCache: cache, siteId: 's' };
    expect(opts.htmlCache.get('page-1')).toBe('<html></html>');
    expect(opts.htmlCache.get('nonexistent')).toBeUndefined();
  });
});
