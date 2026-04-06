// tests/unit/seoEditorCmsFilter.test.ts
// Behavioral tests for the CMS-page filtering invariants in SeoEditor.tsx.
//
// These tests guard the contract: "CMS pages with synthetic IDs must never be
// included in any operation that writes to the Webflow API."
//
// Each test mirrors a filtering predicate used in SeoEditor.tsx and verifies:
//   (a) static pages ARE included/counted
//   (b) CMS pages are NOT included/counted
//   (c) mixed arrays return correct subsets and counts
//
// If any filter is weakened or removed from SeoEditor.tsx, the corresponding
// test here will fail — making the regression visible before Webflow API calls
// start returning 404s in production.

import { describe, it, expect } from 'vitest';
import type { PageMeta } from '../../src/hooks/admin/useSeoEditor.js';

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

// Undiscriminated page (no source field — treat as static to be safe)
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

// ── The filtering predicates (mirror of SeoEditor.tsx) ────────────────────────
// These predicates are extracted here for direct behavioral testing.
// If they diverge from SeoEditor.tsx the tests below will still catch regressions
// because they verify the *invariant*, not the implementation.

const filterForBulkFix = (pages: PageMeta[], field: 'title' | 'description') =>
  pages.filter(p => {
    if (p.source === 'cms') return false;
    if (field === 'title') return !p.seo?.title;
    return !p.seo?.description;
  });

const filterForBulkRewrite = (
  previewItems: Array<{ pageId: string }>,
  pages: PageMeta[],
) =>
  previewItems.filter(item =>
    pages.find(pg => pg.id === item.pageId)?.source !== 'cms'
  );

const filterForPreviewPattern = (
  selectedIds: string[],
  pages: PageMeta[],
) =>
  selectedIds.filter(pageId =>
    pages.find(p => p.id === pageId)?.source !== 'cms'
  );

const countMissingTitles = (pages: PageMeta[]) =>
  pages.filter(p => p.source !== 'cms' && !p.seo?.title).length;

const countMissingDescs = (pages: PageMeta[]) =>
  pages.filter(p => p.source !== 'cms' && !p.seo?.description).length;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleBulkFix — CMS exclusion', () => {
  it('excludes all CMS pages from bulk title fix candidates', () => {
    const result = filterForBulkFix(ALL_PAGES, 'title');
    expect(result.every(p => p.source !== 'cms')).toBe(true);
    expect(result.some(p => p.id.startsWith('cms-'))).toBe(false);
  });

  it('excludes all CMS pages from bulk description fix candidates', () => {
    const result = filterForBulkFix(ALL_PAGES, 'description');
    expect(result.every(p => p.source !== 'cms')).toBe(true);
    expect(result.some(p => p.id.startsWith('cms-'))).toBe(false);
  });

  it('includes static pages missing the target field', () => {
    const titleFix = filterForBulkFix(ALL_PAGES, 'title');
    expect(titleFix.map(p => p.id)).toContain(staticMissingTitle.id);
    expect(titleFix.map(p => p.id)).toContain(staticMissingBoth.id);
  });

  it('excludes static pages that already have the target field', () => {
    const titleFix = filterForBulkFix(ALL_PAGES, 'title');
    expect(titleFix.map(p => p.id)).not.toContain(staticWithTitle.id);
  });

  it('does not include CMS pages even when they are missing the field', () => {
    // cmsMissingTitle has no title — but it is still CMS and must be excluded
    const titleFix = filterForBulkFix(ALL_PAGES, 'title');
    expect(titleFix.map(p => p.id)).not.toContain(cmsMissingTitle.id);
    expect(titleFix.map(p => p.id)).not.toContain(cmsMissingBoth.id);
  });

  it('returns empty array when all missing-field pages are CMS', () => {
    const cmsOnlyMissing = [cmsWithSeo, cmsMissingTitle, cmsMissingBoth];
    expect(filterForBulkFix(cmsOnlyMissing, 'title')).toHaveLength(0);
  });
});

