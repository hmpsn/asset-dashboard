/**
 * Wave 3b-i (#19b) — DUAL-READ fallback gate for siteKeywordMetrics on the REAL
 * public read path `GET /api/public/seo-strategy/:id`.
 *
 * Asserts the public route returns siteKeywordMetrics:
 *   - from the site_keyword_metrics TABLE when it is populated, AND
 *   - from the legacy blob when the table is empty (fallback survives).
 *
 * This is the additive PR: the blob is still written and still read as the
 * fallback. The strip is the follow-up owner-gated 3b-ii PR.
 *
 * Port: 13890 (exclusive; 13888/13889 used by Wave-3a assembler tests, 13886
 * reserved for tracked-keywords-concurrency).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

const PORT = 13890;
const ctx = createTestContext(PORT);
const { api } = ctx;

let tableWsId = '';
let blobWsId = '';

interface PublicStrategy {
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

beforeAll(async () => {
  await ctx.startServer();

  // Workspace A: table populated (different values from the blob to prove the
  // table wins). Blob also kept (dual-write reality).
  tableWsId = createWorkspace(`SKM Table ${PORT}`).id;
  updateWorkspace(tableWsId, { keywordStrategy: {
    siteKeywords: ['table keyword'],
    siteKeywordMetrics: [{ keyword: 'table keyword', volume: 1, difficulty: 1 }],
    opportunities: [],
    generatedAt: '2026-06-01T00:00:00.000Z',
  } as KeywordStrategy });
  replaceAllSiteKeywordMetrics(tableWsId, [{ keyword: 'table keyword', volume: 9999, difficulty: 88 }]);

  // Workspace B: blob-only legacy state (table empty) — fallback path.
  blobWsId = createWorkspace(`SKM Blob ${PORT}`).id;
  updateWorkspace(blobWsId, { keywordStrategy: {
    siteKeywords: ['blob keyword'],
    siteKeywordMetrics: [{ keyword: 'blob keyword', volume: 700, difficulty: 12 }],
    opportunities: [],
    generatedAt: '2026-06-01T00:00:00.000Z',
  } as KeywordStrategy });
}, 25_000);

afterAll(async () => {
  if (tableWsId) deleteWorkspace(tableWsId);
  if (blobWsId) deleteWorkspace(blobWsId);
  await ctx.stopServer();
});

describe('GET /api/public/seo-strategy/:id — siteKeywordMetrics dual-read', () => {
  it('returns metrics from the TABLE when populated', async () => {
    const res = await api(`/api/public/seo-strategy/${tableWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PublicStrategy;
    expect(body.siteKeywordMetrics).toEqual([{ keyword: 'table keyword', volume: 9999, difficulty: 88 }]);
  });

  it('falls back to the BLOB when the table is empty', async () => {
    const res = await api(`/api/public/seo-strategy/${blobWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PublicStrategy;
    expect(body.siteKeywordMetrics).toEqual([{ keyword: 'blob keyword', volume: 700, difficulty: 12 }]);
  });
});
