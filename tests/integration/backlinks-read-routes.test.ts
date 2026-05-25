/**
 * Integration tests for GET /api/backlinks/:workspaceId — DB-layer only paths.
 *
 * The backlinks route delegates to a SEO data provider. These tests cover only
 * the paths that are resolved before any external API call is made:
 *   - Unknown workspace → 404
 *   - No SEO provider configured → 503
 *   - Workspace with no domain → 400
 *
 * External provider calls (getBacklinksOverview, getReferringDomains) are NOT
 * exercised here — see backlinks-routes.test.ts for full provider scenarios.
 *
 * Uses in-process HTTP via createApp() + http.createServer() with vi.mock
 * to control getBacklinksProvider return values.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { SeoDataProvider } from '../../server/seo-data-provider.js';

// ---------------------------------------------------------------------------
// Module mocks — hoisted before all imports by Vitest
// ---------------------------------------------------------------------------

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

let mockProviderRef: SeoDataProvider | null = null;

vi.mock('../../server/seo-data-provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getBacklinksProvider: vi.fn(() => mockProviderRef),
  };
});

// ---------------------------------------------------------------------------
// In-process server helpers
// ---------------------------------------------------------------------------

let sharedServer: http.Server | null = null;
let sharedBaseUrl = '';

async function startSharedServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  sharedServer = http.createServer(app);
  await new Promise<void>((resolve) => sharedServer!.listen(0, '127.0.0.1', resolve));
  const { port } = sharedServer.address() as AddressInfo;
  sharedBaseUrl = `http://127.0.0.1:${port}`;
}

async function getJson(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${sharedBaseUrl}${path}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function makeStubProvider(): SeoDataProvider {
  return {
    name: 'semrush',
    isConfigured: vi.fn(() => true),
    getKeywordMetrics: vi.fn(async () => []),
    getRelatedKeywords: vi.fn(async () => []),
    getQuestionKeywords: vi.fn(async () => []),
    getDomainKeywords: vi.fn(async () => []),
    getDomainOverview: vi.fn(async () => null),
    getCompetitors: vi.fn(async () => []),
    getKeywordGap: vi.fn(async () => []),
    getBacklinksOverview: vi.fn(async () => null),
    getReferringDomains: vi.fn(async () => []),
  } as unknown as SeoDataProvider;
}

let ws: SeededFullWorkspace;

beforeAll(async () => {
  await startSharedServer();
  ws = seedWorkspace();
}, 30_000);

afterAll(() => {
  ws.cleanup();
  sharedServer?.close();
  sharedServer = null;
});

beforeEach(() => {
  mockProviderRef = null;
});

// ---------------------------------------------------------------------------
// Unknown workspace → 404
// ---------------------------------------------------------------------------

describe('GET /api/backlinks/:workspaceId — unknown workspace', () => {
  it('returns 404 for a workspace that does not exist', async () => {
    mockProviderRef = makeStubProvider();

    const { status, body } = await getJson('/api/backlinks/totally-unknown-workspace-id');
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// No SEO provider configured → 503
// ---------------------------------------------------------------------------

describe('GET /api/backlinks/:workspaceId — no provider configured', () => {
  it('returns 503 when getBacklinksProvider returns null', async () => {
    mockProviderRef = null; // explicitly no provider

    const { status, body } = await getJson(`/api/backlinks/${ws.workspaceId}`);
    expect(status).toBe(503);
    const b = body as Record<string, unknown>;
    expect(typeof b.error).toBe('string');
    expect((b.error as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Workspace with no domain → 400
// ---------------------------------------------------------------------------

describe('GET /api/backlinks/:workspaceId — workspace with no domain', () => {
  let noDomainWsId: string;

  beforeAll(async () => {
    const db = (await import('../../server/db/index.js')).default;
    const { randomUUID } = await import('crypto');
    const suffix = randomUUID().slice(0, 8);
    noDomainWsId = `test-nodomain2-${suffix}`;

    db.prepare(`
      INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token,
        client_password, live_domain, tier, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      noDomainWsId,
      `No Domain WS2 ${suffix}`,
      `no-domain2-${suffix}`,
      `site-${suffix}`,
      `token-${suffix}`,
      'test-password',
      null, // live_domain explicitly null — no webflowSiteName either
      'free',
      new Date().toISOString(),
    );
  });

  afterAll(async () => {
    const db = (await import('../../server/db/index.js')).default;
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(noDomainWsId);
  });

  it('returns 400 when workspace has no live_domain or webflowSiteName', async () => {
    mockProviderRef = makeStubProvider();

    const { status, body } = await getJson(`/api/backlinks/${noDomainWsId}`);
    expect(status).toBe(400);
    const b = body as Record<string, unknown>;
    expect(typeof b.error).toBe('string');
    expect((b.error as string).length).toBeGreaterThan(0);
  });
});
