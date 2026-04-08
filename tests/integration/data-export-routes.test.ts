/**
 * Integration tests for data-export API endpoints.
 *
 * Tests the full HTTP request/response cycle for all seven export routes:
 *   GET /api/export/:workspaceId/briefs
 *   GET /api/export/:workspaceId/requests
 *   GET /api/export/:workspaceId/activity
 *   GET /api/export/:workspaceId/strategy
 *   GET /api/export/:workspaceId/payments
 *   GET /api/export/:workspaceId/matrices
 *   GET /api/export/:workspaceId/templates
 *
 * Verifies:
 *   - JSON and CSV format switches via ?format= query param
 *   - Column completeness (all expected headers present in CSV)
 *   - Workspace scoping (no cross-workspace data leakage)
 *   - Empty workspace → valid empty export (JSON: [], CSV: headers only)
 *   - Large dataset does not crash the export
 *   - 404 for unknown workspace on routes that require workspace existence
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import { cleanSeedData } from '../global-setup.js';
import db from '../../server/db/index.js';
import { createContentRequest } from '../../server/content-requests.js';
import { addActivity } from '../../server/activity-log.js';
import { createPayment } from '../../server/payments.js';
import { createTemplate } from '../../server/content-templates.js';
import { createMatrix } from '../../server/content-matrices.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertPageKeywordsBatch } from '../../server/page-keywords.js';

const ctx = createTestContext(13305);
const { api } = ctx;

// ─── Test workspace state ────────────────────────────────────────────────────

let wsAId = '';
let wsBId = '';
let cleanupWorkspaces: () => void;

// Track inserted item IDs for assertion
let wsABriefId = '';
let wsARequestId = '';
let wsAPaymentId = '';
let wsATemplateId = '';
let wsAMatrixId = '';

// ─── Expected CSV headers per endpoint ──────────────────────────────────────

const BRIEF_HEADERS = ['id', 'targetKeyword', 'suggestedTitle', 'wordCountTarget', 'intent', 'contentFormat', 'pageType', 'difficultyScore', 'trafficPotential', 'createdAt'];
const REQUEST_HEADERS = ['id', 'topic', 'targetKeyword', 'intent', 'priority', 'status', 'serviceType', 'source', 'requestedAt', 'updatedAt'];
const ACTIVITY_HEADERS = ['id', 'type', 'title', 'description', 'actorName', 'createdAt'];
const STRATEGY_HEADERS = ['pagePath', 'pageTitle', 'primaryKeyword', 'secondaryKeywords'];
const PAYMENT_HEADERS = ['id', 'productType', 'amount', 'currency', 'status', 'createdAt', 'paidAt'];
const MATRIX_HEADERS = ['matrixId', 'matrixName', 'templateId', 'cellId', 'targetKeyword', 'plannedUrl', 'status', 'variableValues', 'volume', 'difficulty', 'cpc', 'briefId', 'postId'];
const TEMPLATE_HEADERS = ['id', 'name', 'pageType', 'urlPattern', 'keywordPattern', 'sectionCount', 'variableCount', 'createdAt', 'updatedAt'];

// ─── CSV parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse CSV text into an array of header-keyed row objects.
 * Handles simple comma-split (no embedded newlines in cells).
 */
function parseCsv(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csv.split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? '';
    }
    return row;
  });
  return { headers, rows };
}

// ─── Seed helpers ────────────────────────────────────────────────────────────

/**
 * Insert a minimal brief row directly via SQLite — avoids calling the
 * async AI-backed generateBrief() function.
 */
