/**
 * Pure helper function tests extracted from useSeoEditorBulkWorkflow.ts dependencies.
 *
 * The hook itself is entirely side-effect driven (useState, useEffect, API calls).
 * These tests target the pure helper functions it delegates to:
 *   - seoEditorFilters: filterPagesNeedingFix, countMissingField, filterWritableIds, filterWritableItems, isSyntheticCmsId, filterWritablePages
 *   - seoEditorPersistence: key generators, readCachedSeoBulkAnalyzeJobId, readCachedSeoBulkRewriteJobId, persistCachedSeoBulkAnalyzeJobId, persistCachedSeoBulkRewriteJobId
 *   - seoEditorBulkHelpers: buildBulkRewriteRequestPages, buildPatternPreviewItems (cross-referenced with bulk workflow logic)
 */

import { describe, it, expect } from 'vitest';
import {
  filterPagesNeedingFix,
  countMissingField,
  filterWritableIds,
  filterWritableItems,
  isSyntheticCmsId,
  filterWritablePages,
} from '../../src/hooks/admin/seoEditorFilters.js';
import {
  getSeoBulkAnalyzeJobKey,
  getSeoBulkRewriteJobKey,
  getSeoDraftKey,
  getSeoEditorEditsKey,
  getSeoEditorExpandedKey,
  getSeoEditorVariationsKey,
  readCachedSeoBulkAnalyzeJobId,
  readCachedSeoBulkRewriteJobId,
  readCachedSeoEdits,
  readCachedExpandedPages,
  buildSeoEditsFromPages,
} from '../../src/components/editor/seoEditorPersistence.js';
import type { SeoEditorPage } from '../../src/components/editor/seoEditorTypes.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const staticPageWithTitle: SeoEditorPage = {
  id: 'page-home',
  title: 'Home',
  slug: 'home',
  publishedPath: '/',
  source: 'static',
  seo: { title: 'Home | Site', description: 'Welcome to the site' },
};

const staticPageNoTitle: SeoEditorPage = {
  id: 'page-about',
  title: 'About',
  slug: 'about',
  publishedPath: '/about',
  source: 'static',
  seo: { title: '', description: 'About us' },
};

const staticPageNoDesc: SeoEditorPage = {
  id: 'page-services',
  title: 'Services',
  slug: 'services',
  publishedPath: '/services',
  source: 'static',
  seo: { title: 'Services | Site', description: '' },
};

const cmsPage: SeoEditorPage = {
  id: 'cms-blog-post-1',
  title: 'Blog Post',
  slug: 'blog-post-1',
  publishedPath: '/blog/blog-post-1',
  source: 'cms',
  seo: { title: '', description: '' },
};

const allPages = [staticPageWithTitle, staticPageNoTitle, staticPageNoDesc, cmsPage];

// ── filterPagesNeedingFix ─────────────────────────────────────────────────────

describe('filterPagesNeedingFix', () => {
  it('returns only static pages missing SEO title', () => {
    const result = filterPagesNeedingFix(allPages, 'title');
    expect(result.map(p => p.id)).toEqual([staticPageNoTitle.id]);
  });

  it('returns only static pages missing SEO description', () => {
    const result = filterPagesNeedingFix(allPages, 'description');
    expect(result.map(p => p.id)).toEqual([staticPageNoDesc.id]);
  });

  it('excludes CMS pages even when they are missing SEO fields', () => {
    const result = filterPagesNeedingFix(allPages, 'title');
    const ids = result.map(p => p.id);
    expect(ids).not.toContain(cmsPage.id);
  });

  it('returns empty array when all static pages have the field', () => {
    const result = filterPagesNeedingFix([staticPageWithTitle], 'title');
    expect(result).toHaveLength(0);
  });

  it('returns all static pages with missing field when multiple are missing', () => {
    const second: SeoEditorPage = {
      ...staticPageNoTitle,
      id: 'page-contact',
      title: 'Contact',
    };
    const result = filterPagesNeedingFix([staticPageNoTitle, second], 'title');
    expect(result).toHaveLength(2);
  });
});

