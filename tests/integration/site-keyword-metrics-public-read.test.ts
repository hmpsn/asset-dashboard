/**
 * Wave 3b-ii (#19b) — TABLE-AS-TRUTH read gate for siteKeywordMetrics on the REAL
 * public read path `GET /api/public/seo-strategy/:id` (post-strip).
 *
 * Asserts the public route returns siteKeywordMetrics:
 *   - from the site_keyword_metrics TABLE when it is populated, AND
 *   - NOTHING when the table is empty (the legacy blob fallback was removed in the
 *     strip — the table is now the sole source of truth).
 *
 * reserved for tracked-keywords-concurrency).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let tableWsId = '';
let blobWsId = '';

interface PublicStrategy {
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

beforeAll(async () => {
  await ctx.startServer();

  // Workspace A: table populated. A stale legacy blob value is also present to
  // prove the table wins and the blob is ignored.
  tableWsId = createWorkspace(`SKM Table ${ctx.PORT}`).id;
  updateWorkspace(tableWsId, { keywordStrategy: {
    siteKeywords: ['table keyword'],
    siteKeywordMetrics: [{ keyword: 'table keyword', volume: 1, difficulty: 1 }],
    opportunities: [],
    generatedAt: '2026-06-01T00:00:00.000Z',
  } as KeywordStrategy });
  replaceAllSiteKeywordMetrics(tableWsId, [{ keyword: 'table keyword', volume: 9999, difficulty: 88 }]);

  // Workspace B: blob-only legacy state (table empty). Post-strip the blob is NO
  // LONGER a fallback — the public route must return no metrics.
  blobWsId = createWorkspace(`SKM Blob ${ctx.PORT}`).id;
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

describe('GET /api/public/seo-strategy/:id — siteKeywordMetrics table-as-truth', () => {
  it('returns metrics from the TABLE when populated (blob ignored)', async () => {
    const res = await api(`/api/public/seo-strategy/${tableWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PublicStrategy;
    expect(body.siteKeywordMetrics).toEqual([{ keyword: 'table keyword', volume: 9999, difficulty: 88 }]);
  });

  it('returns NO metrics when the table is empty (blob fallback removed by the strip)', async () => {
    const res = await api(`/api/public/seo-strategy/${blobWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PublicStrategy;
    expect(body.siteKeywordMetrics).toBeUndefined();
  });
});
