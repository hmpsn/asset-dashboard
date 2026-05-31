/**
 * Task 2.3 — digest-roi-from-outcomes.test.ts
 *
 * Verifies that digest roiHighlights is non-empty for a workspace that has
 * a scored, valued action_outcome row.
 *
 * TDD requirement: write failing test FIRST with REALISTIC data (the test
 * should fail before the implementation because the live monthly-digest still
 * reads the dead roi_attributions table, which has no rows, and returns []).
 * After the implementation the test passes.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome, getROIHighlightsFromOutcomes } from '../../server/outcome-tracking.js';
import type { ROIHighlight } from '../../shared/types/narrative.js';

const WS_BASE = 'digest-roi-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test Digest ROI WS', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (
      SELECT id FROM tracked_actions WHERE workspace_id LIKE ?
    )
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

const WIN_DELTA = {
  primary_metric: 'clicks',
  baseline_value: 10,
  current_value: 50,
  delta_absolute: 40,
  delta_percent: 400,
  direction: 'improved' as const,
};

describe('getROIHighlightsFromOutcomes', () => {
  it('returns a non-empty ROIHighlight list for a workspace with a scored, valued outcome', () => {
    const ws = `${WS_BASE}-main`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      pageUrl: '/our-services',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });

    recordOutcome({
      actionId: action.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
      score: 'strong_win',
      deltaSummary: WIN_DELTA,
      attributedValue: 100,
      valueBasis: 'clicks_delta_x_cpc',
    });

    const highlights: ROIHighlight[] = getROIHighlightsFromOutcomes(ws, 5);

    // Must be non-empty
    expect(highlights.length).toBeGreaterThan(0);

    // Check shape of the first item
    const first = highlights[0];
    expect(first).toHaveProperty('pageTitle');
    expect(first).toHaveProperty('pageUrl');
    expect(first).toHaveProperty('action');
    expect(first).toHaveProperty('result');
    expect(first).toHaveProperty('clicksGained');
    expect(typeof first.clicksGained).toBe('number');

    // The outcome has clicks delta of 40 — clicksGained must reflect it
    expect(first.clicksGained).toBe(40);

    // pageUrl must reflect the tracked action's pageUrl
    expect(first.pageUrl).toBe('/our-services');
  });

  it('returns an empty list for a workspace with no scored outcomes', () => {
    const ws = `${WS_BASE}-empty`;
    seedWorkspace(ws);

    const highlights = getROIHighlightsFromOutcomes(ws, 5);
    expect(highlights).toEqual([]);
  });

  it('respects the limit parameter', () => {
    const ws = `${WS_BASE}-limit`;
    seedWorkspace(ws);

    for (let i = 0; i < 4; i++) {
      const action = recordAction({ // recordAction-ok
        workspaceId: ws,
        actionType: 'content_published',
        sourceType: 'test',
        sourceId: crypto.randomUUID(),
        pageUrl: `/page-${i}`,
        baselineSnapshot: { captured_at: new Date().toISOString(), clicks: i * 10 },
      });
      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: { captured_at: new Date().toISOString(), clicks: (i + 1) * 20 },
        score: 'win',
        deltaSummary: { ...WIN_DELTA, delta_absolute: (i + 1) * 10, delta_percent: 100 + i * 50 },
        attributedValue: (i + 1) * 25,
        valueBasis: 'clicks_delta_x_cpc',
      });
    }

    const highlights = getROIHighlightsFromOutcomes(ws, 2);
    expect(highlights.length).toBeLessThanOrEqual(2);
  });
});
