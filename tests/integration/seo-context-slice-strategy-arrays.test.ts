/**
 * Wave 3a — seo-context-slice latent-bug fix.
 *
 * Before the assembler swap, assembleSeoContext spread the WHOLE keyword_strategy
 * blob and overrode only pageMap + contentGaps. For a migrated (table-backed)
 * workspace, the persist write path strips quickWins / keywordGaps / topicClusters
 * / cannibalization from the blob — so those four arrays were EMPTY in the AI
 * context (a latent bug). Routing the slice through assembleStoredKeywordStrategy
 * restores them from their tables.
 *
 * This test seeds a table-backed workspace with an empty-array blob (exactly what
 * a re-generated workspace looks like) and asserts all four arrays are populated
 * in the assembled SeoContextSlice.strategy.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllQuickWins } from '../../server/quick-wins.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { replaceAllCannibalizationIssues } from '../../server/cannibalization-issues.js';
import { assembleSeoContext } from '../../server/intelligence/seo-context-slice.js';
import type { KeywordStrategy, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem } from '../../shared/types/workspace.js';

const created: string[] = [];
afterAll(() => { for (const id of created) deleteWorkspace(id); });

describe('assembleSeoContext — strategy arrays restored from tables (latent-bug fix)', () => {
  it('populates quickWins/keywordGaps/topicClusters/cannibalization for a migrated workspace', async () => {
    const id = createWorkspace('seo-context strategy arrays').id;
    created.push(id);
    // The blob has the table-backed arrays stripped (what a re-generated workspace looks like).
    updateWorkspace(id, { keywordStrategy: {
      siteKeywords: ['kw'], opportunities: ['opp'], businessContext: 'ctx',
      generatedAt: '2026-06-01T00:00:00.000Z',
    } as KeywordStrategy });

    const gap: ContentGap = { topic: 't', targetKeyword: 'gap kw', intent: 'informational', priority: 'high', rationale: 'r' };
    const win: QuickWin = { pagePath: '/p', action: 'do it', estimatedImpact: 'high', rationale: 'easy' };
    const kgap: KeywordGapItem = { keyword: 'comp kw', volume: 100, difficulty: 10, competitorPosition: 2, competitorDomain: 'rival.com' };
    const cluster: TopicCluster = { topic: 'tc', keywords: ['a'], ownedCount: 0, totalCount: 1, coveragePercent: 0, gap: ['a'] };
    const cannibal: CannibalizationItem = { keyword: 'cn', pages: [{ path: '/x', source: 'gsc' }], severity: 'low', recommendation: 'fix' };
    replaceAllContentGaps(id, [gap]);
    replaceAllQuickWins(id, [win]);
    replaceAllKeywordGaps(id, [kgap]);
    replaceAllTopicClusters(id, [cluster]);
    replaceAllCannibalizationIssues(id, [cannibal]);

    const slice = await assembleSeoContext(id);
    expect(slice.strategy).toBeTruthy();
    // contentGaps was already populated pre-fix; the four below were the latent bug.
    expect(slice.strategy!.contentGaps).toHaveLength(1);
    expect(slice.strategy!.quickWins).toHaveLength(1);
    expect(slice.strategy!.quickWins![0].action).toBe('do it');
    expect(slice.strategy!.keywordGaps).toHaveLength(1);
    expect(slice.strategy!.keywordGaps![0].keyword).toBe('comp kw');
    expect(slice.strategy!.topicClusters).toHaveLength(1);
    expect(slice.strategy!.topicClusters![0].topic).toBe('tc');
    expect(slice.strategy!.cannibalization).toHaveLength(1);
    expect(slice.strategy!.cannibalization![0].keyword).toBe('cn');
    // Blob scalar fields still present.
    expect(slice.strategy!.siteKeywords).toEqual(['kw']);
    expect(slice.businessContext).toBe('ctx');
  });
});
