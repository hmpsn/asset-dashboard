import { describe, it, expect } from 'vitest';
import { fmtMeasuredMoney, fmtOutcomeMoney } from '../../src/utils/formatNumbers';

describe('fmtMeasuredMoney (exact, measured-labeled)', () => {
  it('exact whole dollars, no ~ band, no cents', () => {
    expect(fmtMeasuredMoney(11_234)).toBe('$11,234');
    expect(fmtMeasuredMoney(1_499)).toBe('$1,499');
  });
  it('renders $0 honestly, guards non-finite to em-dash', () => {
    expect(fmtMeasuredMoney(0)).toBe('$0');
    expect(fmtMeasuredMoney(Number.NaN)).toBe('—');
  });
});
describe('fmtOutcomeMoney (provenance-driven selector)', () => {
  it('estimate_ga4 → banded ~ estimate', () => { expect(fmtOutcomeMoney(11_234, 'estimate_ga4')).toBe('~$11,000'); });
  it('measured_action → exact', () => { expect(fmtOutcomeMoney(11_234, 'measured_action')).toBe('$11,234'); });
  it('actual_reconciled → exact (P3-ready)', () => { expect(fmtOutcomeMoney(11_234, 'actual_reconciled')).toBe('$11,234'); });
});