function insertBriefDirect(workspaceId: string, keyword: string): string {
  const id = `brief_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_briefs
      (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at,
       executive_summary, content_format, tone_and_style, people_also_ask,
       topical_entities, serp_analysis, difficulty_score, traffic_potential,
       cta_recommendations, eeat_guidance, content_checklist, schema_recommendations,
       page_type, reference_urls, real_people_also_ask, real_top_results,
       keyword_locked, keyword_source, keyword_validation, template_id,
       title_variants, meta_desc_variants)
    VALUES
      (?, ?, ?, '[]', ?, '', '[]', 1200, 'informational', '', '', '[]', ?,
       NULL, 'blog_post', NULL, NULL, NULL, NULL, 45, 'medium',
       NULL, NULL, NULL, NULL, 'blog', NULL, NULL, NULL, 0, NULL, NULL, NULL,
       NULL, NULL)
  `).run(id, workspaceId, keyword, `${keyword} — The Complete Guide`, now);
  return id;
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  const { wsA, wsB, cleanup } = seedTwoWorkspaces();
  wsAId = wsA.workspaceId;
  wsBId = wsB.workspaceId;
  cleanupWorkspaces = cleanup;

  // ── Brief ──────────────────────────────────────────────────────────────────
  wsABriefId = insertBriefDirect(wsAId, 'export-test-keyword');

  // ── Content request ────────────────────────────────────────────────────────
  const req = createContentRequest(wsAId, {
    topic: 'Export Test Topic',
    targetKeyword: 'export-test-content-request-xqz',
    intent: 'informational',
    priority: 'high',
    rationale: 'Created for export route testing',
    source: 'strategy',
  });
  wsARequestId = req.id;

  // ── Activity ───────────────────────────────────────────────────────────────
  addActivity(wsAId, 'audit_completed', 'Export Test Audit', 'Seeded for export test', {}, { name: 'Test Actor' });

  // ── Payment ────────────────────────────────────────────────────────────────
  const payment = createPayment(wsAId, {
    workspaceId: wsAId,
    stripeSessionId: `sess_test_export_${Date.now()}`,
    productType: 'brief_blog',
    amount: 9900,
    currency: 'usd',
    status: 'paid',
    paidAt: new Date().toISOString(),
  });
  wsAPaymentId = payment.id;

  // ── Template ───────────────────────────────────────────────────────────────
  const template = createTemplate(wsAId, {
    name: 'Export Test Template',
    pageType: 'blog',
    urlPattern: '/blog/{topic}',
    keywordPattern: '{topic} guide',
    variables: [{ name: 'topic', label: 'Topic' }],
    sections: [],
  });
  wsATemplateId = template.id;

  // ── Matrix ─────────────────────────────────────────────────────────────────
  const matrix = createMatrix(wsAId, {
    name: 'Export Test Matrix',
    templateId: wsATemplateId,
    dimensions: [{ variableName: 'city', values: ['Austin', 'Denver'] }],
    urlPattern: '/service/{city}',
    keywordPattern: 'service {city}',
  });
  wsAMatrixId = matrix.id;

  // ── Keyword strategy ───────────────────────────────────────────────────────
  // Seed page_keywords table (production-canonical storage for pageMap rows)
  upsertPageKeywordsBatch(wsAId, [
    {
      pagePath: '/blog/export-test',
      pageTitle: 'Export Test Page',
      primaryKeyword: 'export-test-keyword',
      secondaryKeywords: ['secondary-kw-1', 'secondary-kw-2'],
    },
  ]);
  // Also seed the workspace strategy metadata blob (siteKeywords, opportunities, etc.)
  updateWorkspace(wsAId, {
    keywordStrategy: {
      siteKeywords: ['seo', 'content'],
      pageMap: [
        {
          pagePath: '/blog/export-test',
          pageTitle: 'Export Test Page',
          primaryKeyword: 'export-test-keyword',
          secondaryKeywords: ['secondary-kw-1', 'secondary-kw-2'],
        },
      ],
      opportunities: [],
      generatedAt: new Date().toISOString(),
    },
  });
}, 25_000);

afterAll(() => {
  // Clean page_keywords rows (not covered by cleanSeedData since FK enforcement is off in tests)
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(wsAId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(wsBId);
  cleanSeedData(wsAId);
  cleanSeedData(wsBId);
  cleanupWorkspaces();
  ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// Briefs export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/briefs — JSON format', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/export/${wsAId}/briefs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded brief', async () => {
    const res = await api(`/api/export/${wsAId}/briefs`);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.length).toBeGreaterThan(0);
    const ids = body.map(b => b.id);
    expect(ids).toContain(wsABriefId);
  });

  it('sets Content-Type application/json', async () => {
    const res = await api(`/api/export/${wsAId}/briefs`);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('sets Content-Disposition attachment with .json filename', async () => {
    const res = await api(`/api/export/${wsAId}/briefs`);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(/briefs-.*\.json/);
  });
});

