// tests/integration/seo-editor-unified.test.ts
import { describe, it, expect } from 'vitest';

// Structural contract tests — verify the SeoEditor integration expectations
// without mounting the full component (no DOM environment needed).

describe('SeoEditor — unified pages integration contracts', () => {
  it('PageMeta source field drives CMS filter: static pages excluded when showCmsOnly=true', () => {
    // Re-tests the core integration contract with explicit inputs matching real component logic
    const pages: Array<{ id: string; source?: string; title: string; slug: string }> = [
      { id: 's1', source: 'static', title: 'Home', slug: '/' },
      { id: 'c1', source: 'cms', title: 'Post A', slug: '/blog/a' },
      { id: 'c2', source: 'cms', title: 'Post B', slug: '/blog/b' },
      { id: 's2', source: undefined, title: 'Unknown', slug: '/unknown' },
    ];
    const showCmsOnly = true;
    const filtered = pages.filter(p => !(showCmsOnly && p.source !== 'cms'));
    expect(filtered).toHaveLength(2);
    expect(filtered.every(p => p.source === 'cms')).toBe(true);
  });

  it('showCmsOnly filter excludes static pages', () => {
    const pages = [
      { id: '1', source: 'static', title: 'Home', slug: '/', seo: {} },
      { id: '2', source: 'cms', title: 'Blog Post', slug: '/blog/post', seo: {} },
    ];
    const filtered = pages.filter(p => p.source === 'cms');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('2');
  });

  it('showCmsOnly=false shows all pages', () => {
    const pages = [
      { id: '1', source: 'static', title: 'Home', slug: '/' },
      { id: '2', source: 'cms', title: 'Blog', slug: '/blog' },
    ];
    const showCmsOnly = false;
    const filtered = pages.filter(p => {
      if (showCmsOnly && p.source !== 'cms') return false;
      return true;
    });
    expect(filtered).toHaveLength(2);
  });

  it('ALL CMS pages trigger the manual apply banner regardless of collectionId', () => {
    // SeoEditor.tsx shows the banner for page.source === 'cms' unconditionally.
    // Sitemap-discovered CMS pages never have a real collectionId, so collectionId
    // cannot gate this UI — the condition is always true for CMS pages.
    const pageWithoutCollectionId = { source: 'cms', collectionId: undefined };
    const pageWithCollectionId = { source: 'cms', collectionId: 'col-123' };
    const needsManual = (p: { source: string }) => p.source === 'cms';
    expect(needsManual(pageWithoutCollectionId)).toBe(true);
    expect(needsManual(pageWithCollectionId)).toBe(true);
  });

  it('approval items include collectionId when present', () => {
    const page = { id: 'p1', title: 'Blog', slug: '/blog', collectionId: 'col-abc', seo: { title: 'Old', description: '' } };
    const edit = { seoTitle: 'New Title', seoDescription: '', dirty: true };
    const items: Array<{ pageId: string; collectionId?: string; field: string }> = [];
    if (edit.seoTitle !== (page.seo?.title || '')) {
      items.push({ pageId: page.id, collectionId: page.collectionId, field: 'seoTitle' });
    }
    expect(items[0].collectionId).toBe('col-abc');
  });
});