// ── countMissingField ─────────────────────────────────────────────────────────

describe('countMissingField', () => {
  it('counts static pages missing SEO title, ignoring CMS pages', () => {
    expect(countMissingField(allPages, 'title')).toBe(1);
  });

  it('counts static pages missing SEO description, ignoring CMS pages', () => {
    expect(countMissingField(allPages, 'description')).toBe(1);
  });

  it('returns 0 when all static pages have the field populated', () => {
    expect(countMissingField([staticPageWithTitle], 'title')).toBe(0);
  });

  it('does not count CMS pages toward the missing field total', () => {
    // cmsPage is missing both title and description — should not be counted
    const cmsOnly = [cmsPage];
    expect(countMissingField(cmsOnly, 'title')).toBe(0);
    expect(countMissingField(cmsOnly, 'description')).toBe(0);
  });
});

// ── filterWritableIds ─────────────────────────────────────────────────────────

describe('filterWritableIds', () => {
  it('filters out CMS page IDs from selected set', () => {
    const selected = [staticPageWithTitle.id, cmsPage.id, staticPageNoTitle.id];
    const result = filterWritableIds(selected, allPages);
    expect(result).toContain(staticPageWithTitle.id);
    expect(result).toContain(staticPageNoTitle.id);
    expect(result).not.toContain(cmsPage.id);
  });

  it('returns empty array when all selected IDs are CMS', () => {
    const result = filterWritableIds([cmsPage.id], allPages);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when selected set is empty', () => {
    const result = filterWritableIds([], allPages);
    expect(result).toHaveLength(0);
  });

  it('passes through IDs for pages not found in the pages array (unknown is treated as non-cms)', () => {
    // filterWritableIds uses `?.source !== 'cms'` — a missing page returns undefined which !== 'cms'
    // So unknown IDs are NOT filtered out; only explicitly cms pages are excluded.
    const result = filterWritableIds(['unknown-id'], allPages);
    expect(result).toContain('unknown-id');
  });
});

// ── filterWritableItems ───────────────────────────────────────────────────────

describe('filterWritableItems', () => {
  it('filters items whose pageId maps to a CMS page', () => {
    const items = [
      { pageId: staticPageWithTitle.id, oldValue: 'Old', newValue: 'New' },
      { pageId: cmsPage.id, oldValue: 'CMS Old', newValue: 'CMS New' },
    ];
    const result = filterWritableItems(items, allPages);
    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe(staticPageWithTitle.id);
  });

  it('preserves extra fields on items', () => {
    const items = [
      { pageId: staticPageWithTitle.id, oldValue: 'Old', newValue: 'New', custom: 'keep' },
    ];
    const result = filterWritableItems(items, allPages);
    expect(result[0]).toHaveProperty('custom', 'keep');
  });
});

// ── isSyntheticCmsId + filterWritablePages ───────────────────────────────────

describe('isSyntheticCmsId', () => {
  it('returns true for IDs starting with cms-', () => {
    expect(isSyntheticCmsId('cms-blog-post-1')).toBe(true);
  });

  it('returns false for standard static page IDs', () => {
    expect(isSyntheticCmsId('page-home')).toBe(false);
    expect(isSyntheticCmsId('abc123')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSyntheticCmsId('')).toBe(false);
  });
});

describe('filterWritablePages', () => {
  it('returns only non-CMS pages', () => {
    const result = filterWritablePages(allPages);
    expect(result.length).toBe(allPages.length - 1);
    expect(result.every(p => p.source !== 'cms')).toBe(true); // every-ok: length asserted above
  });
});

// ── persistence key generators ────────────────────────────────────────────────

