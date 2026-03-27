/**
 * Unit tests for Phase 4 — llms.txt smart summaries, two-tier output, URL validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Cache Store Tests ──

describe('llms-txt-cache store', () => {
  let upsertSummary: typeof import('../../server/llms-txt-generator.js')['upsertSummary'];
  let getSummary: typeof import('../../server/llms-txt-generator.js')['getSummary'];
  let getSummaries: typeof import('../../server/llms-txt-generator.js')['getSummaries'];
  let deleteSummary: typeof import('../../server/llms-txt-generator.js')['deleteSummary'];

  beforeEach(async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    upsertSummary = mod.upsertSummary;
    getSummary = mod.getSummary;
    getSummaries = mod.getSummaries;
    deleteSummary = mod.deleteSummary;
  });

  it('upsert and retrieve a summary', () => {
    upsertSummary('ws-1', 'https://example.com/', 'A landing page for the product.');
    const result = getSummary('ws-1', 'https://example.com/');
    expect(result).toBeTruthy();
    expect(result!.summary).toBe('A landing page for the product.');
  });

  it('upsert replaces existing summary', () => {
    upsertSummary('ws-1', 'https://example.com/about', 'Old summary');
    upsertSummary('ws-1', 'https://example.com/about', 'Updated summary');
    const result = getSummary('ws-1', 'https://example.com/about');
    expect(result!.summary).toBe('Updated summary');
  });

  it('returns all summaries for a workspace', () => {
    upsertSummary('ws-2', 'https://example.com/a', 'Summary A');
    upsertSummary('ws-2', 'https://example.com/b', 'Summary B');
    const all = getSummaries('ws-2');
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('deletes a summary', () => {
    upsertSummary('ws-3', 'https://example.com/del', 'To delete');
    const ok = deleteSummary('ws-3', 'https://example.com/del');
    expect(ok).toBe(true);
    const result = getSummary('ws-3', 'https://example.com/del');
    expect(result).toBeNull();
  });
});

// ── Two-Tier Output Tests ──

describe('buildLlmsTxtIndex', () => {
  let buildLlmsTxtIndex: typeof import('../../server/llms-txt-generator.js')['buildLlmsTxtIndex'];

  beforeEach(async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    buildLlmsTxtIndex = mod.buildLlmsTxtIndex;
  });

  it('builds index with header, site description, and page links', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'Test Site',
      baseUrl: 'https://test.com',
      description: 'A great test site',
      pages: [
        { path: '/', title: 'Home', description: 'Homepage of Test Site' },
        { path: '/about', title: 'About', description: 'About us' },
      ],
      plannedPages: [],
    });
    expect(result).toContain('# Test Site');
    expect(result).toContain('> A great test site');
    expect(result).toContain('[Home](https://test.com/)');
    expect(result).toContain(': Homepage of Test Site');
    expect(result).toContain('[About](https://test.com/about)');
  });

  it('includes generation timestamp', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [],
      plannedPages: [],
    });
    expect(result).toMatch(/Generated:/);
  });

  it('groups pages by section', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/blog/post-1', title: 'Post 1' },
        { path: '/blog/post-2', title: 'Post 2' },
      ],
      plannedPages: [],
    });
    expect(result).toContain('## Blog');
  });
});

describe('buildLlmsFullTxt', () => {
  let buildLlmsFullTxt: typeof import('../../server/llms-txt-generator.js')['buildLlmsFullTxt'];

  beforeEach(async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    buildLlmsFullTxt = mod.buildLlmsFullTxt;
  });

  it('builds full output with inline summaries', () => {
    const result = buildLlmsFullTxt({
      siteName: 'Test Site',
      baseUrl: 'https://test.com',
      description: 'A test site',
      pages: [
        { path: '/', title: 'Home', summary: 'This is the homepage for Test Site, offering analytics services.' },
        { path: '/about', title: 'About', summary: 'About page describing the team.' },
      ],
    });
    expect(result).toContain('# Test Site');
    expect(result).toContain('### [Home](https://test.com/)');
    expect(result).toContain('This is the homepage for Test Site');
    expect(result).toContain('### [About](https://test.com/about)');
    expect(result).toContain('About page describing the team.');
  });

  it('falls back to description when no summary available', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/faq', title: 'FAQ', description: 'Frequently asked questions' },
      ],
    });
    expect(result).toContain('Frequently asked questions');
  });

  it('skips pages with no summary or description', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/empty', title: 'Empty' },
      ],
    });
    // Page still listed but with a note
    expect(result).toContain('### [Empty](https://s.com/empty)');
  });
});

// ── URL Validation Tests ──

describe('validateUrls', () => {
  let validateUrls: typeof import('../../server/llms-txt-generator.js')['validateUrls'];

  beforeEach(async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    validateUrls = mod.validateUrls;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid URLs that respond 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const result = await validateUrls(['https://example.com/', 'https://example.com/about']);
    expect(result).toContain('https://example.com/');
    expect(result).toContain('https://example.com/about');
  });

  it('filters out URLs that return non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('broken')) return new Response('', { status: 404 });
      return new Response('', { status: 200 });
    });
    const result = await validateUrls(['https://example.com/ok', 'https://example.com/broken']);
    expect(result).toContain('https://example.com/ok');
    expect(result).not.toContain('https://example.com/broken');
  });

  it('filters out URLs that throw network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS failed'));
    const result = await validateUrls(['https://dead-domain.xyz/']);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', async () => {
    const result = await validateUrls([]);
    expect(result).toEqual([]);
  });
});
