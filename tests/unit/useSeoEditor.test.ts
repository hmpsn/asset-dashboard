// tests/unit/useSeoEditor.test.ts
// Contract tests for src/hooks/admin/useSeoEditor.ts
// SeoEditor uses the all-pages endpoint for visibility into sitemap-discovered
// CMS pages, while write paths keep using explicit static-page guards.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('useSeoEditor — endpoint contract', () => {
  const src = fs.readFileSync('src/hooks/admin/useSeoEditor.ts', 'utf-8'); // readFile-ok — intentional endpoint guard

  it('uses all-pages endpoint for static + CMS visibility', () => {
    expect(src).toMatch(/\/api\/webflow\/all-pages\//);
    expect(src).not.toMatch(/\/api\/webflow\/pages\//);
  });

  it('PageMeta declares source field for CMS/static discrimination', () => {
    expect(src).toContain("source?: 'static' | 'cms'");
  });

  it('PageMeta declares optional collectionId for CMS write-back', () => {
    expect(src).toContain('collectionId?: string');
  });
});
