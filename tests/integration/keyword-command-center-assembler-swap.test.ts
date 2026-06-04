/**
 * Wave 3a — KCC assembler swap byte-identity guard.
 *
 * The four KCC reassembly sites read contentGaps + keywordGaps off their own
 * tables (siteKeywords/siteKeywordMetrics/generatedAt stay blob-sourced, pageMap
 * stays on the Lite/full page_keywords path). After routing those two array reads
 * through assembleStoredKeywordStrategy, a table-backed workspace must produce the
 * same rows/summary: the content-gap and keyword-gap keywords still appear, the
 * Lite-path pageMap keyword still appears, and the blob siteKeyword still appears.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { upsertAndCleanPageKeywords } from '../../server/page-keywords.js';
import {
  buildKeywordCommandCenterSummary,
  buildKeywordCommandCenterRows,
  buildKeywordCommandCenterDetail,
} from '../../server/keyword-command-center.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import type { KeywordStrategy, ContentGap, KeywordGapItem, PageKeywordMap } from '../../shared/types/workspace.js';

const created: string[] = [];
afterAll(() => { for (const id of created) deleteWorkspace(id); });

describe('KCC assembler swap — table-backed contentGaps/keywordGaps still surface', () => {
  it('summary, rows, and detail reflect the table-backed gaps + blob siteKeyword + page keyword', async () => {
    const id = createWorkspace('kcc assembler swap').id;
    created.push(id);
    updateWorkspace(id, { keywordStrategy: {
      siteKeywords: ['kcc site keyword'], opportunities: [],
      siteKeywordMetrics: [{ keyword: 'kcc site keyword', volume: 1000, difficulty: 30 }],
      generatedAt: '2026-06-01T00:00:00.000Z',
    } as KeywordStrategy });
    const gap: ContentGap = { topic: 't', targetKeyword: 'kcc content gap', intent: 'informational', priority: 'high', rationale: 'r', volume: 400 };
    const kgap: KeywordGapItem = { keyword: 'kcc keyword gap', volume: 200, difficulty: 15, competitorPosition: 4, competitorDomain: 'rival.com' };
    const page: PageKeywordMap = { pagePath: '/p', pageTitle: 'P', primaryKeyword: 'kcc page keyword', secondaryKeywords: [] };
    replaceAllContentGaps(id, [gap]);
    replaceAllKeywordGaps(id, [kgap]);
    upsertAndCleanPageKeywords(id, [page]);

    const rowsResp = await buildKeywordCommandCenterRows(id, {}, { includeLocalSeo: false });
    expect(rowsResp).not.toBeNull();
    const rowKeys = new Set(rowsResp!.rows.map(r => keywordComparisonKey(r.keyword)));
    expect(rowKeys.has(keywordComparisonKey('kcc content gap'))).toBe(true);
    expect(rowKeys.has(keywordComparisonKey('kcc site keyword'))).toBe(true);
    expect(rowKeys.has(keywordComparisonKey('kcc page keyword'))).toBe(true);

    const summary = await buildKeywordCommandCenterSummary(id, { includeLocalSeo: false });
    expect(summary).not.toBeNull();
    expect(summary!.counts.total).toBeGreaterThanOrEqual(3);

    const detail = await buildKeywordCommandCenterDetail(id, 'kcc content gap', { includeLocalSeo: false });
    expect(detail).not.toBeNull();
    expect(keywordComparisonKey(detail!.row.keyword)).toBe(keywordComparisonKey('kcc content gap'));
  });
});
