/**
 * W5.1 — outcome-readback-strategy-ux.test.ts
 *
 * Verifies buildKeywordStrategyUxPayload enriches a page_keyword explanation with
 * its read-back outcome verdict (joined by strategyPageKeywordSourceId(pagePath,
 * keyword)), and leaves explanations with no scored action un-enriched.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, strategyPageKeywordSourceId } from '../../server/outcome-tracking.js';
import { buildKeywordStrategyUxPayload } from '../../server/keyword-strategy-ux.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

const WS_BASE = 'orbsx-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS ORBSX', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE ?)
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

function pageMapRow(over: Partial<PageKeywordMap>): PageKeywordMap {
  return {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'teeth whitening',
    secondaryKeywords: [],
    ...over,
  } as PageKeywordMap;
}

describe('buildKeywordStrategyUxPayload — outcome read-back enrichment', () => {
  it('attaches the scored outcome to the matching page_keyword explanation', async () => {
    const ws = `${WS_BASE}-hit`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'strategy_keyword_added',
      sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
      sourceId: strategyPageKeywordSourceId('/services', 'teeth whitening'),
      pageUrl: '/services',
      targetKeyword: 'teeth whitening',
      baselineSnapshot: { captured_at: new Date().toISOString(), position: 14 },
    });
    recordOutcome({
      actionId: action.id, checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), position: 6 },
      score: 'win',
      deltaSummary: { primary_metric: 'position', baseline_value: 14, current_value: 6, delta_absolute: -8, delta_percent: -57, direction: 'improved' },
    });

    const payload = await buildKeywordStrategyUxPayload({
      workspaceId: ws,
      surface: 'admin',
      pageMap: [pageMapRow({})],
      contentGaps: [],
      keywordGaps: [],
      includeWorkspaceIntelligence: false,
    });

    const exp = payload.explanations.find(e => e.keyword === 'teeth whitening');
    expect(exp).toBeDefined();
    expect(exp!.outcome).toBeDefined();
    expect(exp!.outcome!.score).toBe('win');
    expect(exp!.outcome!.baselinePosition).toBe(14);
    expect(exp!.outcome!.currentPosition).toBe(6);
  });

  it('leaves an explanation with no scored action un-enriched', async () => {
    const ws = `${WS_BASE}-miss`;
    seedWorkspace(ws);

    const payload = await buildKeywordStrategyUxPayload({
      workspaceId: ws,
      surface: 'admin',
      pageMap: [pageMapRow({ primaryKeyword: 'unscored keyword' })],
      contentGaps: [],
      keywordGaps: [],
      includeWorkspaceIntelligence: false,
    });

    const exp = payload.explanations.find(e => e.keyword === 'unscored keyword');
    expect(exp).toBeDefined();
    expect(exp!.outcome).toBeUndefined();
  });
});
