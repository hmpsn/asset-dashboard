// tests/fixtures/strategy-seed.ts
// Shared keyword strategy fixture for integration tests.
// Creates a workspace with keyword_strategy JSON data for strategy/insight testing.

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

export interface SeededStrategy {
  workspaceId: string;
  cleanup: () => void;
}

/**
 * Creates a workspace with a populated keyword_strategy JSON column.
 * The strategy includes siteKeywords, pageMap, opportunities, contentGaps, and quickWins.
 *
 * Uses a direct UPDATE on the keyword_strategy column to set the JSON data,
 * matching the pattern used by updateWorkspace() in server/workspaces.ts.
 */
export function seedStrategyData(): SeededStrategy {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-strat-${suffix}`;
  const now = new Date().toISOString();

  // Insert workspace
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, tier, created_at)
    VALUES (?, ?, ?, 'free', ?)
  `).run(workspaceId, `Strategy Test ${suffix}`, `strategy-test-${suffix}`, now);

  // Build keyword strategy data matching the KeywordStrategy interface
  // from shared/types/workspace.ts
  const keywordStrategy = {
    siteKeywords: ['seo agency', 'web analytics', 'content strategy'],
    siteKeywordMetrics: [
      { keyword: 'seo agency', volume: 5400, difficulty: 72 },
      { keyword: 'web analytics', volume: 8100, difficulty: 58 },
      { keyword: 'content strategy', volume: 3600, difficulty: 45 },
    ],
    pageMap: [
      {
        pagePath: '/services',
        pageTitle: 'Services',
        primaryKeyword: 'seo agency',
        secondaryKeywords: ['seo services', 'search engine optimization'],
      },
      {
        pagePath: '/analytics',
        pageTitle: 'Analytics',
        primaryKeyword: 'web analytics',
        secondaryKeywords: ['website analytics', 'google analytics'],
      },
    ],
    opportunities: ['local seo', 'technical seo audit', 'content marketing'],
    contentGaps: [
      {
        topic: 'Technical SEO Guide',
        targetKeyword: 'technical seo',
        intent: 'informational',
        priority: 'high',
        rationale: 'High search volume, no existing coverage',
      },
    ],
    quickWins: [
      {
        pagePath: '/services',
        currentKeyword: 'seo agency near me',
        action: 'Optimize title tag for primary keyword',
        estimatedImpact: 'high',
        rationale: 'Page ranks #12, minor on-page fix could reach first page',
        roiScore: 85,
      },
    ],
    generatedAt: now,
  };

  // Update workspace with keyword strategy JSON
  db.prepare(`
    UPDATE workspaces SET keyword_strategy = ? WHERE id = ?
  `).run(JSON.stringify(keywordStrategy), workspaceId);

  const cleanup = () => {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return { workspaceId, cleanup };
}
