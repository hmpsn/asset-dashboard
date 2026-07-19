import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---- hoisted mocks (must use vi.hoisted for variables used in vi.mock factories) ----

const {
  mockCallAI,
  mockListWorkspaces,
  mockGetBrandName,
  mockBuildWorkspaceIntelligence,
  mockFormatForPrompt,
} = vi.hoisted(() => ({
  mockCallAI: vi.fn(),
  mockListWorkspaces: vi.fn(() => []),
  mockGetBrandName: vi.fn(() => 'Test Brand'),
  mockBuildWorkspaceIntelligence: vi.fn(async () => ({
    seoContext: null,
    learnings: null,
    contentPipeline: null,
    pageProfile: null,
  })),
  mockFormatForPrompt: vi.fn(() => ''),
}));

vi.mock('../../server/ai.js', () => ({ callAI: mockCallAI }));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() })),
    transaction: vi.fn((fn: unknown) => fn),
  },
}));

vi.mock('../../server/db.js', () => ({
  db: {
    prepare: vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() })),
    transaction: vi.fn((fn: unknown) => fn),
  },
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mockListWorkspaces,
  getBrandName: mockGetBrandName,
  getWorkspace: vi.fn((id: string) => mockListWorkspaces().find((w: { id: string }) => w.id === id)),
  getWorkspaceBySiteId: vi.fn((siteId: string) => mockListWorkspaces().find((w: { webflowSiteId?: string }) => w.webflowSiteId === siteId)),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mockBuildWorkspaceIntelligence,
  formatForPrompt: mockFormatForPrompt,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../server/helpers.js', () => ({
  findPageMapEntryByIdentity: vi.fn(() => null),
  sanitizeForPromptInjection: vi.fn((s: string) => s),
  stripCodeFences: vi.fn((s: string) => s),
}));

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn((_id: string, sys: string) => sys),
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafe: vi.fn((_raw: unknown, _schema: unknown, fallback: unknown) => fallback),
  parseJsonSafeArray: vi.fn(() => []),
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));

vi.mock('../../shared/keyword-normalization.js', () => ({
  keywordComparisonKey: vi.fn((k: unknown) => (typeof k === 'string' ? k.toLowerCase() : '')),
}));

// ---- imports ---------------------------------------------------------------

import { generateAiRecommendations } from '../../server/seo-audit-ai-recs.js';
import type { PageSeoResult } from '../../server/audit-page.js';

// ---------------------------------------------------------------------------

function makePageResult(overrides: Partial<PageSeoResult> = {}): PageSeoResult {
  return {
    pageId: 'page-1',
    page: 'Home',
    slug: '',
    url: 'https://example.com/',
    score: 70,
    issues: [],
    ...overrides,
  };
}

