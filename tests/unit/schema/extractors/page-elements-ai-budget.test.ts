/**
 * Unit tests for the per-regenerate AI budget helper. PR1 ships with no
 * AI calls (every extractor receives a budget of 0), but PR2's image-role
 * classifier and HowTo disambiguator depend on this contract:
 *
 *   - createAiBudget(0) → tryConsumeAiBudget returns false on first call
 *   - createAiBudget(N) → exactly N successful consumes, then exhausted
 *   - exhausted flag tracks the post-consume state
 *
 * Pinning this here means PR2 cannot accidentally ship with an off-by-one
 * that bypasses the budget cap.
 */
import { describe, it, expect } from 'vitest';
import { createAiBudget, tryConsumeAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';

describe('AI budget', () => {
  describe('createAiBudget', () => {
    it('initializes with max set, zero used, and not exhausted', () => {
      const b = createAiBudget(5);
      expect(b).toEqual({ max: 5, used: 0, exhausted: false });
    });

    it('initializes a zero budget as not-yet-exhausted (consume-once flips the flag)', () => {
      const b = createAiBudget(0);
      // exhausted is false until the first consume attempt sets it.
      expect(b.exhausted).toBe(false);
    });
  });

  describe('tryConsumeAiBudget', () => {
    it('returns false on first call when max is 0 (PR1 default)', () => {
      const b = createAiBudget(0);
      expect(tryConsumeAiBudget(b)).toBe(false);
      expect(b.used).toBe(0);
      expect(b.exhausted).toBe(true);
    });

    it('returns true exactly max times, then false', () => {
      const b = createAiBudget(3);
      expect(tryConsumeAiBudget(b)).toBe(true);
      expect(tryConsumeAiBudget(b)).toBe(true);
      expect(tryConsumeAiBudget(b)).toBe(true);
      expect(tryConsumeAiBudget(b)).toBe(false);
      expect(tryConsumeAiBudget(b)).toBe(false); // still false after exhaustion
      expect(b.used).toBe(3);
      expect(b.exhausted).toBe(true);
    });

    it('flips exhausted=true on the consume that hits the cap', () => {
      const b = createAiBudget(2);
      expect(tryConsumeAiBudget(b)).toBe(true);
      expect(b.exhausted).toBe(false); // 1/2 — not yet
      expect(tryConsumeAiBudget(b)).toBe(true);
      expect(b.exhausted).toBe(true); // 2/2 — exhausted now
    });

    it('does not increment used past max (no leak under spam)', () => {
      const b = createAiBudget(1);
      tryConsumeAiBudget(b);
      tryConsumeAiBudget(b);
      tryConsumeAiBudget(b);
      tryConsumeAiBudget(b);
      expect(b.used).toBe(1);
    });
  });
});

describe('Shared budget across multiple consumers (PR2 plumbing)', () => {
  it('a single budget enforces the cap across N consumers', () => {
    const shared = createAiBudget(3);
    // Simulate 3 pages each trying to consume 2 calls.
    const consumed: boolean[] = [];
    for (let page = 0; page < 3; page++) {
      for (let call = 0; call < 2; call++) {
        consumed.push(tryConsumeAiBudget(shared));
      }
    }
    // Total attempts: 6. Cap: 3. So exactly 3 true, then 3 false.
    expect(consumed.filter(Boolean).length).toBe(3);
    expect(consumed.filter(c => !c).length).toBe(3);
    expect(shared.exhausted).toBe(true);
  });
});
