// tests/contract/strategy-autosend-eligibility.test.ts
//
// CONTRACT: the auto-send eligibility set + trust threshold (The Issue, Phase 4 trust ladder).
//
// Locked design: ONLY `quick_win` and `technical` are auto-send-eligible. The four
// money/judgment-heavy buckets (authority_bet, refresh_reclaim, defend, local) are NEVER
// auto-send-eligible — the operator always gates them. The threshold to EARN auto-send is exactly 3
// consecutive ISO-week cycles. This is a pure type/const contract (zero DB, zero server) — it pins
// the eligibility set so a future archetype addition can't silently widen auto-send.

import { describe, it, expect } from 'vitest';
import {
  AUTOSEND_ELIGIBLE_ARCHETYPES,
  AUTOSEND_TRUST_THRESHOLD,
  isAutoSendEligible,
} from '../../shared/types/strategy-autosend.js';
import { ARCHETYPE_ORDER } from '../../shared/types/strategy-archetype.js';
import type { Archetype } from '../../shared/types/strategy-archetype.js';

// The four buckets that must NEVER be auto-send-eligible (the money + judgment-heavy archetypes).
const EXCLUDED_ARCHETYPES: Archetype[] = ['authority_bet', 'refresh_reclaim', 'defend', 'local'];

describe('auto-send eligibility contract', () => {
  it('AUTOSEND_ELIGIBLE_ARCHETYPES is exactly [quick_win, technical]', () => {
    expect([...AUTOSEND_ELIGIBLE_ARCHETYPES].sort()).toEqual(['quick_win', 'technical']);
  });

  it('every eligible archetype is a member of the Archetype union (ARCHETYPE_ORDER)', () => {
    for (const a of AUTOSEND_ELIGIBLE_ARCHETYPES) {
      expect(ARCHETYPE_ORDER).toContain(a);
    }
  });

  it('the eligible set is a strict SUBSET of all archetypes (never the full union)', () => {
    expect(AUTOSEND_ELIGIBLE_ARCHETYPES.length).toBeLessThan(ARCHETYPE_ORDER.length);
    for (const a of AUTOSEND_ELIGIBLE_ARCHETYPES) {
      expect(ARCHETYPE_ORDER.includes(a)).toBe(true);
    }
  });

  it('the four excluded archetypes are NOT eligible', () => {
    for (const a of EXCLUDED_ARCHETYPES) {
      expect(AUTOSEND_ELIGIBLE_ARCHETYPES.includes(a as never)).toBe(false);
      expect(isAutoSendEligible(a)).toBe(false);
    }
  });

  it('eligible + excluded together partition the entire Archetype union (no archetype unaccounted for)', () => {
    const covered = new Set<Archetype>([
      ...(AUTOSEND_ELIGIBLE_ARCHETYPES as readonly Archetype[]),
      ...EXCLUDED_ARCHETYPES,
    ]);
    expect([...covered].sort()).toEqual([...ARCHETYPE_ORDER].sort());
  });

  it('isAutoSendEligible matches AUTOSEND_ELIGIBLE_ARCHETYPES for every archetype', () => {
    for (const a of ARCHETYPE_ORDER) {
      expect(isAutoSendEligible(a)).toBe((AUTOSEND_ELIGIBLE_ARCHETYPES as readonly string[]).includes(a));
    }
  });

  it('the trust threshold is exactly 3', () => {
    expect(AUTOSEND_TRUST_THRESHOLD).toBe(3);
  });
});
