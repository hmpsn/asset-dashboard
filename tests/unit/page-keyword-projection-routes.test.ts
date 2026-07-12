import express, { type Express, type RequestHandler, type Router } from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsonFallback } from '../../server/db/json-validation.js';

const mocks = vi.hoisted(() => ({
  getTokenForSite: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceBySiteId: vi.fn(),
  updatePageState: vi.fn(),
  getWorkspacePages: vi.fn(),
  discoverCmsUrls: vi.fn(),
  buildStaticPathSet: vi.fn(),
  toCmsPageId: vi.fn(),
  resolveBaseUrl: vi.fn(),
  listPageKeywordsPaged: vi.fn(),
  getPageKeyword: vi.fn(),
  getGA4PageOrganicTrafficMap: vi.fn(),
  fetchPublicWebText: vi.fn(),
  isExternalFetchError: vi.fn(),
  getLatestSnapshot: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: vi.fn() }));
vi.mock('../../server/seo-change-tracker.js', () => ({ recordSeoChange: vi.fn() }));
vi.mock('../../server/processor.js', () => ({ getQueue: vi.fn(() => []), getMetadata: vi.fn(() => ({})) }));
vi.mock('../../server/webflow.js', () => ({
  listSites: vi.fn(),
  listAssets: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  updatePageSeo: vi.fn(),
  publishSite: vi.fn(),
  discoverCmsUrls: mocks.discoverCmsUrls,
  buildStaticPathSet: mocks.buildStaticPathSet,
  toCmsPageId: mocks.toCmsPageId,
}));
vi.mock('../../server/workspaces.js', () => ({
  getTokenForSite: mocks.getTokenForSite,
  getWorkspace: mocks.getWorkspace,
  getWorkspaceBySiteId: mocks.getWorkspaceBySiteId,
  updatePageState: mocks.updatePageState,
}));
vi.mock('../../server/domains/recommendations/resolution-service.js', () => ({
  resolveRecommendationsForChange: vi.fn(),
}));
vi.mock('../../server/workspace-data.js', () => ({ getWorkspacePages: mocks.getWorkspacePages }));
vi.mock('../../server/logger.js', () => ({
  createLogger: mocks.createLogger,
}));
vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywordsPaged: mocks.listPageKeywordsPaged,
  getPageKeyword: mocks.getPageKeyword,
}));
vi.mock('../../server/google-analytics.js', () => ({
  getGA4PageOrganicTrafficMap: mocks.getGA4PageOrganicTrafficMap,
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: vi.fn() }));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: { PAGE_STATE_UPDATED: 'page:state-updated' } }));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({ invalidateIntelligenceCache: vi.fn() }));
vi.mock('../../server/auth.js', () => ({
  requireWorkspaceSiteAccess: vi.fn((): RequestHandler => (_req, _res, next) => next()),
  requireWorkspaceSiteAccessFromQuery: vi.fn((): RequestHandler => (_req, _res, next) => next()),
  requireWorkspaceAccess: vi.fn((): RequestHandler => (_req, _res, next) => next()),
}));
vi.mock('../../server/middleware.js', () => ({ verifyAdminToken: vi.fn(() => true) }));
vi.mock('../../server/middleware/admin-auth.js', () => ({
  requireAdminAuth: ((_req, _res, next) => next()) as RequestHandler,
}));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: vi.fn(() => false) }));
vi.mock('../../server/url-helpers.js', () => ({ resolveBaseUrl: mocks.resolveBaseUrl }));
vi.mock('../../server/ai.js', () => ({ callAI: vi.fn() }));
vi.mock('../../server/reports.js', () => ({ getLatestSnapshot: mocks.getLatestSnapshot }));
vi.mock('../../server/chat-memory.js', () => ({
  addMessage: vi.fn(),
  buildConversationContext: vi.fn(() => ({ historyMessages: [], priorContext: '' })),
  getSession: vi.fn(),
  generateSessionSummary: vi.fn(),
  shouldAttemptSessionSummary: vi.fn((count: number) => count >= 6),
}));
vi.mock('../../server/prompt-assembly.js', () => ({ buildSystemPrompt: vi.fn((_workspaceId: string, prompt: string) => prompt) }));
vi.mock('../../server/external-fetch.js', () => ({
  fetchPublicWebText: mocks.fetchPublicWebText,
  isExternalFetchError: mocks.isExternalFetchError,
}));
vi.mock('../../server/intelligence/page-assist-context-builder.js', () => ({
  buildPageAssistContext: vi.fn(async () => ({
    blocks: {
      keywordBlock: '',
      brandVoiceBlock: '',
      personasBlock: '',
      knowledgeBlock: '',
      pageProfileBlock: '',
      playbookBlock: '',
    },
  })),
}));

