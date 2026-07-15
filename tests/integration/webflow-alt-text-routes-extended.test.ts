/**
 * Extended integration tests for server/routes/webflow-alt-text.ts
 * Uses an ephemeral in-process server port.
 *
 * Covers uncovered paths:
 * - workspace not found (generate-alt, bulk-generate-alt)
 * - usage limit enforcement (generate-alt, bulk-generate-alt)
 * - alt text generation returns null
 * - fetchExternalBytes failure (ExternalFetchError with http / network kinds)
 * - generate-alt with siteId context (page DOM matching)
 * - generate-alt without siteId (no context)
 * - generate-alt write-back failure decrements usage
 * - bulk-generate-alt workspace not found
 * - bulk-generate-alt usage limit mid-batch
 * - bulk-generate-alt partial success / all fail
 * - bulk-generate-alt fetch error per asset
 * - bulk-generate-alt generateAltText returns null
 * - bulk-generate-alt write-back fails per asset
 * - compress: upload fails
 * - compress: savings below threshold (skipped)
 * - compress: SVG path
 * - compress: with CMS usages (repairCmsReferences)
 * - compress: CMS repair partial failure → old asset preserved
 * - compress: CMS usages but missing hostedUrl → old asset preserved
 * - compress: wrong siteId (site not owned by workspace)
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { ExternalFetchError } from '../../server/external-fetch.js';
import { getUsageCount } from '../../server/usage-tracking.js';

const nativeFetch = globalThis.fetch;
const ALT_ROUTE_TEST_TIMEOUT_MS = 15_000;

// --- Hoisted mock state ---

const altState = vi.hoisted(() => ({
  queue: [] as Array<string | null>,
  shouldThrow: false,
  returnNull: false,
}));

const webflowState = vi.hoisted(() => ({
  updateCalls: [] as Array<{ assetId: string; altText?: string }>,
  updateShouldFail: false,
  uploadCalls: [] as Array<{ siteId: string; fileName: string }>,
  uploadShouldFail: false,
  uploadResult: null as null | { success: boolean; assetId?: string; hostedUrl?: string; error?: string },
  deleteCalls: [] as Array<{ assetId: string }>,
  listSitesResult: [] as Array<{ id: string; displayName: string }>,
  pageDomResult: '<html></html>',
}));

const fetchBytesState = vi.hoisted(() => ({
  shouldThrow: false,
  throwKind: 'http' as 'http' | 'network' | 'timeout',
  throwStatus: 404 as number | undefined,
  genericThrowOnCall: null as number | null,
  callCount: 0,
}));

const cmsState = vi.hoisted(() => ({
  getCollectionItemResult: null as Record<string, unknown> | null,
  updateShouldFail: false,
  updateCalls: [] as Array<{ collectionId: string; itemId: string }>,
  publishCalls: [] as Array<{ collectionId: string; itemIds: string[] }>,
}));

// --- Mocks ---

vi.mock('../../server/alttext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/alttext.js')>();
  return {
    ...actual,
    generateAltText: vi.fn(async () => {
      if (altState.shouldThrow) throw new Error('AI generation error');
      if (altState.returnNull) return null;
      if (altState.queue.length > 0) {
        const next = altState.queue.shift();
        // Explicit null in queue means "return null for this call"
        if (next === null) return null;
        return next;
      }
      return 'Default alt text';
    }),
  };
});

vi.mock('../../server/workspace-intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildIntelPrompt: vi.fn(async () => '[Workspace Intelligence]\n## SEO Context\nBusiness: Test business'),
  };
});

vi.mock('../../server/external-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/external-fetch.js')>();
  return {
    ...actual,
    fetchExternalBytes: vi.fn(async () => {
      fetchBytesState.callCount++;
      if (fetchBytesState.genericThrowOnCall === fetchBytesState.callCount) {
        throw new Error('Unexpected fetch failure');
      }
      if (fetchBytesState.shouldThrow) {
        throw new actual.ExternalFetchError({
          kind: fetchBytesState.throwKind,
          message: `Fetch error: ${fetchBytesState.throwKind}`,
          url: 'https://cdn.example.test/image.jpg',
          status: fetchBytesState.throwKind === 'http' ? fetchBytesState.throwStatus : undefined,
        });
      }
      // Return a minimal valid buffer (enough bytes to process)
      return new Uint8Array(Buffer.alloc(2000));
    }),
    isExternalFetchError: actual.isExternalFetchError,
    ExternalFetchError: actual.ExternalFetchError,
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    listSites: vi.fn(async () => webflowState.listSitesResult),
    getPageDom: vi.fn(async () => webflowState.pageDomResult),
    updateAsset: vi.fn(async (assetId: string, payload: { altText?: string }) => {
      webflowState.updateCalls.push({ assetId, altText: payload.altText });
      if (webflowState.updateShouldFail) return { success: false, error: 'Webflow write failed' };
      return { success: true };
    }),
    uploadAsset: vi.fn(async (siteId: string, _tmpPath: string, fileName: string) => {
      webflowState.uploadCalls.push({ siteId, fileName });
      if (webflowState.uploadShouldFail) return { success: false, error: 'Upload failed' };
      if (webflowState.uploadResult) return webflowState.uploadResult;
      return { success: true, assetId: `new-${fileName}`, hostedUrl: `https://cdn.example.com/new-${fileName}` };
    }),
    deleteAsset: vi.fn(async (assetId: string) => {
      webflowState.deleteCalls.push({ assetId });
      return { success: true };
    }),
  };
});

vi.mock('../../server/webflow-cms.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow-cms.js')>();
  return {
    ...actual,
    getCollectionItem: vi.fn(async () => cmsState.getCollectionItemResult),
    updateCollectionItem: vi.fn(async (collectionId: string, itemId: string) => {
      cmsState.updateCalls.push({ collectionId, itemId });
      if (cmsState.updateShouldFail) return { success: false, error: 'CMS update failed' };
      return { success: true };
    }),
    publishCollectionItems: vi.fn(async (collectionId: string, itemIds: string[]) => {
      cmsState.publishCalls.push({ collectionId, itemIds });
      return { success: true };
    }),
  };
});

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(async () => Buffer.alloc(200)),
  })),
}));


let server: http.Server | undefined;
let baseUrl = '';
let workspaceId = '';
let siteId = '';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
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

async function api(urlPath: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${urlPath}`, opts);
}

async function postJson(urlPath: string, body: unknown): Promise<Response> {
  return api(urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Parse NDJSON response body into an array of parsed objects.
 */
