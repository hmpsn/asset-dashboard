// tests/unit/useSeoEditor.test.ts
// Contract tests for src/hooks/admin/useSeoEditor.ts
// SeoEditor uses the static pages endpoint (/api/webflow/pages/).
// CMS collection items are edited through the separate CmsEditor component
// which fetches real item IDs from the CMS Items API.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('useSeoEditor — endpoint contract', () => {
  const src = fs.readFileSync('src/hooks/admin/useSeoEditor.ts', 'utf-8'); // readFile-ok — intentional endpoint guard

  it('uses static pages endpoint (CMS items handled by CmsEditor)', () => {
    expect(src).toMatch(/\/api\/webflow\/pages\//);
    // Must NOT use all-pages — that returns sitemap CMS pages with synthetic IDs
    // that cannot be written back to Webflow. CMS editing lives in CmsEditor.
    expect(src).not.toContain('all-pages');
  });

  it('PageMeta declares source field for CMS/static discrimination', () => {
    expect(src).toContain("source?: 'static' | 'cms'");
  });

  it('PageMeta declares optional collectionId for CMS write-back', () => {
    expect(src).toContain('collectionId?: string');
  });
});
