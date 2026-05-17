import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const nativeFetch = globalThis.fetch;

const altState = vi.hoisted(() => ({
  queue: [] as Array<string | null>,
}));

const webflowState = vi.hoisted(() => ({
  updateCalls: [] as Array<{ assetId: string; altText?: string }>,
  updateShouldFail: false,
  uploadCalls: [] as Array<{ siteId: string; fileName: string; altText?: string }>,
  deleteCalls: [] as Array<{ assetId: string }>,
}));

vi.mock('../../server/alttext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/alttext.js')>();
  return {
    ...actual,
    generateAltText: vi.fn(async () => altState.queue.shift() ?? 'Fallback alt text'),
  };
});

vi.mock('../../server/workspace-intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildWorkspaceIntelligence: vi.fn(async () => ({
      seoContext: {
        businessContext: 'Test business context',
        effectiveBrandVoiceBlock: '',
      },
    })),
  };
});

vi.mock('../../server/external-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/external-fetch.js')>();
  return {
    ...actual,
    fetchExternalBytes: vi.fn(async () => new Uint8Array(Buffer.alloc(1200))),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    listSites: vi.fn(async () => []),
    getPageDom: vi.fn(async () => '<html></html>'),
    updateAsset: vi.fn(async (assetId: string, payload: { altText?: string }) => {
      webflowState.updateCalls.push({ assetId, altText: payload.altText });
      if (webflowState.updateShouldFail) {
        return { success: false, error: 'Webflow write failed' };
      }
      return { success: true };
    }),
    uploadAsset: vi.fn(async (siteId: string, _tmpPath: string, fileName: string, altText?: string) => {
      webflowState.uploadCalls.push({ siteId, fileName, altText });
      return { success: true, assetId: `new-${fileName}`, hostedUrl: `https://cdn.example.com/new-${fileName}` };
    }),
    deleteAsset: vi.fn(async (assetId: string) => {
      webflowState.deleteCalls.push({ assetId });
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
  await new Promise<void>((resolve) => server!.listen(0, resolve));
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

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${path}`, opts);
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

beforeEach(() => {
  const ws = createWorkspace('Webflow Alt Routes Test Workspace', 'wf-alt-routes-site', 'Alt Routes Site');
  workspaceId = ws.id;
  siteId = ws.webflowSiteId!;
  updateWorkspace(workspaceId, { webflowToken: 'wf-alt-routes-token' });
  updateWorkspace(workspaceId, { tier: 'premium' });

  altState.queue = [];
  webflowState.updateCalls = [];
  webflowState.updateShouldFail = false;
  webflowState.uploadCalls = [];
  webflowState.deleteCalls = [];
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

afterEach(() => {
  if (workspaceId) {
    deleteWorkspace(workspaceId);
    workspaceId = '';
    siteId = '';
  }
});

describe('webflow-alt-text routes', () => {
  it('POST /generate-alt requires imageUrl', async () => {
    const res = await api(`/api/webflow/${workspaceId}/generate-alt/asset-1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'imageUrl required' });
  });

  it('POST /generate-alt returns alt text and marks update success', async () => {
    altState.queue.push('Homepage hero banner with CTA');

    const res = await api(`/api/webflow/${workspaceId}/generate-alt/asset-2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://cdn.example.test/hero.jpg', siteId }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ altText: 'Homepage hero banner with CTA', updated: true });
    expect(webflowState.updateCalls).toEqual([{ assetId: 'asset-2', altText: 'Homepage hero banner with CTA' }]);
  });

  it('POST /generate-alt returns updated=false when Webflow write-back fails', async () => {
    altState.queue.push('Product screenshot with pricing cards');
    webflowState.updateShouldFail = true;

    const res = await api(`/api/webflow/${workspaceId}/generate-alt/asset-3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://cdn.example.test/pricing.jpg', siteId }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      altText: 'Product screenshot with pricing cards',
      updated: false,
      writeError: 'Webflow write failed',
    });
  });

  it('POST /bulk-generate-alt requires assets array', async () => {
    const res = await api(`/api/webflow/${workspaceId}/bulk-generate-alt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: [], siteId }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'assets required' });
  });

  it('POST /compress/:assetId requires imageUrl and siteId', async () => {
    const res = await api(`/api/webflow/${workspaceId}/compress/asset-4`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://cdn.example.test/asset-4.jpg' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'imageUrl and siteId required' });
  });

  it('POST /compress/:assetId uploads optimized asset and deletes old asset', async () => {
    const res = await api(`/api/webflow/${workspaceId}/compress/asset-5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: 'https://cdn.example.test/asset-5.jpg',
        siteId,
        altText: 'Compressed image alt',
        fileName: 'asset-5.jpg',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      newAssetId: 'new-asset-5.jpg',
      newFileName: 'asset-5.jpg',
      oldAssetPreserved: false,
    });
    expect(webflowState.uploadCalls).toHaveLength(1);
    expect(webflowState.deleteCalls).toEqual([{ assetId: 'asset-5' }]);
  });
});
