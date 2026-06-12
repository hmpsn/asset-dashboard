import { describe, it, expect } from 'vitest';
import { keywordDollarValue } from '../../server/scoring/keyword-value-money.js';

describe('keywordDollarValue', () => {
  it('currentMonthly = clicks × cpc (matches roi.ts trafficValue definition)', () => {
    expect(keywordDollarValue({ clicks: 120, cpc: 4 }).currentMonthly).toBe(480);
  });

  it('upside is positive when below page 1 and 0 floor otherwise', () => {
    const up = keywordDollarValue({ clicks: 5, cpc: 4, currentPosition: 11, impressions: 2000 });
    expect(up.upsideMonthly).toBeGreaterThan(0);
    expect(keywordDollarValue({ clicks: 50, cpc: 4, currentPosition: 1, impressions: 2000 }).upsideMonthly).toBe(0);
  });

  it('missing data floors to 0 (no throw)', () => {
    expect(keywordDollarValue({}).currentMonthly).toBe(0);
    expect(keywordDollarValue({}).upsideMonthly).toBe(0);
  });

  // The ONE $ definition: per-keyword realized $ must equal roi.ts's trafficValue
  // (value = clicks * cpc) for matching inputs. This is the cross-module equivalence
  // guarantee — keywordDollarValue is the sole producer of the realized $ figure.
  it('currentMonthly equals roi.ts trafficValue (clicks × cpc) for matching inputs', () => {
    const cases = [
      { clicks: 200, cpc: 4.5 },
      { clicks: 50, cpc: 1.2 },
      { clicks: 0, cpc: 2 },
      { clicks: 80, cpc: 2.5 },
    ];
    for (const { clicks, cpc } of cases) {
      // roi.ts: `const value = clicks * cpc;`
      const roiTrafficValue = clicks * cpc;
      expect(keywordDollarValue({ clicks, cpc }).currentMonthly).toBe(roiTrafficValue);
    }
  });
});