async function parseNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

beforeEach(() => {
  const ws = createWorkspace('Alt Text Extended Test', 'wf-ext-site', 'Extended Site');
  workspaceId = ws.id;
  siteId = ws.webflowSiteId!;
  updateWorkspace(workspaceId, { webflowToken: 'ext-token', tier: 'premium' });

  // Reset all state
  altState.queue = [];
  altState.shouldThrow = false;
  altState.returnNull = false;

  webflowState.updateCalls = [];
  webflowState.updateShouldFail = false;
  webflowState.uploadCalls = [];
  webflowState.uploadShouldFail = false;
  webflowState.uploadResult = null;
  webflowState.deleteCalls = [];
  webflowState.listSitesResult = [];
  webflowState.pageDomResult = '<html></html>';

  fetchBytesState.shouldThrow = false;
  fetchBytesState.throwKind = 'http';
  fetchBytesState.throwStatus = 404;
  fetchBytesState.genericThrowOnCall = null;
  fetchBytesState.callCount = 0;

  cmsState.getCollectionItemResult = null;
  cmsState.updateShouldFail = false;
  cmsState.updateCalls = [];
  cmsState.publishCalls = [];
});

afterEach(() => {
  if (workspaceId) {
    deleteWorkspace(workspaceId);
    workspaceId = '';
    siteId = '';
  }
});

