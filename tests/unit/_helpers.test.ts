import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/briefing-anchors.js', () => ({
  findBestWeekSince: vi.fn(),
}));

import { findBestWeekSince } from '../../server/briefing-anchors.js';
import {
  appendAnchor,
  fmtLongDateUTC,
  fmtNum,
  fmtShortDateUTC,
} from '../../server/briefing-templates/_helpers.js';

describe('briefing-templates/_helpers', () => {
  it('fmtNum formats finite values and clamps negatives to zero', () => {
    expect(fmtNum(611)).toBe('611');
    expect(fmtNum(8600)).toBe('8.6k');
    expect(fmtNum(1_840_000)).toBe('1.8m');
    expect(fmtNum(-5)).toBe('0');
    expect(fmtNum(Number.NaN)).toBe('0');
  });

  it('fmtNum avoids 1000.0k rollover by promoting to 1.0m', () => {
    expect(fmtNum(999_950)).toBe('1.0m');
  });

  it('formats UTC dates in short and long forms, empty on invalid input', () => {
    expect(fmtShortDateUTC('2026-04-14T12:00:00.000Z')).toBe('Apr 14');
    expect(fmtLongDateUTC('2026-04-14T12:00:00.000Z')).toBe('Apr 14, 2026');
    expect(fmtShortDateUTC('bad-date')).toBe('');
    expect(fmtLongDateUTC(Number.NaN)).toBe('');
  });

  it('appendAnchor is punctuation-idempotent and sentence-cases anchor phrase', () => {
    vi.mocked(findBestWeekSince).mockReturnValue({
      phrase: 'best week since Mar 17',
      sinceWeekOf: '2026-03-17',
    });

    const a = appendAnchor(
      'Source: GSC last-28-day window',
      'ws-1',
      'total_clicks',
      500,
    );
    const b = appendAnchor(
      'Source: GSC last-28-day window.',
      'ws-1',
      'total_clicks',
      500,
    );

    expect(a).toBe('Source: GSC last-28-day window. Best week since Mar 17.');
    expect(b).toBe('Source: GSC last-28-day window. Best week since Mar 17.');
  });

  it('appendAnchor falls back to a single terminal period when no anchor or non-finite current', () => {
    vi.mocked(findBestWeekSince).mockReturnValue(null);

    expect(appendAnchor('Receipt text', 'ws-1', 'total_clicks', 123))
      .toBe('Receipt text.');
    expect(appendAnchor('Receipt text.', 'ws-1', 'total_clicks', Number.POSITIVE_INFINITY))
      .toBe('Receipt text.');
  });
});
