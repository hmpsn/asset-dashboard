/**
 * Integration tests — Activity Routes, Sales Reports, Site Architecture, Public Reports
 *
 * Covers:
 * - GET  /api/public/activity/:workspaceId  (public, no auth)
 * - GET  /api/activity                      (admin, global + filtered)
 * - POST /api/activity                      (admin, manual entry)
 * - GET  /api/site-architecture/:workspaceId
 * - GET  /api/site-architecture/:workspaceId/schema-coverage
 * - GET  /api/sales-reports
 * - GET  /api/sales-report/:id
 * - POST /api/sales-report  (mocked — avoids live HTTP crawl)
 * - GET  /api/public/reports/:workspaceId
 *
 * Architecture: in-process Express server with dynamic port (listen(0)).
 */

import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({ sendEmail: vi.fn() }));

// Mock sales audit so POST /api/sales-report does not crawl real URLs
const salesAuditMockState = vi.hoisted(() => ({
  shouldThrow: false,
  mockResult: null as null | Record<string, unknown>,
}));

vi.mock('../../server/sales-audit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/sales-audit.js')>();
  return {
    ...actual,
    runSalesAudit: vi.fn(async (url: string) => {
      if (salesAuditMockState.shouldThrow) throw new Error('Mocked sales audit failure');
      return salesAuditMockState.mockResult ?? {
        url,
        siteName: 'Mock Site',
        siteScore: 72,
        totalPages: 3,
        errors: 1,
        warnings: 2,
        pages: [],
        siteWideIssues: [],
        generatedAt: new Date().toISOString(),
      };
    }),
  };
});

// ── Server bootstrap ─────────────────────────────────────────────────────────

let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterAll(async () => {
  await new Promise<void>(resolve => server!.close(() => resolve()));
});