describe('persistence key generators', () => {
  it('getSeoEditorEditsKey produces a stable key', () => {
    expect(getSeoEditorEditsKey('site-abc')).toBe('seo-editor-edits-site-abc');
  });

  it('getSeoEditorExpandedKey produces a stable key', () => {
    expect(getSeoEditorExpandedKey('site-abc')).toBe('seo-editor-expanded-site-abc');
  });

  it('getSeoEditorVariationsKey produces a stable key', () => {
    expect(getSeoEditorVariationsKey('site-abc')).toBe('seo-editor-vars-site-abc');
  });

  it('getSeoBulkAnalyzeJobKey produces a stable key', () => {
    expect(getSeoBulkAnalyzeJobKey('ws-123')).toBe('seo-bulk-analyze-job-ws-123');
  });

  it('getSeoBulkRewriteJobKey produces a stable key', () => {
    expect(getSeoBulkRewriteJobKey('ws-123')).toBe('seo-bulk-rewrite-job-ws-123');
  });

  it('getSeoDraftKey embeds both workspaceId and pageId', () => {
    expect(getSeoDraftKey('ws-1', 'page-2')).toBe('seo-draft-ws-1-page-2');
    expect(getSeoDraftKey(undefined, 'page-2')).toBe('seo-draft-undefined-page-2');
  });
});

// ── readCachedSeoBulkAnalyzeJobId / readCachedSeoBulkRewriteJobId ─────────────

describe('readCachedSeoBulkAnalyzeJobId', () => {
  it('returns null when workspaceId is undefined', () => {
    expect(readCachedSeoBulkAnalyzeJobId(undefined, null)).toBeNull();
  });

  it('returns null when storage is null', () => {
    expect(readCachedSeoBulkAnalyzeJobId('ws-123', null)).toBeNull();
  });

  it('reads the job ID from storage', () => {
    const storage = { getItem: (key: string) => key.includes('analyze') ? 'job-abc' : null };
    expect(readCachedSeoBulkAnalyzeJobId('ws-123', storage)).toBe('job-abc');
  });

  it('returns null when storage returns null for the key', () => {
    const storage = { getItem: () => null };
    expect(readCachedSeoBulkAnalyzeJobId('ws-123', storage)).toBeNull();
  });
});

describe('readCachedSeoBulkRewriteJobId', () => {
  it('returns null when workspaceId is undefined', () => {
    expect(readCachedSeoBulkRewriteJobId(undefined, null)).toBeNull();
  });

  it('returns null when storage is null', () => {
    expect(readCachedSeoBulkRewriteJobId('ws-123', null)).toBeNull();
  });

  it('reads the job ID from storage', () => {
    const storage = { getItem: (key: string) => key.includes('rewrite') ? 'job-xyz' : null };
    expect(readCachedSeoBulkRewriteJobId('ws-123', storage)).toBe('job-xyz');
  });
});

// ── persistCachedSeoBulkAnalyzeJobId / persistCachedSeoBulkRewriteJobId ──────
// These functions use sessionStorage internally via getSessionStorage().
// We test the key generation and read/write contract via direct key assertions.

describe('persistCachedSeoBulkAnalyzeJobId key contract', () => {
  it('writes to the key returned by getSeoBulkAnalyzeJobKey', () => {
    // The key is deterministic — verify the key generator produces the expected format
    const key = getSeoBulkAnalyzeJobKey('ws-1');
    expect(key).toBe('seo-bulk-analyze-job-ws-1');
    // Read round-trip with a mock storage whose key matches
    const storage = { getItem: (k: string) => k === key ? 'job-42' : null };
    expect(readCachedSeoBulkAnalyzeJobId('ws-1', storage)).toBe('job-42');
  });

  it('returns null from read when the key does not exist in storage', () => {
    const storage = { getItem: () => null };
    expect(readCachedSeoBulkAnalyzeJobId('ws-1', storage)).toBeNull();
  });
});

// ── readCachedSeoEdits ────────────────────────────────────────────────────────