describe('GET /api/export/:workspaceId/briefs — CSV format', () => {
  it('returns 200 with text/csv content-type', async () => {
    const res = await api(`/api/export/${wsAId}/briefs?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('sets Content-Disposition attachment with .csv filename', async () => {
    const res = await api(`/api/export/${wsAId}/briefs?format=csv`);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(/briefs-.*\.csv/);
  });

  it('first row contains all expected headers', async () => {
    const res = await api(`/api/export/${wsAId}/briefs?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of BRIEF_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('contains the seeded brief in data rows', async () => {
    const res = await api(`/api/export/${wsAId}/briefs?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map(r => r['id']);
    expect(ids).toContain(wsABriefId);
  });
});

describe('GET /api/export/:workspaceId/briefs — empty workspace', () => {
  it('JSON: returns empty array for workspace with no briefs', async () => {
    const res = await api(`/api/export/${wsBId}/briefs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('CSV: returns only header row for workspace with no briefs', async () => {
    const res = await api(`/api/export/${wsBId}/briefs?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { headers, rows } = parseCsv(text);
    // Headers must still be present
    expect(headers.length).toBeGreaterThan(0);
    for (const expected of BRIEF_HEADERS) {
      expect(headers).toContain(expected);
    }
    // No data rows
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requests export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/requests — JSON format', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/export/${wsAId}/requests`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded request', async () => {
    const res = await api(`/api/export/${wsAId}/requests`);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.length).toBeGreaterThan(0);
    const ids = body.map(r => r.id);
    expect(ids).toContain(wsARequestId);
  });

  it('every item has all expected fields', async () => {
    const res = await api(`/api/export/${wsAId}/requests`);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('topic');
      expect(item).toHaveProperty('targetKeyword');
      expect(item).toHaveProperty('status');
    }
  });
});

describe('GET /api/export/:workspaceId/requests — CSV format', () => {
  it('returns 200 with text/csv', async () => {
    const res = await api(`/api/export/${wsAId}/requests?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('first row contains all expected headers', async () => {
    const res = await api(`/api/export/${wsAId}/requests?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of REQUEST_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('seeded request appears in data rows', async () => {
    const res = await api(`/api/export/${wsAId}/requests?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map(r => r['id']);
    expect(ids).toContain(wsARequestId);
  });
});

describe('GET /api/export/:workspaceId/requests — empty workspace', () => {
  it('JSON: empty array for workspace with no requests', async () => {
    const res = await api(`/api/export/${wsBId}/requests`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('CSV: only headers for workspace with no requests', async () => {
    const res = await api(`/api/export/${wsBId}/requests?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { headers, rows } = parseCsv(text);
    for (const expected of REQUEST_HEADERS) {
      expect(headers).toContain(expected);
    }
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Activity export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/activity — JSON format', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/export/${wsAId}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded activity entry', async () => {
    const res = await api(`/api/export/${wsAId}/activity`);
    const body = await res.json() as Array<{ title: string }>;
    expect(body.length).toBeGreaterThan(0);
    const titles = body.map(e => e.title);
    expect(titles).toContain('Export Test Audit');
  });
});

describe('GET /api/export/:workspaceId/activity — CSV format', () => {
  it('returns 200 with text/csv', async () => {
    const res = await api(`/api/export/${wsAId}/activity?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('first row contains all expected headers', async () => {
    const res = await api(`/api/export/${wsAId}/activity?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of ACTIVITY_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('seeded audit event appears in data rows', async () => {
    const res = await api(`/api/export/${wsAId}/activity?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const titles = rows.map(r => r['title']);
    expect(titles).toContain('Export Test Audit');
  });
});

describe('GET /api/export/:workspaceId/activity — empty workspace', () => {
  it('JSON: empty array for workspace with no activity', async () => {
    const res = await api(`/api/export/${wsBId}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('CSV: only headers for workspace with no activity', async () => {
    const res = await api(`/api/export/${wsBId}/activity?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { headers, rows } = parseCsv(text);
    for (const expected of ACTIVITY_HEADERS) {
      expect(headers).toContain(expected);
    }
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategy export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/strategy — JSON format', () => {
  it('returns 200 with an array of page rows for workspace with strategy', async () => {
    const res = await api(`/api/export/${wsAId}/strategy`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded page map entry', async () => {
    const res = await api(`/api/export/${wsAId}/strategy`);
    const body = await res.json() as Array<{ pagePath: string; primaryKeyword: string }>;
    expect(body.length).toBeGreaterThan(0);
    const paths = body.map(p => p.pagePath);
    expect(paths).toContain('/blog/export-test');
  });

  it('every item has all expected fields', async () => {
    const res = await api(`/api/export/${wsAId}/strategy`);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item).toHaveProperty('pagePath');
      expect(item).toHaveProperty('pageTitle');
      expect(item).toHaveProperty('primaryKeyword');
      expect(item).toHaveProperty('secondaryKeywords');
    }
  });
});

describe('GET /api/export/:workspaceId/strategy — CSV format', () => {
  it('returns 200 with text/csv', async () => {
    const res = await api(`/api/export/${wsAId}/strategy?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('first row contains all expected strategy headers', async () => {
    const res = await api(`/api/export/${wsAId}/strategy?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of STRATEGY_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('seeded page path appears in data rows', async () => {
    const res = await api(`/api/export/${wsAId}/strategy?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const paths = rows.map(r => r['pagePath']);
    expect(paths).toContain('/blog/export-test');
  });
});

describe('GET /api/export/:workspaceId/strategy — workspace with no strategy', () => {
  it('JSON: returns 200 with empty array for workspace with no strategy', async () => {
    const res = await api(`/api/export/${wsBId}/strategy`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

describe('GET /api/export/:workspaceId/strategy — unknown workspace', () => {
  it('returns 404 for non-existent workspace', async () => {
    const res = await api('/api/export/ws_does_not_exist_xyz/strategy');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Payments export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/payments — JSON format', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/export/${wsAId}/payments`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded payment', async () => {
    const res = await api(`/api/export/${wsAId}/payments`);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.length).toBeGreaterThan(0);
    const ids = body.map(p => p.id);
    expect(ids).toContain(wsAPaymentId);
  });

  it('every item has all expected fields', async () => {
    const res = await api(`/api/export/${wsAId}/payments`);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('productType');
      expect(item).toHaveProperty('amount');
      expect(item).toHaveProperty('currency');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('createdAt');
    }
  });
});

describe('GET /api/export/:workspaceId/payments — CSV format', () => {
  it('returns 200 with text/csv', async () => {
    const res = await api(`/api/export/${wsAId}/payments?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('first row contains all expected headers', async () => {
    const res = await api(`/api/export/${wsAId}/payments?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of PAYMENT_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('seeded payment appears in data rows', async () => {
    const res = await api(`/api/export/${wsAId}/payments?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map(r => r['id']);
    expect(ids).toContain(wsAPaymentId);
  });
});

describe('GET /api/export/:workspaceId/payments — empty workspace', () => {
  it('JSON: empty array for workspace with no payments', async () => {
    const res = await api(`/api/export/${wsBId}/payments`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('CSV: only headers for workspace with no payments', async () => {
    const res = await api(`/api/export/${wsBId}/payments?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { headers, rows } = parseCsv(text);
    for (const expected of PAYMENT_HEADERS) {
      expect(headers).toContain(expected);
    }
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Matrices export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/matrices — JSON format', () => {
  it('returns 200 with an array (flattened cells)', async () => {
    const res = await api(`/api/export/${wsAId}/matrices`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains cells belonging to the seeded matrix', async () => {
    const res = await api(`/api/export/${wsAId}/matrices`);
    const body = await res.json() as Array<{ matrixId: string }>;
    expect(body.length).toBeGreaterThan(0);
    const matrixIds = body.map(c => c.matrixId);
    // Every cell in the export should reference the seeded matrix
    const hasSeedMatrix = matrixIds.some(id => id === wsAMatrixId);
    expect(hasSeedMatrix).toBe(true);
  });

  it('every cell row has all expected fields', async () => {
    const res = await api(`/api/export/${wsAId}/matrices`);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const cell of body) {
      expect(cell).toHaveProperty('matrixId');
      expect(cell).toHaveProperty('matrixName');
      expect(cell).toHaveProperty('templateId');
      expect(cell).toHaveProperty('cellId');
      expect(cell).toHaveProperty('targetKeyword');
      expect(cell).toHaveProperty('plannedUrl');
      expect(cell).toHaveProperty('status');
    }
  });
});

describe('GET /api/export/:workspaceId/matrices — CSV format', () => {
  it('returns 200 with text/csv', async () => {
    const res = await api(`/api/export/${wsAId}/matrices?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('first row contains all expected headers', async () => {
    const res = await api(`/api/export/${wsAId}/matrices?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of MATRIX_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('data rows reference the seeded matrix id', async () => {
    const res = await api(`/api/export/${wsAId}/matrices?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const matrixIds = rows.map(r => r['matrixId']);
    expect(matrixIds).toContain(wsAMatrixId);
  });
});

describe('GET /api/export/:workspaceId/matrices — empty workspace', () => {
  it('JSON: empty array for workspace with no matrices', async () => {
    const res = await api(`/api/export/${wsBId}/matrices`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('CSV: only headers for workspace with no matrices', async () => {
    const res = await api(`/api/export/${wsBId}/matrices?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { headers, rows } = parseCsv(text);
    for (const expected of MATRIX_HEADERS) {
      expect(headers).toContain(expected);
    }
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Templates export
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/export/:workspaceId/templates — JSON format', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/export/${wsAId}/templates`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('contains the seeded template', async () => {
    const res = await api(`/api/export/${wsAId}/templates`);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.length).toBeGreaterThan(0);
    const ids = body.map(t => t.id);
    expect(ids).toContain(wsATemplateId);
  });

  it('every item has all expected fields', async () => {
    const res = await api(`/api/export/${wsAId}/templates`);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('pageType');
      expect(item).toHaveProperty('urlPattern');
      expect(item).toHaveProperty('keywordPattern');
      expect(item).toHaveProperty('sectionCount');
      expect(item).toHaveProperty('variableCount');
    }
  });
});

describe('GET /api/export/:workspaceId/templates — CSV format', () => {
  it('returns 200 with text/csv', async () => {
    const res = await api(`/api/export/${wsAId}/templates?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
  });

  it('first row contains all expected headers', async () => {
    const res = await api(`/api/export/${wsAId}/templates?format=csv`);
    const text = await res.text();
    const { headers } = parseCsv(text);
    for (const expected of TEMPLATE_HEADERS) {
      expect(headers).toContain(expected);
    }
  });

  it('seeded template appears in data rows', async () => {
    const res = await api(`/api/export/${wsAId}/templates?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map(r => r['id']);
    expect(ids).toContain(wsATemplateId);
  });
});

describe('GET /api/export/:workspaceId/templates — empty workspace', () => {
  it('JSON: empty array for workspace with no templates', async () => {
    const res = await api(`/api/export/${wsBId}/templates`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('CSV: only headers for workspace with no templates', async () => {
    const res = await api(`/api/export/${wsBId}/templates?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { headers, rows } = parseCsv(text);
    for (const expected of TEMPLATE_HEADERS) {
      expect(headers).toContain(expected);
    }
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-workspace isolation (HTTP layer)
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-workspace isolation — export endpoints', () => {
  it('briefs: wsB export does not include wsA brief id', async () => {
    const res = await api(`/api/export/${wsBId}/briefs`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(b => b.id);
    expect(ids).not.toContain(wsABriefId);
  });

  it('requests: wsB export does not include wsA request id', async () => {
    const res = await api(`/api/export/${wsBId}/requests`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(r => r.id);
    expect(ids).not.toContain(wsARequestId);
  });

  it('requests: wsB export does not include wsA exclusive keyword', async () => {
    const res = await api(`/api/export/${wsBId}/requests`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ targetKeyword: string }>;
    const keywords = body.map(r => r.targetKeyword);
    expect(keywords).not.toContain('export-test-content-request-xqz');
  });

  it('activity: wsB export does not include wsA seeded title', async () => {
    const res = await api(`/api/export/${wsBId}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ title: string }>;
    const titles = body.map(e => e.title);
    expect(titles).not.toContain('Export Test Audit');
  });

  it('payments: wsB export does not include wsA payment id', async () => {
    const res = await api(`/api/export/${wsBId}/payments`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(p => p.id);
    expect(ids).not.toContain(wsAPaymentId);
  });

  it('matrices: wsB export does not include wsA matrix id', async () => {
    const res = await api(`/api/export/${wsBId}/matrices`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ matrixId: string }>;
    const matrixIds = body.map(c => c.matrixId);
    expect(matrixIds).not.toContain(wsAMatrixId);
  });

  it('templates: wsB export does not include wsA template id', async () => {
    const res = await api(`/api/export/${wsBId}/templates`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(t => t.id);
    expect(ids).not.toContain(wsATemplateId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Large dataset — crash resistance
// ─────────────────────────────────────────────────────────────────────────────

describe('Large dataset export — crash resistance', () => {
  it('inserts 50 activity entries and exports without error', async () => {
    for (let i = 0; i < 50; i++) {
      addActivity(wsAId, 'note', `Bulk Note ${i}`, `Description ${i}`, {}, { name: 'Bulk Actor' });
    }

    const res = await api(`/api/export/${wsAId}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<unknown>;
    // Activity is capped at 500 entries server-side; we just verify it returns successfully
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('exports 50 activity entries as CSV without error', async () => {
    const res = await api(`/api/export/${wsAId}/activity?format=csv`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(typeof text).toBe('string');
    const { headers, rows } = parseCsv(text);
    for (const expected of ACTIVITY_HEADERS) {
      expect(headers).toContain(expected);
    }
    // After the 50 bulk inserts above plus the seeded entry, rows > 0
    expect(rows.length).toBeGreaterThan(0);
  });

  it('inserts 20 content requests and JSON export handles them all', async () => {
    for (let i = 0; i < 20; i++) {
      createContentRequest(wsAId, {
        topic: `Bulk Topic ${i}`,
        targetKeyword: `bulk-keyword-export-${i}-${Date.now()}`,
        intent: 'informational',
        priority: 'low',
        rationale: 'Bulk load test',
        source: 'strategy',
      });
    }

    const res = await api(`/api/export/${wsAId}/requests`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<unknown>;
    expect(Array.isArray(body)).toBe(true);
    // At least the original + 20 bulk
    expect(body.length).toBeGreaterThanOrEqual(21);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSV correctness — field values survive the round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('CSV field value correctness', () => {
  it('request CSV: targetKeyword value matches the seeded value', async () => {
    const res = await api(`/api/export/${wsAId}/requests?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);

    const seedRow = rows.find(r => r['id'] === wsARequestId);
    expect(seedRow).toBeDefined();
    expect(seedRow!['targetKeyword']).toBe('export-test-content-request-xqz');
    expect(seedRow!['topic']).toBe('Export Test Topic');
    expect(seedRow!['intent']).toBe('informational');
    expect(seedRow!['priority']).toBe('high');
  });

  it('payment CSV: amount and currency match the seeded values', async () => {
    const res = await api(`/api/export/${wsAId}/payments?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);

    const seedRow = rows.find(r => r['id'] === wsAPaymentId);
    expect(seedRow).toBeDefined();
    expect(seedRow!['amount']).toBe('9900');
    expect(seedRow!['currency']).toBe('usd');
    expect(seedRow!['status']).toBe('paid');
    expect(seedRow!['productType']).toBe('brief_blog');
  });

  it('template CSV: name and pageType match the seeded values', async () => {
    const res = await api(`/api/export/${wsAId}/templates?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);

    const seedRow = rows.find(r => r['id'] === wsATemplateId);
    expect(seedRow).toBeDefined();
    expect(seedRow!['name']).toBe('Export Test Template');
    expect(seedRow!['pageType']).toBe('blog');
  });

  it('strategy CSV: primaryKeyword matches the seeded page map entry', async () => {
    const res = await api(`/api/export/${wsAId}/strategy?format=csv`);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);

    const seedRow = rows.find(r => r['pagePath'] === '/blog/export-test');
    expect(seedRow).toBeDefined();
    expect(seedRow!['primaryKeyword']).toBe('export-test-keyword');
    expect(seedRow!['pageTitle']).toBe('Export Test Page');
  });
});
