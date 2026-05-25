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

    updateWorkspace(workspaceId, {
      keywordStrategy: {
        generatedAt: '2026-05-20T00:00:00.000Z',
        siteKeywords: [],
        opportunities: [],
        quickWins: [quickWin],
      },
    });
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
