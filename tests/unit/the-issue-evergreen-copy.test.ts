// Evergreen-copy contract for the strategy-the-issue client surface.
//
// The client experiences The Issue as a continuously-current dashboard — NO time-relative
// language ("since last week", "this week", "vs last refresh", issue numbers, dates). This
// test asserts the centralized copy constants + helpers carry no banned temporal phrase, and
// that the guard helper itself works. The pr-check evergreen rule is the static twin; this is
// the programmatic one that also covers the dynamic helpers (loop status / work-in-flight).

import { describe, it, expect } from 'vitest';
import {
  ISSUE_SECTION_TITLES,
  ISSUE_SECTION_INTROS,
  ISSUE_CTA,
  loopStatusLine,
  workInFlightLine,
  hasTemporalLanguage,
  hasBaselineAnchor,
  baselineVerdict,
  ALLOWED_BASELINE_PATTERNS,
  ROLLING_WINDOW_PATTERNS,
} from '../../src/components/client/the-issue/evergreenCopy';

describe('the-issue evergreen copy', () => {
  it('no section title contains time-relative language', () => {
    for (const title of Object.values(ISSUE_SECTION_TITLES)) {
      expect(hasTemporalLanguage(title), `title "${title}"`).toBe(false);
    }
  });

  it('no section intro contains time-relative language', () => {
    for (const intro of Object.values(ISSUE_SECTION_INTROS)) {
      expect(hasTemporalLanguage(intro), `intro "${intro}"`).toBe(false);
    }
  });

  it('no CTA label contains time-relative language', () => {
    for (const cta of Object.values(ISSUE_CTA)) {
      expect(hasTemporalLanguage(cta), `cta "${cta}"`).toBe(false);
    }
  });

  it('CTA labels are "Request this"/"Discuss this" + "See the details", never "Act on this"/"open the brief" (D1)', () => {
    const all = Object.values(ISSUE_CTA).join(' ').toLowerCase();
    expect(all).toContain('request this');
    expect(all).toContain('discuss this');
    expect(all).toContain('see the details');
    // The retired pre-D1 greenlight label must never appear on the client surface.
    expect(all).not.toContain('act on this');
    expect(all).not.toContain('open the brief');
    expect(all).not.toContain('get brief');
  });

  it('loopStatusLine is evergreen and omits empty parts', () => {
    expect(loopStatusLine(0, 0)).toBeNull();
    const line = loopStatusLine(4, 1);
    expect(line).toBe("you've greenlit 4 moves · 1 in discussion");
    expect(hasTemporalLanguage(line!)).toBe(false);
    expect(loopStatusLine(1, 0)).toBe("you've greenlit 1 move");
  });

  it('workInFlightLine is evergreen and null at zero', () => {
    expect(workInFlightLine(0)).toBeNull();
    const line = workInFlightLine(3);
    expect(line).toBe('3 briefs in progress');
    expect(hasTemporalLanguage(line!)).toBe(false);
    expect(workInFlightLine(1)).toBe('1 brief in progress');
  });

  it('the guard catches known temporal violations', () => {
    expect(hasTemporalLanguage('Up 12% since last week')).toBe(true);
    expect(hasTemporalLanguage('vs last refresh')).toBe(true);
    expect(hasTemporalLanguage('This week we shipped')).toBe(true);
    expect(hasTemporalLanguage('Issue #15')).toBe(true);
    expect(hasTemporalLanguage('3 days ago')).toBe(true);
    // Evergreen state phrases are NOT temporal.
    expect(hasTemporalLanguage('what is working right now')).toBe(false);
    expect(hasTemporalLanguage('3 briefs in progress')).toBe(false);
  });
});

// ── C1: two-zone split (D2) ─────────────────────────────────────────────────
describe('the-issue evergreen — two-zone split (D2)', () => {
  it('plan zone bans rolling + relative windows', () => {
    expect(hasTemporalLanguage('up since last week', 'plan')).toBe(true);
    expect(hasTemporalLanguage('vs last refresh', 'plan')).toBe(true);
    expect(hasTemporalLanguage('Issue #15', 'plan')).toBe(true);
    expect(hasTemporalLanguage('The pieces we recommend writing next', 'plan')).toBe(false);
  });
  it('verdict zone allows since-engagement-start baselines, still bans rolling windows', () => {
    expect(hasTemporalLanguage('14 new patients, up from 6 since we started', 'verdict')).toBe(false);
    expect(hasTemporalLanguage('up from 9 since January', 'verdict')).toBe(false);
    expect(hasTemporalLanguage('up 12% vs last week', 'verdict')).toBe(true);
  });
  it('INVERSE law: a dateless verdict is a violation', () => {
    expect(hasTemporalLanguage('Your search visibility is strong', 'verdict')).toBe(true);
    expect(hasBaselineAnchor('Your search visibility is strong')).toBe(false);
    expect(hasBaselineAnchor('14 new patients, up from 6 since we started')).toBe(true);
    for (const re of ALLOWED_BASELINE_PATTERNS) expect(re).toBeInstanceOf(RegExp);
    expect(ROLLING_WINDOW_PATTERNS.length).toBeGreaterThan(0);
  });
  it('1-arg call defaults to plan-zone banning (back-compat)', () => {
    expect(hasTemporalLanguage('vs last refresh')).toBe(true);
    expect(hasTemporalLanguage('what is working right now')).toBe(false);
  });
});

// ── C2: baselineVerdict() ───────────────────────────────────────────────────
describe('baselineVerdict — verdict-zone copy generator', () => {
  it('emits a baseline-anchored sentence passing the verdict guard + carrying an anchor', () => {
    const s = baselineVerdict({ outcomeNoun: 'new patients', current: 14, baseline: 6 });
    expect(s).toContain('14 new patients');
    expect(s).toContain('since we started');
    expect(hasTemporalLanguage(s, 'verdict')).toBe(false);
    expect(hasBaselineAnchor(s)).toBe(true);
  });
  it('degrades to an establishing line (no fabricated delta) when baseline is null', () => {
    const s = baselineVerdict({ outcomeNoun: 'qualified leads', current: 3, baseline: null });
    expect(s).toContain('3 qualified leads');
    expect(s).toContain('establishing your baseline');
  });
  it('reports a decline honestly', () => {
    const s = baselineVerdict({ outcomeNoun: 'bookings', current: 5, baseline: 8 });
    expect(s).toContain('5 bookings');
    expect(s).toContain('down from 8');
    expect(hasTemporalLanguage(s, 'verdict')).toBe(false);
  });
});
