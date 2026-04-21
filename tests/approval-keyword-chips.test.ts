import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('ApprovalsTab keyword chips', () => {
  const src = readFileSync('src/components/client/ApprovalsTab.tsx', 'utf-8'); // readFile-ok — UI contract guard: asserts keyword chip feature props (pageMap, findPageKeywords, field gating, chip rendering) are wired correctly in ApprovalsTab after the chip feature was added.

  it('ApprovalsTabProps has pageMap optional prop', () => {
    expect(src).toMatch(/pageMap\??\s*:/);
  });

  it('slug-to-path lookup delegates to findPageMapEntryBySlug (handles nested pages)', () => {
    // The slug-to-path conversion moved into findPageMapEntryBySlug in pathUtils.ts,
    // which tries exact match then endsWith suffix fallback for nested pages.
    expect(src).toMatch(/findPageMapEntryBySlug/);
    const helpers = readFileSync('src/lib/pathUtils.ts', 'utf-8');
    expect(helpers).toMatch(/endsWith/);
  });

  it('keyword chips only render for seoTitle and seoDescription fields', () => {
    expect(src).toMatch(/item\.field\s*===\s*['"]seoTitle['"]/);
    expect(src).toMatch(/item\.field\s*===\s*['"]seoDescription['"]/);
  });

  it('renders primaryKeyword chip', () => {
    expect(src).toMatch(/primaryKeyword/);
    expect(src).toMatch(/targeting:/);
  });

  it('slices secondary keywords to 2 max', () => {
    expect(src).toMatch(/secondaryKeywords\?\.slice\s*\(\s*0\s*,\s*2\s*\)/);
  });
});
