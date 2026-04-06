// tests/unit/seoEditorCmsFilter.test.ts
// Behavioral tests for the CMS-page filtering utilities in
// src/hooks/admin/seoEditorFilters.ts.
//
// These tests import the REAL utility functions used by SeoEditor.tsx so that:
//   - Any regression in the filtering logic (e.g. removing the source !== 'cms'
//     check) will cause named tests here to fail before Webflow sees the request
//   - The test suite acts as a living specification of the invariant:
//     "CMS pages with synthetic IDs must never reach a Webflow write API call"
//
// Test structure mirrors each utility function exported from seoEditorFilters.ts.

import { describe, it, expect } from 'vitest';
import type { PageMeta } from '../../src/hooks/admin/useSeoEditor.js';
import {
  isSyntheticCmsId,
  filterWritablePages,
  filterWritableItems,
  filterWritableIds,
  filterPagesNeedingFix,
  countMissingField,
} from '../../src/hooks/admin/seoEditorFilters.js';

// ── Test fixtures ──────────────────────────────────────────────────────────────

const staticWithTitle: PageMeta = {
  id: 'page-about',
  title: 'About',
  slug: 'about',
  source: 'static',
  seo: { title: 'About Us | Acme', description: 'Learn about Acme.' },
};

const staticMissingTitle: PageMeta = {
  id: 'page-services',
  title: 'Services',
  slug: 'services',
  source: 'static',
  seo: { title: '', description: 'Our services.' },
};

const staticMissingDesc: PageMeta = {
  id: 'page-contact',
  title: 'Contact',
  slug: 'contact',
  source: 'static',
  seo: { title: 'Contact Us', description: '' },
};

const staticMissingBoth: PageMeta = {
  id: 'page-blank',
  title: 'Blank',
  slug: 'blank',
  source: 'static',
  seo: {},
};

const cmsWithSeo: PageMeta = {
  id: 'cms-blog-a-post',
  title: 'A Blog Post',
  slug: 'blog/a-post',
  source: 'cms',
  seo: { title: 'A Post Title', description: 'A post description.' },
};

const cmsMissingTitle: PageMeta = {
  id: 'cms-blog-no-title',
  title: 'No Title Post',
  slug: 'blog/no-title',
  source: 'cms',
  seo: { description: 'Some description.' },
};

const cmsMissingBoth: PageMeta = {
  id: 'cms-blog-empty',
  title: 'Empty CMS',
  slug: 'blog/empty',
  source: 'cms',
  seo: {},
};

// No source field — treated as static (source !== 'cms' is falsy for undefined)
const legacyPage: PageMeta = {
  id: 'page-legacy',
  title: 'Legacy',
  slug: 'legacy',
  seo: { title: 'Legacy', description: 'Old page.' },
};

const ALL_PAGES: PageMeta[] = [
  staticWithTitle,
  staticMissingTitle,
  staticMissingDesc,
  staticMissingBoth,
  cmsWithSeo,
  cmsMissingTitle,
  cmsMissingBoth,
  legacyPage,
];

// ── isSyntheticCmsId ───────────────────────────────────────────────────────────

describe('isSyntheticCmsId', () => {
  it('returns true for ids starting with cms-', () => {
    expect(isSyntheticCmsId('cms-blog-post-slug')).toBe(true);
    expect(isSyntheticCmsId('cms-')).toBe(true);
    expect(isSyntheticCmsId('cms-a')).toBe(true);
  });

  it('returns false for real Webflow page ids', () => {
    expect(isSyntheticCmsId('page-about')).toBe(false);
    expect(isSyntheticCmsId('67a3b2c1d4e5f6a7b8c9d0e1')).toBe(false);
    expect(isSyntheticCmsId('')).toBe(false);
  });

  it('all CMS test fixtures are synthetic', () => {
    const cmsPages = ALL_PAGES.filter(p => p.source === 'cms');
    expect(cmsPages.length).toBeGreaterThan(0);
    expect(cmsPages.every(p => isSyntheticCmsId(p.id))).toBe(true);
  });

  it('no static test fixtures are synthetic', () => {
    const staticPages = ALL_PAGES.filter(p => p.source !== 'cms');
    expect(staticPages.length).toBeGreaterThan(0);
    expect(staticPages.every(p => !isSyntheticCmsId(p.id))).toBe(true);
  });
});

