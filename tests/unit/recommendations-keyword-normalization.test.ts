import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

vi.mock('../../server/diagnostic-store.js', () => ({
  listDiagnosticReports: vi.fn(() => []),
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildRecommendationGenerationContext: vi.fn(async () => ({
    intelligence: {
      learnings: null,
      seoContext: { backlinkProfile: null },
    },
  })),
}));

import db from '../../server/db/index.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllQuickWins } from '../../server/quick-wins.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { generateRecommendations } from '../../server/recommendations.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import type { PageKeywordMap, QuickWin } from '../../shared/types/workspace.js';

describe('generateRecommendations keyword normalization', () => {
  let workspaceId = '';

  afterEach(() => {
    if (workspaceId) {
      deleteWorkspace(workspaceId);
      workspaceId = '';
    }
  });

  it('suppresses declined keyword variants across quick wins, content gaps, and ranking opportunities', async () => {
    workspaceId = createWorkspace('Recommendation Keyword Normalization').id;
    const declinedKeyword = 'Emergency Dentist - Near-Me';
    const canonicalKeyword = keywordComparisonKey(declinedKeyword);
    const quickWin: QuickWin = {
      pagePath: '/services/emergency-dentist',
      currentKeyword: declinedKeyword,
      action: 'Refresh emergency dentist copy',
      estimatedImpact: 'high',
      rationale: 'This keyword was declined and should not drive recommendation copy.',
    };

    // Seed the workspace with a strategy blob (no quickWins — those live in the quick_wins table)
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        generatedAt: '2026-05-20T00:00:00.000Z',
        siteKeywords: [],
        opportunities: [],
      },
    });
    // Quick wins are table-backed; seed via replaceAllQuickWins (blob fallback removed in #22)
    replaceAllQuickWins(workspaceId, [quickWin]);
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source)
      VALUES (?, ?, 'declined', 'Not a fit', 'content_gap')
    `).run(workspaceId, canonicalKeyword);
    replaceAllContentGaps(workspaceId, [{
      topic: 'Emergency Dentistry Guide',
      targetKeyword: declinedKeyword,
      intent: 'commercial',
      priority: 'high',
      rationale: 'Declined keyword variant should be suppressed.',
      suggestedPageType: 'service',
      volume: 1200,
      difficulty: 35,
    }]);
    upsertPageKeyword(workspaceId, {
      pagePath: '/services/emergency-dentist',
      pageTitle: 'Emergency Dentist',
      primaryKeyword: declinedKeyword,
      searchIntent: 'transactional',
      currentPosition: 8,
      previousPosition: 11,
      impressions: 240,
      clicks: 8,
    } as PageKeywordMap);

    const result = await generateRecommendations(workspaceId);
    const strategySources = result.recommendations
      .map(recommendation => recommendation.source)
      .filter(source => source?.startsWith('strategy:'));

    expect(strategySources).not.toContain('strategy:quick-win');
    expect(strategySources).not.toContain('strategy:content-gap');
    expect(strategySources).not.toContain('strategy:ranking-opportunity');
  });
});

/**
 * Regression guard (#22): quick wins recommendations must come from the quick_wins
 * table, NOT the workspace keywordStrategy blob.  A future re-introduction of a
 * blob-read path would silently bypass post-migration data and this test would
 * catch it.
 */
describe('generateRecommendations — quickWins table-only source (regression guard #22)', () => {
  let workspaceId = '';

  afterEach(() => {
    if (workspaceId) {
      deleteWorkspace(workspaceId);
      workspaceId = '';
    }
  });

  it('produces quick-win recs from the quick_wins table, not the blob', async () => {
    workspaceId = createWorkspace('QW Table Source Guard').id;

    // Seed a strategy blob WITHOUT quickWins — if the code reads the blob it sees nothing
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        generatedAt: '2026-05-20T00:00:00.000Z',
        siteKeywords: [],
        opportunities: [],
      },
    });
    // Seed quick wins exclusively via the table
    replaceAllQuickWins(workspaceId, [{
      pagePath: '/services',
      action: 'Update title tag with primary keyword',
      estimatedImpact: 'high',
      rationale: 'Missing keyword in title',
      roiScore: 80,
    }]);

    const result = await generateRecommendations(workspaceId);
    const quickWinSources = result.recommendations.filter(r => r.source === 'strategy:quick-win');

    // The table-backed quick win must produce a recommendation
    // Note: affectedPages strips the leading slash (qw.pagePath.replace(/^\//, ''))
    expect(quickWinSources.length).toBeGreaterThanOrEqual(1);
    expect(quickWinSources[0].affectedPages).toContain('services');
  });

  it('produces no quick-win recs when table is empty, even if blob had quickWins', async () => {
    workspaceId = createWorkspace('QW Blob Ignored Guard').id;

    // Seed a strategy blob WITH quickWins in the blob — these must NOT be read
    updateWorkspace(workspaceId, {
      keywordStrategy: {
        generatedAt: '2026-05-20T00:00:00.000Z',
        siteKeywords: [],
        opportunities: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        quickWins: [{ pagePath: '/ghost-page', action: 'ghost action', estimatedImpact: 'high', rationale: 'blob-only' }] as any,
      },
    });
    // Leave the quick_wins table empty — no replaceAllQuickWins call

    const result = await generateRecommendations(workspaceId);
    const quickWinSources = result.recommendations.filter(r => r.source === 'strategy:quick-win');

    // Blob quickWins must be ignored; table is empty so zero quick-win recs
    expect(quickWinSources).toHaveLength(0);
  });
});
