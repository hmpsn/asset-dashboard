/**
 * Unit tests for server/opportunity-weights.ts (PR5 · Spine C).
 *
 * Covers:
 *  - getOrCreateWorkspaceWeights returns non-nullable platform DEFAULT_WEIGHTS
 *    by default
 *  - the persisted weights round-trip exactly (lockstep mapper parity)
 *  - upsert overwrites in place
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import db from '../../server/db/index.js';
import { getOrCreateWorkspaceWeights, upsertWorkspaceWeights } from '../../server/opportunity-weights.js';
import { DEFAULT_WEIGHTS } from '../../server/scoring/opportunity-value.js';
import type { OpportunityWeights } from '../../shared/types/recommendations.js';

const WS = 'ow-test-ws';
const WS2 = 'ow-test-ws-2';

function cleanup() {
  db.prepare("DELETE FROM workspace_opportunity_weights WHERE workspace_id LIKE 'ow-test-%'").run();
}

beforeEach(cleanup);
afterAll(cleanup);

describe('getOrCreateWorkspaceWeights', () => {
  it('returns a non-null OpportunityWeights at platform defaults when no row exists', () => {
    const w = getOrCreateWorkspaceWeights(WS);
    expect(w).not.toBeNull();
    expect(w).toEqual(DEFAULT_WEIGHTS);
    expect(w.calibrationVersion).toBe('platform-default');
  });

  it('persists the default row so a second call reads it back identically', () => {
    const first = getOrCreateWorkspaceWeights(WS);
    const second = getOrCreateWorkspaceWeights(WS);
    expect(second).toEqual(first);
    expect(second).toEqual(DEFAULT_WEIGHTS);
  });

  it('round-trips custom calibrated weights through the DB (mapper parity)', () => {
    const custom: OpportunityWeights = {
      demand: 0.3,
      winnability: 0.25,
      intent: 0.15,
      effort: 0.1,
      businessFit: 0.1,
      timing: 0.05,
      evidence: 0.05,
      calibrationVersion: 'ridge-2026-06',
    };
    upsertWorkspaceWeights(WS2, custom);
    expect(getOrCreateWorkspaceWeights(WS2)).toEqual(custom);
  });

  it('upsert overwrites the prior weights in place', () => {
    upsertWorkspaceWeights(WS, { ...DEFAULT_WEIGHTS, demand: 0.9, calibrationVersion: 'v1' });
    upsertWorkspaceWeights(WS, { ...DEFAULT_WEIGHTS, demand: 0.1, calibrationVersion: 'v2' });
    const w = getOrCreateWorkspaceWeights(WS);
    expect(w.demand).toBe(0.1);
    expect(w.calibrationVersion).toBe('v2');
  });
});
