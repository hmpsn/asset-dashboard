/**
 * opportunity-timing decay-math tests (PR7 · Spine B).
 *
 * Covers:
 *   1. computeTimingBoosts returns an EMPTY map when the events flag is OFF
 *      (the no-op gate → timingBoost 0 everywhere → identity scoring).
 *   2. When ON, it aggregates the DECAYING boost per page:
 *      boost_page = Σ boost·exp(−ageDays/halfLifeDays).
 *   3. The per-page total is CAPPED at MAX_PAGE_BOOST so Timing can't hijack #1.
 *   4. Negligible (fully decayed) contributions are dropped.
 *   5. maxBoostForPages returns the max boost across a rec's affected pages (or 0).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { setFlagOverride } from '../../server/feature-flags.js';
import { insertOpportunityEvent } from '../../server/opportunity-events.js';
import {
  computeTimingBoosts,
  maxBoostForPages,
  MAX_PAGE_BOOST,
  NEGLIGIBLE_BOOST,
} from '../../server/scoring/opportunity-timing.js';

const WS = 'ot-test-ws';
const NOW = new Date('2026-06-01T00:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function cleanup() {
  db.prepare("DELETE FROM opportunity_events WHERE workspace_id LIKE 'ot-test-%'").run();
  setFlagOverride('opportunity-value-events', null);
}

beforeEach(cleanup);
afterAll(cleanup);

describe('computeTimingBoosts — no-op gate', () => {
  it('returns an EMPTY map when the events flag is OFF (even with events present)', () => {
    setFlagOverride('opportunity-value-events', false);
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'a', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(0) });
    const boosts = computeTimingBoosts(WS, NOW);
    expect(boosts.size).toBe(0);
  });
});

describe('computeTimingBoosts — decay math (flag ON)', () => {
  beforeEach(() => setFlagOverride('opportunity-value-events', true));

  it('applies a freshly-detected event at full boost (age 0 → exp(0)=1)', () => {
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'a', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(0) });
    const b = computeTimingBoosts(WS, NOW).get('a')!;
    expect(b).toBeCloseTo(0.5, 5);
  });

  it('halves a contribution at one half-life of age (exp(−1)≈0.368)', () => {
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'a', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(14) });
    const b = computeTimingBoosts(WS, NOW).get('a')!;
    expect(b).toBeCloseTo(0.5 * Math.exp(-1), 4);
  });

  it('sums multiple events on the SAME page', () => {
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'a', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(0) });
    insertOpportunityEvent({ workspaceId: WS, type: 'rank_drop', pagePath: '/A/', boost: 0.4, halfLifeDays: 10, detectedAt: daysAgo(0) });
    // Both normalise to slug 'a' → 0.5 + 0.4 = 0.9.
    const b = computeTimingBoosts(WS, NOW).get('a')!;
    expect(b).toBeCloseTo(0.9, 5);
  });

  it('CAPS the per-page total at MAX_PAGE_BOOST (across DISTINCT events)', () => {
    // Distinct keywords → distinct dedup keys → they stack (not deduped to one).
    for (let i = 0; i < 6; i++) {
      insertOpportunityEvent({ workspaceId: WS, type: 'competitor', pagePath: 'a', keyword: `kw${i}`, boost: 0.6, halfLifeDays: 7, detectedAt: daysAgo(0) });
    }
    // 6 × 0.6 = 3.6 uncapped → capped to MAX_PAGE_BOOST.
    const b = computeTimingBoosts(WS, NOW).get('a')!;
    expect(b).toBe(MAX_PAGE_BOOST);
  });

  it('DEDUPS re-detection of the same logical event — refresh, not stack', () => {
    // Same (workspace,type,page,keyword): the second insert REFRESHES the row.
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'b', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(5) });
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'b', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(0) });
    // One row at the latest detection (age 0) → 0.5, NOT 2 stacked and NOT the stale decayed one.
    const b = computeTimingBoosts(WS, NOW).get('b')!;
    expect(b).toBeCloseTo(0.5, 5);
  });

  it('drops a fully-decayed (negligible) contribution', () => {
    // 0.5 · exp(−200/14) ≈ 3e-7 < NEGLIGIBLE_BOOST → skipped → no key for the page.
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'old', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(200) });
    const boosts = computeTimingBoosts(WS, NOW);
    expect(boosts.has('old')).toBe(false);
    // Sanity: the chosen age really is below the negligible floor.
    expect(0.5 * Math.exp(-200 / 14)).toBeLessThan(NEGLIGIBLE_BOOST);
  });

  it('ignores domain-level events (null pagePath)', () => {
    insertOpportunityEvent({ workspaceId: WS, type: 'competitor', keyword: 'kw', boost: 0.6, halfLifeDays: 7, detectedAt: daysAgo(0) });
    expect(computeTimingBoosts(WS, NOW).size).toBe(0);
  });

  it('keeps pages independent', () => {
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'a', boost: 0.5, halfLifeDays: 14, detectedAt: daysAgo(0) });
    insertOpportunityEvent({ workspaceId: WS, type: 'decay', pagePath: 'b', boost: 0.3, halfLifeDays: 14, detectedAt: daysAgo(0) });
    const boosts = computeTimingBoosts(WS, NOW);
    expect(boosts.get('a')).toBeCloseTo(0.5, 5);
    expect(boosts.get('b')).toBeCloseTo(0.3, 5);
  });
});

describe('maxBoostForPages', () => {
  it('returns 0 for an empty map (the flag-off identity path)', () => {
    expect(maxBoostForPages(new Map(), ['a', 'b'])).toBe(0);
  });
  it('returns 0 for empty affectedPages', () => {
    expect(maxBoostForPages(new Map([['a', 0.5]]), [])).toBe(0);
  });
  it('returns the MAX boost across the affected pages (slug-normalised)', () => {
    const boosts = new Map([['a', 0.5], ['b', 0.9]]);
    expect(maxBoostForPages(boosts, ['/A/', '/B/'])).toBe(0.9);
    expect(maxBoostForPages(boosts, ['a'])).toBe(0.5);
    expect(maxBoostForPages(boosts, ['c'])).toBe(0);
  });
});