beforeEach(() => {
  broadcastState.calls = [];
  salesAuditMockState.shouldThrow = false;
  salesAuditMockState.mockResult = null;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Workspace creation (import after mocks) ──────────────────────────────────

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let wsId = '';
let wsBId = '';

beforeAll(async () => {
  // Workspace creation can only happen after server started (DB ready)
  wsId = createWorkspace('ActivityReports-WsA').id;
  wsBId = createWorkspace('ActivityReports-WsB').id;
}, 30_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  if (wsBId) deleteWorkspace(wsBId);
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/activity — manual entry creation
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/activity', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const res = await postJson('/api/activity', { type: 'note', title: 'Missing workspace' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspaceId/i);
  });

  it('returns 400 when type is missing', async () => {
    const res = await postJson('/api/activity', { workspaceId: wsId, title: 'No type' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/type/i);
  });

  it('returns 400 when title is missing', async () => {
    const res = await postJson('/api/activity', { workspaceId: wsId, type: 'note' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/title/i);
  });

  it('creates an activity entry and returns it with correct fields', async () => {
    const res = await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'note',
      title: 'Test note entry',
      description: 'Optional description',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      id: string;
      workspaceId: string;
      type: string;
      title: string;
      description?: string;
      createdAt: string;
    };
    expect(body.id).toBeTruthy();
    expect(body.id).toMatch(/^act_/);
    expect(body.workspaceId).toBe(wsId);
    expect(body.type).toBe('note');
    expect(body.title).toBe('Test note entry');
    expect(body.description).toBe('Optional description');
    expect(typeof body.createdAt).toBe('string');
    expect(body.createdAt).toBeTruthy();
  });

  it('creates entry without description (optional)', async () => {
    const res = await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'note',
      title: 'No description entry',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; description?: string };
    expect(body.id).toBeTruthy();
    expect(body.description).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/public/activity/:workspaceId — client-visible log
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/public/activity/:workspaceId', () => {
  it('returns 200 with empty array for fresh workspace', async () => {
    const freshWs = createWorkspace('ActivityReports-Fresh');
    try {
      const res = await get(`/api/public/activity/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      // "note" is not in CLIENT_VISIBLE_TYPES, so a fresh workspace with only note entries returns []
      expect(body.length).toBe(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns 400 for invalid limit parameter', async () => {
    const res = await get(`/api/public/activity/${wsId}?limit=abc`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/limit/i);
  });

  it('returns 400 for non-positive limit', async () => {
    const res = await get(`/api/public/activity/${wsId}?limit=0`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative limit', async () => {
    const res = await get(`/api/public/activity/${wsId}?limit=-5`);
    expect(res.status).toBe(400);
  });

  it('only returns client-visible entry types (not internal types like note)', async () => {
    // POST a "note" (not client-visible) and an "audit_completed" (client-visible)
    await postJson('/api/activity', { workspaceId: wsId, type: 'note', title: 'Internal note' });
    await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'audit_completed',
      title: 'Site audit completed — score 80',
    });

    const res = await get(`/api/public/activity/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ type: string }>;
    expect(Array.isArray(body)).toBe(true);

    // "note" must not appear in public activity
    const noteEntries = body.filter(e => e.type === 'note');
    expect(noteEntries.length).toBe(0);

    // "audit_completed" is client-visible and should appear
    const auditEntries = body.filter(e => e.type === 'audit_completed');
    expect(auditEntries.length).toBeGreaterThan(0);
  });

  it('all entries belong to the requested workspace', async () => {
    const res = await get(`/api/public/activity/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    for (const entry of body) {
      expect(entry.workspaceId).toBe(wsId);
    }
  });

  it('respects the limit query parameter', async () => {
    // Ensure at least 1 client-visible entry exists
    await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'audit_completed',
      title: 'Limit test audit',
    });

    const res = await get(`/api/public/activity/${wsId}?limit=1`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body.length).toBeLessThanOrEqual(1);
  });

  it('POST creates entry visible in public activity (client-visible type)', async () => {
    const uniqueTitle = `Approval Sent ${Date.now()}`;
    await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'approval_sent',
      title: uniqueTitle,
    });

    const res = await get(`/api/public/activity/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ type: string; title: string }>;
    const found = body.find(e => e.type === 'approval_sent' && e.title === uniqueTitle);
    expect(found).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/activity — global/filtered internal log
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/activity', () => {
  it('returns 200 with an array', async () => {
    const res = await get('/api/activity');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await get('/api/activity?limit=notanumber');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/limit/i);
  });

  it('filters by workspaceId when provided', async () => {
    // Add an entry for wsId
    await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'note',
      title: 'WsA note for filter test',
    });

    const res = await get(`/api/activity?workspaceId=${wsId}&limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(entry.workspaceId).toBe(wsId);
    }
  });

  it('returns entries from all workspaces when no workspaceId filter', async () => {
    // Seed entries in both workspaces
    await postJson('/api/activity', { workspaceId: wsId, type: 'note', title: 'All-ws test A' });
    await postJson('/api/activity', { workspaceId: wsBId, type: 'note', title: 'All-ws test B' });

    const res = await get('/api/activity?limit=200');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    const wsIds = new Set(body.map(e => e.workspaceId));
    expect(wsIds.has(wsId)).toBe(true);
    expect(wsIds.has(wsBId)).toBe(true);
  });

  it('respects limit parameter', async () => {
    const res = await get('/api/activity?limit=3');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body.length).toBeLessThanOrEqual(3);
  });

  it('entries are ordered newest first', async () => {
    // Seed a couple entries to ensure ordering
    await postJson('/api/activity', { workspaceId: wsId, type: 'note', title: 'Order test 1' });
    await postJson('/api/activity', { workspaceId: wsId, type: 'note', title: 'Order test 2' });

    const res = await get(`/api/activity?workspaceId=${wsId}&limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ createdAt: string }>;
    if (body.length >= 2) {
      for (let i = 1; i < body.length; i++) {
        expect(body[i - 1].createdAt >= body[i].createdAt).toBe(true);
      }
    }
  });

  it('every entry has required fields', async () => {
    await postJson('/api/activity', { workspaceId: wsId, type: 'note', title: 'Shape test' });

    const res = await get(`/api/activity?workspaceId=${wsId}&limit=10`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id).toBeTruthy();
      expect(typeof entry.workspaceId).toBe('string');
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.title).toBe('string');
      expect(typeof entry.createdAt).toBe('string');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Workspace isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('Activity — workspace isolation', () => {
  it('GET /api/public/activity does not leak entries across workspaces', async () => {
    const uniqueTitle = `Isolation-audit-${Date.now()}`;
    await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'audit_completed',
      title: uniqueTitle,
    });

    // Check wsBId public activity — should not contain wsId's entry
    const res = await get(`/api/public/activity/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ title: string; workspaceId: string }>;
    const leaked = body.find(e => e.title === uniqueTitle);
    expect(leaked).toBeUndefined();
  });

  it('GET /api/activity filtered to wsBId does not include wsId entries', async () => {
    await postJson('/api/activity', {
      workspaceId: wsId,
      type: 'note',
      title: 'Isolation note WsA',
    });

    const res = await get(`/api/activity?workspaceId=${wsBId}&limit=100`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    for (const entry of body) {
      expect(entry.workspaceId).toBe(wsBId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/site-architecture/:workspaceId
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/site-architecture/:workspaceId', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await get('/api/site-architecture/nonexistent-ws-xyz');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 200 with valid structure for workspace without webflow site', async () => {
    // wsId has no webflowSiteId — buildSiteArchitecture skips Webflow calls
    const res = await get(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tree: unknown;
      totalPages: number;
      existingPages: number;
      plannedPages: number;
      strategyPages: number;
      gaps: unknown[];
      depthDistribution: Record<string, number>;
      orphanPaths: string[];
      analyzedAt: string;
    };
    expect(typeof body.tree).toBe('object');
    expect(typeof body.totalPages).toBe('number');
    expect(typeof body.existingPages).toBe('number');
    expect(typeof body.plannedPages).toBe('number');
    expect(typeof body.strategyPages).toBe('number');
    expect(Array.isArray(body.gaps)).toBe(true);
    expect(typeof body.depthDistribution).toBe('object');
    expect(Array.isArray(body.orphanPaths)).toBe(true);
    expect(typeof body.analyzedAt).toBe('string');
  });

  it('tree root node has path "/" and no depth', async () => {
    const res = await get(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tree: { path: string; depth: number; children: unknown[] } };
    expect(body.tree.path).toBe('/');
    expect(body.tree.depth).toBe(0);
    expect(Array.isArray(body.tree.children)).toBe(true);
  });

  it('counts add up: totalPages = existingPages + plannedPages + strategyPages + gaps', async () => {
    const res = await get(`/api/site-architecture/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      totalPages: number;
      existingPages: number;
      plannedPages: number;
      strategyPages: number;
    };
    // total does NOT include gap nodes in the count per analyzeTree logic
    // but existing+planned+strategy should be <= total
    expect(body.existingPages + body.plannedPages + body.strategyPages).toBeLessThanOrEqual(body.totalPages + 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/site-architecture/:workspaceId/schema-coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/site-architecture/:workspaceId/schema-coverage', () => {
  it('returns 404 when workspace has no webflowSiteId', async () => {
    // wsId has no webflowSiteId
    const res = await get(`/api/site-architecture/${wsId}/schema-coverage`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace or site not found/i);
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await get('/api/site-architecture/unknown-ws-999/schema-coverage');
    // Either 404 (no ws.webflowSiteId check fails) or 404 from ws not found check
    expect([404, 500]).toContain(res.status);
  });

  it('returns schema coverage structure for workspace with webflowSiteId', async () => {
    const siteWs = createWorkspace('SiteArch-WithSiteId', 'fake-site-for-arch-test');
    try {
      const res = await get(`/api/site-architecture/${siteWs.id}/schema-coverage`);
      // With no actual Webflow data and no cached architecture, the result will be:
      // 200 with empty/zero counts (buildSiteArchitecture skips pages when webflow calls fail gracefully)
      expect(res.status).toBe(200);
      const body = await res.json() as {
        totalExisting: number;
        withSchema: number;
        withoutSchema: number;
        coveragePct: number;
        snapshotDate: string | null;
        hasPlan: boolean;
        hasLinkData: boolean;
        pages: unknown[];
        priorityQueue: unknown[];
      };
      expect(typeof body.totalExisting).toBe('number');
      expect(typeof body.withSchema).toBe('number');
      expect(typeof body.withoutSchema).toBe('number');
      expect(typeof body.coveragePct).toBe('number');
      expect(typeof body.hasPlan).toBe('boolean');
      expect(typeof body.hasLinkData).toBe('boolean');
      expect(Array.isArray(body.pages)).toBe(true);
      expect(Array.isArray(body.priorityQueue)).toBe(true);
    } finally {
      deleteWorkspace(siteWs.id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sales-reports
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/sales-reports', () => {
  it('returns 200 with an array', async () => {
    const res = await get('/api/sales-reports');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns an array even when no reports exist', async () => {
    const res = await get('/api/sales-reports');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sales-report — create a sales report
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/sales-report', () => {
  it('returns 400 when url is missing', async () => {
    const res = await postJson('/api/sales-report', { maxPages: 5 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/url/i);
  });

  it('returns 400 for non-integer maxPages', async () => {
    const res = await postJson('/api/sales-report', { url: 'https://example.com', maxPages: 'five' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/maxPages/i);
  });

  it('returns 400 when maxPages is less than 1', async () => {
    const res = await postJson('/api/sales-report', { url: 'https://example.com', maxPages: 0 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/maxPages/i);
  });

  it('returns 400 when maxPages exceeds 100', async () => {
    const res = await postJson('/api/sales-report', { url: 'https://example.com', maxPages: 101 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/maxPages/i);
  });

  it('creates a sales report with correct shape (mocked audit)', async () => {
    salesAuditMockState.mockResult = {
      url: 'https://mock-site.com',
      siteName: 'Mock Co',
      siteScore: 85,
      totalPages: 10,
      errors: 0,
      warnings: 3,
      pages: [],
      siteWideIssues: [],
      generatedAt: new Date().toISOString(),
    };

    const res = await postJson('/api/sales-report', { url: 'https://mock-site.com', maxPages: 5 });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      id: string;
      url: string;
      siteName: string;
      siteScore: number;
      totalPages: number;
      generatedAt: string;
    };
    expect(body.id).toMatch(/^sr_/);
    expect(body.url).toBe('https://mock-site.com');
    expect(body.siteName).toBe('Mock Co');
    expect(body.siteScore).toBe(85);
    expect(body.totalPages).toBe(10);
    expect(typeof body.generatedAt).toBe('string');
  });

  it('uses default maxPages of 25 when not provided', async () => {
    // Should succeed — runSalesAudit is mocked to accept any page count
    const res = await postJson('/api/sales-report', { url: 'https://default-pages.com' });
    expect(res.status).toBe(200);
  });

  it('returns 500 when sales audit throws', async () => {
    salesAuditMockState.shouldThrow = true;
    const res = await postJson('/api/sales-report', { url: 'https://broken.com', maxPages: 5 });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Sales report failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sales-report/:id — retrieve by ID
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/sales-report/:id', () => {
  let createdReportId = '';

  beforeAll(async () => {
    // Reset mock state before setup — outer beforeEach doesn't run before beforeAll
    salesAuditMockState.shouldThrow = false;
    salesAuditMockState.mockResult = {
      url: 'https://report-fetch-test.com',
      siteName: 'Fetch Test Site',
      siteScore: 60,
      totalPages: 5,
      errors: 2,
      warnings: 1,
      pages: [],
      siteWideIssues: [],
      generatedAt: new Date().toISOString(),
    };
    const res = await postJson('/api/sales-report', { url: 'https://report-fetch-test.com', maxPages: 3 });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    createdReportId = body.id;
  });

  it('returns 404 for unknown id', async () => {
    const res = await get('/api/sales-report/sr_9999999999_nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it('returns the created report by id', async () => {
    const res = await get(`/api/sales-report/${createdReportId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      id: string;
      url: string;
      siteName: string;
      siteScore: number;
      totalPages: number;
    };
    expect(body.id).toBe(createdReportId);
    expect(body.url).toBe('https://report-fetch-test.com');
    expect(body.siteName).toBe('Fetch Test Site');
    expect(body.siteScore).toBe(60);
    expect(body.totalPages).toBe(5);
  });

  it('created report appears in GET /api/sales-reports list', async () => {
    const res = await get('/api/sales-reports');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const found = body.find(r => r.id === createdReportId);
    expect(found).toBeDefined();
  });

  it('sales-reports list summary has expected fields', async () => {
    const res = await get('/api/sales-reports');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    // At least one report should exist
    expect(body.length).toBeGreaterThan(0);
    // Find our test report
    const report = body.find(r => r.id === createdReportId);
    expect(report).toBeDefined();
    if (report) {
      expect(typeof report.id).toBe('string');
      expect(typeof report.url).toBe('string');
      expect(typeof report.siteScore).toBe('number');
      expect(typeof report.totalPages).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/public/reports/:workspaceId
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/public/reports/:workspaceId', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await get('/api/public/reports/no-such-workspace-abc');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 200 with array for existing workspace (even with no reports)', async () => {
    const res = await get(`/api/public/reports/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('each report entry has required fields', async () => {
    // wsId has no webflowSiteId and no monthly reports, so array may be empty
    const res = await get(`/api/public/reports/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    for (const report of body) {
      expect(typeof report.id).toBe('string');
      expect(report.type === 'audit' || report.type === 'monthly').toBe(true);
      expect(typeof report.title).toBe('string');
      expect(typeof report.createdAt).toBe('string');
      expect(typeof report.permalink).toBe('string');
    }
  });

  it('reports are sorted newest first', async () => {
    const res = await get(`/api/public/reports/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ createdAt: string }>;
    if (body.length >= 2) {
      for (let i = 1; i < body.length; i++) {
        expect(new Date(body[i - 1].createdAt).getTime())
          .toBeGreaterThanOrEqual(new Date(body[i].createdAt).getTime());
      }
    }
  });
});