describe('generateAiRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkspaces.mockReturnValue([]);
    mockGetBrandName.mockReturnValue('Test Brand');
    mockBuildWorkspaceIntelligence.mockResolvedValue({
      seoContext: null,
      learnings: null,
      contentPipeline: null,
      pageProfile: null,
    });
    mockFormatForPrompt.mockReturnValue('');
  });

  it('does nothing when OPENAI_API_KEY is not set', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = makePageResult({
      issues: [{ check: 'title', severity: 'error', message: 'Missing title', recommendation: 'Add title' }],
    });

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-1' });

    expect(mockCallAI).not.toHaveBeenCalled();
    process.env.OPENAI_API_KEY = savedKey;
  });

  it('does nothing when no pages have relevant issues', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const result = makePageResult({
      issues: [{ check: 'images', severity: 'warning', message: 'Missing alt', recommendation: 'Add alt text' }],
    });

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-1' });

    expect(mockCallAI).not.toHaveBeenCalled();
    delete process.env.OPENAI_API_KEY;
  });

  it('calls callAI for pages with title issues', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const titleIssue = { check: 'title', severity: 'error' as const, message: 'Missing title', recommendation: 'Add title' };
    const result = makePageResult({ issues: [titleIssue] });

    mockCallAI.mockResolvedValue({ text: '{"title":"New Title"}' });
    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({ title: 'New Title' } as ReturnType<typeof jsonValidation.parseJsonSafe>);

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-1' });

    expect(mockCallAI).toHaveBeenCalledOnce();
    const callArgs = mockCallAI.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-5.6-luna');
    expect(callArgs.feature).toBe('seo-audit-recs');
    expect(callArgs.responseFormat).toEqual({ type: 'json_object' });

    delete process.env.OPENAI_API_KEY;
  });

  it('applies returned title suggestion to the issue', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const titleIssue = { check: 'title', severity: 'error' as const, message: 'Missing title', recommendation: 'Add title' };
    const result = makePageResult({ issues: [titleIssue] });

    mockCallAI.mockResolvedValue({ text: '{"title":"Optimized Title"}' });
    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({ title: 'Optimized Title' } as ReturnType<typeof jsonValidation.parseJsonSafe>);

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-1' });

    expect(titleIssue.suggestedFix).toBe('Optimized Title');

    delete process.env.OPENAI_API_KEY;
  });

  it('applies returned metaDescription suggestion to the meta-description issue', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const descIssue = { check: 'meta-description', severity: 'error' as const, message: 'Missing meta description', recommendation: 'Add meta description' };
    const result = makePageResult({ issues: [descIssue] });

    mockCallAI.mockResolvedValue({ text: '{"metaDescription":"A great description"}' });
    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({ metaDescription: 'A great description' } as ReturnType<typeof jsonValidation.parseJsonSafe>);

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-1' });

    expect(descIssue.suggestedFix).toBe('A great description');

    delete process.env.OPENAI_API_KEY;
  });

  it('applies ogTitle suggestion to og-tags issue with title message', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const ogIssue = { check: 'og-tags', severity: 'warning' as const, message: 'Missing og:title tag', recommendation: 'Add OG title' };
    const result = makePageResult({ issues: [ogIssue] });

    mockCallAI.mockResolvedValue({ text: '{"ogTitle":"Social Title"}' });
    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({ ogTitle: 'Social Title' } as ReturnType<typeof jsonValidation.parseJsonSafe>);

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-1' });

    expect(ogIssue.suggestedFix).toBe('Social Title');

    delete process.env.OPENAI_API_KEY;
  });

  it('uses page HTML from htmlCache when available', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const titleIssue = { check: 'title', severity: 'error' as const, message: 'Missing title', recommendation: 'Add title' };
    const result = makePageResult({ pageId: 'cached-page', issues: [titleIssue] });

    const htmlCache = new Map([['cached-page', '<h1>Service We Offer</h1><p>We provide great services.</p>']]);

    mockCallAI.mockResolvedValue({ text: '{"title":"Service Title"}' });
    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({ title: 'Service Title' } as ReturnType<typeof jsonValidation.parseJsonSafe>);

    await generateAiRecommendations({ results: [result], htmlCache, siteId: 'site-1' });

    const callArgs = mockCallAI.mock.calls[0][0];
    // The prompt should contain content from the cached HTML
    expect(callArgs.messages[0].content).toContain('PAGE CONTENT EVIDENCE');

    delete process.env.OPENAI_API_KEY;
  });

  it('gracefully continues when callAI throws for one page', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const issue1 = { check: 'title', severity: 'error' as const, message: 'Missing title', recommendation: 'Fix' };
    const issue2 = { check: 'title', severity: 'error' as const, message: 'Missing title', recommendation: 'Fix' };
    const page1 = makePageResult({ pageId: 'p1', issues: [issue1] });
    const page2 = makePageResult({ pageId: 'p2', issues: [issue2] });

    mockCallAI
      .mockRejectedValueOnce(new Error('Rate limit'))
      .mockResolvedValueOnce({ text: '{"title":"Good Title"}' });

    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({ title: 'Good Title' } as ReturnType<typeof jsonValidation.parseJsonSafe>);

    // Should not throw even though one page fails
    await expect(
      generateAiRecommendations({ results: [page1, page2], htmlCache: new Map(), siteId: 'site-1' })
    ).resolves.toBeUndefined();

    delete process.env.OPENAI_API_KEY;
  });

  it('resolves workspace from siteId when workspaceId is not provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    mockListWorkspaces.mockReturnValue([
      { id: 'ws-from-site', webflowSiteId: 'site-abc', name: 'Test WS' },
    ]);

    const titleIssue = { check: 'title', severity: 'error' as const, message: 'Missing title', recommendation: 'Add title' };
    const result = makePageResult({ issues: [titleIssue] });

    mockCallAI.mockResolvedValue({ text: '{}' });
    const jsonValidation = await import('../../server/db/json-validation.js');
    vi.mocked(jsonValidation.parseJsonSafe).mockReturnValue({} as ReturnType<typeof jsonValidation.parseJsonSafe>);

    await generateAiRecommendations({ results: [result], htmlCache: new Map(), siteId: 'site-abc' });

    // buildWorkspaceIntelligence should have been called with the resolved workspace id
    expect(mockBuildWorkspaceIntelligence).toHaveBeenCalledWith('ws-from-site', expect.anything());

    delete process.env.OPENAI_API_KEY;
  });
});
