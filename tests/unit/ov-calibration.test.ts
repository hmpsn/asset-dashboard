/**
 * Unit tests for server/scoring/ov-calibration.ts (PR5 · Spine C / §4 Spine E).
 *
 * Covers the identity-safe contract + the win-rate-derived calibration basis:
 *  - < MIN_OUTCOMES          → 1.0 (identity)
 *  - >= MIN_OUTCOMES         → clamp(0.75, 1.25, 0.75 + 0.5*winRate), shifts with data
 *  - failure                 → 1.0 (try/catch safety)
 *
 * Seeds REAL tracked_actions + action_outcomes rows (FK off in tests) so the
 * production getCalibrationOutcomes read path is exercised end-to-end.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import db from '../../server/db/index.js';
import { computeOvCalibration, MIN_OUTCOMES } from '../../server/scoring/ov-calibration.js';

const WS = 'ovcal-test-ws';

function cleanup() {
  db.prepare("DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE 'ovcal-test-%')").run();
  db.prepare("DELETE FROM tracked_actions WHERE workspace_id LIKE 'ovcal-test-%'").run();
}

let seq = 0;
function seedOutcome(workspaceId: string, score: string, attributedValue: number | null) {
  const actionId = `ovcal-act-${seq++}`;
  db.prepare(`
    INSERT INTO tracked_actions (id, workspace_id, action_type, source_type)
    VALUES (?, ?, 'meta_updated', 'recommendation')
  `).run(actionId, workspaceId);
  db.prepare(`
    INSERT INTO action_outcomes (id, action_id, checkpoint_days, score, attributed_value, value_basis)
    VALUES (?, ?, 90, ?, ?, ?)
  `).run(`ovcal-out-${seq++}`, actionId, score, attributedValue, attributedValue != null ? 'clicks_delta_x_cpc' : null);
}

beforeEach(() => {
  cleanup();
  seq = 0;
});

afterAll(cleanup);

describe('computeOvCalibration — identity-safe gates', () => {
  it('returns 1.0 when there are zero outcomes', () => {
    expect(computeOvCalibration(WS)).toBe(1.0);
  });

  it('returns 1.0 when fewer than MIN_OUTCOMES qualify', () => {
    for (let i = 0; i < MIN_OUTCOMES - 1; i++) seedOutcome(WS, 'win', 50);
    expect(computeOvCalibration(WS)).toBe(1.0);
  });

  it('ignores outcomes with null attributed_value toward the MIN_OUTCOMES threshold', () => {
    // MIN_OUTCOMES winning outcomes but all with null value → not counted → identity.
    for (let i = 0; i < MIN_OUTCOMES; i++) seedOutcome(WS, 'win', null);
    expect(computeOvCalibration(WS)).toBe(1.0);
  });

  it('ignores inconclusive/insufficient_data scores toward the threshold', () => {
    for (let i = 0; i < MIN_OUTCOMES; i++) seedOutcome(WS, 'inconclusive', 100);
    expect(computeOvCalibration(WS)).toBe(1.0);
  });
});

describe('computeOvCalibration — win-rate-derived shift (clamped 0.75..1.25)', () => {
  it('all wins → ceiling 1.25', () => {
    for (let i = 0; i < MIN_OUTCOMES + 1; i++) seedOutcome(WS, 'strong_win', 100);
    expect(computeOvCalibration(WS)).toBe(1.25);
  });

  it('no wins (all losses) → floor 0.75', () => {
    for (let i = 0; i < MIN_OUTCOMES + 1; i++) seedOutcome(WS, 'loss', 5);
    expect(computeOvCalibration(WS)).toBe(0.75);
  });

  it('half wins → ~1.0 neutral', () => {
    // 4 wins + 4 losses = 8 qualifying, winRate 0.5 → 0.75 + 0.25 = 1.0
    for (let i = 0; i < 4; i++) seedOutcome(WS, 'win', 80);
    for (let i = 0; i < 4; i++) seedOutcome(WS, 'loss', 10);
    expect(computeOvCalibration(WS)).toBeCloseTo(1.0, 5);
  });

  it('result is always within the [0.75, 1.25] band', () => {
    for (let i = 0; i < 3; i++) seedOutcome(WS, 'strong_win', 200);
    for (let i = 0; i < 3; i++) seedOutcome(WS, 'neutral', 20);
    const c = computeOvCalibration(WS);
    expect(c).toBeGreaterThanOrEqual(0.75);
    expect(c).toBeLessThanOrEqual(1.25);
  });

  it('all-neutral → 1.0 identity (neutral is a modest realized gain, not a loss — must NOT drag to the 0.75 floor)', () => {
    for (let i = 0; i < MIN_OUTCOMES + 1; i++) seedOutcome(WS, 'neutral', 30);
    // realization = 0.5 → 0.75 + 0.5*0.5 = 1.0 (PR5-review fix; previously 0.75)
    expect(computeOvCalibration(WS)).toBeCloseTo(1.0, 5);
  });
});