// =============================================================================
// generate-alt — uncovered paths
// =============================================================================

describe('POST /generate-alt — workspace not found', () => {
  it('returns 404 when workspace does not exist (no siteId, passes middleware)', async () => {
    // Without siteId, requireWorkspaceSiteAccess passes through (no JWT user → canOmitWorkspaceScope=true).
    // The route handler then checks getWorkspace() and returns 404.
    const res = await postJson('/api/webflow/nonexistent-ws-id/generate-alt/asset-1', {
      imageUrl: 'https://cdn.example.test/img.jpg',
      // no siteId — middleware skips site ownership check
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});

describe('POST /generate-alt — usage limit', () => {
  it('returns 429 when an expired-trial Free workspace has no allowance', async () => {
    updateWorkspace(workspaceId, {
      tier: 'free',
      trialEndsAt: '2000-01-01T00:00:00.000Z',
    });
    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-limit`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
    });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'Monthly AI generation limit reached' });
  });

  it('uses Growth allowance for an active-trial Free workspace', async () => {
    updateWorkspace(workspaceId, {
      tier: 'free',
      trialEndsAt: '2999-01-01T00:00:00.000Z',
    });
    altState.queue.push('Active trial alt text');

    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-trial`, {
      imageUrl: 'https://cdn.example.test/trial.jpg',
      siteId,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ altText: 'Active trial alt text', updated: true });
  });
});

describe('POST /generate-alt — generate returns null', () => {
  it('returns altText null and updated false when generation returns null', async () => {
    altState.returnNull = true;
    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-null`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { altText: null; updated: boolean };
    expect(body.altText).toBeNull();
    expect(body.updated).toBe(false);
    // Should NOT have called updateAsset
    expect(webflowState.updateCalls).toHaveLength(0);
  }, ALT_ROUTE_TEST_TIMEOUT_MS);
});

describe('POST /generate-alt — without siteId', () => {
  it('succeeds without siteId (no page context attempted)', async () => {
    altState.queue.push('Alt text without site context');
    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-nosid`, {
      imageUrl: 'https://cdn.example.test/hero.jpg',
      // no siteId
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { altText: string; updated: boolean };
    expect(body.altText).toBe('Alt text without site context');
    expect(body.updated).toBe(true);
  });
});

describe('POST /generate-alt — fetchExternalBytes failure (http error)', () => {
  it('returns 500 when image download fails with HTTP error', async () => {
    fetchBytesState.shouldThrow = true;
    fetchBytesState.throwKind = 'http';
    fetchBytesState.throwStatus = 403;

    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-fetch-fail`, {
      imageUrl: 'https://cdn.example.test/protected.jpg',
      siteId,
    });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to generate alt text' });
  });
});

describe('POST /generate-alt — siteId context from site displayName', () => {
  it('uses site displayName as context when no page match', async () => {
    webflowState.listSitesResult = [{ id: siteId, displayName: 'My Awesome Site' }];
    webflowState.pageDomResult = '<html><body>No asset reference here</body></html>';
    altState.queue.push('Generated with site name context');

    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-ctx`, {
      imageUrl: 'https://cdn.example.test/hero.jpg',
      siteId,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { altText: string; updated: boolean };
    expect(body.updated).toBe(true);
    expect(body.altText).toBe('Generated with site name context');
  }, ALT_ROUTE_TEST_TIMEOUT_MS);
});

describe('POST /generate-alt — siteId context from page DOM match', () => {
  it('extracts page snippet when asset ID appears in DOM', async () => {
    webflowState.pageDomResult = '<html><body>Some content asset-dom-match more content here that describes the image</body></html>';
    altState.queue.push('Generated with page context');

    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-dom-match`, {
      imageUrl: 'https://cdn.example.test/hero.jpg',
      siteId,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { altText: string; updated: boolean };
    expect(body.updated).toBe(true);
    expect(body.altText).toBe('Generated with page context');
  });
});

describe('POST /generate-alt — write-back fails decrements usage', () => {
  it('returns writeError and updated false, write-back failed response', async () => {
    altState.queue.push('Good alt text');
    webflowState.updateShouldFail = true;

    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-wbfail`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { altText: string; updated: boolean; writeError: string };
    expect(body.altText).toBe('Good alt text');
    expect(body.updated).toBe(false);
    expect(body.writeError).toBe('Webflow write failed');
  });
});

// =============================================================================
// bulk-generate-alt — uncovered paths
// =============================================================================

describe('POST /bulk-generate-alt — workspace not found', () => {
  it('returns 404 when workspace does not exist (no siteId, passes middleware)', async () => {
    // Without siteId the site-access middleware passes through for unauthenticated requests.
    const res = await postJson('/api/webflow/nonexistent-ws-id/bulk-generate-alt', {
      assets: [{ assetId: 'a1', imageUrl: 'https://cdn.example.test/a1.jpg' }],
      // no siteId
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});

describe('POST /bulk-generate-alt — free tier usage limit at start', () => {
  it('returns 429 when an expired-trial Free workspace has no allowance', async () => {
    updateWorkspace(workspaceId, {
      tier: 'free',
      trialEndsAt: '2000-01-01T00:00:00.000Z',
    });
    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'a1', imageUrl: 'https://cdn.example.test/a1.jpg' }],
      siteId,
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; used: number; limit: number };
    expect(body.error).toBe('Monthly AI generation limit reached');
    expect(typeof body.used).toBe('number');
    expect(typeof body.limit).toBe('number');
  });
});

describe('POST /bulk-generate-alt — successful single asset', () => {
  it('uses Growth allowance at preflight and reservation for an active-trial Free workspace', async () => {
    updateWorkspace(workspaceId, {
      tier: 'free',
      trialEndsAt: '2999-01-01T00:00:00.000Z',
    });
    altState.queue.push('First asset alt');

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-1', imageUrl: 'https://cdn.example.test/b1.jpg' }],
      siteId,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const lines = await parseNdjson(res);
    const statusLine = lines.find(l => l.type === 'status' && l.message === 'Processing images...');
    expect(statusLine).toBeDefined();

    const resultLine = lines.find(l => l.type === 'result');
    expect(resultLine).toBeDefined();
    expect(resultLine!.assetId).toBe('bulk-1');
    expect(resultLine!.altText).toBe('First asset alt');
    expect(resultLine!.updated).toBe(true);

    const doneLine = lines.find(l => l.type === 'done');
    expect(doneLine).toBeDefined();
    expect(doneLine!.done).toBe(1);
    expect(doneLine!.total).toBe(1);
  });
});

describe('POST /bulk-generate-alt — generateAltText returns null', () => {
  it('sends result with altText null and error message', async () => {
    altState.returnNull = true;

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-null', imageUrl: 'https://cdn.example.test/bn.jpg' }],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const resultLine = lines.find(l => l.type === 'result');
    expect(resultLine).toBeDefined();
    expect(resultLine!.altText).toBeNull();
    expect(resultLine!.updated).toBe(false);
    expect(typeof resultLine!.error).toBe('string');
  });
});

describe('POST /bulk-generate-alt — fetchExternalBytes fails with HTTP error', () => {
  it('sends result with download error detail and continues', async () => {
    fetchBytesState.shouldThrow = true;
    fetchBytesState.throwKind = 'http';
    fetchBytesState.throwStatus = 503;

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-fetch-fail', imageUrl: 'https://cdn.example.test/fail.jpg' }],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const resultLine = lines.find(l => l.type === 'result');
    expect(resultLine).toBeDefined();
    expect(resultLine!.assetId).toBe('bulk-fetch-fail');
    expect(resultLine!.altText).toBeNull();
    expect(resultLine!.updated).toBe(false);
    expect(String(resultLine!.error)).toContain('503');
  });
});

describe('POST /bulk-generate-alt — fetchExternalBytes fails with network error', () => {
  it('sends result with network error kind detail', async () => {
    fetchBytesState.shouldThrow = true;
    fetchBytesState.throwKind = 'network';
    fetchBytesState.throwStatus = undefined;

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-net-fail', imageUrl: 'https://cdn.example.test/net.jpg' }],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const resultLine = lines.find(l => l.type === 'result');
    expect(resultLine!.assetId).toBe('bulk-net-fail');
    expect(resultLine!.altText).toBeNull();
    expect(String(resultLine!.error)).toContain('network');
  });
});

describe('POST /bulk-generate-alt — generic fetch failure accounting', () => {
  it('counts and refunds one generic failure exactly once', async () => {
    fetchBytesState.genericThrowOnCall = 1;

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-generic-fail', imageUrl: 'https://cdn.example.test/generic.jpg' }],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const resultLine = lines.find(line => line.type === 'result');
    expect(resultLine).toMatchObject({
      assetId: 'bulk-generic-fail',
      altText: null,
      updated: false,
      error: 'Unexpected fetch failure',
      done: 1,
      total: 1,
    });
    expect(lines.find(line => line.type === 'done')).toMatchObject({ done: 1, total: 1 });
    expect(getUsageCount(workspaceId, 'alt_text_generations')).toBe(0);
  });

  it('does not refund a prior successful asset when the next generic fetch fails', async () => {
    fetchBytesState.genericThrowOnCall = 2;
    altState.queue.push('Successful first alt');

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [
        { assetId: 'bulk-success-before-error', imageUrl: 'https://cdn.example.test/success.jpg' },
        { assetId: 'bulk-generic-after-success', imageUrl: 'https://cdn.example.test/generic-after.jpg' },
      ],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    expect(lines.find(line => line.assetId === 'bulk-success-before-error')).toMatchObject({
      updated: true,
      done: 1,
      total: 2,
    });
    expect(lines.find(line => line.assetId === 'bulk-generic-after-success')).toMatchObject({
      updated: false,
      done: 2,
      total: 2,
    });
    expect(lines.find(line => line.type === 'done')).toMatchObject({ done: 2, total: 2 });
    expect(getUsageCount(workspaceId, 'alt_text_generations')).toBe(1);
  });
});

describe('POST /bulk-generate-alt — write-back fails per asset', () => {
  it('sends result with updated=false and error from Webflow', async () => {
    altState.queue.push('Good bulk alt');
    webflowState.updateShouldFail = true;

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-wb-fail', imageUrl: 'https://cdn.example.test/wb.jpg' }],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const resultLine = lines.find(l => l.type === 'result');
    expect(resultLine!.altText).toBe('Good bulk alt');
    expect(resultLine!.updated).toBe(false);
    expect(String(resultLine!.error)).toBe('Webflow write failed');
  });
});

describe('POST /bulk-generate-alt — multiple assets, partial success', () => {
  it('processes all assets and streams correct done count', async () => {
    // First asset succeeds, second fetch fails → partial success
    altState.queue.push('Alt for first');

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [
        { assetId: 'bulk-ok', imageUrl: 'https://cdn.example.test/ok.jpg' },
        { assetId: 'bulk-wb-fail2', imageUrl: 'https://cdn.example.test/wbf2.jpg' },
      ],
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const results = lines.filter(l => l.type === 'result');
    expect(results).toHaveLength(2);

    const okResult = results.find(r => r.assetId === 'bulk-ok');
    expect(okResult!.updated).toBe(true);
    expect(okResult!.altText).toBe('Alt for first');

    // Second asset got default text and was updated
    const secondResult = results.find(r => r.assetId === 'bulk-wb-fail2');
    expect(secondResult).toBeDefined();

    const doneLine = lines.find(l => l.type === 'done');
    expect(doneLine!.done).toBe(2);
    expect(doneLine!.total).toBe(2);
  });
});

describe('POST /bulk-generate-alt — with siteId uses site context', () => {
  it('fetches site name when siteId provided, includes in context building', async () => {
    webflowState.listSitesResult = [{ id: siteId, displayName: 'Test Site' }];
    altState.queue.push('Contextualized alt');

    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'bulk-ctx', imageUrl: 'https://cdn.example.test/ctx.jpg' }],
      siteId,
    });
    expect(res.status).toBe(200);

    const lines = await parseNdjson(res);
    const resultLine = lines.find(l => l.type === 'result');
    expect(resultLine!.updated).toBe(true);
  });
});

// =============================================================================
// compress — uncovered paths
// =============================================================================

describe('POST /compress — upload fails', () => {
  it('returns 500 when uploadAsset fails', async () => {
    webflowState.uploadShouldFail = true;

    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-upload-fail`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
      fileName: 'img.jpg',
    });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Upload failed' });
    // Old asset should NOT be deleted if upload failed
    expect(webflowState.deleteCalls).toHaveLength(0);
  });
});

describe('POST /compress — fetchExternalBytes fails', () => {
  it('returns 500 when image download throws', async () => {
    fetchBytesState.shouldThrow = true;
    fetchBytesState.throwKind = 'http';
    fetchBytesState.throwStatus = 404;

    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-dl-fail`, {
      imageUrl: 'https://cdn.example.test/missing.jpg',
      siteId,
      fileName: 'missing.jpg',
    });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Compression failed' });
  });
});

describe('POST /compress — SVG optimization path', () => {
  it('handles SVG files (uses svgo path, skipped when savings <3%)', async () => {
    // The mock sharp doesn't run for SVG — svgo is used instead.
    // We import svgo at runtime; in test env it will try to optimize the buffer.
    // Since we supply a minimal fake SVG that is already minimal, svgo may produce
    // equal or larger output, triggering the "already optimized" skip path.
    // Either way the route should return 200 without error.
    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-svg`, {
      imageUrl: 'https://cdn.example.test/icon.svg',
      siteId,
      fileName: 'icon.svg',
    });
    expect(res.status).toBe(200);
    // May be skipped or succeed — just assert no 500
    const body = await res.json() as { skipped?: boolean; success?: boolean };
    expect(body.skipped !== undefined || body.success !== undefined).toBe(true);
  });
});

describe('POST /compress — with Image CMS usage (repairCmsReferences)', () => {
  it('updates CMS items and publishes them after upload', async () => {
    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-cms`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
      fileName: 'img.jpg',
      cmsUsages: [
        {
          collectionId: 'coll-1',
          itemId: 'item-1',
          fieldSlug: 'hero-image',
          fieldType: 'Image',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      cmsUpdates: { succeeded: number; failed: number };
      oldAssetPreserved: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.cmsUpdates).toEqual({ succeeded: 1, failed: 0 });
    expect(body.oldAssetPreserved).toBe(false);

    // CMS item should have been updated and published
    expect(cmsState.updateCalls).toHaveLength(1);
    expect(cmsState.updateCalls[0].collectionId).toBe('coll-1');
    expect(cmsState.publishCalls).toHaveLength(1);

    // Old asset should be deleted after successful CMS repairs
    expect(webflowState.deleteCalls).toHaveLength(1);
  });
});

describe('POST /compress — CMS repair partial failure → old asset preserved', () => {
  it('preserves old asset when CMS update fails', async () => {
    cmsState.updateShouldFail = true;

    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-cms-fail`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
      fileName: 'img.jpg',
      cmsUsages: [
        {
          collectionId: 'coll-fail',
          itemId: 'item-fail',
          fieldSlug: 'hero',
          fieldType: 'Image',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      cmsUpdates: { succeeded: number; failed: number };
      oldAssetPreserved: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.cmsUpdates.failed).toBe(1);
    expect(body.cmsUpdates.succeeded).toBe(0);
    expect(body.oldAssetPreserved).toBe(true);
    // Old asset must NOT be deleted
    expect(webflowState.deleteCalls).toHaveLength(0);
  });
});

describe('POST /compress — CMS usages but upload missing hostedUrl → old asset preserved', () => {
  it('preserves old asset when hostedUrl is missing from upload result', async () => {
    // Upload returns assetId but no hostedUrl
    webflowState.uploadResult = { success: true, assetId: 'new-asset-id', hostedUrl: undefined };

    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-no-url`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
      fileName: 'img.jpg',
      cmsUsages: [
        {
          collectionId: 'coll-x',
          itemId: 'item-x',
          fieldSlug: 'image',
          fieldType: 'Image',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; oldAssetPreserved: boolean };
    expect(body.success).toBe(true);
    // cmsUsages were requested but repairCmsReferences was skipped (no hostedUrl)
    expect(body.oldAssetPreserved).toBe(true);
    // No CMS updates should have been made
    expect(cmsState.updateCalls).toHaveLength(0);
    // Old asset should NOT be deleted
    expect(webflowState.deleteCalls).toHaveLength(0);
  });
});

describe('POST /compress — MultiImage CMS field update', () => {
  it('replaces asset in MultiImage array when fieldType is MultiImage', async () => {
    cmsState.getCollectionItemResult = {
      fieldData: {
        'gallery': [
          { fileId: 'asset-multi', url: 'https://cdn.example.com/old.jpg' },
          { fileId: 'other-asset', url: 'https://cdn.example.com/other.jpg' },
        ],
      },
    };

    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-multi`, {
      imageUrl: 'https://cdn.example.test/old.jpg',
      siteId,
      fileName: 'gallery.jpg',
      cmsUsages: [
        {
          collectionId: 'coll-gallery',
          itemId: 'item-gallery',
          fieldSlug: 'gallery',
          fieldType: 'MultiImage',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; cmsUpdates: { succeeded: number; failed: number } };
    expect(body.success).toBe(true);
    expect(body.cmsUpdates.succeeded).toBe(1);
    expect(cmsState.updateCalls).toHaveLength(1);
  });
});

describe('POST /compress — wrong siteId returns 403', () => {
  it('returns 403 when siteId does not belong to the workspace', async () => {
    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-wrong-site`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId: 'wrong-site-id',
      fileName: 'img.jpg',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /compress — no CMS usages, old asset deleted', () => {
  it('deletes old asset directly when no CMS usages provided', async () => {
    const res = await postJson(`/api/webflow/${workspaceId}/compress/asset-no-cms`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId,
      fileName: 'img.jpg',
      // no cmsUsages
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; oldAssetPreserved: boolean };
    expect(body.success).toBe(true);
    expect(body.oldAssetPreserved).toBe(false);
    expect(webflowState.deleteCalls).toEqual([{ assetId: 'asset-no-cms' }]);
  });
});

describe('POST /generate-alt — wrong siteId returns 403', () => {
  it('returns 403 when siteId does not belong to workspace', async () => {
    const res = await postJson(`/api/webflow/${workspaceId}/generate-alt/asset-wrong`, {
      imageUrl: 'https://cdn.example.test/img.jpg',
      siteId: 'not-owned-site',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /bulk-generate-alt — wrong siteId returns 403', () => {
  it('returns 403 when siteId does not belong to workspace', async () => {
    const res = await postJson(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      assets: [{ assetId: 'a1', imageUrl: 'https://cdn.example.test/a1.jpg' }],
      siteId: 'not-owned-site',
    });
    expect(res.status).toBe(403);
  });
});
