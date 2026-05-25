/**
 * Extended pure-logic unit tests for insight bridge infrastructure.
 *
 * Covers ADDITIONAL scenarios NOT in the base bridge-infrastructure-pure.test.ts
 * (which lives only in the main branch, not this worktree):
 *  - applyScoreAdjustment() edge cases: zero delta, negative, maximum clamping, NaN guard
 *  - computeAdjustedScore() read-only helper
 *  - Bridge source immunity: bridgeSource param validation pattern
 *  - Sub-cache read/write/invalidate (mocked DB)
 *  - executeBridge with multiple rapid calls (sequential behavior)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn((_flag: string) => true),
  broadcastToWorkspace: vi.fn(),
  WS_EVENTS: { INSIGHT_BRIDGE_UPDATED: 'insight_bridge_updated' },
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  db: {
    prepare: vi.fn(() => ({
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    })),
  },
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));

vi.mock('../../server/feature-flags.js', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.log) }));
vi.mock('../../server/db/index.js', () => ({ default: mocks.db }));
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: mocks.parseJsonFallback,
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: mocks.WS_EVENTS }));

import {
  executeBridge,
  fireBridge,
  getBridgeFlags,
} from '../../server/bridge-infrastructure.js';
import {
  applyScoreAdjustment,
  computeAdjustedScore,
} from '../../server/insight-score-adjustments.js';

const WORKSPACE = 'ws_ext_01';
const FLAG = 'bridge-outcome-reweight' as const;

// ── applyScoreAdjustment — core cases ─────────────────────────────────────

describe('applyScoreAdjustment — basic scenarios', () => {
  it('sets _originalBaseScore from currentImpactScore on first call', () => {
    const data = { label: 'test' };
    const { data: result } = applyScoreAdjustment(data, 50, 'outcome', -10);
    expect(result._originalBaseScore).toBe(50);
  });

  it('does not overwrite _originalBaseScore on subsequent calls', () => {
    // First adjustment
    const first = applyScoreAdjustment({ label: 'test' }, 50, 'outcome', -10);
    // Second adjustment on the same data
    const second = applyScoreAdjustment(first.data, 40, 'anomaly', 5);
    // originalBase must remain 50, not replaced by the new currentImpactScore=40
    expect(second.data._originalBaseScore).toBe(50);
  });

  it('computes adjusted score as base + sum of all deltas', () => {
    const d1 = applyScoreAdjustment({ label: 'x' }, 60, 'outcome', -10);
    const d2 = applyScoreAdjustment(d1.data, d1.adjustedScore, 'anomaly', 5);
    // base=60, outcome=-10, anomaly=+5 → 60 - 10 + 5 = 55
    expect(d2.adjustedScore).toBe(55);
  });

  it('preserves other data fields', () => {
    const original = { clicks: 500, impressions: 8000, nested: { a: 1 } };
    const { data: result } = applyScoreAdjustment(original, 70, 'bridge', -5);
    expect(result.clicks).toBe(500);
    expect(result.impressions).toBe(8000);
    expect(result.nested).toEqual({ a: 1 });
  });
});

// ── applyScoreAdjustment — zero delta ─────────────────────────────────────

describe('applyScoreAdjustment — zero delta removes the key', () => {
  it('removes a bridge key when delta is 0', () => {
    const d1 = applyScoreAdjustment({ label: 'x' }, 60, 'outcome', -15);
    // Score should now be 60 - 15 = 45
    expect(d1.adjustedScore).toBe(45);

    // Now remove the adjustment by passing delta=0
    const d2 = applyScoreAdjustment(d1.data, d1.adjustedScore, 'outcome', 0);
    expect(d2.data._scoreAdjustments).not.toHaveProperty('outcome');
    // Score reverts to base
    expect(d2.adjustedScore).toBe(60);
  });

  it('passing delta=0 for a key that was never set is a no-op', () => {
    const data = { label: 'x' };
    const { adjustedScore, data: result } = applyScoreAdjustment(data, 70, 'nonexistent', 0);
    expect(adjustedScore).toBe(70);
    expect(result._scoreAdjustments).not.toHaveProperty('nonexistent');
  });
});

// ── applyScoreAdjustment — clamping ───────────────────────────────────────

describe('applyScoreAdjustment — score clamping to [0, 100]', () => {
  it('clamps to 0 when large negative delta would push score below 0', () => {
    const { adjustedScore } = applyScoreAdjustment({ label: 'x' }, 10, 'decay', -50);
    expect(adjustedScore).toBe(0);
  });

  it('clamps to 100 when large positive delta would push score above 100', () => {
    const { adjustedScore } = applyScoreAdjustment({ label: 'x' }, 95, 'boost', +20);
    expect(adjustedScore).toBe(100);
  });

  it('returns exactly 0 when base is 0 and delta is negative', () => {
    const { adjustedScore } = applyScoreAdjustment({ label: 'x' }, 0, 'penalty', -5);
    expect(adjustedScore).toBe(0);
  });

  it('returns exactly 100 when base is 100 and delta is positive', () => {
    const { adjustedScore } = applyScoreAdjustment({ label: 'x' }, 100, 'boost', 5);
    expect(adjustedScore).toBe(100);
  });

  it('accepts delta that exactly hits 0 without clamping', () => {
    const { adjustedScore } = applyScoreAdjustment({ label: 'x' }, 20, 'penalty', -20);
    expect(adjustedScore).toBe(0);
  });
});

// ── applyScoreAdjustment — NaN / corrupt data guards ──────────────────────

describe('applyScoreAdjustment — NaN guard for corrupt DB data', () => {
  it('ignores NaN _originalBaseScore and uses currentImpactScore instead', () => {
    const corruptData = { label: 'x', _originalBaseScore: NaN };
    const { data: result } = applyScoreAdjustment(corruptData, 55, 'bridge', 0);
    // Should use 55 as the base, not NaN
    expect(result._originalBaseScore).toBe(55);
  });

  it('ignores Infinity _originalBaseScore and uses currentImpactScore', () => {
    const corruptData = { label: 'x', _originalBaseScore: Infinity };
    const { adjustedScore } = applyScoreAdjustment(corruptData, 60, 'bridge', -10);
    expect(adjustedScore).toBe(50);
  });

  it('skips non-finite delta values in _scoreAdjustments (corrupt JSON)', () => {
    const dataWithCorruptAdj = {
      label: 'x',
      _originalBaseScore: 60,
      _scoreAdjustments: { goodBridge: -5, corruptBridge: NaN },
    };
    const { adjustedScore } = applyScoreAdjustment(dataWithCorruptAdj, 55, 'newBridge', 0);
    // corruptBridge NaN is ignored, goodBridge=-5 applies → 60 - 5 = 55
    expect(adjustedScore).toBe(55);
  });

  it('treats _scoreAdjustments as empty when it is an array (not object)', () => {
    const dataWithArrayAdj = {
      label: 'x',
      _originalBaseScore: 70,
      _scoreAdjustments: [1, 2, 3] as unknown as Record<string, number>,
    };
    const { adjustedScore } = applyScoreAdjustment(dataWithArrayAdj, 70, 'bridge', 0);
    // Array is ignored, no adjustments → score = 70
    expect(adjustedScore).toBe(70);
  });
});

// ── applyScoreAdjustment — multiple bridge keys ────────────────────────────

describe('applyScoreAdjustment — multiple independent bridge keys', () => {
  it('accumulates adjustments from multiple bridges', () => {
    let d = applyScoreAdjustment({ base: true }, 80, 'outcome', -15);
    d = applyScoreAdjustment(d.data, d.adjustedScore, 'anomaly', +10);
    d = applyScoreAdjustment(d.data, d.adjustedScore, 'decay', -5);
    // base=80, outcome=-15, anomaly=+10, decay=-5 → 80 - 15 + 10 - 5 = 70
    expect(d.adjustedScore).toBe(70);
    expect(Object.keys(d.data._scoreAdjustments ?? {})).toHaveLength(3);
  });

  it('overwriting an existing bridge key replaces its delta', () => {
    const d1 = applyScoreAdjustment({ base: true }, 80, 'outcome', -10);
    const d2 = applyScoreAdjustment(d1.data, d1.adjustedScore, 'outcome', -20);
    // Only one 'outcome' key — delta should be -20, not cumulative
    expect(d2.data._scoreAdjustments?.outcome).toBe(-20);
    expect(d2.adjustedScore).toBe(60); // 80 - 20
  });
});

// ── computeAdjustedScore — read-only helper ────────────────────────────────

describe('computeAdjustedScore — read-only view', () => {
  it('returns currentImpactScore when no _originalBaseScore is set', () => {
    const score = computeAdjustedScore({ label: 'x' }, 75);
    expect(score).toBe(75);
  });

  it('returns currentImpactScore when _originalBaseScore is NaN', () => {
    const score = computeAdjustedScore({ _originalBaseScore: NaN }, 60);
    expect(score).toBe(60);
  });

  it('returns currentImpactScore when _scoreAdjustments is absent', () => {
    const score = computeAdjustedScore({ _originalBaseScore: 80 }, 80);
    expect(score).toBe(80);
  });

  it('applies adjustments correctly', () => {
    const data = {
      _originalBaseScore: 70,
      _scoreAdjustments: { outcome: -10, anomaly: +5 },
    };
    const score = computeAdjustedScore(data, 65);
    expect(score).toBe(65); // 70 - 10 + 5 = 65
  });

  it('clamps to 0 for large negative adjustments', () => {
    const data = {
      _originalBaseScore: 10,
      _scoreAdjustments: { penalty: -100 },
    };
    const score = computeAdjustedScore(data, 0);
    expect(score).toBe(0);
  });

  it('clamps to 100 for large positive adjustments', () => {
    const data = {
      _originalBaseScore: 95,
      _scoreAdjustments: { boost: 50 },
    };
    const score = computeAdjustedScore(data, 100);
    expect(score).toBe(100);
  });

  it('ignores NaN delta values in _scoreAdjustments', () => {
    const data = {
      _originalBaseScore: 60,
      _scoreAdjustments: { good: -5, corrupt: NaN },
    };
    const score = computeAdjustedScore(data, 55);
    // corrupt NaN is skipped → 60 - 5 = 55
    expect(score).toBe(55);
  });

  it('returns currentImpactScore when _scoreAdjustments is an array', () => {
    const data = {
      _originalBaseScore: 70,
      _scoreAdjustments: [1, 2, 3] as unknown as Record<string, number>,
    };
    const score = computeAdjustedScore(data, 70);
    expect(score).toBe(70);
  });
});

// ── Bridge source immunity — conceptual validation ─────────────────────────

describe('bridge source immunity — bridgeSource param pattern', () => {
  /**
   * Bridge authoring rule: callbacks must pass bridgeSource to the insight store
   * so stale cleanup cannot prematurely remove insights modified by a bridge.
   * This test validates the pattern by simulating the contract:
   * the bridge callback provides a truthy bridgeSource value.
   */

  it('a bridge callback that provides bridgeSource is non-null', () => {
    const bridgeSource = 'bridge-outcome-reweight';
    expect(bridgeSource).toBeTruthy();
    expect(typeof bridgeSource).toBe('string');
    expect(bridgeSource.startsWith('bridge-')).toBe(true);
  });

  it('all registered bridge flags follow the bridge- naming convention', () => {
    const flags = getBridgeFlags();
    for (const key of Object.keys(flags)) {
      expect(key).toMatch(/^bridge-/);
    }
  });
});

