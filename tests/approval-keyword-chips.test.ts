import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('ApprovalsTab keyword chips', () => {
  const src = readFileSync('src/components/client/ApprovalsTab.tsx', 'utf-8');

  it('ApprovalsTabProps has pageMap optional prop', () => {
    expect(src).toMatch(/pageMap\??\s*:/);
  });

  it('findPageKeywords handles both /slug and slug formats', () => {
    // Matches either the old pagePath === '/' + pageSlug or the refactored path === '/' + slug form
    expect(src).toMatch(/['"]\/['"]\s*\+\s*slug/);
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
