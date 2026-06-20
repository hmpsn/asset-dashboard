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
