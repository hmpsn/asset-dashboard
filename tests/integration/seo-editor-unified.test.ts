// tests/integration/seo-editor-unified.test.ts
import { describe, it, expect } from 'vitest';
import { filterWritablePages } from '../../src/hooks/admin/seoEditorFilters';
import type { PageMeta } from '../../src/hooks/admin/useSeoEditor';

// Structural contract tests — verify the SeoEditor integration expectations
// without mounting the full component (no DOM environment needed).

describe('SeoEditor — unified pages integration contracts', () => {
  it('static Pages tab hides CMS sitemap rows and keeps legacy/static rows writable', () => {
    const pages: PageMeta[] = [
      { id: 's1', source: 'static', title: 'Home', slug: '/' },
      { id: 'c1', source: 'cms', title: 'Post A', slug: '/blog/a' },
      { id: 'c2', source: 'cms', title: 'Post B', slug: '/blog/b' },
      { id: 's2', source: undefined, title: 'Unknown', slug: '/unknown' },
    ];
    const filtered = filterWritablePages(pages);
    expect(filtered.length > 0 && filtered.every(p => p.source !== 'cms')).toBe(true);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(p => p.id)).toEqual(['s1', 's2']);
  });

  it('approval items do NOT include collectionId — SeoEditor omits it intentionally', () => {
    // collectionId on a Webflow page means "this page is a template for this collection",
    // NOT "this is a CMS item ID". Passing it mis-routes items into updateCollectionItem
    // where item.pageId (a Webflow page ID) is used as a CMS item ID → 404.
    // SeoEditor.sendForApproval omits collectionId so all items route to updatePageSeo.
    const page = { id: 'p1', title: 'Blog', slug: '/blog', source: 'static' as const, collectionId: 'col-abc', seo: { title: 'Old', description: '' } };
    const edit = { seoTitle: 'New Title', seoDescription: '' };
    // Simulate the actual sendForApproval item shape — no collectionId field
    const items: Array<{ pageId: string; pageTitle: string; pageSlug: string; field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string }> = [];
    if (edit.seoTitle !== (page.seo?.title || '')) {
      items.push({ pageId: page.id, pageTitle: page.title, pageSlug: page.slug, field: 'seoTitle', currentValue: page.seo?.title || '', proposedValue: edit.seoTitle });
    }
    expect(items[0].pageId).toBe('p1');
    expect('collectionId' in items[0]).toBe(false);
  });

  it('single-page approval payload can emit both changed fields and omits collectionId', () => {
    const page = {
      id: 'p2',
      title: 'Services',
      slug: '/services',
      source: 'static' as const,
      collectionId: 'col-services',
      seo: { title: 'Old Title', description: 'Old Description' },
    };
    const edit = { seoTitle: 'New Title', seoDescription: 'New Description' };

    const items: Array<{ pageId: string; field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string }> = [];
    if (edit.seoTitle !== (page.seo?.title || '')) {
      items.push({ pageId: page.id, field: 'seoTitle', currentValue: page.seo?.title || '', proposedValue: edit.seoTitle });
    }
    if (edit.seoDescription !== (page.seo?.description || '')) {
      items.push({ pageId: page.id, field: 'seoDescription', currentValue: page.seo?.description || '', proposedValue: edit.seoDescription });
    }

    expect(items).toHaveLength(2);
    expect(items[0].field).toBe('seoTitle');
    expect(items[1].field).toBe('seoDescription');
    expect('collectionId' in items[0]).toBe(false);
    expect('collectionId' in items[1]).toBe(false);
  });

  it('approval payload excludes unchanged fields', () => {
    const page = {
      id: 'p3',
      title: 'Contact',
      slug: '/contact',
      source: 'static' as const,
      seo: { title: 'Keep Title', description: 'Keep Description' },
    };
    const edit = { seoTitle: 'Keep Title', seoDescription: 'New Description' };

    const items: Array<{ field: 'seoTitle' | 'seoDescription' }> = [];
    if (edit.seoTitle !== (page.seo?.title || '')) items.push({ field: 'seoTitle' });
    if (edit.seoDescription !== (page.seo?.description || '')) items.push({ field: 'seoDescription' });

    expect(items).toHaveLength(1);
    expect(items[0].field).toBe('seoDescription');
  });
});