// ── filterWritablePages ────────────────────────────────────────────────────────

describe('filterWritablePages', () => {
  it('excludes all CMS pages', () => {
    const result = filterWritablePages(ALL_PAGES);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(p => p.source !== 'cms')).toBe(true);
    expect(result.some(p => p.id.startsWith('cms-'))).toBe(false);
  });

  it('preserves all static pages', () => {
    const result = filterWritablePages(ALL_PAGES);
    expect(result.map(p => p.id)).toContain(staticWithTitle.id);
    expect(result.map(p => p.id)).toContain(staticMissingBoth.id);
    expect(result.map(p => p.id)).toContain(legacyPage.id);
  });

  it('returns empty array for CMS-only input', () => {
    expect(filterWritablePages([cmsWithSeo, cmsMissingBoth])).toHaveLength(0);
  });

  it('returns full array when no CMS pages present', () => {
    const staticOnly = [staticWithTitle, staticMissingTitle, legacyPage];
    expect(filterWritablePages(staticOnly)).toHaveLength(3);
  });
});

// ── filterWritableItems ────────────────────────────────────────────────────────

describe('filterWritableItems (applyBulkRewrite pre-filter)', () => {
  const previewItems = [
    { pageId: staticWithTitle.id, newValue: 'New Title A' },
    { pageId: staticMissingTitle.id, newValue: 'New Title B' },
    { pageId: cmsWithSeo.id, newValue: 'Should be excluded' },
    { pageId: cmsMissingBoth.id, newValue: 'Should be excluded' },
    { pageId: legacyPage.id, newValue: 'New Title C' },
  ];

  it('excludes items whose page is CMS', () => {
    const result = filterWritableItems(previewItems, ALL_PAGES);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(i => i.pageId.startsWith('cms-'))).toBe(false);
  });

  it('preserves items whose page is static', () => {
    const result = filterWritableItems(previewItems, ALL_PAGES);
    expect(result.map(i => i.pageId)).toContain(staticWithTitle.id);
    expect(result.map(i => i.pageId)).toContain(staticMissingTitle.id);
    expect(result.map(i => i.pageId)).toContain(legacyPage.id);
  });

  it('result length equals input minus CMS items (progress total is accurate)', () => {
    const result = filterWritableItems(previewItems, ALL_PAGES);
    const cmsCount = previewItems.filter(i => i.pageId.startsWith('cms-')).length;
    expect(result.length).toBe(previewItems.length - cmsCount);
  });

  it('returns empty for CMS-only preview', () => {
    const cmsOnly = [{ pageId: cmsWithSeo.id, newValue: 'x' }];
    expect(filterWritableItems(cmsOnly, ALL_PAGES)).toHaveLength(0);
  });

  it('preserves item shape (no field stripping)', () => {
    const items = [{ pageId: staticWithTitle.id, newValue: 'v', extra: 42 }];
    const result = filterWritableItems(items, ALL_PAGES);
    expect(result[0]).toEqual(items[0]);
  });
});

// ── filterWritableIds ──────────────────────────────────────────────────────────

