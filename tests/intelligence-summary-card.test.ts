import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('IntelligenceSummaryCard component contract', () => {
  const src = readFileSync('src/components/client/IntelligenceSummaryCard.tsx', 'utf-8'); // readFile-ok — UI contract guard: asserts IntelligenceSummaryCard follows Three Laws of Color (blue data, no purple), uses useClientIntelligence, and gates Growth+ content in TierGate.

  it('uses useClientIntelligence hook', () => {
    expect(src).toMatch(/useClientIntelligence/);
  });

  it('uses blue for data metrics (Three Laws of Color)', () => {
    expect(src).toMatch(/text-blue-|bg-blue-/);
  });

  it('does NOT use purple (Three Laws of Color — purple is admin-only)', () => {
    expect(src).not.toMatch(/purple-/);
  });

  it('wraps Growth+ content in TierGate', () => {
    expect(src).toMatch(/TierGate/);
  });

  it('TierGate uses tier prop from workspace data, not intel.tier (prevents false downgrade on API error)', () => {
    // tier must come from the Props interface, not intel.tier
    expect(src).toMatch(/tier:\s*(string|Tier)/);  // Props definition (widen to allow Tier alias)
    expect(src).toMatch(/tier\s*\}/);              // destructured from props
    expect(src).not.toMatch(/intel\.tier/);        // NOT sourced from the fallible API response
  });
});
