// tests/integration/webflow-seo-route-coverage.test.ts
//
// Low-risk route coverage for Webflow SEO routes extracted in PR #458.
// Uses createApp() in-process so OpenAI helper mocks apply to the SEO copy route.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import db from '../../server/db/index.js';
import { saveSuggestion, selectVariation } from '../../server/seo-suggestions.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  mockOpenAIError,
  getCapturedOpenAICalls,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

interface JsonResponse {
  status: number;
  body: unknown;
}

interface SeoSuggestionResponse {
  suggestions: Array<{
    id: string;
    workspaceId: string;
    pageId: string;
    field: 'title' | 'description';
    status: string;
    variations: string[];
  }>;
  counts: {
    pending: number;
    selected: number;
    total: number;
  };
}

interface SeoCopyResponse {
  seoTitle?: string;
  metaDescription?: string;
  h1?: string;
  introParagraph?: string;
  internalLinkSuggestions?: Array<{ targetPath: string; anchorText: string; context: string }>;
  changes?: string[];
}

async function startTestServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const originalAppPassword = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (originalAppPassword === undefined) {
          delete process.env.APP_PASSWORD;
        } else {
          process.env.APP_PASSWORD = originalAppPassword;
        }
        return err ? reject(err) : resolve();
      });
    }),
  };
}

async function getJson(baseUrl: string, path: string): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function deleteSeoSuggestions(workspaceId: string): void {
  db.prepare('DELETE FROM seo_suggestions WHERE workspace_id = ?').run(workspaceId);
}

describe('Webflow SEO suggestions route coverage', () => {
  let ws: SeededFullWorkspace;
  let baseUrl = '';
  let stopServer: () => Promise<void>;

  beforeEach(async () => {
    resetOpenAIMocks();
    ws = seedWorkspace();
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
  });

  afterEach(async () => {
    await stopServer();
    deleteSeoSuggestions(ws.workspaceId);
    ws.cleanup();
  });

  it('lists pending suggestions with counts for a workspace', async () => {
    const titleSuggestion = saveSuggestion({
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      pageId: 'page-home',
      pageTitle: 'Home',
      pageSlug: '/',
      field: 'title',
      currentValue: 'Old Home Title',
      variations: ['Home SEO Title A', 'Home SEO Title B', 'Home SEO Title C'],
    });
    const descriptionSuggestion = saveSuggestion({
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      pageId: 'page-home',
      pageTitle: 'Home',
      pageSlug: '/',
      field: 'description',
      currentValue: 'Old home description.',
      variations: ['Home meta A', 'Home meta B', 'Home meta C'],
    });
    saveSuggestion({
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      pageId: 'page-services',
      pageTitle: 'Services',
      pageSlug: '/services',
      field: 'title',
      currentValue: 'Old Services Title',
      variations: ['Services SEO Title A', 'Services SEO Title B', 'Services SEO Title C'],
    });
    expect(selectVariation(ws.workspaceId, titleSuggestion.id, 1)).toBe(true);

    const { status, body } = await getJson(baseUrl, `/api/webflow/seo-suggestions/${ws.workspaceId}`);

    expect(status).toBe(200);
    const json = body as SeoSuggestionResponse;
    expect(json.suggestions).toHaveLength(3);
    expect(json.suggestions.map(s => s.id)).toEqual(expect.arrayContaining([
      titleSuggestion.id,
      descriptionSuggestion.id,
    ]));
    for (const suggestion of json.suggestions) {
      expect(suggestion.workspaceId).toBe(ws.workspaceId);
      expect(suggestion.status).toBe('pending');
    }
    expect(json.counts).toEqual({ pending: 3, selected: 1, total: 3 });
  });

  it('filters suggestions by field while preserving workspace-level counts', async () => {
    saveSuggestion({
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      pageId: 'page-about',
      pageTitle: 'About',
      pageSlug: '/about',
      field: 'title',
      currentValue: 'Old About Title',
      variations: ['About SEO Title A', 'About SEO Title B', 'About SEO Title C'],
    });
    const descriptionSuggestion = saveSuggestion({
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      pageId: 'page-about',
      pageTitle: 'About',
      pageSlug: '/about',
      field: 'description',
      currentValue: 'Old about description.',
      variations: ['About meta A', 'About meta B', 'About meta C'],
    });

    const { status, body } = await getJson(
      baseUrl,
      `/api/webflow/seo-suggestions/${ws.workspaceId}?field=description`,
    );

    expect(status).toBe(200);
    const json = body as SeoSuggestionResponse;
    expect(json.suggestions).toHaveLength(1);
    expect(json.suggestions[0]).toMatchObject({
      id: descriptionSuggestion.id,
      pageId: 'page-about',
      field: 'description',
      variations: ['About meta A', 'About meta B', 'About meta C'],
    });
    expect(json.counts).toEqual({ pending: 2, selected: 0, total: 2 });
  });
});

describe('Webflow SEO copy route coverage', () => {
  let ws: SeededFullWorkspace;
  let baseUrl = '';
  let stopServer: () => Promise<void>;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    resetOpenAIMocks();
    ws = seedWorkspace();
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
  });

  afterEach(async () => {
    await stopServer();
    deleteSeoSuggestions(ws.workspaceId);
    ws.cleanup();
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it('returns mocked optimized copy from POST /api/webflow/seo-copy', async () => {
    const mockedCopy: SeoCopyResponse = {
      seoTitle: 'Local SEO Services for Growth',
      metaDescription: 'Improve visibility with practical local SEO services built for teams that need measurable growth.',
      h1: 'Local SEO Services That Improve Visibility',
      introParagraph: 'Local SEO services should make your best pages easier to find and easier to trust.',
      internalLinkSuggestions: [
        {
          targetPath: '/case-studies',
          anchorText: 'local SEO case studies',
          context: 'Add near the services proof section.',
        },
      ],
      changes: [
        'Front-loaded the primary topic and clarified the business outcome.',
      ],
    };
    mockOpenAIJsonResponse('content-score', mockedCopy);

    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-copy', {
      workspaceId: ws.workspaceId,
      pagePath: '/services/local-seo',
      pageTitle: 'Local SEO',
      currentSeoTitle: 'Local SEO',
      currentDescription: 'We help with local SEO.',
      currentH1: 'Local SEO',
      pageContent: 'Local SEO services for growing regional businesses.',
    });

    expect(status).toBe(200);
    expect(body).toEqual(mockedCopy);

    const calls = getCapturedOpenAICalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      feature: 'content-score',
      model: 'gpt-5.4-mini',
    });
    expect(calls[0].messages[1]?.content).toContain('PAGE: /services/local-seo');
  });

  it('returns an error instead of success when SEO copy AI generation fails', async () => {
    mockOpenAIError('content-score', 'API rate limited');

    const { status, body } = await postJson(baseUrl, '/api/webflow/seo-copy', {
      workspaceId: ws.workspaceId,
      pagePath: '/services/local-seo',
      pageTitle: 'Local SEO',
      currentSeoTitle: 'Local SEO',
      currentDescription: 'We help with local SEO.',
      currentH1: 'Local SEO',
      pageContent: 'Local SEO services for growing regional businesses.',
    });

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'SEO copy generation failed' });
    expect(getCapturedOpenAICalls()).toHaveLength(1);
  });
});
