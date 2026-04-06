// tests/unit/useSeoEditor.test.ts
// Contract tests for src/hooks/admin/useSeoEditor.ts
// These are structural tests — they guard the endpoint migration and PageMeta interface
// without requiring a full DOM environment to mount the hook.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('useSeoEditor — endpoint contract', () => {
  const src = fs.readFileSync('src/hooks/admin/useSeoEditor.ts', 'utf-8');

  it('uses all-pages endpoint (migration guard — must not regress to /pages/)', () => {
    expect(src).toContain('all-pages');
    // Negative guard: the legacy endpoint must not be re-introduced
    expect(src).not.toMatch(/`\/api\/webflow\/pages\/\$\{siteId\}`/);
  });

  it('hook accepts optional workspaceId parameter', () => {
    // workspaceId is optional — must appear as a parameter
    expect(src).toMatch(/useSeoEditor\s*\(\s*siteId.*workspaceId/);
  });

  it('PageMeta declares source field for CMS/static discrimination', () => {
    expect(src).toContain("source?: 'static' | 'cms'");
  });

  it('PageMeta declares optional collectionId for CMS write-back', () => {
    expect(src).toContain('collectionId?: string');
  });
});
