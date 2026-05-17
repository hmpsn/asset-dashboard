import { describe, expect, it } from 'vitest';
import type { SeoEditState, SeoEditorPage } from '../../src/components/editor/seoEditorTypes';
import {
  buildSeoApprovalItemsForPage,
  buildSeoApprovalItemsForSelection,
  filterAndSortSeoPages,
} from '../../src/components/editor/seoEditorDerived';

const staticPage: SeoEditorPage = {
  id: 'page-services',
  title: 'Services',
  slug: 'services',
  source: 'static',
  seo: { title: 'Old Title', description: 'Old Description' },
};

const cmsPage: SeoEditorPage = {
  id: 'cms-post-1',
  title: 'Post One',
  slug: 'blog/post-one',
  source: 'cms',
  seo: { title: 'CMS Title', description: 'CMS Description' },
};

describe('seoEditorDerived approval payload builders', () => {
  it('builds single-page approval items only for changed fields', () => {
    const edit: SeoEditState = { seoTitle: 'New Title', seoDescription: 'Old Description', dirty: true };
    const items = buildSeoApprovalItemsForPage(staticPage, edit);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      pageId: staticPage.id,
      field: 'seoTitle',
      currentValue: 'Old Title',
      proposedValue: 'New Title',
    });
  });

  it('returns no items for CMS pages in single-page flow', () => {
    const edit: SeoEditState = { seoTitle: 'New CMS Title', seoDescription: 'New CMS Description', dirty: true };
    expect(buildSeoApprovalItemsForPage(cmsPage, edit)).toHaveLength(0);
  });

  it('builds selection payload across pages and skips unchanged/missing edits', () => {
    const pages: SeoEditorPage[] = [staticPage, cmsPage];
    const edits: Record<string, SeoEditState> = {
      [staticPage.id]: { seoTitle: 'Old Title', seoDescription: 'New Description', dirty: true },
    };

    const items = buildSeoApprovalItemsForSelection([staticPage.id, cmsPage.id, 'missing'], pages, edits);

    expect(items).toHaveLength(1);
    expect(items[0].field).toBe('seoDescription');
    expect(items[0].proposedValue).toBe('New Description');
  });
});

describe('seoEditorDerived page filtering and ranking', () => {
  const pages: SeoEditorPage[] = [
    { id: 'a', title: 'About', slug: 'about', source: 'static', seo: { title: 'About', description: 'About page' } },
    { id: 'b', title: 'Contact', slug: 'contact', source: 'static', seo: { title: '', description: '' } },
    { id: 'c', title: 'Blog Post', slug: 'blog/post', source: 'cms', seo: { title: '', description: '' } },
  ];

  it('applies search filter across title and slug', () => {
    const result = filterAndSortSeoPages(pages, {
      search: 'contact',
      metadataRecommendationCountByPageId: new Map(),
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('ranks by missing SEO fields plus metadata recommendation count', () => {
    const result = filterAndSortSeoPages(pages, {
      search: '',
      metadataRecommendationCountByPageId: new Map([
        ['a', 3],
        ['b', 0],
      ]),
    });

    // page a score: 0 missing + 3 recs = 3
    // page b score: 4 missing + 0 recs = 4 (highest first)
    // page c score: 4 missing + 0 recs = 4 (ties preserve existing sort behavior)
    expect(result[0].id).toBe('b');
    expect(result[2].id).toBe('a');
  });
});