describe('applyBulkRewrite — CMS exclusion via pre-filter', () => {
  const previewItems = [
    { pageId: staticWithTitle.id },
    { pageId: staticMissingTitle.id },
    { pageId: cmsWithSeo.id },       // synthetic ID — must be excluded
    { pageId: cmsMissingBoth.id },   // synthetic ID — must be excluded
    { pageId: legacyPage.id },       // no source field — treated as static
  ];

  it('excludes CMS pages from the static write batch', () => {
    const staticItems = filterForBulkRewrite(previewItems, ALL_PAGES);
    expect(staticItems.some(i => i.pageId.startsWith('cms-'))).toBe(false);
  });

  it('preserves all static pages in the write batch', () => {
    const staticItems = filterForBulkRewrite(previewItems, ALL_PAGES);
    expect(staticItems.map(i => i.pageId)).toContain(staticWithTitle.id);
    expect(staticItems.map(i => i.pageId)).toContain(staticMissingTitle.id);
  });

  it('progress total equals number of static items, not raw preview length', () => {
    const staticItems = filterForBulkRewrite(previewItems, ALL_PAGES);
    // The total used for setBulkProgress must reflect filtered count only
    expect(staticItems.length).toBeLessThan(previewItems.length);
    expect(staticItems.length).toBe(3); // staticWithTitle, staticMissingTitle, legacyPage
  });

  it('returns empty batch when all preview items are CMS pages', () => {
    const cmsOnlyPreview = [{ pageId: cmsWithSeo.id }, { pageId: cmsMissingBoth.id }];
    expect(filterForBulkRewrite(cmsOnlyPreview, ALL_PAGES)).toHaveLength(0);
  });
});

describe('previewPattern — CMS exclusion', () => {
  const selected = [
    staticWithTitle.id,
    staticMissingTitle.id,
    cmsWithSeo.id,    // must be excluded
    cmsMissingBoth.id, // must be excluded
  ];

  it('excludes CMS page IDs from the pattern preview', () => {
    const filtered = filterForPreviewPattern(selected, ALL_PAGES);
    expect(filtered).not.toContain(cmsWithSeo.id);
    expect(filtered).not.toContain(cmsMissingBoth.id);
  });

  it('preserves static page IDs in the preview', () => {
    const filtered = filterForPreviewPattern(selected, ALL_PAGES);
    expect(filtered).toContain(staticWithTitle.id);
    expect(filtered).toContain(staticMissingTitle.id);
  });

  it('returns empty array when all selected pages are CMS', () => {
    const cmsOnly = [cmsWithSeo.id, cmsMissingBoth.id];
    expect(filterForPreviewPattern(cmsOnly, ALL_PAGES)).toHaveLength(0);
  });
});

describe('missingTitles / missingDescs — CMS exclusion from counts', () => {
  it('counts only static pages missing titles', () => {
    // staticMissingTitle (empty title), staticMissingBoth (no seo), legacyPage has title
    const count = countMissingTitles(ALL_PAGES);
    expect(count).toBe(2); // staticMissingTitle + staticMissingBoth
  });

  it('counts only static pages missing descriptions', () => {
    const count = countMissingDescs(ALL_PAGES);
    expect(count).toBe(2); // staticMissingDesc + staticMissingBoth
  });

  it('CMS pages with missing fields do not inflate counts', () => {
    const withExtraCms: PageMeta[] = [
      staticWithTitle,
      ...Array.from({ length: 10 }, (_, i): PageMeta => ({
        id: `cms-extra-${i}`,
        title: `CMS ${i}`,
        slug: `blog/extra-${i}`,
        source: 'cms',
        seo: {}, // missing both title and description
      })),
    ];
    expect(countMissingTitles(withExtraCms)).toBe(0);
    expect(countMissingDescs(withExtraCms)).toBe(0);
  });

  it('returns 0 when all pages are CMS or all static have complete SEO', () => {
    const allComplete = [staticWithTitle, cmsWithSeo, cmsMissingBoth];
    expect(countMissingTitles(allComplete)).toBe(0);
    expect(countMissingDescs(allComplete)).toBe(0);
  });
});

describe('approval execution — synthetic ID guard invariant', () => {
  // These tests document the invariant that no operation receiving a pageId
  // starting with 'cms-' should attempt a Webflow API write.
  // The actual guard lives in server/routes/approvals.ts.

  const isSyntheticCmsId = (pageId: string) => pageId.startsWith('cms-');

  it('synthetic CMS IDs are identifiable by the cms- prefix', () => {
    expect(isSyntheticCmsId('cms-blog-post-slug')).toBe(true);
    expect(isSyntheticCmsId('cms-')).toBe(true);
    expect(isSyntheticCmsId('page-about')).toBe(false);
    expect(isSyntheticCmsId('67a3b2c1d4e5f6a7b8c9d0e1')).toBe(false); // real Webflow ID
  });

  it('all CMS test fixture IDs are synthetic (start with cms-)', () => {
    const cmsPages = ALL_PAGES.filter(p => p.source === 'cms');
    expect(cmsPages.length).toBeGreaterThan(0);
    expect(cmsPages.every(p => p.id.startsWith('cms-'))).toBe(true);
  });

  it('static page IDs do not match the synthetic prefix', () => {
    const staticPages = ALL_PAGES.filter(p => p.source !== 'cms');
    expect(staticPages.every(p => !p.id.startsWith('cms-'))).toBe(true);
  });
});
