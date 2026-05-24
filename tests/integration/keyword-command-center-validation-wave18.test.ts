/**
 * wave-18 supplemental integration tests — Keyword Command Center validation paths.
 *
 * Focused on: unknown workspaceId → 404; missing/invalid query/body → 400.
 * These complement keyword-command-center-routes.test.ts which covers the
 * happy-path behaviour.
 *
 * Port: 13427 (exclusive to wave-18 batch A2)
 *
 * Routes covered:
 *   GET  /api/webflow/keyword-command-center/:workspaceId/summary
 *   GET  /api/webflow/keyword-command-center/:workspaceId/rows
 *   GET  /api/webflow/keyword-command-center/:workspaceId/detail
 *   POST /api/webflow/keyword-command-center/:workspaceId/actions
 *   POST /api/webflow/keyword-command-center/:workspaceId/actions/bulk
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const PORT = 13427;
const ctx = createTestContext(PORT);
const { api, postJson } = ctx;

const UNKNOWN_ID = 'ws_wave18_kcc_does_not_exist_q7m';

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`Wave18 KCC Validation ${PORT}`).id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /summary — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /summary — unknown workspace', () => {
  it('returns 404', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${UNKNOWN_ID}/summary`);
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${UNKNOWN_ID}/summary`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /summary — fresh workspace → 200 with expected shape
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /summary — fresh workspace', () => {
  it('returns 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    expect(res.status).toBe(200);
  });

  it('response has counts, filters, summarizedAt fields', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    const body = await res.json();
    expect(body).toHaveProperty('counts');
    expect(body).toHaveProperty('filters');
    expect(body).toHaveProperty('summarizedAt');
  });

  it('counts.total is a number', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    const body = await res.json();
    expect(typeof body.counts.total).toBe('number');
  });

  it('filters is an array', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    const body = await res.json();
    expect(Array.isArray(body.filters)).toBe(true);
  });

  it('does not include rows field (split read model)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/summary`);
    const body = await res.json();
    expect(body.rows).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /rows — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /rows — unknown workspace', () => {
  it('returns 404', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${UNKNOWN_ID}/rows`);
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${UNKNOWN_ID}/rows`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /rows — invalid query params → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /rows — invalid query parameter validation', () => {
  it('invalid filter value → 400', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?filter=not_a_valid_filter`);
    expect(res.status).toBe(400);
  });

  it('invalid sort value → 400', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?sort=invalid_sort`);
    expect(res.status).toBe(400);
  });

  it('page=0 → 400 (min is 1)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?page=0`);
    expect(res.status).toBe(400);
  });

  it('pageSize=0 → 400 (min is 1)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?pageSize=0`);
    expect(res.status).toBe(400);
  });

  it('pageSize=101 → 400 (max is 100)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?pageSize=101`);
    expect(res.status).toBe(400);
  });

  it('unknown query key → 400 (strict schema)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?unknownParam=true`);
    expect(res.status).toBe(400);
  });

  it('400 response body has error string', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?filter=bogus`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /rows — valid params → 200
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /rows — valid params for fresh workspace', () => {
  it('no params → 200 with rows array and pageInfo', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body).toHaveProperty('pageInfo');
  });

  it('filter=all → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?filter=all`);
    expect(res.status).toBe(200);
  });

  it('filter=in_strategy → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?filter=in_strategy`);
    expect(res.status).toBe(200);
  });

  it('sort=keyword → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?sort=keyword`);
    expect(res.status).toBe(200);
  });

  it('sort=demand → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?sort=demand`);
    expect(res.status).toBe(200);
  });

  it('sort=rank → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?sort=rank`);
    expect(res.status).toBe(200);
  });

  it('sort=priority → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?sort=priority`);
    expect(res.status).toBe(200);
  });

  it('page=1&pageSize=10 → 200 with correct pageInfo', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?page=1&pageSize=10`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageInfo.page).toBe(1);
    expect(body.pageInfo.pageSize).toBe(10);
  });

  it('pageSize=1 (minimum valid) → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?pageSize=1`);
    expect(res.status).toBe(200);
  });

  it('pageSize=100 (maximum valid) → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?pageSize=100`);
    expect(res.status).toBe(200);
  });

  it('search=test → 200', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/rows?search=test`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /detail — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /detail — unknown workspace', () => {
  it('returns 404 when workspace not found (with keyword param)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${UNKNOWN_ID}/detail?keyword=test`);
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${UNKNOWN_ID}/detail?keyword=test`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /detail — missing required param → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /detail — missing keyword param → 400', () => {
  it('omitting keyword → 400', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/detail`);
    expect(res.status).toBe(400);
  });

  it('empty keyword string → 400 (min length 1)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/detail?keyword=`);
    expect(res.status).toBe(400);
  });

  it('unknown query key → 400 (strict schema)', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/detail?keyword=test&extra=1`);
    expect(res.status).toBe(400);
  });

  it('400 body has error string', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/detail`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /detail — valid keyword not tracked → 404 keyword not found
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /detail — keyword not found in fresh workspace', () => {
  it('returns 404 when keyword is not in the command center', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/detail?keyword=untracked-kw-wave18`);
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await api(`/api/webflow/keyword-command-center/${wsId}/detail?keyword=untracked-kw-wave18`);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /actions — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /actions — unknown workspace → 404', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${UNKNOWN_ID}/actions`,
      { action: 'track', keyword: 'test-keyword' },
    );
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${UNKNOWN_ID}/actions`,
      { action: 'track', keyword: 'test-keyword' },
    );
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /actions — invalid body → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /actions — invalid body validation', () => {
  it('missing action → 400', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { keyword: 'test-keyword' },
    );
    expect(res.status).toBe(400);
  });

  it('invalid action value → 400', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'not_a_real_action', keyword: 'test-keyword' },
    );
    expect(res.status).toBe(400);
  });

  it('missing keyword → 400', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'track' },
    );
    expect(res.status).toBe(400);
  });

  it('empty keyword string → 400 (min length 1)', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'track', keyword: '' },
    );
    expect(res.status).toBe(400);
  });

  it('extra unknown field → 400 (strict schema)', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'track', keyword: 'test', unknownField: true },
    );
    expect(res.status).toBe(400);
  });

  it('400 body has error string', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'invalid_action', keyword: 'test' },
    );
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /actions — valid action → 200
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /actions — valid action on fresh workspace', () => {
  it('track action → 200 with ok:true', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'track', keyword: 'wave18-validation-keyword' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);
  });

  it('add_to_strategy action → 200', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'add_to_strategy', keyword: 'wave18-strategy-keyword' },
    );
    expect(res.status).toBe(200);
  });

  it('decline action → 200', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'decline', keyword: 'wave18-declined-keyword' },
    );
    expect(res.status).toBe(200);
  });

  it('optional pagePath field is accepted', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'track', keyword: 'wave18-pagepath-keyword', pagePath: '/blog/test' },
    );
    expect(res.status).toBe(200);
  });

  it('optional reason field is accepted', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions`,
      { action: 'decline', keyword: 'wave18-reason-keyword', reason: 'Not relevant' },
    );
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /actions/bulk — unknown workspace → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /actions/bulk — unknown workspace → 404', () => {
  it('returns 404 for unknown workspaceId', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${UNKNOWN_ID}/actions/bulk`,
      { action: 'track', keywords: ['kw1'] },
    );
    expect(res.status).toBe(404);
  });

  it('response body has error field', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${UNKNOWN_ID}/actions/bulk`,
      { action: 'track', keywords: ['kw1'] },
    );
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /actions/bulk — invalid body → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /actions/bulk — invalid body validation', () => {
  it('missing action → 400', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { keywords: ['kw1'] },
    );
    expect(res.status).toBe(400);
  });

  it('invalid action value → 400', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'not_bulk_eligible', keywords: ['kw1'] },
    );
    expect(res.status).toBe(400);
  });

  it('promote_evidence is not a valid bulk action → 400', async () => {
    // promote_evidence exists in single-action enum but NOT in bulk-action enum
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'promote_evidence', keywords: ['kw1'] },
    );
    expect(res.status).toBe(400);
  });

  it('restore is not a valid bulk action → 400', async () => {
    // restore is in single-action enum but not bulk
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'restore', keywords: ['kw1'] },
    );
    expect(res.status).toBe(400);
  });

  it('empty keywords array → 400 (min 1)', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords: [] },
    );
    expect(res.status).toBe(400);
  });

  it('51 keywords → 400 (max 50)', async () => {
    const keywords = Array.from({ length: 51 }, (_, i) => `wave18-bulk-kw-${i}`);
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords },
    );
    expect(res.status).toBe(400);
  });

  it('missing keywords field → 400', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track' },
    );
    expect(res.status).toBe(400);
  });

  it('keyword item exceeding max length → 400', async () => {
    // Each keyword has max 200 chars
    const longKeyword = 'a'.repeat(201);
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords: [longKeyword] },
    );
    expect(res.status).toBe(400);
  });

  it('extra unknown field → 400 (strict schema)', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords: ['kw1'], unknownField: 'nope' },
    );
    expect(res.status).toBe(400);
  });

  it('400 body has error string', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords: [] },
    );
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /actions/bulk — valid requests → 200
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /actions/bulk — valid requests', () => {
  it('track bulk action → 200 with result summary', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords: ['wave18-bulk-a', 'wave18-bulk-b'] },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('action', 'track');
    expect(body).toHaveProperty('applied');
    expect(body).toHaveProperty('skipped');
    expect(body).toHaveProperty('failed');
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('message');
  });

  it('decline bulk action → 200', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'decline', keywords: ['wave18-bulk-decline-x'] },
    );
    expect(res.status).toBe(200);
  });

  it('add_to_strategy bulk action → 200', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'add_to_strategy', keywords: ['wave18-bulk-strategy-y'] },
    );
    expect(res.status).toBe(200);
  });

  it('single keyword (boundary: min=1) → 200', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords: ['wave18-single-bulk-kw'] },
    );
    expect(res.status).toBe(200);
  });

  it('50 keywords (boundary: max=50) → 200', async () => {
    const keywords = Array.from({ length: 50 }, (_, i) => `wave18-max-bulk-kw-${i}`);
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords },
    );
    expect(res.status).toBe(200);
  });

  it('optional reason field is accepted in bulk', async () => {
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'retire', keywords: ['wave18-bulk-retire-a'], reason: 'No longer relevant', force: true },
    );
    expect(res.status).toBe(200);
  });

  it('items array length matches keywords length', async () => {
    const keywords = ['wave18-items-check-1', 'wave18-items-check-2', 'wave18-items-check-3'];
    const res = await postJson(
      `/api/webflow/keyword-command-center/${wsId}/actions/bulk`,
      { action: 'track', keywords },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(keywords.length);
  });
});
