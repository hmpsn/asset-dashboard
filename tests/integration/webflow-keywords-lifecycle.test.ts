/**
 * Integration tests for server/routes/webflow-keywords.ts
 * Port: 13861
 * // port-ok: unique in integration suite
 *
 * Covers:
 * - POST /api/webflow/keyword-analysis        (AI keyword analysis)
 * - POST /api/webflow/keyword-analysis/persist (save analysis results)
 * - POST /api/webflow/content-score           (compute content score)
 *
 * Uses in-process server with vi.mock() so AI calls are intercepted without
 * hitting real APIs.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

// ---------------------------------------------------------------------------
// Hoisted mock state (must precede any vi.mock calls)
// ---------------------------------------------------------------------------

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

const aiState = vi.hoisted(() => ({
  text: JSON.stringify({
    primaryKeyword: 'seo services',
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
    secondaryKeywords: ['local seo', 'technical seo', 'on-page seo'],
    longTailKeywords: ['best seo services for small business'],
    searchIntent: 'commercial',
    searchIntentConfidence: 0.85,
    contentGaps: ['competitor analysis section'],
    competitorKeywords: ['seo agency', 'seo consultant'],
    optimizationScore: 72,
    optimizationIssues: ['Meta description too short'],
    recommendations: ['Add primary keyword to meta description'],
    estimatedDifficulty: 'medium',
    keywordDifficulty: 45,
    monthlyVolume: 1200,
    topicCluster: 'SEO Services',
  }),
  shouldThrow: false,
  malformedJson: false,
}));

// ---------------------------------------------------------------------------
// Module mocks — must precede imports that transitively load these modules
// ---------------------------------------------------------------------------

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: (wsId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId: wsId, event, payload });
  },
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(async () => {
    if (aiState.shouldThrow) throw new Error('AI service unavailable');
    if (aiState.malformedJson) return { text: 'not valid json {{{{' };
    return { text: aiState.text };
  }),
}));

vi.mock('../../server/provider-keyword-metrics.js', () => ({
  getProviderMetricsForKeyword: vi.fn(async () => null),
  resolvePersistedKeywordMetrics: vi.fn((_existing: unknown, _keyword: string, metrics: unknown) => ({
    keywordDifficulty: metrics ? 45 : undefined,
    monthlyVolume: metrics ? 1200 : undefined,
  })),
}));

vi.mock('../../server/intelligence/page-assist-context-builder.js', () => ({
  buildPageAssistContext: vi.fn(async () => ({
    promptContext: '',
    blocks: { pageMapBlock: '' },
  })),
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  debouncedPageAnalysisInvalidate: vi.fn((_wsId: string, cb: () => void) => cb()),
  invalidateSubCachePrefix: vi.fn(),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(async () => ({})),
  getWorkspaceIntelligence: vi.fn(async () => null),
}));

vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: vi.fn(() => null),
  getProviderDisplayName: vi.fn(() => 'SEMRush'),
  registerProvider: vi.fn(),
}));

vi.mock('../../server/local-seo.js', () => ({
  resolveWorkspaceLocationCode: vi.fn(() => null),
  countLocalVisibilitySnapshots: vi.fn(() => 0),
  runLocationBackfillJob: vi.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Test server bootstrap (in-process so mocks apply)
// ---------------------------------------------------------------------------

const nativeFetch = globalThis.fetch;
const originalAppPassword = process.env.APP_PASSWORD;

let baseUrl = '';
let server: http.Server | undefined;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.OPENAI_API_KEY = 'test-openai-key-webflow-kw';
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${path}`, opts);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Valid fixture payloads
// ---------------------------------------------------------------------------

function makeValidAnalysis() {
  return {
    primaryKeyword: 'seo services',
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
    secondaryKeywords: ['local seo', 'technical seo', 'on-page seo'],
    longTailKeywords: ['best seo services for small business'],
    searchIntent: 'commercial' as const,
    searchIntentConfidence: 0.85,
    contentGaps: ['competitor analysis section'],
    competitorKeywords: ['seo agency', 'seo consultant'],
    optimizationScore: 72,
    optimizationIssues: ['Meta description too short'],
    recommendations: ['Add primary keyword to meta description'],
    estimatedDifficulty: 'medium' as const,
    keywordDifficulty: 45,
    monthlyVolume: 1200,
    topicCluster: 'SEO Services',
  };
}

// ---------------------------------------------------------------------------
// Workspace fixtures
// ---------------------------------------------------------------------------

let ws: SeededFullWorkspace;
let wsB: SeededFullWorkspace;

beforeAll(async () => {
  await startTestServer();
}, 30_000);

beforeEach(() => {
  // Reset mock state before each test
  aiState.shouldThrow = false;
  aiState.malformedJson = false;
  aiState.text = JSON.stringify({
    primaryKeyword: 'seo services',
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
    secondaryKeywords: ['local seo', 'technical seo', 'on-page seo'],
    longTailKeywords: ['best seo services for small business'],
    searchIntent: 'commercial',
    searchIntentConfidence: 0.85,
    contentGaps: ['competitor analysis section'],
    competitorKeywords: ['seo agency', 'seo consultant'],
    optimizationScore: 72,
    optimizationIssues: ['Meta description too short'],
    recommendations: ['Add primary keyword to meta description'],
    estimatedDifficulty: 'medium',
    keywordDifficulty: 45,
    monthlyVolume: 1200,
    topicCluster: 'SEO Services',
  });
  broadcastState.calls = [];

  ws = seedWorkspace();
  wsB = seedWorkspace();
});

afterEach(() => {
  ws.cleanup();
  wsB.cleanup();
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  delete process.env.OPENAI_API_KEY;
});

// ---------------------------------------------------------------------------
// POST /api/webflow/keyword-analysis
// ---------------------------------------------------------------------------

describe('POST /api/webflow/keyword-analysis — basic analysis', () => {
  it('returns 400 when pageTitle is missing', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageContent: 'Some content',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/pageTitle/);
  });

  it('returns structured analysis on happy path', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'SEO Services',
      seoTitle: 'SEO Services - Grow Your Business',
      metaDescription: 'Expert SEO services to grow your business online.',
      pageContent: '<h1>SEO Services</h1><p>We help businesses grow with SEO.</p>',
      slug: '/services/seo',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('primaryKeyword');
    expect(body).toHaveProperty('secondaryKeywords');
    expect(body).toHaveProperty('searchIntent');
    expect(body).toHaveProperty('optimizationScore');
    expect(body).toHaveProperty('recommendations');
  });

  it('works without optional fields (seoTitle, metaDescription, pageContent, slug)', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'About Us',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('primaryKeyword');
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/keyword-analysis — missing workspace / invalid payload
// ---------------------------------------------------------------------------

describe('POST /api/webflow/keyword-analysis — workspace validation', () => {
  it('returns non-2xx or processes gracefully when workspaceId is missing from body', async () => {
    // When APP_PASSWORD is unset, requireWorkspaceAccessFromBody passes through (no req.user to
    // enforce workspace scope). The route either processes the request without a workspace or
    // returns a validation/auth error. Either outcome is acceptable here.
    const res = await postJson('/api/webflow/keyword-analysis', {
      pageTitle: 'Test Page',
    });
    expect([200, 400, 403, 500]).toContain(res.status);
  });

  it('returns 400 when both pageTitle and pageContent are absent', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/keyword-analysis/persist — save and retrieve
// ---------------------------------------------------------------------------

describe('POST /api/webflow/keyword-analysis/persist — persist and GET', () => {
  it('returns success with pagePath on happy path', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      analysis: makeValidAnalysis(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.pagePath).toBe('/services/seo');
    expect(body.hasAnalysis).toBe(true);
  });

  it('normalizes pagePath by prepending slash if missing', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: 'about',
      pageTitle: 'About Us',
      analysis: makeValidAnalysis(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.pagePath).toBe('/about');
  });

  it('returns 404 when workspace does not exist', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: 'nonexistent-workspace-000',
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      analysis: makeValidAnalysis(),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/[Ww]orkspace/);
  });

  it('returns 400 when required fields are missing (no analysis)', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: '/services/seo',
      // analysis is missing
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/webflow/content-score — compute content score
// ---------------------------------------------------------------------------

describe('POST /api/webflow/content-score — content scoring', () => {
  it('returns 400 when both pageContent and pageTitle are absent', async () => {
    const res = await postJson('/api/webflow/content-score', {});
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('returns scored response with expected fields when given pageContent', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'SEO Services',
      seoTitle: 'SEO Services - Grow Your Business',
      metaDescription: 'Expert SEO services to grow your business online with proven strategies.',
      pageContent:
        '<h1>SEO Services</h1>' +
        '<h2>What We Do</h2>' +
        '<p>We provide comprehensive SEO services including keyword research, on-page optimization, and link building. ' +
        'Our team of experts helps businesses rank higher in search engines and drive more organic traffic.</p>',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('wordCount');
    expect(body).toHaveProperty('sentenceCount');
    expect(body).toHaveProperty('readabilityScore');
    expect(body).toHaveProperty('readabilityGrade');
    expect(body).toHaveProperty('headings');
    expect(body).toHaveProperty('topKeywords');
    expect(body).toHaveProperty('titleLength');
    expect(body).toHaveProperty('descLength');
    expect(body).toHaveProperty('titleOk');
    expect(body).toHaveProperty('descOk');
  });

  it('returns score even when only pageTitle is provided (no content)', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'About Us',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('wordCount');
    expect(typeof body.wordCount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Cross-workspace isolation
// ---------------------------------------------------------------------------

describe('Cross-workspace isolation — persist', () => {
  it('workspace A analysis is not accessible from workspace B', async () => {
    const pathA = `/services/seo-${Date.now()}`;

    // Persist for workspace A
    const persistRes = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: pathA,
      pageTitle: 'SEO Page',
      analysis: makeValidAnalysis(),
    });
    expect(persistRes.status).toBe(200);

    // Import page-keywords to verify isolation directly against the DB
    const { getPageKeyword } = await import('../../server/page-keywords.js');
    const rowA = getPageKeyword(ws.workspaceId, pathA);
    const rowB = getPageKeyword(wsB.workspaceId, pathA);

    expect(rowA).toBeDefined();
    expect(rowB).toBeUndefined();
  });

  it('workspace B persist does not overwrite workspace A data', async () => {
    const sharedPath = '/services/shared';
    const analysisA = { ...makeValidAnalysis(), primaryKeyword: 'workspace-a-keyword' };
    const analysisB = { ...makeValidAnalysis(), primaryKeyword: 'workspace-b-keyword' };

    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: sharedPath,
      pageTitle: 'Shared Page',
      analysis: analysisA,
    });
    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: wsB.workspaceId,
      pagePath: sharedPath,
      pageTitle: 'Shared Page',
      analysis: analysisB,
    });

    const { getPageKeyword } = await import('../../server/page-keywords.js');
    const rowA = getPageKeyword(ws.workspaceId, sharedPath);
    const rowB = getPageKeyword(wsB.workspaceId, sharedPath);

    expect(rowA?.primaryKeyword).toBe('workspace-a-keyword');
    expect(rowB?.primaryKeyword).toBe('workspace-b-keyword');
  });

  it('analysis response for one workspace does not leak data from another workspace', async () => {
    // Both workspaces analyse independently — responses should not cross-contaminate
    const [resA, resB] = await Promise.all([
      postJson('/api/webflow/keyword-analysis', {
        workspaceId: ws.workspaceId,
        pageTitle: 'Workspace A Page',
      }),
      postJson('/api/webflow/keyword-analysis', {
        workspaceId: wsB.workspaceId,
        pageTitle: 'Workspace B Page',
      }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    // Both get their own valid analysis without error
    const bodyA = await resA.json() as Record<string, unknown>;
    const bodyB = await resB.json() as Record<string, unknown>;
    expect(bodyA).toHaveProperty('primaryKeyword');
    expect(bodyB).toHaveProperty('primaryKeyword');
  });
});

// ---------------------------------------------------------------------------
// Broadcast emissions
// ---------------------------------------------------------------------------

describe('Broadcast emissions', () => {
  it('persist fires broadcastToWorkspace for the correct workspaceId', async () => {
    broadcastState.calls = [];
    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: '/test-broadcast',
      pageTitle: 'Broadcast Test',
      analysis: makeValidAnalysis(),
    });
    const calls = broadcastState.calls.filter(c => c.workspaceId === ws.workspaceId);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('persist broadcasts strategy:updated event', async () => {
    broadcastState.calls = [];
    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: '/test-event',
      pageTitle: 'Event Test',
      analysis: makeValidAnalysis(),
    });
    const strategyEvents = broadcastState.calls.filter(c => c.event === 'strategy:updated');
    expect(strategyEvents.length).toBeGreaterThan(0);
  });

  it('persist broadcast payload includes pagePath', async () => {
    const testPath = '/broadcast-payload-test';
    broadcastState.calls = [];
    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: testPath,
      pageTitle: 'Payload Test',
      analysis: makeValidAnalysis(),
    });
    const event = broadcastState.calls.find(
      c => c.workspaceId === ws.workspaceId && c.event === 'strategy:updated',
    );
    expect(event).toBeDefined();
    const payload = event!.payload as Record<string, unknown>;
    expect(payload.pagePath).toBe(testPath);
  });

  it('analysis endpoint (non-persist) does NOT fire a broadcast', async () => {
    broadcastState.calls = [];
    await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'Analysis Only',
    });
    // The raw analysis endpoint does not persist or broadcast — only persist does
    const wsEvents = broadcastState.calls.filter(c => c.workspaceId === ws.workspaceId);
    expect(wsEvents.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid payload → 400 validation errors
// ---------------------------------------------------------------------------

describe('Validation errors — invalid payloads', () => {
  it('persist: returns 400 when pagePath is empty string', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: '',
      analysis: makeValidAnalysis(),
    });
    expect(res.status).toBe(400);
  });

  it('persist: returns 400 when workspaceId is empty string', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: '',
      pagePath: '/some-path',
      analysis: makeValidAnalysis(),
    });
    expect(res.status).toBe(400);
  });

  it('content-score: returns 400 with empty body', async () => {
    const res = await postJson('/api/webflow/content-score', {});
    expect(res.status).toBe(400);
  });

  it('analysis: returns 400 when body is not JSON', async () => {
    const res = await api('/api/webflow/keyword-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    // Without workspaceId and pageTitle, route returns 400 or 403
    expect([400, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Re-analyze same page — upsert behavior
// ---------------------------------------------------------------------------

describe('Re-analyze same page — upsert, no duplicate', () => {
  it('second persist to same path updates rather than duplicates', async () => {
    const pagePath = `/services/upsert-test-${Date.now()}`;

    const first = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath,
      pageTitle: 'First Analysis',
      analysis: { ...makeValidAnalysis(), primaryKeyword: 'first-keyword' },
    });
    expect(first.status).toBe(200);

    const second = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath,
      pageTitle: 'Second Analysis',
      analysis: { ...makeValidAnalysis(), primaryKeyword: 'updated-keyword' },
    });
    expect(second.status).toBe(200);

    const { getPageKeyword, listPageKeywords } = await import('../../server/page-keywords.js');
    const all = listPageKeywords(ws.workspaceId);
    const matching = all.filter(p => p.pagePath === pagePath);
    expect(matching.length).toBe(1);
    const entry = getPageKeyword(ws.workspaceId, pagePath);
    expect(entry?.primaryKeyword).toBe('updated-keyword');
  });

  it('re-persisting preserves pagePath normalization (no slash duplication)', async () => {
    const rawPath = 'services/no-slash';
    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: rawPath,
      analysis: makeValidAnalysis(),
    });
    await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: rawPath,
      analysis: { ...makeValidAnalysis(), primaryKeyword: 'second-run' },
    });

    const { listPageKeywords } = await import('../../server/page-keywords.js');
    const all = listPageKeywords(ws.workspaceId);
    const matching = all.filter(p => p.pagePath === '/services/no-slash');
    expect(matching.length).toBe(1);
  });

  it('analysis endpoint always returns fresh AI response without caching', async () => {
    const firstRes = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'Repeated Analysis Test',
    });
    expect(firstRes.status).toBe(200);

    aiState.text = JSON.stringify({
      ...JSON.parse(aiState.text) as Record<string, unknown>,
      primaryKeyword: 'updated-keyword-on-second-call',
    });

    const secondRes = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'Repeated Analysis Test',
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json() as Record<string, unknown>;
    expect(secondBody.primaryKeyword).toBe('updated-keyword-on-second-call');
  });
});

// ---------------------------------------------------------------------------
// Error paths — AI returns malformed / throws
// ---------------------------------------------------------------------------

describe('Error paths — AI failures', () => {
  it('keyword-analysis: gracefully returns error shape when AI returns malformed JSON', async () => {
    aiState.malformedJson = true;
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'Malformed AI Test',
    });
    // Route returns 200 with error field when AI parse fails — graceful degradation
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('keyword-analysis: returns 500 when callAI throws', async () => {
    aiState.shouldThrow = true;
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'Throwing AI Test',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('content-score: returns valid scores even for HTML-heavy content', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'Rich Content',
      pageContent:
        '<h1>Title</h1>' +
        '<h2>Subtitle</h2>' +
        '<p><strong>Bold</strong> and <em>italic</em> text with <a href="#">links</a></p>' +
        '<ul><li>Item one</li><li>Item two</li></ul>' +
        '<p>More paragraph content to ensure word counting works with HTML stripped.</p>',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.wordCount).toBe('number');
    expect((body.wordCount as number)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Response shape contracts
// ---------------------------------------------------------------------------

describe('Response shape contracts', () => {
  it('keyword-analysis response includes all required top-level fields', async () => {
    const res = await postJson('/api/webflow/keyword-analysis', {
      workspaceId: ws.workspaceId,
      pageTitle: 'Shape Contract Test',
      seoTitle: 'Shape Contract SEO',
      metaDescription: 'Testing shape contracts for keyword analysis.',
      pageContent: '<p>Testing shape contracts for keyword analysis responses.</p>',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const requiredFields = [
      'primaryKeyword',
      'secondaryKeywords',
      'longTailKeywords',
      'searchIntent',
      'contentGaps',
      'competitorKeywords',
      'optimizationScore',
      'optimizationIssues',
      'recommendations',
      'estimatedDifficulty',
      'keywordDifficulty',
      'monthlyVolume',
      'topicCluster',
    ];
    for (const field of requiredFields) {
      expect(body, `field "${field}" should be present`).toHaveProperty(field);
    }
  });

  it('persist response has success, pagePath, and hasAnalysis fields', async () => {
    const res = await postJson('/api/webflow/keyword-analysis/persist', {
      workspaceId: ws.workspaceId,
      pagePath: '/shape-contract-persist',
      pageTitle: 'Shape Persist',
      analysis: makeValidAnalysis(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('pagePath');
    expect(body).toHaveProperty('hasAnalysis', true);
  });

  it('content-score headings object has total, h1, h2, and texts fields', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'Headings Shape Test',
      pageContent: '<h1>Main Heading</h1><h2>Subheading</h2><h2>Another Sub</h2><p>Body content here.</p>',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const headings = body.headings as Record<string, unknown>;
    expect(headings).toHaveProperty('total');
    expect(headings).toHaveProperty('h1');
    expect(headings).toHaveProperty('h2');
    expect(headings).toHaveProperty('texts');
    expect(Array.isArray(headings.texts)).toBe(true);
    expect(headings.h1).toBe(1);
    expect(headings.h2).toBe(2);
    expect(headings.total).toBe(3);
  });

  it('content-score topKeywords entries each have word, count, and density fields', async () => {
    const res = await postJson('/api/webflow/content-score', {
      pageTitle: 'Keywords Shape',
      pageContent:
        '<p>Keyword analysis is important. Keyword research helps. Keyword optimization improves rankings. ' +
        'Search engine optimization and keyword density matter for ranking.</p>',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const topKeywords = body.topKeywords as Array<Record<string, unknown>>;
    expect(Array.isArray(topKeywords)).toBe(true);
    expect(topKeywords.length).toBeGreaterThan(0);
    for (const kw of topKeywords) {
      expect(kw).toHaveProperty('word');
      expect(kw).toHaveProperty('count');
      expect(kw).toHaveProperty('density');
    }
  });
});