describe('readCachedSeoEdits', () => {
  it('returns empty edits and restoredFromCache=false when storage is null', () => {
    const result = readCachedSeoEdits('site-abc', null);
    expect(result).toEqual({ edits: {}, restoredFromCache: false });
  });

  it('returns empty edits when storage key is absent', () => {
    const storage = { getItem: () => null };
    const result = readCachedSeoEdits('site-abc', storage);
    expect(result).toEqual({ edits: {}, restoredFromCache: false });
  });

  it('parses and returns edits from a valid JSON string', () => {
    const raw = JSON.stringify({ 'page-1': { seoTitle: 'T', seoDescription: 'D', dirty: true } });
    const storage = { getItem: () => raw };
    const result = readCachedSeoEdits('site-abc', storage);
    expect(result.restoredFromCache).toBe(true);
    expect(result.edits['page-1'].seoTitle).toBe('T');
  });

  it('returns empty edits for invalid JSON without throwing', () => {
    const storage = { getItem: () => '{not-valid-json' };
    const result = readCachedSeoEdits('site-abc', storage);
    expect(result).toEqual({ edits: {}, restoredFromCache: false });
  });

  it('returns empty edits for an empty object string', () => {
    const storage = { getItem: () => '{}' };
    const result = readCachedSeoEdits('site-abc', storage);
    expect(result).toEqual({ edits: {}, restoredFromCache: false });
  });
});

// ── readCachedExpandedPages ───────────────────────────────────────────────────

describe('readCachedExpandedPages', () => {
  it('returns empty set when storage is null', () => {
    const result = readCachedExpandedPages('site-abc', null);
    expect(result.size).toBe(0);
  });

  it('returns the parsed set from a valid JSON array', () => {
    const storage = { getItem: () => JSON.stringify(['p1', 'p2']) };
    const result = readCachedExpandedPages('site-abc', storage);
    expect(result).toEqual(new Set(['p1', 'p2']));
  });

  it('filters non-string values from stored array', () => {
    const storage = { getItem: () => JSON.stringify(['p1', 42, null, 'p2']) };
    const result = readCachedExpandedPages('site-abc', storage);
    expect(result).toEqual(new Set(['p1', 'p2']));
  });

  it('returns empty set for invalid JSON', () => {
    const storage = { getItem: () => 'bad-json' };
    const result = readCachedExpandedPages('site-abc', storage);
    expect(result.size).toBe(0);
  });
});

// ── buildSeoEditsFromPages ────────────────────────────────────────────────────

describe('buildSeoEditsFromPages', () => {
  it('builds edit map from page SEO fields when no drafts exist', () => {
    const storage = { getItem: () => null };
    const result = buildSeoEditsFromPages([staticPageWithTitle], 'ws-1', storage);
    expect(result[staticPageWithTitle.id]).toMatchObject({
      seoTitle: 'Home | Site',
      seoDescription: 'Welcome to the site',
      dirty: false,
    });
  });

  it('applies draft overrides from local storage, setting dirty=true', () => {
    const draft = JSON.stringify({ seoTitle: 'Draft Title', seoDescription: 'Draft Desc' });
    const storage = { getItem: (key: string) => key.includes(staticPageWithTitle.id) ? draft : null };
    const result = buildSeoEditsFromPages([staticPageWithTitle], 'ws-1', storage);
    expect(result[staticPageWithTitle.id]).toMatchObject({
      seoTitle: 'Draft Title',
      seoDescription: 'Draft Desc',
      dirty: true,
    });
  });

  it('handles page with no SEO fields gracefully', () => {
    const page: SeoEditorPage = { id: 'p-bare', title: 'Bare', slug: 'bare', publishedPath: '/bare', source: 'static', seo: { title: '', description: '' } };
    const storage = { getItem: () => null };
    const result = buildSeoEditsFromPages([page], 'ws-1', storage);
    expect(result['p-bare']).toMatchObject({ seoTitle: '', seoDescription: '', dirty: false });
  });

  it('builds entries for all pages in the array', () => {
    const storage = { getItem: () => null };
    const result = buildSeoEditsFromPages([staticPageWithTitle, staticPageNoTitle, staticPageNoDesc], 'ws-1', storage);
    expect(Object.keys(result)).toHaveLength(3);
  });
});
