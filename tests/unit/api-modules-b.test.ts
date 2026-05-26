/**
 * Unit tests for src/api/* modules — file B
 * Covers: content, brand-engine, briefing, workspaces
 *
 * Strategy: mock src/api/client so each wrapper is tested for correct URL,
 * HTTP verb, and body construction without hitting the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the base API client ────────────────────────────────────────────────
vi.mock('../../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
  get: vi.fn().mockResolvedValue({}),
  getSafe: vi.fn().mockResolvedValue({}),
  getOptional: vi.fn().mockResolvedValue(null),
  getText: vi.fn().mockResolvedValue(''),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue(undefined),
  postForm: vi.fn().mockResolvedValue({}),
}));

import { get, getSafe, getOptional, getText, post, patch, put, del } from '../../src/api/client';

const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockGetOptional = vi.mocked(getOptional);
const mockGetText = vi.mocked(getText);
const mockPost = vi.mocked(post);
const mockPatch = vi.mocked(patch);
const mockPut = vi.mocked(put);
const mockDel = vi.mocked(del);

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentBriefs
// ═══════════════════════════════════════════════════════════════════════════

import {
  contentBriefs,
  contentPosts,
  contentRequests,
  publicContent,
  publicPostReview,
  contentTemplates,
  contentMatrices,
  contentPlanReview,
  siteArchitecture,
  llmsTxt,
  contentDecay,
} from '../../src/api/content';

describe('contentBriefs.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await contentBriefs.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-briefs/ws-1');
  });

  it('returns data from GET', async () => {
    const briefs = [{ id: 'b1', keyword: 'seo tips' }];
    mockGet.mockResolvedValueOnce(briefs);
    const result = await contentBriefs.list('ws-1');
    expect(result).toEqual(briefs);
  });
});

describe('contentBriefs.getById', () => {
  it('calls GET with briefId in path', async () => {
    await contentBriefs.getById('ws-1', 'brief-abc');
    expect(mockGet).toHaveBeenCalledWith('/api/content-briefs/ws-1/brief-abc');
  });
});

describe('contentBriefs.generate', () => {
  it('calls post with generate subpath and body', async () => {
    await contentBriefs.generate('ws-1', { keyword: 'local seo', contentType: 'blog' });
    expect(mockPost).toHaveBeenCalledWith('/api/content-briefs/ws-1/generate', { keyword: 'local seo', contentType: 'blog' });
  });
});

describe('contentBriefs.update', () => {
  it('calls patch with briefId in path and body', async () => {
    await contentBriefs.update('ws-1', 'brief-1', { title: 'Updated Title' });
    expect(mockPatch).toHaveBeenCalledWith('/api/content-briefs/ws-1/brief-1', { title: 'Updated Title' });
  });
});

describe('contentBriefs.remove', () => {
  it('calls del with briefId in path', async () => {
    await contentBriefs.remove('ws-1', 'brief-1');
    expect(mockDel).toHaveBeenCalledWith('/api/content-briefs/ws-1/brief-1');
  });
});

describe('contentBriefs.validateKeyword', () => {
  it('calls post with keyword body', async () => {
    await contentBriefs.validateKeyword('ws-1', 'local seo services');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-briefs/ws-1/validate-keyword',
      { keyword: 'local seo services' },
    );
  });
});

describe('contentBriefs.validateKeywords', () => {
  it('calls post with keywords array', async () => {
    const kws = ['seo tips', 'local seo', 'on-page seo'];
    await contentBriefs.validateKeywords('ws-1', kws);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-briefs/ws-1/validate-keywords',
      { keywords: kws },
    );
  });
});

describe('contentBriefs.templateCrossref', () => {
  it('calls getSafe with URL-encoded keyword', async () => {
    await contentBriefs.templateCrossref('ws-1', 'best seo tools');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/content-briefs/ws-1/template-crossref');
    expect(url).toContain('keyword=best%20seo%20tools');
  });

  it('uses null fallback', async () => {
    await contentBriefs.templateCrossref('ws-1', 'keyword');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toBeNull();
  });
});

describe('contentBriefs.regenerateOutline', () => {
  it('calls post with feedback in body', async () => {
    await contentBriefs.regenerateOutline('ws-1', 'brief-1', 'Make it more detailed');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-briefs/ws-1/brief-1/regenerate-outline',
      { feedback: 'Make it more detailed' },
    );
  });

  it('calls post with undefined feedback when not provided', async () => {
    await contentBriefs.regenerateOutline('ws-1', 'brief-1');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-briefs/ws-1/brief-1/regenerate-outline',
      { feedback: undefined },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentPosts
// ═══════════════════════════════════════════════════════════════════════════

describe('contentPosts.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await contentPosts.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-posts/ws-1');
  });
});

describe('contentPosts.generate', () => {
  it('calls post on generate subpath', async () => {
    await contentPosts.generate('ws-1', { briefId: 'brief-1' });
    expect(mockPost).toHaveBeenCalledWith('/api/content-posts/ws-1/generate', { briefId: 'brief-1' });
  });
});

describe('contentPosts.update', () => {
  it('calls patch with postId in path', async () => {
    await contentPosts.update('ws-1', 'post-1', { title: 'New Title' });
    expect(mockPatch).toHaveBeenCalledWith('/api/content-posts/ws-1/post-1', { title: 'New Title' });
  });
});

describe('contentPosts.remove', () => {
  it('calls del with postId in path', async () => {
    await contentPosts.remove('ws-1', 'post-1');
    expect(mockDel).toHaveBeenCalledWith('/api/content-posts/ws-1/post-1');
  });
});

describe('contentPosts.getById', () => {
  it('calls GET with postId in path', async () => {
    await contentPosts.getById('ws-1', 'post-abc');
    expect(mockGet).toHaveBeenCalledWith('/api/content-posts/ws-1/post-abc');
  });
});

describe('contentPosts.regenerateSection', () => {
  it('calls post on regenerate-section subpath', async () => {
    await contentPosts.regenerateSection('ws-1', 'post-1', { sectionIndex: 2, instruction: 'Make shorter' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-posts/ws-1/post-1/regenerate-section',
      { sectionIndex: 2, instruction: 'Make shorter' },
    );
  });
});

describe('contentPosts.versions', () => {
  it('calls getSafe with versions endpoint', async () => {
    await contentPosts.versions('ws-1', 'post-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/content-posts/ws-1/post-1/versions');
  });

  it('uses empty array fallback', async () => {
    await contentPosts.versions('ws-1', 'post-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

describe('contentPosts.revertVersion', () => {
  it('calls post on revert subpath', async () => {
    await contentPosts.revertVersion('ws-1', 'post-1', 'ver-2');
    expect(mockPost).toHaveBeenCalledWith('/api/content-posts/ws-1/post-1/versions/ver-2/revert');
  });
});

describe('contentPosts.publishToWebflow', () => {
  it('calls post on publish-to-webflow subpath', async () => {
    await contentPosts.publishToWebflow('ws-1', 'post-1');
    expect(mockPost).toHaveBeenCalledWith('/api/content-posts/ws-1/post-1/publish-to-webflow', undefined);
  });

  it('passes generateImage option when provided', async () => {
    await contentPosts.publishToWebflow('ws-1', 'post-1', { generateImage: true });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-posts/ws-1/post-1/publish-to-webflow',
      { generateImage: true },
    );
  });
});

describe('contentPosts.aiReview', () => {
  it('calls post on ai-review subpath', async () => {
    await contentPosts.aiReview('ws-1', 'post-1');
    expect(mockPost).toHaveBeenCalledWith('/api/content-posts/ws-1/post-1/ai-review');
  });
});

describe('contentPosts.scoreVoice', () => {
  it('calls post on score-voice subpath with empty body', async () => {
    await contentPosts.scoreVoice('ws-1', 'post-1');
    expect(mockPost).toHaveBeenCalledWith('/api/content-posts/ws-1/post-1/score-voice', {});
  });
});

describe('contentPosts.aifix', () => {
  it('calls post on ai-fix subpath with issue body', async () => {
    await contentPosts.aifix('ws-1', 'post-1', { issueKey: 'seo-title' as never, reason: 'Title too short' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-posts/ws-1/post-1/ai-fix',
      { issueKey: 'seo-title', reason: 'Title too short' },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentRequests
// ═══════════════════════════════════════════════════════════════════════════

describe('contentRequests.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await contentRequests.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-requests/ws-1');
  });
});

describe('contentRequests.create', () => {
  it('calls post with body', async () => {
    await contentRequests.create('ws-1', { topic: 'Local SEO Guide' });
    expect(mockPost).toHaveBeenCalledWith('/api/content-requests/ws-1', { topic: 'Local SEO Guide' });
  });
});

describe('contentRequests.update', () => {
  it('calls patch with reqId in path and body', async () => {
    await contentRequests.update('ws-1', 'req-1', { status: 'approved' });
    expect(mockPatch).toHaveBeenCalledWith('/api/content-requests/ws-1/req-1', { status: 'approved' });
  });
});

describe('contentRequests.remove', () => {
  it('calls del with reqId in path', async () => {
    await contentRequests.remove('ws-1', 'req-1');
    expect(mockDel).toHaveBeenCalledWith('/api/content-requests/ws-1/req-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — publicContent
// ═══════════════════════════════════════════════════════════════════════════

describe('publicContent.requests', () => {
  it('calls getSafe with public content-requests endpoint', async () => {
    await publicContent.requests('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/content-requests/ws-1');
  });
});

describe('publicContent.requestTopic', () => {
  it('calls post on public content-requests endpoint', async () => {
    await publicContent.requestTopic('ws-1', { topic: 'Blog Ideas' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-requests/ws-1', { topic: 'Blog Ideas' });
  });
});

describe('publicContent.approve', () => {
  it('calls post on approve subpath', async () => {
    await publicContent.approve('ws-1', 'req-1');
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-request/ws-1/req-1/approve');
  });
});

describe('publicContent.decline', () => {
  it('calls post on decline subpath', async () => {
    await publicContent.decline('ws-1', 'req-1', { reason: 'Off-topic' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-request/ws-1/req-1/decline', { reason: 'Off-topic' });
  });
});

describe('publicContent.requestChanges', () => {
  it('calls post on request-changes subpath', async () => {
    await publicContent.requestChanges('ws-1', 'req-1', { notes: 'Please revise' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-request/ws-1/req-1/request-changes', { notes: 'Please revise' });
  });
});

describe('publicContent.comment', () => {
  it('calls post on comment subpath', async () => {
    await publicContent.comment('ws-1', 'req-1', { text: 'Looks great!' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-request/ws-1/req-1/comment', { text: 'Looks great!' });
  });
});

describe('publicContent.briefPreview', () => {
  it('calls getOptional with public content-brief endpoint', async () => {
    await publicContent.briefPreview('ws-1', 'brief-1');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/public/content-brief/ws-1/brief-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — publicPostReview
// ═══════════════════════════════════════════════════════════════════════════

describe('publicPostReview.getPost', () => {
  it('calls GET with public content-posts endpoint', async () => {
    await publicPostReview.getPost('ws-1', 'post-1');
    expect(mockGet).toHaveBeenCalledWith('/api/public/content-posts/ws-1/post-1');
  });
});

describe('publicPostReview.clientEdit', () => {
  it('calls patch on client-edit subpath', async () => {
    await publicPostReview.clientEdit('ws-1', 'post-1', { title: 'New Title' });
    expect(mockPatch).toHaveBeenCalledWith('/api/public/content-posts/ws-1/post-1/client-edit', { title: 'New Title' });
  });
});

describe('publicPostReview.approvePost', () => {
  it('calls post on approve-post subpath', async () => {
    await publicPostReview.approvePost('ws-1', 'req-1');
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-request/ws-1/req-1/approve-post');
  });
});

describe('publicPostReview.requestPostChanges', () => {
  it('calls post on request-post-changes subpath with feedback body', async () => {
    await publicPostReview.requestPostChanges('ws-1', 'req-1', 'Needs a better intro');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/public/content-request/ws-1/req-1/request-post-changes',
      { feedback: 'Needs a better intro' },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentTemplates
// ═══════════════════════════════════════════════════════════════════════════

describe('contentTemplates.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await contentTemplates.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-templates/ws-1');
  });
});

describe('contentTemplates.getById', () => {
  it('calls GET with templateId in path', async () => {
    await contentTemplates.getById('ws-1', 'tmpl-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-templates/ws-1/tmpl-1');
  });
});

describe('contentTemplates.create', () => {
  it('calls post with template body', async () => {
    await contentTemplates.create('ws-1', { name: 'Blog Template', slug: 'blog' } as never);
    expect(mockPost).toHaveBeenCalledWith('/api/content-templates/ws-1', { name: 'Blog Template', slug: 'blog' });
  });
});

describe('contentTemplates.update', () => {
  it('calls put with templateId in path and body', async () => {
    await contentTemplates.update('ws-1', 'tmpl-1', { name: 'Updated Template' } as never);
    expect(mockPut).toHaveBeenCalledWith('/api/content-templates/ws-1/tmpl-1', { name: 'Updated Template' });
  });
});

describe('contentTemplates.remove', () => {
  it('calls del with templateId in path', async () => {
    await contentTemplates.remove('ws-1', 'tmpl-1');
    expect(mockDel).toHaveBeenCalledWith('/api/content-templates/ws-1/tmpl-1');
  });
});

describe('contentTemplates.duplicate', () => {
  it('calls post on duplicate subpath with name', async () => {
    await contentTemplates.duplicate('ws-1', 'tmpl-1', 'Copy of Template');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-templates/ws-1/tmpl-1/duplicate',
      { name: 'Copy of Template' },
    );
  });

  it('passes undefined name when not provided', async () => {
    await contentTemplates.duplicate('ws-1', 'tmpl-1');
    const [, body] = mockPost.mock.calls[0];
    expect((body as Record<string, unknown>).name).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentMatrices
// ═══════════════════════════════════════════════════════════════════════════

describe('contentMatrices.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await contentMatrices.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-matrices/ws-1');
  });
});

describe('contentMatrices.getById', () => {
  it('calls GET with matrixId in path', async () => {
    await contentMatrices.getById('ws-1', 'matrix-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-matrices/ws-1/matrix-1');
  });
});

describe('contentMatrices.create', () => {
  it('calls post with matrix body', async () => {
    const body = {
      name: 'City Pages',
      templateId: 'tmpl-1',
      dimensions: [] as never,
      urlPattern: '/city/{city}',
      keywordPattern: '{city} SEO',
    };
    await contentMatrices.create('ws-1', body);
    expect(mockPost).toHaveBeenCalledWith('/api/content-matrices/ws-1', body);
  });
});

describe('contentMatrices.update', () => {
  it('calls put with matrixId in path', async () => {
    await contentMatrices.update('ws-1', 'matrix-1', { name: 'Renamed Matrix' });
    expect(mockPut).toHaveBeenCalledWith('/api/content-matrices/ws-1/matrix-1', { name: 'Renamed Matrix' });
  });
});

describe('contentMatrices.updateCell', () => {
  it('calls patch with cell path', async () => {
    await contentMatrices.updateCell('ws-1', 'matrix-1', 'cell-1', { keyword: 'austin seo' });
    expect(mockPatch).toHaveBeenCalledWith(
      '/api/content-matrices/ws-1/matrix-1/cells/cell-1',
      { keyword: 'austin seo' },
    );
  });
});

describe('contentMatrices.remove', () => {
  it('calls del with matrixId in path', async () => {
    await contentMatrices.remove('ws-1', 'matrix-1');
    expect(mockDel).toHaveBeenCalledWith('/api/content-matrices/ws-1/matrix-1');
  });
});

describe('contentMatrices.recommendKeywords', () => {
  it('calls post with seedKeyword', async () => {
    await contentMatrices.recommendKeywords('ws-1', 'local seo');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-matrices/ws-1/recommend-keywords',
      expect.objectContaining({ seedKeyword: 'local seo' }),
    );
  });
});

describe('contentMatrices.checkKeywordCannibalization', () => {
  it('calls post with keyword body', async () => {
    await contentMatrices.checkKeywordCannibalization('ws-1', 'seo agency');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-matrices/ws-1/check-cannibalization',
      { keyword: 'seo agency' },
    );
  });
});

describe('contentMatrices.getCannibalization', () => {
  it('calls GET with cannibalization subpath', async () => {
    await contentMatrices.getCannibalization('ws-1', 'matrix-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-matrices/ws-1/matrix-1/cannibalization');
  });
});

describe('contentMatrices.sendSamples', () => {
  it('calls post on send-samples subpath with cellIds', async () => {
    await contentMatrices.sendSamples('ws-1', 'matrix-1', ['cell-1', 'cell-2']);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/content-plan/ws-1/matrix-1/send-samples',
      { cellIds: ['cell-1', 'cell-2'] },
    );
  });
});

describe('contentMatrices.exportMatricesCsv', () => {
  it('returns expected URL string (no network call)', () => {
    const url = contentMatrices.exportMatricesCsv('ws-1');
    expect(url).toBe('/api/export/ws-1/matrices?format=csv');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('contentMatrices.exportMatricesJson', () => {
  it('returns expected URL string (no network call)', () => {
    const url = contentMatrices.exportMatricesJson('ws-1');
    expect(url).toBe('/api/export/ws-1/matrices?format=json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentPlanReview
// ═══════════════════════════════════════════════════════════════════════════

describe('contentPlanReview.getPlans', () => {
  it('calls GET on public content-plan endpoint', async () => {
    await contentPlanReview.getPlans('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/public/content-plan/ws-1');
  });
});

describe('contentPlanReview.getPlan', () => {
  it('calls GET with matrixId in path', async () => {
    await contentPlanReview.getPlan('ws-1', 'matrix-1');
    expect(mockGet).toHaveBeenCalledWith('/api/public/content-plan/ws-1/matrix-1');
  });
});

describe('contentPlanReview.flagCell', () => {
  it('calls post on flag subpath with comment', async () => {
    await contentPlanReview.flagCell('ws-1', 'matrix-1', 'cell-1', 'Wrong keyword');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/public/content-plan/ws-1/matrix-1/cells/cell-1/flag',
      { comment: 'Wrong keyword' },
    );
  });
});

describe('contentPlanReview.sendTemplateReview', () => {
  it('calls post on send-template-review subpath', async () => {
    await contentPlanReview.sendTemplateReview('ws-1', 'matrix-1');
    expect(mockPost).toHaveBeenCalledWith('/api/content-plan/ws-1/matrix-1/send-template-review', {});
  });
});

describe('contentPlanReview.batchApprove', () => {
  it('calls post on batch-approve subpath', async () => {
    await contentPlanReview.batchApprove('ws-1', 'matrix-1');
    expect(mockPost).toHaveBeenCalledWith('/api/content-plan/ws-1/matrix-1/batch-approve', {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — siteArchitecture
// ═══════════════════════════════════════════════════════════════════════════

describe('siteArchitecture.get', () => {
  it('calls GET with workspaceId in path', async () => {
    await siteArchitecture.get('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/site-architecture/ws-1');
  });
});

describe('siteArchitecture.schemaCoverage', () => {
  it('calls GET with schema-coverage subpath', async () => {
    await siteArchitecture.schemaCoverage('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/site-architecture/ws-1/schema-coverage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — llmsTxt
// ═══════════════════════════════════════════════════════════════════════════

describe('llmsTxt.generate', () => {
  it('calls GET with workspaceId in path', async () => {
    await llmsTxt.generate('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/llms-txt/ws-1');
  });
});

describe('llmsTxt.freshness', () => {
  it('calls GET with freshness subpath', async () => {
    await llmsTxt.freshness('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/llms-txt/ws-1/freshness');
  });
});

describe('llmsTxt.downloadUrl', () => {
  it('returns URL string without making network call', () => {
    const url = llmsTxt.downloadUrl('ws-1');
    expect(url).toBe('/api/llms-txt/ws-1/download');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('llmsTxt.downloadFullUrl', () => {
  it('returns full URL string without making network call', () => {
    const url = llmsTxt.downloadFullUrl('ws-1');
    expect(url).toBe('/api/llms-txt/ws-1/download-full');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/content.ts — contentDecay
// ═══════════════════════════════════════════════════════════════════════════

describe('contentDecay.get', () => {
  it('calls GET with workspaceId in path', async () => {
    await contentDecay.get('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/content-decay/ws-1');
  });
});

describe('contentDecay.analyze', () => {
  it('calls post on analyze subpath', async () => {
    await contentDecay.analyze('ws-1');
    expect(mockPost).toHaveBeenCalledWith('/api/content-decay/ws-1/analyze');
  });
});

describe('contentDecay.recommendations', () => {
  it('calls post on recommendations subpath with body', async () => {
    await contentDecay.recommendations('ws-1', { pageIds: ['p1', 'p2'] });
    expect(mockPost).toHaveBeenCalledWith('/api/content-decay/ws-1/recommendations', { pageIds: ['p1', 'p2'] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — brandscripts
// ═══════════════════════════════════════════════════════════════════════════

import {
  brandscripts,
  discovery,
  voice,
  identity,
  blueprints,
  blueprintEntries,
  blueprintVersions,
  copyGeneration,
  copyReview,
  copyBatch,
  copyExport,
  copyIntelligence,
} from '../../src/api/brand-engine';

describe('brandscripts.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await brandscripts.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/brandscripts/ws-1');
  });
});

describe('brandscripts.get', () => {
  it('calls GET with brandscript id in path', async () => {
    await brandscripts.get('ws-1', 'bs-1');
    expect(mockGet).toHaveBeenCalledWith('/api/brandscripts/ws-1/bs-1');
  });
});

describe('brandscripts.create', () => {
  it('calls post with name body', async () => {
    await brandscripts.create('ws-1', { name: 'My Brand Story' });
    expect(mockPost).toHaveBeenCalledWith('/api/brandscripts/ws-1', { name: 'My Brand Story' });
  });
});

describe('brandscripts.updateSections', () => {
  it('calls put on sections subpath with sections array', async () => {
    const sections = [{ title: 'Hero', content: 'Our hero text' }];
    await brandscripts.updateSections('ws-1', 'bs-1', sections);
    expect(mockPut).toHaveBeenCalledWith(
      '/api/brandscripts/ws-1/bs-1/sections',
      { sections, expectedUpdatedAt: undefined },
    );
  });

  it('includes expectedUpdatedAt when provided', async () => {
    await brandscripts.updateSections('ws-1', 'bs-1', [], '2025-01-01T00:00:00Z');
    const [, body] = mockPut.mock.calls[0];
    expect((body as Record<string, unknown>).expectedUpdatedAt).toBe('2025-01-01T00:00:00Z');
  });
});

describe('brandscripts.remove', () => {
  it('calls del with brandscript id in path', async () => {
    await brandscripts.remove('ws-1', 'bs-1');
    expect(mockDel).toHaveBeenCalledWith('/api/brandscripts/ws-1/bs-1');
  });
});

describe('brandscripts.import', () => {
  it('calls post on import subpath with rawText', async () => {
    await brandscripts.import('ws-1', { rawText: 'Raw brand content here' });
    expect(mockPost).toHaveBeenCalledWith('/api/brandscripts/ws-1/import', { rawText: 'Raw brand content here' });
  });
});

describe('brandscripts.complete', () => {
  it('calls post on complete subpath with empty body', async () => {
    await brandscripts.complete('ws-1', 'bs-1');
    expect(mockPost).toHaveBeenCalledWith('/api/brandscripts/ws-1/bs-1/complete', {});
  });
});

describe('brandscripts.templates', () => {
  it('calls GET on /api/brandscript-templates', async () => {
    await brandscripts.templates();
    expect(mockGet).toHaveBeenCalledWith('/api/brandscript-templates');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — discovery
// ═══════════════════════════════════════════════════════════════════════════

describe('discovery.listSources', () => {
  it('calls GET with sources subpath', async () => {
    await discovery.listSources('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/discovery/ws-1/sources');
  });
});

describe('discovery.uploadText', () => {
  it('calls post on sources/text subpath with body', async () => {
    await discovery.uploadText('ws-1', { rawContent: 'Brand document content', sourceType: 'document' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/discovery/ws-1/sources/text',
      { rawContent: 'Brand document content', sourceType: 'document' },
    );
  });
});

describe('discovery.deleteSource', () => {
  it('calls del with source id in path', async () => {
    await discovery.deleteSource('ws-1', 'src-1');
    expect(mockDel).toHaveBeenCalledWith('/api/discovery/ws-1/sources/src-1');
  });
});

describe('discovery.process', () => {
  it('calls post on process subpath with empty body', async () => {
    await discovery.process('ws-1', 'src-1');
    expect(mockPost).toHaveBeenCalledWith('/api/discovery/ws-1/sources/src-1/process', {});
  });
});

describe('discovery.listExtractions', () => {
  it('calls GET on extractions subpath', async () => {
    await discovery.listExtractions('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/discovery/ws-1/extractions');
  });
});

describe('discovery.listExtractionsBySource', () => {
  it('calls GET with source id in path', async () => {
    await discovery.listExtractionsBySource('ws-1', 'src-1');
    expect(mockGet).toHaveBeenCalledWith('/api/discovery/ws-1/sources/src-1/extractions');
  });
});

describe('discovery.updateExtraction', () => {
  it('calls patch with extraction id in path and body', async () => {
    await discovery.updateExtraction('ws-1', 'ext-1', { status: 'routed', routedTo: 'voice' });
    expect(mockPatch).toHaveBeenCalledWith(
      '/api/discovery/ws-1/extractions/ext-1',
      { status: 'routed', routedTo: 'voice' },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — voice
// ═══════════════════════════════════════════════════════════════════════════

describe('voice.getProfile', () => {
  it('calls GET with workspaceId in path', async () => {
    await voice.getProfile('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/voice/ws-1');
  });
});

describe('voice.createProfile', () => {
  it('calls post on voice endpoint with empty body', async () => {
    await voice.createProfile('ws-1');
    expect(mockPost).toHaveBeenCalledWith('/api/voice/ws-1', {});
  });
});

describe('voice.updateProfile', () => {
  it('calls patch with partial voice profile body', async () => {
    await voice.updateProfile('ws-1', { guardrails: ['No jargon', 'Be concise'] });
    expect(mockPatch).toHaveBeenCalledWith('/api/voice/ws-1', { guardrails: ['No jargon', 'Be concise'] });
  });
});

describe('voice.addSample', () => {
  it('calls post on samples subpath with content body', async () => {
    await voice.addSample('ws-1', { content: 'Sample text about our brand', contextTag: 'homepage' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/voice/ws-1/samples',
      { content: 'Sample text about our brand', contextTag: 'homepage' },
    );
  });
});

describe('voice.deleteSample', () => {
  it('calls del with sampleId in path', async () => {
    await voice.deleteSample('ws-1', 'sample-1');
    expect(mockDel).toHaveBeenCalledWith('/api/voice/ws-1/samples/sample-1');
  });
});

describe('voice.calibrate', () => {
  it('calls post on calibrate subpath with promptType body', async () => {
    await voice.calibrate('ws-1', { promptType: 'blog', steeringNotes: 'More casual tone' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/voice/ws-1/calibrate',
      { promptType: 'blog', steeringNotes: 'More casual tone' },
    );
  });
});

describe('voice.refine', () => {
  it('calls post on refine subpath with variation body', async () => {
    await voice.refine('ws-1', 'sess-1', { variationIndex: 2, direction: 'more formal' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/voice/ws-1/calibrate/sess-1/refine',
      { variationIndex: 2, direction: 'more formal' },
    );
  });
});

describe('voice.saveVariationFeedback', () => {
  it('calls post on calibration-feedback endpoint', async () => {
    await voice.saveVariationFeedback('ws-1', 'sess-1', 1, 'I prefer this one');
    expect(mockPost).toHaveBeenCalledWith('/api/voice/ws-1/calibration-feedback', {
      sessionId: 'sess-1',
      variationIndex: 1,
      feedback: 'I prefer this one',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — identity
// ═══════════════════════════════════════════════════════════════════════════

describe('identity.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await identity.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/brand-identity/ws-1');
  });
});

describe('identity.generate', () => {
  it('calls post on generate subpath with deliverableType body', async () => {
    await identity.generate('ws-1', { deliverableType: 'tagline' });
    expect(mockPost).toHaveBeenCalledWith('/api/brand-identity/ws-1/generate', { deliverableType: 'tagline' });
  });
});

describe('identity.refine', () => {
  it('calls post on refine subpath with direction body', async () => {
    await identity.refine('ws-1', 'del-1', { direction: 'more energetic' });
    expect(mockPost).toHaveBeenCalledWith('/api/brand-identity/ws-1/del-1/refine', { direction: 'more energetic' });
  });
});

describe('identity.updateContent', () => {
  it('calls patch with content body', async () => {
    await identity.updateContent('ws-1', 'del-1', 'New deliverable content');
    expect(mockPatch).toHaveBeenCalledWith('/api/brand-identity/ws-1/del-1', { content: 'New deliverable content' });
  });
});

describe('identity.updateStatus', () => {
  it('calls patch with status body', async () => {
    await identity.updateStatus('ws-1', 'del-1', 'approved');
    expect(mockPatch).toHaveBeenCalledWith('/api/brand-identity/ws-1/del-1', { status: 'approved' });
  });
});

describe('identity.export', () => {
  it('calls getText on export subpath', async () => {
    mockGetText.mockResolvedValueOnce('# Brand Identity\nTagline: ...');
    await identity.export('ws-1');
    expect(mockGetText).toHaveBeenCalledWith('/api/brand-identity/ws-1/export');
  });

  it('returns markdown wrapped in object', async () => {
    mockGetText.mockResolvedValueOnce('# Brand Identity');
    const result = await identity.export('ws-1');
    expect(result).toEqual({ markdown: '# Brand Identity' });
  });

  it('appends tier query param when provided', async () => {
    mockGetText.mockResolvedValueOnce('# Brand Identity');
    await identity.export('ws-1', 'premium');
    const [url] = mockGetText.mock.calls[0];
    expect(url).toContain('?tier=premium');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — blueprints
// ═══════════════════════════════════════════════════════════════════════════

describe('blueprints.list', () => {
  it('calls GET with workspaceId in path', async () => {
    await blueprints.list('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/page-strategy/ws-1');
  });
});

describe('blueprints.getById', () => {
  it('calls GET with blueprintId in path', async () => {
    await blueprints.getById('ws-1', 'bp-1');
    expect(mockGet).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1');
  });
});

describe('blueprints.create', () => {
  it('calls post with blueprint body', async () => {
    await blueprints.create('ws-1', { name: 'Main Site Blueprint' });
    expect(mockPost).toHaveBeenCalledWith('/api/page-strategy/ws-1', { name: 'Main Site Blueprint' });
  });
});

describe('blueprints.update', () => {
  it('calls put with blueprintId in path and body', async () => {
    await blueprints.update('ws-1', 'bp-1', { name: 'Updated Blueprint', status: 'active' as never });
    expect(mockPut).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1', { name: 'Updated Blueprint', status: 'active' });
  });
});

describe('blueprints.remove', () => {
  it('calls del with blueprintId in path', async () => {
    await blueprints.remove('ws-1', 'bp-1');
    expect(mockDel).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1');
  });
});

describe('blueprints.generate', () => {
  it('calls post on generate subpath with input body', async () => {
    await blueprints.generate('ws-1', { name: 'Auto Blueprint' } as never);
    expect(mockPost).toHaveBeenCalledWith('/api/page-strategy/ws-1/generate', { name: 'Auto Blueprint' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — blueprintEntries
// ═══════════════════════════════════════════════════════════════════════════

describe('blueprintEntries.add', () => {
  it('calls post on entries subpath', async () => {
    await blueprintEntries.add('ws-1', 'bp-1', { name: 'Home Page', pageType: 'homepage' });
    expect(mockPost).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1/entries', { name: 'Home Page', pageType: 'homepage' });
  });
});

describe('blueprintEntries.update', () => {
  it('calls put with entryId in path', async () => {
    await blueprintEntries.update('ws-1', 'bp-1', 'entry-1', { name: 'Updated Page' });
    expect(mockPut).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1/entries/entry-1', { name: 'Updated Page' });
  });
});

describe('blueprintEntries.remove', () => {
  it('calls del with entryId in path', async () => {
    await blueprintEntries.remove('ws-1', 'bp-1', 'entry-1');
    expect(mockDel).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1/entries/entry-1');
  });
});

describe('blueprintEntries.reorder', () => {
  it('calls put on entries/reorder subpath with orderedIds', async () => {
    await blueprintEntries.reorder('ws-1', 'bp-1', ['e3', 'e1', 'e2']);
    expect(mockPut).toHaveBeenCalledWith(
      '/api/page-strategy/ws-1/bp-1/entries/reorder',
      { orderedIds: ['e3', 'e1', 'e2'] },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — blueprintVersions
// ═══════════════════════════════════════════════════════════════════════════

describe('blueprintVersions.list', () => {
  it('calls GET on versions subpath', async () => {
    await blueprintVersions.list('ws-1', 'bp-1');
    expect(mockGet).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1/versions');
  });
});

describe('blueprintVersions.create', () => {
  it('calls post on versions subpath with changeNotes', async () => {
    await blueprintVersions.create('ws-1', 'bp-1', 'Added service pages');
    expect(mockPost).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1/versions', { changeNotes: 'Added service pages' });
  });
});

describe('blueprintVersions.getById', () => {
  it('calls GET with versionId in path', async () => {
    await blueprintVersions.getById('ws-1', 'bp-1', 'ver-1');
    expect(mockGet).toHaveBeenCalledWith('/api/page-strategy/ws-1/bp-1/versions/ver-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — copyGeneration
// ═══════════════════════════════════════════════════════════════════════════

describe('copyGeneration.generate', () => {
  it('calls post on copy generate endpoint', async () => {
    await copyGeneration.generate('ws-1', 'bp-1', 'entry-1');
    expect(mockPost).toHaveBeenCalledWith('/api/copy/ws-1/bp-1/entry-1/generate', {});
  });

  it('passes options body when provided', async () => {
    await copyGeneration.generate('ws-1', 'bp-1', 'entry-1', { force: true });
    expect(mockPost).toHaveBeenCalledWith('/api/copy/ws-1/bp-1/entry-1/generate', { force: true });
  });
});

describe('copyGeneration.regenerateSection', () => {
  it('calls post on regenerate subpath', async () => {
    await copyGeneration.regenerateSection('ws-1', 'bp-1', 'entry-1', 'sec-1', { note: 'More detail', highlight: 'benefits' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/copy/ws-1/bp-1/entry-1/regenerate/sec-1',
      { note: 'More detail', highlight: 'benefits' },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — copyReview
// ═══════════════════════════════════════════════════════════════════════════

describe('copyReview.getSections', () => {
  it('calls GET on entry sections endpoint', async () => {
    await copyReview.getSections('ws-1', 'entry-1');
    expect(mockGet).toHaveBeenCalledWith('/api/copy/ws-1/entry/entry-1/sections');
  });
});

describe('copyReview.getStatus', () => {
  it('calls GET on entry status endpoint', async () => {
    await copyReview.getStatus('ws-1', 'entry-1');
    expect(mockGet).toHaveBeenCalledWith('/api/copy/ws-1/entry/entry-1/status');
  });
});

describe('copyReview.getMetadata', () => {
  it('calls GET on entry metadata endpoint', async () => {
    await copyReview.getMetadata('ws-1', 'entry-1');
    expect(mockGet).toHaveBeenCalledWith('/api/copy/ws-1/entry/entry-1/metadata');
  });
});

describe('copyReview.updateSectionStatus', () => {
  it('calls patch on section status endpoint', async () => {
    await copyReview.updateSectionStatus('ws-1', 'sec-1', 'approved' as never);
    expect(mockPatch).toHaveBeenCalledWith('/api/copy/ws-1/section/sec-1/status', { status: 'approved' });
  });
});

describe('copyReview.updateSectionText', () => {
  it('calls patch on section text endpoint', async () => {
    await copyReview.updateSectionText('ws-1', 'sec-1', 'Updated copy text here');
    expect(mockPatch).toHaveBeenCalledWith('/api/copy/ws-1/section/sec-1/text', { copy: 'Updated copy text here' });
  });
});

describe('copyReview.addSuggestion', () => {
  it('calls post on suggest subpath', async () => {
    await copyReview.addSuggestion('ws-1', 'sec-1', { originalText: 'Old text', suggestedText: 'New text' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/copy/ws-1/section/sec-1/suggest',
      { originalText: 'Old text', suggestedText: 'New text' },
    );
  });
});

describe('copyReview.sendEntryToClientReview', () => {
  it('calls post on send-to-client endpoint', async () => {
    await copyReview.sendEntryToClientReview('ws-1', 'bp-1', 'entry-1');
    expect(mockPost).toHaveBeenCalledWith('/api/copy/ws-1/bp-1/entry-1/send-to-client', {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — copyBatch
// ═══════════════════════════════════════════════════════════════════════════

describe('copyBatch.start', () => {
  it('calls post on batch endpoint with entryIds', async () => {
    await copyBatch.start('ws-1', 'bp-1', { entryIds: ['e1', 'e2'], mode: 'full' });
    expect(mockPost).toHaveBeenCalledWith(
      '/api/copy/ws-1/bp-1/batch',
      { entryIds: ['e1', 'e2'], mode: 'full' },
    );
  });
});

describe('copyBatch.getJob', () => {
  it('calls GET with batchId in path', async () => {
    await copyBatch.getJob('ws-1', 'batch-1');
    expect(mockGet).toHaveBeenCalledWith('/api/copy/ws-1/batch/batch-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — copyExport
// ═══════════════════════════════════════════════════════════════════════════

describe('copyExport.export', () => {
  it('calls post on export endpoint with request body', async () => {
    const req = { format: 'pdf', blueprintId: 'bp-1' } as never;
    await copyExport.export('ws-1', 'bp-1', req);
    expect(mockPost).toHaveBeenCalledWith('/api/copy/ws-1/bp-1/export', req);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/brand-engine.ts — copyIntelligence
// ═══════════════════════════════════════════════════════════════════════════

describe('copyIntelligence.getAll', () => {
  it('calls GET on intelligence endpoint', async () => {
    await copyIntelligence.getAll('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/copy/ws-1/intelligence');
  });
});

describe('copyIntelligence.getPromotable', () => {
  it('calls GET on intelligence/promotable endpoint', async () => {
    await copyIntelligence.getPromotable('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/copy/ws-1/intelligence/promotable');
  });
});

describe('copyIntelligence.update', () => {
  it('calls patch with patternId in path', async () => {
    await copyIntelligence.update('ws-1', 'pat-1', { active: true });
    expect(mockPatch).toHaveBeenCalledWith('/api/copy/ws-1/intelligence/pat-1', { active: true });
  });
});

describe('copyIntelligence.remove', () => {
  it('calls del with patternId in path', async () => {
    await copyIntelligence.remove('ws-1', 'pat-1');
    expect(mockDel).toHaveBeenCalledWith('/api/copy/ws-1/intelligence/pat-1');
  });
});

describe('copyIntelligence.extract', () => {
  it('calls post on extract endpoint with steeringNotes', async () => {
    await copyIntelligence.extract('ws-1', ['Be bold', 'Use numbers']);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/copy/ws-1/intelligence/extract',
      { steeringNotes: ['Be bold', 'Use numbers'] },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/briefing.ts
// ═══════════════════════════════════════════════════════════════════════════

import { briefingApi } from '../../src/api/briefing';

describe('briefingApi.listDrafts', () => {
  it('calls GET on drafts subpath', async () => {
    mockGet.mockResolvedValueOnce({ drafts: [] });
    await briefingApi.listDrafts('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/briefing/ws-1/drafts');
  });

  it('unwraps the drafts array from the response', async () => {
    const drafts = [{ id: 'd1', status: 'draft' }];
    mockGet.mockResolvedValueOnce({ drafts });
    const result = await briefingApi.listDrafts('ws-1');
    expect(result).toEqual(drafts);
  });
});

describe('briefingApi.updateStories', () => {
  it('calls patch with stories body on stories subpath', async () => {
    mockPatch.mockResolvedValueOnce({ draft: { id: 'd1' } });
    const stories = [{ id: 's1', content: 'Story content' }] as never;
    await briefingApi.updateStories('ws-1', 'd1', stories);
    expect(mockPatch).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/stories',
      { stories },
    );
  });

  it('unwraps the draft from the response', async () => {
    const draft = { id: 'd1', status: 'draft' };
    mockPatch.mockResolvedValueOnce({ draft });
    const result = await briefingApi.updateStories('ws-1', 'd1', []);
    expect(result).toEqual(draft);
  });
});

describe('briefingApi.approve', () => {
  it('calls post on approve subpath with adminNote body', async () => {
    mockPost.mockResolvedValueOnce({ draft: { id: 'd1' } });
    await briefingApi.approve('ws-1', 'd1', 'Looks good!');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/approve',
      { adminNote: 'Looks good!' },
    );
  });

  it('unwraps the draft from the response', async () => {
    const draft = { id: 'd1', status: 'approved' };
    mockPost.mockResolvedValueOnce({ draft });
    const result = await briefingApi.approve('ws-1', 'd1');
    expect(result).toEqual(draft);
  });
});

describe('briefingApi.publish', () => {
  it('calls post on publish subpath', async () => {
    mockPost.mockResolvedValueOnce({ draft: { id: 'd1' } });
    await briefingApi.publish('ws-1', 'd1', 'Published to clients');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/publish',
      { adminNote: 'Published to clients' },
    );
  });
});

describe('briefingApi.skip', () => {
  it('calls post on skip subpath with adminNote', async () => {
    mockPost.mockResolvedValueOnce({ draft: { id: 'd1' } });
    await briefingApi.skip('ws-1', 'd1', 'Not this week');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/skip',
      { adminNote: 'Not this week' },
    );
  });
});

describe('briefingApi.generateNow', () => {
  it('calls post on generate-now endpoint with empty body', async () => {
    mockPost.mockResolvedValueOnce({ accepted: true });
    await briefingApi.generateNow('ws-1');
    expect(mockPost).toHaveBeenCalledWith('/api/briefing/ws-1/generate-now', {});
  });

  it('returns the accepted response directly', async () => {
    mockPost.mockResolvedValueOnce({ accepted: true, reason: 'OK' });
    const result = await briefingApi.generateNow('ws-1');
    expect(result).toEqual({ accepted: true, reason: 'OK' });
  });
});

describe('briefingApi.getPublished', () => {
  it('calls GET on public briefing endpoint', async () => {
    mockGet.mockResolvedValueOnce({ briefing: null });
    await briefingApi.getPublished('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/public/briefing/ws-1');
  });

  it('returns null when briefing is null', async () => {
    mockGet.mockResolvedValueOnce({ briefing: null });
    const result = await briefingApi.getPublished('ws-1');
    expect(result).toBeNull();
  });

  it('returns the briefing data when present', async () => {
    const briefing = { id: 'br-1', publishedAt: '2025-01-01' };
    mockGet.mockResolvedValueOnce({ briefing });
    const result = await briefingApi.getPublished('ws-1');
    expect(result).toEqual(briefing);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/workspaces.ts
// ═══════════════════════════════════════════════════════════════════════════

import { workspaces, publicWorkspaces } from '../../src/api/workspaces';

describe('workspaces.list', () => {
  it('calls GET /api/workspaces', async () => {
    await workspaces.list();
    expect(mockGet).toHaveBeenCalledWith('/api/workspaces');
  });
});

describe('workspaces.getById', () => {
  it('calls GET with workspaceId in path', async () => {
    await workspaces.getById('ws-abc');
    expect(mockGet).toHaveBeenCalledWith('/api/workspaces/ws-abc');
  });
});

describe('workspaces.create', () => {
  it('calls post with name body', async () => {
    await workspaces.create({ name: 'My New Workspace' });
    expect(mockPost).toHaveBeenCalledWith('/api/workspaces', { name: 'My New Workspace' });
  });

  it('includes folder when provided', async () => {
    await workspaces.create({ name: 'WS', folder: 'clients' });
    const [, body] = mockPost.mock.calls[0];
    expect((body as Record<string, unknown>).folder).toBe('clients');
  });
});

describe('workspaces.update', () => {
  it('calls patch with workspaceId in path and body', async () => {
    await workspaces.update('ws-1', { name: 'Updated Workspace' });
    expect(mockPatch).toHaveBeenCalledWith('/api/workspaces/ws-1', { name: 'Updated Workspace' });
  });
});

describe('workspaces.remove', () => {
  it('calls del with workspaceId in path', async () => {
    await workspaces.remove('ws-1');
    expect(mockDel).toHaveBeenCalledWith('/api/workspaces/ws-1');
  });
});

describe('workspaces.getSuppressions', () => {
  it('calls GET on audit-suppressions subpath', async () => {
    await workspaces.getSuppressions('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/workspaces/ws-1/audit-suppressions');
  });
});

describe('workspaces.addSuppression', () => {
  it('calls post with check body', async () => {
    await workspaces.addSuppression('ws-1', 'missing-alt-text');
    expect(mockPost).toHaveBeenCalledWith('/api/workspaces/ws-1/audit-suppressions', { check: 'missing-alt-text' });
  });
});

describe('workspaces.removeSuppression', () => {
  it('calls del with check and optional pageSlug', async () => {
    await workspaces.removeSuppression('ws-1', 'missing-alt-text', '/about');
    expect(mockDel).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/audit-suppressions',
      { check: 'missing-alt-text', pageSlug: '/about' },
    );
  });

  it('passes undefined pageSlug when not provided', async () => {
    await workspaces.removeSuppression('ws-1', 'missing-title');
    const [, body] = mockDel.mock.calls[0];
    expect((body as Record<string, unknown>).pageSlug).toBeUndefined();
  });
});

describe('workspaces.updateClientUser', () => {
  it('calls patch with correct path and body', async () => {
    await workspaces.updateClientUser('ws-1', 'user-1', { name: 'Alice Smith' });
    expect(mockPatch).toHaveBeenCalledWith('/api/workspaces/ws-1/client-users/user-1', { name: 'Alice Smith' });
  });
});

describe('workspaces.removeClientUser', () => {
  it('calls del with userId in path', async () => {
    await workspaces.removeClientUser('ws-1', 'user-99');
    expect(mockDel).toHaveBeenCalledWith('/api/workspaces/ws-1/client-users/user-99');
  });
});

describe('workspaces.deletePageState', () => {
  it('calls del with pageId in path', async () => {
    await workspaces.deletePageState('ws-1', 'page-xyz');
    expect(mockDel).toHaveBeenCalledWith('/api/workspaces/ws-1/page-states/page-xyz');
  });
});

describe('publicWorkspaces.getInfo', () => {
  it('calls getOptional with public workspace endpoint', async () => {
    await publicWorkspaces.getInfo('ws-1');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/public/workspace/ws-1');
  });
});