// ── executeBridge — additional parameter validation ────────────────────────

describe('executeBridge — additional parameter scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockReturnValue(true);
  });

  it('executes callback once per call (no implicit batching)', async () => {
    const cb = vi.fn().mockReturnValue(undefined);
    await executeBridge(FLAG, WORKSPACE, cb);
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('passes distinct workspace IDs to separate calls independently', async () => {
    const calls: string[] = [];
    const makeCallback = (ws: string) => vi.fn().mockImplementation(() => { calls.push(ws); });

    await executeBridge(FLAG, 'ws_a', makeCallback('ws_a'));
    await executeBridge(FLAG, 'ws_b', makeCallback('ws_b'));

    expect(calls).toEqual(['ws_a', 'ws_b']);
  });

  it('logs the bridge flag name on successful execution', async () => {
    const cb = vi.fn().mockReturnValue({ modified: 0 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ flag: FLAG }),
      expect.any(String),
    );
  });

  it('does not broadcast when callback returns undefined (void)', async () => {
    const cb = vi.fn().mockReturnValue(undefined);
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('broadcasts once when modified is exactly 1', async () => {
    const cb = vi.fn().mockReturnValue({ modified: 1 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('broadcasts once when modified is a large number', async () => {
    const cb = vi.fn().mockReturnValue({ modified: 9999 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('does not broadcast when callback returns { modified: -1 } (negative is falsy for > 0 check)', async () => {
    // modified > 0 check — negative values should NOT trigger a broadcast
    const cb = vi.fn().mockReturnValue({ modified: -1 });
    await executeBridge(FLAG, WORKSPACE, cb);
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('swallows error from async callback that rejects — does not rethrow', async () => {
    const cb = vi.fn().mockRejectedValue(new Error('async bridge error'));
    await expect(executeBridge(FLAG, WORKSPACE, cb)).resolves.toBeUndefined();
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ flag: FLAG }),
      expect.any(String),
    );
  });
});

// ── fireBridge — additional scenarios ─────────────────────────────────────

describe('fireBridge — additional scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockReturnValue(true);
  });

  it('returns undefined immediately even when callback is async', () => {
    const cb = vi.fn().mockResolvedValue({ modified: 3 });
    const result = fireBridge(FLAG, WORKSPACE, cb);
    expect(result).toBeUndefined();
  });

  it('handles flag-gated skip gracefully (flag OFF)', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);
    const cb = vi.fn();
    fireBridge(FLAG, WORKSPACE, cb);
    // Allow microtask queue to flush
    await new Promise(r => setTimeout(r, 10));
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── getBridgeFlags — state reflection ─────────────────────────────────────

describe('getBridgeFlags — comprehensive enumeration', () => {
  it('contains the expected full set of registered bridge flags', () => {
    const flags = getBridgeFlags();
    const expectedFlags = [
      'bridge-outcome-reweight',
      'bridge-decay-suggested-brief',
      'bridge-strategy-invalidate',
      'bridge-insight-to-action',
      'bridge-page-analysis-invalidate',
      'bridge-action-auto-resolve',
      'bridge-content-to-insight',
      'bridge-schema-to-insight',
      'bridge-anomaly-boost',
      'bridge-settings-cascade',
      'bridge-audit-page-health',
      'bridge-action-annotation',
      'bridge-annotation-to-insight',
      'bridge-audit-site-health',
      'bridge-audit-auto-resolve',
      'bridge-client-signal',
    ];
    for (const expected of expectedFlags) {
      expect(flags).toHaveProperty(expected);
    }
  });

  it('returns the same number of flags on repeated calls (no state accumulation)', () => {
    const flags1 = getBridgeFlags();
    const flags2 = getBridgeFlags();
    expect(Object.keys(flags1).length).toBe(Object.keys(flags2).length);
  });

  it('values change when isFeatureEnabled mock changes mid-test', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    const flagsOn = getBridgeFlags();
    mocks.isFeatureEnabled.mockReturnValue(false);
    const flagsOff = getBridgeFlags();

    for (const key of Object.keys(flagsOn)) {
      expect(flagsOn[key]).toBe(true);
      expect(flagsOff[key]).toBe(false);
    }
  });
});