describe('filterWritableIds (previewPattern selection filter)', () => {
  const selected = [
    staticWithTitle.id,
    staticMissingTitle.id,
    cmsWithSeo.id,
    cmsMissingBoth.id,
    legacyPage.id,
  ];

  it('excludes CMS page ids', () => {
    const result = filterWritableIds(selected, ALL_PAGES);
    expect(result).not.toContain(cmsWithSeo.id);
    expect(result).not.toContain(cmsMissingBoth.id);
  });

  it('preserves static page ids', () => {
    const result = filterWritableIds(selected, ALL_PAGES);
    expect(result).toContain(staticWithTitle.id);
    expect(result).toContain(staticMissingTitle.id);
    expect(result).toContain(legacyPage.id);
  });

  it('returns empty array when all selected are CMS', () => {
    expect(filterWritableIds([cmsWithSeo.id, cmsMissingBoth.id], ALL_PAGES)).toHaveLength(0);
  });
});

// ── filterPagesNeedingFix ──────────────────────────────────────────────────────

describe('filterPagesNeedingFix (handleBulkFix input)', () => {
  it('excludes CMS pages even when they are missing the field', () => {
    const titleFix = filterPagesNeedingFix(ALL_PAGES, 'title');
    expect(titleFix.length).toBeGreaterThan(0);
    expect(titleFix.some(p => p.source === 'cms')).toBe(false);
    // cmsMissingTitle and cmsMissingBoth are missing titles but are CMS — must be excluded
    expect(titleFix.map(p => p.id)).not.toContain(cmsMissingTitle.id);
    expect(titleFix.map(p => p.id)).not.toContain(cmsMissingBoth.id);
  });

  it('includes static pages missing the title field', () => {
    const titleFix = filterPagesNeedingFix(ALL_PAGES, 'title');
    expect(titleFix.map(p => p.id)).toContain(staticMissingTitle.id);
    expect(titleFix.map(p => p.id)).toContain(staticMissingBoth.id);
  });

  it('excludes static pages that already have the title field', () => {
    const titleFix = filterPagesNeedingFix(ALL_PAGES, 'title');
    expect(titleFix.map(p => p.id)).not.toContain(staticWithTitle.id);
  });

  it('includes static pages missing the description field', () => {
    const descFix = filterPagesNeedingFix(ALL_PAGES, 'description');
    expect(descFix.map(p => p.id)).toContain(staticMissingDesc.id);
    expect(descFix.map(p => p.id)).toContain(staticMissingBoth.id);
  });

  it('returns empty when only CMS pages are missing the field', () => {
    expect(filterPagesNeedingFix([staticWithTitle, cmsMissingBoth], 'title')).toHaveLength(0);
  });
});

// ── countMissingField ──────────────────────────────────────────────────────────

describe('countMissingField (AI Fix badge counts)', () => {
  it('counts only static pages missing titles', () => {
    // staticMissingTitle (empty string title) + staticMissingBoth (no seo)
    expect(countMissingField(ALL_PAGES, 'title')).toBe(2);
  });

  it('counts only static pages missing descriptions', () => {
    // staticMissingDesc + staticMissingBoth
    expect(countMissingField(ALL_PAGES, 'description')).toBe(2);
  });

  it('CMS pages with missing fields do not inflate the count', () => {
    const withExtraCms: PageMeta[] = [
      staticWithTitle,
      ...Array.from({ length: 10 }, (_, i): PageMeta => ({
        id: `cms-extra-${i}`,
        title: `CMS ${i}`,
        slug: `blog/extra-${i}`,
        source: 'cms',
        seo: {},
      })),
    ];
    expect(countMissingField(withExtraCms, 'title')).toBe(0);
    expect(countMissingField(withExtraCms, 'description')).toBe(0);
  });

  it('returns 0 when all static pages have complete SEO', () => {
    expect(countMissingField([staticWithTitle, cmsWithSeo, cmsMissingBoth], 'title')).toBe(0);
    expect(countMissingField([staticWithTitle, cmsWithSeo, cmsMissingBoth], 'description')).toBe(0);
  });

  it('returns 0 for empty input', () => {
    expect(countMissingField([], 'title')).toBe(0);
    expect(countMissingField([], 'description')).toBe(0);
  });
});
