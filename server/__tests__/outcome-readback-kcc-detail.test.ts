/**
 * W5.1 — outcome-readback-kcc-detail.test.ts
 *
 * Verifies buildKeywordCommandCenterDetail attaches the read-back outcome verdict
 * for a keyword that has a scored tracked action (joined via the keyword fallback),
 * and omits it when no scored action exists.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { buildKeywordCommandCenterDetail } from '../../server/keyword-command-center.js';

const WS_BASE = 'orbkcc-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS ORBKCC', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE ?)
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM rank_tracking_config WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

describe('buildKeywordCommandCenterDetail — outcome read-back', () => {
  it('attaches the scored outcome for a tracked keyword with a scored action', async () => {
    const ws = `${WS_BASE}-hit`;
    seedWorkspace(ws);
    addTrackedKeyword(ws, 'dental implants');

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'strategy_keyword_added',
      sourceType: 'strategy_page_keyword',
      sourceId: 'no-page::dental implants',
      pageUrl: null,
      targetKeyword: 'dental implants',
      baselineSnapshot: { captured_at: new Date().toISOString(), position: 22 },
    });
    recordOutcome({
      actionId: action.id, checkpointDays: 60,
      metricsSnapshot: { captured_at: new Date().toISOString(), position: 9 },
      score: 'strong_win',
      deltaSummary: { primary_metric: 'position', baseline_value: 22, current_value: 9, delta_absolute: -13, delta_percent: -59, direction: 'improved' },
    });

    const detail = await buildKeywordCommandCenterDetail(ws, 'dental implants');
    expect(detail).not.toBeNull();
    expect(detail!.outcome).toBeDefined();
    expect(detail!.outcome!.score).toBe('strong_win');
    expect(detail!.outcome!.currentPosition).toBe(9);
    expect(detail!.outcome!.checkpointDays).toBe(60);
  });

  it('omits outcome when the keyword has no scored action', async () => {
    const ws = `${WS_BASE}-miss`;
    seedWorkspace(ws);
    addTrackedKeyword(ws, 'unscored dental kw');

    const detail = await buildKeywordCommandCenterDetail(ws, 'unscored dental kw');
    expect(detail).not.toBeNull();
    expect(detail!.outcome).toBeUndefined();
  });
});
