/**
 * W5.1 — outcome-readback.test.ts
 *
 * Verifies the read-side join that closes the outcome loop: getScoredOutcomeReadbacks
 * returns the LATEST conclusive outcome per tracked action for a workspace, shaped
 * as OutcomeReadback (baseline→current + verdict + direction), and excludes
 * inconclusive / insufficient_data / unscored actions.
 *
 * TDD: written to FAIL before getScoredOutcomeReadbacks exists.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { getScoredOutcomeReadbacks } from '../../server/outcome-tracking.js';
import { STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, strategyPageKeywordSourceId } from '../../server/outcome-tracking.js';

const WS_BASE = 'orb-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS ORB', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE ?)
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

describe('getScoredOutcomeReadbacks — latest conclusive outcome per action', () => {
  it('returns a position readback (#14→#6, win) keyed by strategy source id', () => {
    const ws = `${WS_BASE}-pos`;
    seedWorkspace(ws);

    const sourceId = strategyPageKeywordSourceId('/services', 'teeth whitening');
    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'strategy_keyword_added',
      sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
      sourceId,
      pageUrl: '/services',
      targetKeyword: 'teeth whitening',
      baselineSnapshot: { captured_at: new Date().toISOString(), position: 14 },
    });

    recordOutcome({
      actionId: action.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), position: 6 },
      score: 'win',
      deltaSummary: {
        primary_metric: 'position',
        baseline_value: 14,
        current_value: 6,
        delta_absolute: -8,
        delta_percent: -57,
        direction: 'improved',
      },
    });

    const readbacks = getScoredOutcomeReadbacks(ws);
    const bySource = readbacks.bySource.get(`${STRATEGY_PAGE_KEYWORD_SOURCE_TYPE}::${sourceId}`);
    expect(bySource).toBeDefined();
    expect(bySource!.score).toBe('win');
    expect(bySource!.direction).toBe('improved');
    expect(bySource!.baselinePosition).toBe(14);
    expect(bySource!.currentPosition).toBe(6);
    expect(bySource!.checkpointDays).toBe(30);
    expect(bySource!.primaryMetric).toBe('position');

    // keyword index also resolves
    const byKeyword = readbacks.byKeyword.get('teeth whitening');
    expect(byKeyword?.score).toBe('win');
  });

  it('uses the HIGHEST checkpoint when an action scored at 30 AND 60', () => {
    const ws = `${WS_BASE}-multi`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'post',
      sourceId: 'post-multi',
      pageUrl: '/blog/post',
      targetKeyword: 'multi keyword',
      baselineSnapshot: { captured_at: new Date().toISOString(), position: 20, clicks: 5 },
    });

    recordOutcome({
      actionId: action.id, checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), position: 12, clicks: 8 },
      score: 'win',
      deltaSummary: { primary_metric: 'position', baseline_value: 20, current_value: 12, delta_absolute: -8, delta_percent: -40, direction: 'improved' },
    });
    recordOutcome({
      actionId: action.id, checkpointDays: 60,
      metricsSnapshot: { captured_at: new Date().toISOString(), position: 4, clicks: 15 },
      score: 'strong_win',
      deltaSummary: { primary_metric: 'position', baseline_value: 20, current_value: 4, delta_absolute: -16, delta_percent: -80, direction: 'improved' },
    });

    const readbacks = getScoredOutcomeReadbacks(ws);
    const rb = readbacks.bySource.get('post::post-multi');
    expect(rb).toBeDefined();
    expect(rb!.checkpointDays).toBe(60);
    expect(rb!.score).toBe('strong_win');
    expect(rb!.currentPosition).toBe(4);
  });

  it('excludes inconclusive and insufficient_data outcomes', () => {
    const ws = `${WS_BASE}-inconc`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'strategy_keyword_added',
      sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
      sourceId: strategyPageKeywordSourceId('/x', 'inconclusive kw'),
      pageUrl: '/x',
      targetKeyword: 'inconclusive kw',
      baselineSnapshot: { captured_at: new Date().toISOString(), position: 9 },
    });
    recordOutcome({
      actionId: action.id, checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString() },
      score: 'inconclusive',
      deltaSummary: { primary_metric: 'position', baseline_value: 9, current_value: 9, delta_absolute: 0, delta_percent: 0, direction: 'stable' },
    });

    const readbacks = getScoredOutcomeReadbacks(ws);
    expect(readbacks.byKeyword.get('inconclusive kw')).toBeUndefined();
  });

  it('returns empty indexes for a workspace with no scored actions', () => {
    const ws = `${WS_BASE}-empty`;
    seedWorkspace(ws);
    const readbacks = getScoredOutcomeReadbacks(ws);
    expect(readbacks.bySource.size).toBe(0);
    expect(readbacks.byKeyword.size).toBe(0);
    expect(readbacks.byPage.size).toBe(0);
  });
});
