// tests/unit/useSeoEditor.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('useSeoEditor — endpoint contract', () => {
  const src = fs.readFileSync('src/hooks/admin/useSeoEditor.ts', 'utf-8');

  it('uses all-pages endpoint (not legacy /pages endpoint)', () => {
    expect(src).toContain('all-pages');
    expect(src).not.toMatch(/`\/api\/webflow\/pages\/\$\{siteId\}`/);
  });

  it('hook signature accepts workspaceId parameter', () => {
    expect(src).toContain('workspaceId');
  });

  it('workspaceId is appended as query param', () => {
    expect(src).toContain('workspaceId=${workspaceId}');
  });

  it('query enabled flag guards on siteId', () => {
    expect(src).toContain('!!siteId');
  });

  it('PageMeta includes source field', () => {
    expect(src).toContain("source?: 'static' | 'cms'");
  });

  it('PageMeta includes collectionId field', () => {
    expect(src).toContain('collectionId?: string');
  });
});
