/**
 * Unit tests for the positionColor / positionTone authority.
 *
 * Written FIRST (red → green TDD). These assertions will fail until the
 * functions are exported from src/components/ui/constants.ts.
 *
 * NOTE — deliberate visual change (Wave 2 Four-Laws fix):
 *   positionColor(10) → 'text-accent-success' (EMERALD), NOT 'text-accent-brand' (TEAL).
 *   Using teal for a read-only rank metric violates Four Law #1 (teal = actions).
 *   This fix also propagates to pageIntelligenceDisplay.positionColor (via delegation)
 *   and any call site migrated in T1 (KeywordStrategy, LowHangingFruit).
 */
import { describe, expect, it } from 'vitest';
import { positionColor, positionTone } from '../../src/components/ui/constants';

describe('positionColor — canonical rank color authority', () => {
  it('returns muted token for undefined (no ranking data)', () => {
    expect(positionColor(undefined)).toBe('text-[var(--brand-text-muted)]');
  });

  it('returns muted token for 0 (sentinel "no ranking")', () => {
    expect(positionColor(0)).toBe('text-[var(--brand-text-muted)]');
  });

  it('returns muted token for null', () => {
    expect(positionColor(null)).toBe('text-[var(--brand-text-muted)]');
  });

  it('returns success (emerald) for position 1', () => {
    expect(positionColor(1)).toBe('text-accent-success');
  });

  it('returns success (emerald) for position 3 (≤3 boundary)', () => {
    expect(positionColor(3)).toBe('text-accent-success');
  });

  it('returns success (emerald) for position 4 (4–10 band — Four-Laws fix: NOT teal)', () => {
    expect(positionColor(4)).toBe('text-accent-success');
  });

  it('returns success (emerald) for position 10 (≤10 boundary — Four-Laws fix: was teal, now emerald)', () => {
    // INTENTIONAL VISUAL CHANGE: previous DEF B used 'text-accent-brand' (teal) here.
    // Teal is reserved for actions; rank position is read-only data → emerald.
    expect(positionColor(10)).toBe('text-accent-success');
  });

  it('returns warning (amber) for position 11', () => {
    expect(positionColor(11)).toBe('text-accent-warning');
  });

  it('returns warning (amber) for position 20 (≤20 boundary)', () => {
    expect(positionColor(20)).toBe('text-accent-warning');
  });

  it('returns danger (red) for position 21', () => {
    expect(positionColor(21)).toBe('text-accent-danger');
  });

  it('returns danger (red) for large positions', () => {
    expect(positionColor(100)).toBe('text-accent-danger');
  });
});

describe('positionTone — BadgeTone variant for Badge consumers', () => {
  it('returns zinc tone for undefined (no ranking)', () => {
    expect(positionTone(undefined)).toBe('zinc');
  });

  it('returns zinc tone for null', () => {
    expect(positionTone(null)).toBe('zinc');
  });

  it('returns zinc tone for 0 (sentinel)', () => {
    expect(positionTone(0)).toBe('zinc');
  });

  it('returns emerald tone for position 5 (≤10)', () => {
    expect(positionTone(5)).toBe('emerald');
  });

  it('returns emerald tone for position 10 (boundary)', () => {
    expect(positionTone(10)).toBe('emerald');
  });

  it('returns amber tone for position 11 (11–20)', () => {
    expect(positionTone(11)).toBe('amber');
  });

  it('returns amber tone for position 15 (warning band)', () => {
    expect(positionTone(15)).toBe('amber');
  });

  it('returns amber tone for position 20 (boundary)', () => {
    expect(positionTone(20)).toBe('amber');
  });

  it('returns red tone for position 21', () => {
    expect(positionTone(21)).toBe('red');
  });

  it('returns red tone for position 100', () => {
    expect(positionTone(100)).toBe('red');
  });
});
