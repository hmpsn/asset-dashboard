import { describe, it, expect } from 'vitest';
import { bandEstimateMoney, exactMoney, formatOutcomeMoney } from '../../shared/format-money';

describe('bandEstimateMoney (2 sig figs, ~$ band)', () => {
  it('bands dollars to two significant figures with a ~ prefix', () => {
    expect(bandEstimateMoney(11_200)).toBe('~$11,000');
    expect(bandEstimateMoney(11_234)).toBe('~$11,000');
    expect(bandEstimateMoney(1_499)).toBe('~$1,500');
    expect(bandEstimateMoney(94_900)).toBe('~$95,000');
  });
  it('floors small values to a readable band, not $0', () => {
    expect(bandEstimateMoney(950)).toBe('~$950');
    expect(bandEstimateMoney(42)).toBe('~$42');
    expect(bandEstimateMoney(0)).toBe('~$0');
  });
  it('bands large values', () => {
    expect(bandEstimateMoney(1_250_000)).toBe('~$1,300,000');
  });
  it('never emits cents on an estimate', () => {
    expect(bandEstimateMoney(11_234)).not.toMatch(/\.\d/);
  });
  it('preserves sign and guards non-finite to an em-dash sentinel', () => {
    expect(bandEstimateMoney(-11_234)).toBe('~-$11,000');
    expect(bandEstimateMoney(Number.NaN)).toBe('—');
    expect(bandEstimateMoney(Infinity)).toBe('—');
  });
});

describe('exactMoney (exact whole dollars, no band)', () => {
  it('exact whole dollars, no ~ band, no cents', () => {
    expect(exactMoney(11_200)).toBe('$11,200');
    expect(exactMoney(11_234)).toBe('$11,234');
    expect(exactMoney(1_499)).toBe('$1,499');
  });
  it('renders $0 honestly, guards non-finite to em-dash', () => {
    expect(exactMoney(0)).toBe('$0');
    expect(exactMoney(Number.NaN)).toBe('—');
  });
});

describe('formatOutcomeMoney (band UNLESS actual_reconciled — gate D)', () => {
  it('estimate_ga4 → banded', () => {
    expect(formatOutcomeMoney(11_200, 'estimate_ga4')).toBe('~$11,000');
  });
  it('measured_action → banded (count exact, dollar still count × estimated rate)', () => {
    expect(formatOutcomeMoney(11_200, 'measured_action')).toBe('~$11,000');
  });
  it('actual_reconciled → exact', () => {
    expect(formatOutcomeMoney(11_200, 'actual_reconciled')).toBe('$11,200');
  });
});
