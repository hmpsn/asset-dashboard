/**
 * Unit tests for pure utility functions associated with hooks and lib helpers.
 * Tests the non-React parts: pure utility functions, selector transforms,
 * filter predicates, and data transformation helpers.
 *
 * Covers:
 *   - src/hooks/admin/seoEditorFilters.ts  — CMS page filter utilities
 *   - src/lib/decision-adapters.ts          — badgeForBatch
 *   - src/lib/kdFraming.ts                  — kdFraming, kdTooltip
 *   - src/lib/background-job-helpers.ts     — startAndTrackJob, cancelTrackedJob, attachTrackedJob
 */
import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// src/hooks/admin/seoEditorFilters.ts
// ═══════════════════════════════════════════════════════════════════════════

import {
  isSyntheticCmsId,
  filterWritablePages,
  filterWritableItems,
  filterWritableIds,
  countMissingField,
  filterPagesNeedingFix,
} from '../../src/hooks/admin/seoEditorFilters';

// Minimal PageMeta-like objects for testing
type PageMetaLike = {
  id: string;
  source?: string;
  seo?: { title?: string; description?: string };
};

const makeStaticPage = (id: string, seo: { title?: string; description?: string } = {}): PageMetaLike => ({
  id,
  source: 'static',
  seo,
});

const makeCmsPage = (id: string, seo: { title?: string; description?: string } = {}): PageMetaLike => ({
  id: `cms-${id}`,
  source: 'cms',
  seo,
});

describe('src/hooks/admin/seoEditorFilters — isSyntheticCmsId', () => {
  it('returns true for IDs starting with "cms-"', () => {
    expect(isSyntheticCmsId('cms-abc123')).toBe(true);
  });

  it('returns false for regular Webflow page IDs', () => {
    expect(isSyntheticCmsId('page-12345')).toBe(false);
  });

  it('returns false for IDs containing but not starting with "cms-"', () => {
    expect(isSyntheticCmsId('page-cms-extra')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSyntheticCmsId('')).toBe(false);
  });

  it('returns true for exactly "cms-"', () => {
    expect(isSyntheticCmsId('cms-')).toBe(true);
  });
});

describe('src/hooks/admin/seoEditorFilters — filterWritablePages', () => {
  it('excludes CMS pages (source === "cms")', () => {
    const pages = [
      makeStaticPage('p1'),
      makeCmsPage('c1'),
      makeStaticPage('p2'),
    ] as never;
    const result = filterWritablePages(pages);
    expect(result).toHaveLength(2);
    expect(result.every((p: PageMetaLike) => p.source !== 'cms')).toBe(true); // every-ok: length asserted above
  });

  it('returns all pages when there are no CMS pages', () => {
    const pages = [makeStaticPage('p1'), makeStaticPage('p2')] as never;
    expect(filterWritablePages(pages)).toHaveLength(2);
  });

  it('returns empty array when all pages are CMS', () => {
    const pages = [makeCmsPage('c1'), makeCmsPage('c2')] as never;
    expect(filterWritablePages(pages)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterWritablePages([])).toEqual([]);
  });
});

describe('src/hooks/admin/seoEditorFilters — filterWritableItems', () => {
  const pages = [
    makeStaticPage('static-1'),
    makeCmsPage('cms-page'),
  ] as never;

  it('excludes items whose corresponding page is a CMS page', () => {
    const items = [
      { pageId: 'static-1', data: 'a' },
      { pageId: 'cms-cms-page', data: 'b' },
    ];
    const result = filterWritableItems(items, pages);
    expect(result).toHaveLength(1);
    expect(result[0].pageId).toBe('static-1');
  });

  it('includes items whose pageId is not found in pages (undefined?.source !== "cms" is true)', () => {
    // When pageId is not found, find() returns undefined, and undefined?.source !== 'cms' is true
    // so unknown items are kept — this is the actual behavior of the implementation
    const items = [{ pageId: 'unknown-page', data: 'x' }];
    const result = filterWritableItems(items, pages);
    expect(result).toHaveLength(1);
  });

  it('returns all items when all are static', () => {
    const items = [{ pageId: 'static-1', data: 'a' }];
    expect(filterWritableItems(items, pages)).toHaveLength(1);
  });
});

describe('src/hooks/admin/seoEditorFilters — filterWritableIds', () => {
  const pages = [
    makeStaticPage('static-1'),
    makeCmsPage('c1'),
  ] as never;

  it('excludes CMS page IDs', () => {
    const ids = ['static-1', 'cms-c1'];
    const result = filterWritableIds(ids, pages);
    expect(result).toContain('static-1');
    expect(result).not.toContain('cms-c1');
  });

  it('includes IDs not present in pages list (undefined?.source !== "cms" is true)', () => {
    // When ID is not found, find() returns undefined, and undefined?.source !== 'cms' is true
    // so unknown IDs are kept — this is the actual behavior of the implementation
    const ids = ['no-such-page'];
    expect(filterWritableIds(ids, pages)).toHaveLength(1);
  });

  it('returns empty array for empty ids', () => {
    expect(filterWritableIds([], pages)).toEqual([]);
  });
});

