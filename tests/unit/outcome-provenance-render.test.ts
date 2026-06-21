import { describe, it, expect } from 'vitest';
import { resolveProvenanceRender } from '../../src/components/client/the-issue/outcomeProvenance';

describe('resolveProvenanceRender', () => {
  it('estimate_ga4 → estimate label, banded money, estimate disclosure', () => {
    const r = resolveProvenanceRender('estimate_ga4');
    expect(r.qualifier).toMatch(/estimate/i); expect(r.isExact).toBe(false);
    expect(r.fmtMoney(11_234)).toBe('~$11,000'); expect(r.disclosure(800)).toMatch(/estimate/i);
  });
  it('measured_action → "tracked on your site", EXACT count but BANDED dollar (value = count × estimated rate)', () => {
    const r = resolveProvenanceRender('measured_action');
    // isExact describes the COUNT graduation (a measured truth on the site).
    expect(r.qualifier).toMatch(/tracked on your site/i); expect(r.isExact).toBe(true);
    // The DOLLAR stays banded (~$) — the dollar overclaim fix: a measured count × an estimated lead
    // value is still an estimate at the dollar layer. Only P3 actual_reconciled graduates the dollar.
    expect(r.fmtMoney(11_234)).toBe('~$11,000');
    // Disclosure is measured-framed but acknowledges the value is approximate ("about ~$").
    expect(r.disclosure(800)).toMatch(/measured/i);
  });
  it('actual_reconciled → exact at BOTH count and dollar, "actual", no estimate language (P3-ready)', () => {
    const r = resolveProvenanceRender('actual_reconciled');
    expect(r.isExact).toBe(true); expect(r.fmtMoney(11_234)).toBe('$11,234'); expect(r.qualifier).not.toMatch(/estimate/i);
  });
});
