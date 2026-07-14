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

import { describe, it, expect, afterAll, vi } from 'vitest';
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
  it('supports a measured-at window for current-month digest highlights', () => {
    const ws = `${WS_BASE}-window`;
    seedWorkspace(ws);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-30T23:59:59.999Z'));
      const prior = recordAction({ // recordAction-ok — isolated outcome fixture cleaned in afterAll
        attribution: 'platform_executed',
        workspaceId: ws,
        actionType: 'content_published',
        sourceType: 'test',
        sourceId: crypto.randomUUID(),
        pageUrl: '/prior-month',
        baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
      });
      recordOutcome({
        actionId: prior.id,
        checkpointDays: 30,
        metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
        score: 'win',
        deltaSummary: WIN_DELTA,
        attributedValue: 100,
        valueBasis: 'clicks_delta_x_cpc',
      });

      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const current = recordAction({ // recordAction-ok — isolated outcome fixture cleaned in afterAll
        attribution: 'platform_executed',
        workspaceId: ws,
        actionType: 'content_published',
        sourceType: 'test',
        sourceId: crypto.randomUUID(),
        pageUrl: '/current-month',
        baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
      });
      recordOutcome({
        actionId: current.id,
        checkpointDays: 30,
        metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
        score: 'win',
        deltaSummary: WIN_DELTA,
        attributedValue: 100,
        valueBasis: 'clicks_delta_x_cpc',
      });

      const highlights = getROIHighlightsFromOutcomes(ws, 10, {
        start: '2026-05-01T00:00:00.000Z',
        endExclusive: '2026-06-01T00:00:00.000Z',
      });

      expect(highlights.map((item) => item.pageUrl)).toEqual(['/current-month']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects the highest winning checkpoint inside the requested window', () => {
    const ws = `${WS_BASE}-checkpoint-window`;
    seedWorkspace(ws);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
      const action = recordAction({ // recordAction-ok — isolated outcome fixture cleaned in afterAll
        attribution: 'platform_executed',
        workspaceId: ws,
        actionType: 'content_published',
        sourceType: 'test',
        sourceId: crypto.randomUUID(),
        pageUrl: '/checkpoint-window',
        baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
      });
      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
        score: 'win',
        deltaSummary: WIN_DELTA,
        attributedValue: 100,
        valueBasis: 'clicks_delta_x_cpc',
      });

      vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));
      recordOutcome({
        actionId: action.id,
        checkpointDays: 60,
        metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 90 },
        score: 'strong_win',
        deltaSummary: { ...WIN_DELTA, current_value: 90, delta_absolute: 80, delta_percent: 800 },
        attributedValue: 200,
        valueBasis: 'clicks_delta_x_cpc',
      });

      const highlights = getROIHighlightsFromOutcomes(ws, 5, {
        start: '2026-05-01T00:00:00.000Z',
        endExclusive: '2026-05-23T00:00:00.000Z',
      });

      expect(highlights).toHaveLength(1);
      expect(highlights[0]).toMatchObject({
        pageUrl: '/checkpoint-window',
        clicksGained: 40,
        attributedValue: 100,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a non-empty ROIHighlight list for a workspace with a scored, valued outcome', () => {
    const ws = `${WS_BASE}-main`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
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

    // FIX 3: attributedValue must be surfaced in the ROIHighlight
    expect(first).toHaveProperty('attributedValue');
    expect(first.attributedValue).toBe(100);
    expect(first.attribution).toBe('platform_executed');
  });

  it('propagates externally_executed attribution into the client digest highlight', () => {
    const ws = `${WS_BASE}-external-attribution`;
    seedWorkspace(ws);
    const action = recordAction({ // recordAction-ok
      attribution: 'externally_executed',
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      pageUrl: '/client-implemented',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });
    recordOutcome({
      actionId: action.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
      score: 'win',
      deltaSummary: WIN_DELTA,
      attributedValue: 100,
      valueBasis: 'clicks_delta_x_cpc',
    });

    const [highlight] = getROIHighlightsFromOutcomes(ws, 5);

    expect(highlight.attribution).toBe('externally_executed');
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
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
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

  // C4 (attribution honesty): a `not_acted_on` action — an unexecuted proposal the
  // workspace never acted on — must NEVER contribute to the client monthly digest wins,
  // even when its outcome scored a win. getWinsWithValueByWorkspace (the digest's read
  // path) must exclude it via the `ta.attribution != 'not_acted_on'` predicate.
  it('excludes a not_acted_on action from digest wins even when its outcome scored a win', () => {
    const ws = `${WS_BASE}-not-acted-on`;
    seedWorkspace(ws);

    // An executed win — SHOULD appear.
    const executed = recordAction({ // recordAction-ok
      attribution: 'platform_executed',
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      pageUrl: '/executed-page',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });
    recordOutcome({
      actionId: executed.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 60 },
      score: 'strong_win',
      deltaSummary: { ...WIN_DELTA, delta_absolute: 50, delta_percent: 500 },
      attributedValue: 120,
      valueBasis: 'clicks_delta_x_cpc',
    });

    // An UNEXECUTED proposal that also "scored a win" — MUST NOT appear.
    const proposal = recordAction({ // recordAction-ok
      attribution: 'not_acted_on',
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      pageUrl: '/proposal-page',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });
    recordOutcome({
      actionId: proposal.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 90 },
      score: 'strong_win',
      deltaSummary: { ...WIN_DELTA, delta_absolute: 80, delta_percent: 800 },
      attributedValue: 200,
      valueBasis: 'clicks_delta_x_cpc',
    });

    const highlights = getROIHighlightsFromOutcomes(ws, 10);

    // Only the executed win survives.
    expect(highlights.length).toBe(1);
    expect(highlights[0].pageUrl).toBe('/executed-page');
    // The phantom proposal win must be absent.
    expect(highlights.some(h => h.pageUrl === '/proposal-page')).toBe(false);
  });

  it('excludes internal-only action-catalog entries from digest and value highlights', () => {
    const ws = `${WS_BASE}-client-hidden`;
    seedWorkspace(ws);

    const internalOnly = recordAction({ // recordAction-ok — isolated outcome fixture cleaned in afterAll
      attribution: 'platform_executed',
      workspaceId: ws,
      actionType: 'voice_calibrated',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      baselineSnapshot: { captured_at: new Date().toISOString() },
    });
    recordOutcome({
      actionId: internalOnly.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString() },
      score: 'strong_win',
      deltaSummary: WIN_DELTA,
      attributedValue: 999,
      valueBasis: 'manual',
    });

    const visible = recordAction({ // recordAction-ok — isolated outcome fixture cleaned in afterAll
      attribution: 'platform_executed',
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      pageUrl: '/visible-win',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
    });
    recordOutcome({
      actionId: visible.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 50 },
      score: 'win',
      deltaSummary: WIN_DELTA,
      attributedValue: 100,
      valueBasis: 'clicks_delta_x_cpc',
    });

    const highlights = getROIHighlightsFromOutcomes(ws, 10);

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ pageUrl: '/visible-win', attributedValue: 100 });
  });

  // FIX 4: dedup — an action with win outcomes at BOTH the 30-day and 60-day
  // checkpoints must yield exactly ONE highlight (the higher checkpoint wins).
  it('deduplicates: one action with wins at two checkpoints yields exactly one highlight', () => {
    const ws = `${WS_BASE}-dedup`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
      workspaceId: ws,
      actionType: 'content_published',
      sourceType: 'test',
      sourceId: crypto.randomUUID(),
      pageUrl: '/dedup-page',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 5 },
    });

    // Record wins at BOTH 30 and 60 days — pre-fix this would emit two highlights
    recordOutcome({
      actionId: action.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 20 },
      score: 'win',
      deltaSummary: { ...WIN_DELTA, delta_absolute: 15, delta_percent: 300 },
      attributedValue: 37.5,
      valueBasis: 'clicks_delta_x_cpc',
    });
    recordOutcome({
      actionId: action.id,
      checkpointDays: 60,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 40 },
      score: 'strong_win',
      deltaSummary: { ...WIN_DELTA, delta_absolute: 35, delta_percent: 700 },
      attributedValue: 87.5,
      valueBasis: 'clicks_delta_x_cpc',
    });

    const highlights = getROIHighlightsFromOutcomes(ws, 10);

    // Must be exactly 1 — not 2 — despite having win outcomes at two checkpoints
    expect(highlights.length).toBe(1);

    // The single highlight should correspond to the HIGHER checkpoint (60 days)
    // which has the stronger_win score and higher delta
    expect(highlights[0].pageUrl).toBe('/dedup-page');
  });
});