import webflowRouter from '../../server/routes/webflow.js';
import rewriteChatRouter from '../../server/routes/rewrite-chat.js';

interface ProjectedPageRow {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  primaryKeyword?: string;
  rank?: number | null;
  optimizationScore?: number;
  monthlyTraffic?: number;
}

interface LoadPageResponse {
  title: string;
  slug: string;
  primaryKeyword?: string;
  rank?: number | null;
  optimizationScore?: number;
  monthlyTraffic?: number;
}

const workspace = {
  id: 'ws-1',
  name: 'Workspace',
  webflowSiteId: 'site-1',
  liveDomain: 'example.com',
  ga4PropertyId: 'ga4-1',
};

function makeApp(router: Router): Express {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function requestJson(
  app: Express,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const rawBody = typeof init.body === 'string' ? init.body : '';
  return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = new IncomingMessage(new Socket());
    req.method = init.method || 'GET';
    req.url = path;
    req.headers = { host: 'localhost' };
    if (rawBody) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = Buffer.byteLength(rawBody).toString();
    }

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    let settled = false;

    function settle(bodyText: string): void {
      if (settled) return;
      settled = true;
      resolve({ status: res.statusCode, body: bodyText ? parseJsonFallback<unknown>(bodyText, bodyText) : undefined });
    }

    res.write = ((chunk: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error) => void), callback?: (error?: Error) => void): boolean => {
      if (chunk != null) {
        const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
      if (typeof encodingOrCallback === 'function') encodingOrCallback();
      if (callback) callback();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): ServerResponse => {
      if (chunk != null) {
        const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
      }
      if (typeof encodingOrCallback === 'function') encodingOrCallback();
      if (callback) callback();
      settle(Buffer.concat(chunks).toString('utf8'));
      return res;
    }) as typeof res.end;

    app.handle(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      res.statusCode = 404;
      res.end('{"error":"Not found"}');
    });

    if (rawBody) req.push(rawBody);
    req.push(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTokenForSite.mockReturnValue('webflow-token');
  mocks.getWorkspace.mockReturnValue(workspace);
  mocks.getWorkspaceBySiteId.mockReturnValue(workspace);
  mocks.getWorkspacePages.mockResolvedValue([
    { id: 'page-home', title: 'Home', slug: '', publishedPath: '/', seo: { title: 'Home SEO', description: 'Home meta' } },
    { id: 'page-service', title: 'Service', slug: 'services/seo', publishedPath: '/services/seo', seo: {} },
    { id: 'page-blog', title: 'Blog', slug: 'blog/post', publishedPath: '/blog/post', seo: {} },
  ]);
  mocks.discoverCmsUrls.mockResolvedValue({ cmsUrls: [] });
  mocks.buildStaticPathSet.mockReturnValue(new Set(['/']));
  mocks.toCmsPageId.mockImplementation((path: string) => `cms-${path.replace(/[^a-z0-9]+/gi, '-')}`);
  mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
  mocks.listPageKeywordsPaged.mockReturnValue({
    items: [
      {
        pagePath: '/services/seo',
        pageTitle: 'Service',
        primaryKeyword: 'seo services',
        secondaryKeywords: [],
        currentPosition: 7,
        optimizationScore: 86,
      },
      {
        pagePath: '/blog/post',
        pageTitle: 'Blog',
        primaryKeyword: 'blog keyword',
        secondaryKeywords: [],
        optimizationScore: 55,
      },
    ],
    total: 2,
    limit: 10_000,
    offset: 0,
    hasMore: false,
  });
  mocks.getPageKeyword.mockReturnValue({
    pagePath: '/services/seo',
    pageTitle: 'Service',
    primaryKeyword: 'seo services',
    secondaryKeywords: [],
    currentPosition: 7,
    optimizationScore: 86,
  });
  mocks.getGA4PageOrganicTrafficMap.mockResolvedValue(new Map([['/services/seo', 123]]));
  mocks.fetchPublicWebText.mockResolvedValue(`
    <html>
      <head><title>Service Page</title></head>
      <body><main><h1>Hero</h1><p>Useful copy.</p></main></body>
    </html>
  `);
  mocks.isExternalFetchError.mockReturnValue(false);
  mocks.getLatestSnapshot.mockReturnValue({ audit: { pages: [] } });
});

