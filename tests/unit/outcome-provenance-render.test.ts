import { describe, it, expect } from 'vitest';
import { resolveProvenanceRender } from '../../src/components/client/the-issue/outcomeProvenance';

describe('resolveProvenanceRender', () => {
  it('estimate_ga4 → estimate label, banded money, estimate disclosure', () => {
    const r = resolveProvenanceRender('estimate_ga4');
    expect(r.qualifier).toMatch(/estimate/i); expect(r.isExact).toBe(false);
    expect(r.fmtMoney(11_234)).toBe('~$11,000'); expect(r.disclosure(800)).toMatch(/estimate/i);
  });
  it('measured_action → "tracked on your site", exact money, measured disclosure (NOT estimate language)', () => {
    const r = resolveProvenanceRender('measured_action');
    expect(r.qualifier).toMatch(/tracked on your site/i); expect(r.isExact).toBe(true);
    expect(r.fmtMoney(11_234)).toBe('$11,234');
    expect(r.disclosure(800)).toMatch(/measured/i); expect(r.disclosure(800)).not.toMatch(/estimate/i);
  });
  it('actual_reconciled → exact, "actual", no estimate language (P3-ready)', () => {
    const r = resolveProvenanceRender('actual_reconciled');
    expect(r.isExact).toBe(true); expect(r.fmtMoney(11_234)).toBe('$11,234'); expect(r.qualifier).not.toMatch(/estimate/i);
  });
});
