/**
 * assembleStoredKeywordStrategy (#2) — the single read-path assembler.
 *
 * Proves the table-as-truth + table-or-blob fallback policy:
 *  - table-backed workspace → assembler returns the table rows (table-as-truth);
 *  - legacy blob-only workspace (blob arrays present, tables empty) → the
 *    fallback returns the blob arrays (NO DATA LOSS pre-strip);
 *  - empty workspace (no blob, all tables empty) → null short-circuit;
 *  - `backfilled` + the gap fields survive the assembler's contentGaps array.
 *
 * No HTTP — exercises the assembler directly against the DB.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllQuickWins } from '../../server/quick-wins.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { replaceAllCannibalizationIssues } from '../../server/cannibalization-issues.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { assembleStoredKeywordStrategy } from '../../server/keyword-strategy-assembler.js';
import type { KeywordStrategy, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem } from '../../shared/types/workspace.js';

const created: string[] = [];
function ws(name: string): string {
  const id = createWorkspace(name).id;
  created.push(id);
  return id;
}

afterAll(() => {
  for (const id of created) deleteWorkspace(id);
});

const tableGap: ContentGap = {
  topic: 'Table topic', targetKeyword: 'table gap keyword', intent: 'informational',
  priority: 'high', rationale: 'from the content_gaps table', volume: 5000, difficulty: 20,
  opportunityScore: 88, backfilled: true,
};
const tableQuickWin: QuickWin = { pagePath: '/a', action: 'do x', estimatedImpact: 'high', rationale: 'r', roiScore: 70 };
const tableKeywordGap: KeywordGapItem = { keyword: 'kg keyword', volume: 100, difficulty: 10, competitorPosition: 3, competitorDomain: 'rival.com' };
const tableCluster: TopicCluster = { topic: 'tc', keywords: ['a', 'b'], ownedCount: 1, totalCount: 2, coveragePercent: 50, gap: ['b'] };
const tableCannibal: CannibalizationItem = {
  keyword: 'cannibal', pages: [{ path: '/p1', source: 'keyword_map' }], severity: 'medium', recommendation: 'pick one',
};

describe('assembleStoredKeywordStrategy — table-as-truth + fallback', () => {
  it('returns table rows when tables are populated (table-as-truth)', () => {
    const id = ws('assembler table-backed');
    updateWorkspace(id, { keywordStrategy: {
      siteKeywords: ['site kw'], opportunities: ['opp'],
      siteKeywordMetrics: [{ keyword: 'site kw', volume: 900, difficulty: 30 }],
      businessContext: 'ctx', generatedAt: '2026-06-01T00:00:00.000Z',
      // Blob arrays intentionally present but DIFFERENT — tables must win.
      contentGaps: [{ ...tableGap, targetKeyword: 'STALE blob gap', backfilled: false }],
    } as KeywordStrategy });
    replaceAllContentGaps(id, [tableGap]);
    replaceAllQuickWins(id, [tableQuickWin]);
    replaceAllKeywordGaps(id, [tableKeywordGap]);
    replaceAllTopicClusters(id, [tableCluster]);
    replaceAllCannibalizationIssues(id, [tableCannibal]);
    // siteKeywordMetrics is table-only post-strip — populate the table, not the blob.
    replaceAllSiteKeywordMetrics(id, [{ keyword: 'site kw', volume: 900, difficulty: 30 }]);

    const result = assembleStoredKeywordStrategy(id);
    expect(result).not.toBeNull();
    expect(result!.siteKeywords).toEqual(['site kw']);
    expect(result!.siteKeywordMetrics).toEqual([{ keyword: 'site kw', volume: 900, difficulty: 30 }]);
    expect(result!.generatedAt).toBe('2026-06-01T00:00:00.000Z');
    // Table wins over the stale blob gap.
    expect(result!.contentGaps).toHaveLength(1);
    expect(result!.contentGaps[0].targetKeyword).toBe('table gap keyword');
    // backfilled + the gap fields survive the assembler's array.
    expect(result!.contentGaps[0].backfilled).toBe(true);
    expect(result!.contentGaps[0].opportunityScore).toBe(88);
    expect(result!.quickWins[0].action).toBe('do x');
    expect(result!.keywordGaps[0].keyword).toBe('kg keyword');
    expect(result!.topicClusters[0].topic).toBe('tc');
    expect(result!.cannibalization[0].keyword).toBe('cannibal');
  });

  it('falls back to the blob arrays for a legacy un-migrated workspace (tables empty)', () => {
    const id = ws('assembler blob-only');
    const blobGap: ContentGap = { ...tableGap, targetKeyword: 'legacy blob gap', backfilled: false };
    const blobQuickWin: QuickWin = { ...tableQuickWin, pagePath: '/legacy' };
    const blobKeywordGap: KeywordGapItem = { ...tableKeywordGap, keyword: 'legacy kg' };
    const blobCluster: TopicCluster = { ...tableCluster, topic: 'legacy tc' };
    const blobCannibal: CannibalizationItem = { ...tableCannibal, keyword: 'legacy cannibal' };
    updateWorkspace(id, { keywordStrategy: {
      siteKeywords: ['legacy kw'], opportunities: [],
      contentGaps: [blobGap], quickWins: [blobQuickWin], keywordGaps: [blobKeywordGap],
      topicClusters: [blobCluster], cannibalization: [blobCannibal],
      generatedAt: '2026-05-01T00:00:00.000Z',
    } as KeywordStrategy });
    // Tables intentionally left empty → blob fallback must surface the blob arrays.

    const result = assembleStoredKeywordStrategy(id);
    expect(result).not.toBeNull();
    expect(result!.contentGaps).toHaveLength(1);
    expect(result!.contentGaps[0].targetKeyword).toBe('legacy blob gap');
    expect(result!.quickWins[0].pagePath).toBe('/legacy');
    expect(result!.keywordGaps[0].keyword).toBe('legacy kg');
    expect(result!.topicClusters[0].topic).toBe('legacy tc');
    expect(result!.cannibalization[0].keyword).toBe('legacy cannibal');
  });

  it('returns null when there is no blob and every table is empty', () => {
    const id = ws('assembler empty');
    expect(assembleStoredKeywordStrategy(id)).toBeNull();
  });

  it('returns null for a non-existent workspace', () => {
    expect(assembleStoredKeywordStrategy('does-not-exist')).toBeNull();
  });
});