describe('src/hooks/admin/seoEditorFilters — countMissingField', () => {
  const pages = [
    makeStaticPage('p1', { title: 'My Title', description: 'My desc' }),
    makeStaticPage('p2', { title: '', description: 'My desc' }),
    makeStaticPage('p3', { title: 'My Title', description: '' }),
    makeCmsPage('c1', { title: '', description: '' }),
  ] as never;

  it('counts static pages missing title', () => {
    expect(countMissingField(pages, 'title')).toBe(1); // p2 only (c1 is CMS)
  });

  it('counts static pages missing description', () => {
    expect(countMissingField(pages, 'description')).toBe(1); // p3 only
  });

  it('does not count CMS pages', () => {
    const allCms = [makeCmsPage('c1', { title: '' })] as never;
    expect(countMissingField(allCms, 'title')).toBe(0);
  });

  it('returns 0 when all static pages have the field', () => {
    const allFilled = [makeStaticPage('p1', { title: 'T', description: 'D' })] as never;
    expect(countMissingField(allFilled, 'title')).toBe(0);
  });
});

describe('src/hooks/admin/seoEditorFilters — filterPagesNeedingFix', () => {
  const pages = [
    makeStaticPage('p1', { title: '', description: 'desc' }),
    makeStaticPage('p2', { title: 'title', description: '' }),
    makeStaticPage('p3', { title: 'title', description: 'desc' }),
    makeCmsPage('c1', { title: '', description: '' }),
  ] as never;

  it('returns static pages missing title', () => {
    const result = filterPagesNeedingFix(pages, 'title');
    expect(result).toHaveLength(1);
    expect((result[0] as PageMetaLike).id).toBe('p1');
  });

  it('returns static pages missing description', () => {
    const result = filterPagesNeedingFix(pages, 'description');
    expect(result).toHaveLength(1);
    expect((result[0] as PageMetaLike).id).toBe('p2');
  });

  it('excludes CMS pages from results', () => {
    const result = filterPagesNeedingFix(pages, 'title');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p: PageMetaLike) => !p.id.startsWith('cms-'))).toBe(true); // every-ok: length guard above
  });

  it('returns empty array when no static pages need fix', () => {
    const complete = [makeStaticPage('p1', { title: 'T', description: 'D' })] as never;
    expect(filterPagesNeedingFix(complete, 'title')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/decision-adapters.ts
// ═══════════════════════════════════════════════════════════════════════════

import { badgeForBatch } from '../../src/lib/decision-adapters';

describe('src/lib/decision-adapters — badgeForBatch', () => {
  it('returns "Schema" for names starting with "schema"', () => {
    expect(badgeForBatch('Schema — 5 pages')).toBe('Schema');
    expect(badgeForBatch('schema update')).toBe('Schema');
  });

  it('returns "CMS" for names starting with "cms"', () => {
    expect(badgeForBatch('CMS Editor — collection')).toBe('CMS');
  });

  it('returns "SEO Editor" for names starting with "seo editor"', () => {
    expect(badgeForBatch('SEO Editor — 10 pages')).toBe('SEO Editor');
  });

  it('returns "SEO Editor" for names starting with "seo" (without "editor")', () => {
    expect(badgeForBatch('seo suggestions batch')).toBe('SEO Editor');
  });

  it('returns "Audit" for names starting with "audit"', () => {
    expect(badgeForBatch('Audit — Critical Issues')).toBe('Audit');
  });

  it('returns "SEO" fallback for unrecognized names', () => {
    expect(badgeForBatch('Random batch name')).toBe('SEO');
  });

  it('is case-insensitive', () => {
    expect(badgeForBatch('SCHEMA — items')).toBe('Schema');
    expect(badgeForBatch('CMS EDITOR')).toBe('CMS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/kdFraming.ts
// ═══════════════════════════════════════════════════════════════════════════

import { kdFraming, kdTooltip } from '../../src/lib/kdFraming';

describe('src/lib/kdFraming — kdFraming', () => {
  it('returns undefined for undefined input', () => {
    expect(kdFraming(undefined)).toBeUndefined();
  });

  it('classifies 0 as low competition', () => {
    expect(kdFraming(0)).toBe('Low competition — strong odds');
  });

  it('classifies 30 as low competition (boundary)', () => {
    expect(kdFraming(30)).toBe('Low competition — strong odds');
  });

  it('classifies 31 as moderate competition', () => {
    expect(kdFraming(31)).toBe('Moderate competition — achievable with a strong post');
  });

  it('classifies 60 as moderate competition (boundary)', () => {
    expect(kdFraming(60)).toBe('Moderate competition — achievable with a strong post');
  });

  it('classifies 61 as competitive', () => {
    expect(kdFraming(61)).toBe('Competitive — requires authority and depth');
  });

  it('classifies 80 as competitive (boundary)', () => {
    expect(kdFraming(80)).toBe('Competitive — requires authority and depth');
  });

  it('classifies 81 as highly competitive', () => {
    expect(kdFraming(81)).toBe('Highly competitive — long-term play');
  });

  it('classifies 100 as highly competitive (boundary)', () => {
    expect(kdFraming(100)).toBe('Highly competitive — long-term play');
  });

  it('classifies midpoint values correctly', () => {
    expect(kdFraming(15)).toBe('Low competition — strong odds');
    expect(kdFraming(45)).toBe('Moderate competition — achievable with a strong post');
    expect(kdFraming(70)).toBe('Competitive — requires authority and depth');
    expect(kdFraming(90)).toBe('Highly competitive — long-term play');
  });
});

describe('src/lib/kdFraming — kdTooltip', () => {
  it('returns empty string for undefined kd', () => {
    expect(kdTooltip(undefined)).toBe('');
  });

  it('returns tooltip string containing KD value', () => {
    const result = kdTooltip(25);
    expect(result).toContain('25');
    expect(result).toContain('KD');
  });

  it('tooltip contains the framing label', () => {
    const result = kdTooltip(25);
    expect(result).toContain('Low competition — strong odds');
  });

  it('tooltip format is "KD X/100 — label"', () => {
    const result = kdTooltip(50);
    expect(result).toBe('KD 50/100 — Moderate competition — achievable with a strong post');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/background-job-helpers.ts
// ═══════════════════════════════════════════════════════════════════════════

import { startAndTrackJob, cancelTrackedJob, attachTrackedJob } from '../../src/lib/background-job-helpers';

describe('src/lib/background-job-helpers — startAndTrackJob', () => {
  it('returns jobId and calls trackJob when startJob succeeds', async () => {
    const bridge = {
      startJob: vi.fn().mockResolvedValue('job-abc'),
      trackJob: vi.fn(),
      cancelJob: vi.fn(),
    };
    const result = await startAndTrackJob(bridge, 'bulk-seo-analyze' as never, { workspaceId: 'ws-1' });
    expect(result).toBe('job-abc');
    expect(bridge.trackJob).toHaveBeenCalledWith('bulk-seo-analyze', 'job-abc', { workspaceId: 'ws-1' });
  });

  it('returns null and does not call trackJob when startJob returns null', async () => {
    const bridge = {
      startJob: vi.fn().mockResolvedValue(null),
      trackJob: vi.fn(),
      cancelJob: vi.fn(),
    };
    const result = await startAndTrackJob(bridge, 'bulk-seo-analyze' as never, {});
    expect(result).toBeNull();
    expect(bridge.trackJob).not.toHaveBeenCalled();
  });

  it('calls startJob with the correct type and params', async () => {
    const bridge = {
      startJob: vi.fn().mockResolvedValue('job-1'),
      trackJob: vi.fn(),
      cancelJob: vi.fn(),
    };
    const params = { workspaceId: 'ws-2', siteId: 'site-1' };
    await startAndTrackJob(bridge, 'deep-diagnostic' as never, params);
    expect(bridge.startJob).toHaveBeenCalledWith('deep-diagnostic', params);
  });
});

describe('src/lib/background-job-helpers — cancelTrackedJob', () => {
  it('calls cancelJob with the jobId', async () => {
    const bridge = { cancelJob: vi.fn().mockResolvedValue(undefined) };
    await cancelTrackedJob(bridge, 'job-xyz');
    expect(bridge.cancelJob).toHaveBeenCalledWith('job-xyz');
  });

  it('does nothing when jobId is null', async () => {
    const bridge = { cancelJob: vi.fn() };
    await cancelTrackedJob(bridge, null);
    expect(bridge.cancelJob).not.toHaveBeenCalled();
  });

  it('does nothing when jobId is undefined', async () => {
    const bridge = { cancelJob: vi.fn() };
    await cancelTrackedJob(bridge, undefined);
    expect(bridge.cancelJob).not.toHaveBeenCalled();
  });

  it('does nothing when jobId is empty string', async () => {
    const bridge = { cancelJob: vi.fn() };
    await cancelTrackedJob(bridge, '');
    expect(bridge.cancelJob).not.toHaveBeenCalled();
  });
});

describe('src/lib/background-job-helpers — attachTrackedJob', () => {
  it('calls trackJob with the correct arguments', () => {
    const bridge = { trackJob: vi.fn() };
    attachTrackedJob(bridge, 'deep-diagnostic' as never, 'job-999', { workspaceId: 'ws-1' });
    expect(bridge.trackJob).toHaveBeenCalledWith('deep-diagnostic', 'job-999', { workspaceId: 'ws-1' });
  });

  it('passes through params object as-is', () => {
    const bridge = { trackJob: vi.fn() };
    const params = { a: 1, b: 'two', c: true };
    attachTrackedJob(bridge, 'bulk-seo-analyze' as never, 'j-1', params);
    expect(bridge.trackJob).toHaveBeenCalledWith(expect.any(String), 'j-1', params);
  });
});