describe('GET /api/webflow/all-pages/:siteId page keyword projection', () => {
  it('projects keyword fields and batched organic traffic without per-row fan-out', async () => {
    const { status, body } = await requestJson(makeApp(webflowRouter), '/api/webflow/all-pages/site-1');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const rows = body as ProjectedPageRow[];
    expect(rows.length).toBeGreaterThan(0);

    const service = rows.find(row => row.publishedPath === '/services/seo');
    expect(service).toMatchObject({
      primaryKeyword: 'seo services',
      rank: 7,
      optimizationScore: 86,
      monthlyTraffic: 123,
    });

    const blog = rows.find(row => row.publishedPath === '/blog/post');
    expect(blog).toMatchObject({
      primaryKeyword: 'blog keyword',
      rank: null,
      optimizationScore: 55,
    });
    expect(blog).not.toHaveProperty('monthlyTraffic');

    expect(mocks.listPageKeywordsPaged).toHaveBeenCalledTimes(1);
    expect(mocks.listPageKeywordsPaged).toHaveBeenCalledWith('ws-1', 10_000, 0);
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledTimes(1);
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledWith('ga4-1', 28, 500);
    expect(mocks.getPageKeyword).not.toHaveBeenCalled();
  });

  it('omits monthlyTraffic when GA4 is unavailable instead of failing the response', async () => {
    mocks.getGA4PageOrganicTrafficMap.mockRejectedValueOnce(new Error('Google not connected'));

    const { status, body } = await requestJson(makeApp(webflowRouter), '/api/webflow/all-pages/site-1');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const rows = body as ProjectedPageRow[];
    expect(rows.length).toBeGreaterThan(0);
    const service = rows.find(row => row.publishedPath === '/services/seo');
    expect(service).toMatchObject({
      primaryKeyword: 'seo services',
      rank: 7,
      optimizationScore: 86,
    });
    expect(service).not.toHaveProperty('monthlyTraffic');
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledTimes(1);
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledWith('ga4-1', 28, 500);
  });
});

describe('POST /api/rewrite-chat/:workspaceId/load-page page keyword projection', () => {
  it('projects the single page keyword fields and batched organic traffic', async () => {
    const { status, body } = await requestJson(makeApp(rewriteChatRouter), '/api/rewrite-chat/ws-1/load-page', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/services/seo' }),
    });

    expect(status).toBe(200);
    const page = body as LoadPageResponse;
    expect(page).toMatchObject({
      title: 'Service Page',
      slug: 'services/seo',
      primaryKeyword: 'seo services',
      rank: 7,
      optimizationScore: 86,
      monthlyTraffic: 123,
    });
    expect(mocks.getPageKeyword).toHaveBeenCalledTimes(1);
    expect(mocks.getPageKeyword).toHaveBeenCalledWith('ws-1', '/services/seo');
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledTimes(1);
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledWith('ga4-1', 28, 500);
    expect(mocks.listPageKeywordsPaged).not.toHaveBeenCalled();
  });

  it('omits monthlyTraffic on the single-page response when GA4 is unavailable', async () => {
    mocks.getGA4PageOrganicTrafficMap.mockRejectedValueOnce(new Error('Google not connected'));

    const { status, body } = await requestJson(makeApp(rewriteChatRouter), '/api/rewrite-chat/ws-1/load-page', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/services/seo' }),
    });

    expect(status).toBe(200);
    const page = body as LoadPageResponse;
    expect(page).toMatchObject({
      primaryKeyword: 'seo services',
      rank: 7,
      optimizationScore: 86,
    });
    expect(page).not.toHaveProperty('monthlyTraffic');
    expect(mocks.getPageKeyword).toHaveBeenCalledTimes(1);
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledTimes(1);
    expect(mocks.getGA4PageOrganicTrafficMap).toHaveBeenCalledWith('ga4-1', 28, 500);
  });
});
