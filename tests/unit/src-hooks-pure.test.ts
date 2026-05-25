/**
 * Unit tests for pure utility functions associated with hooks and lib helpers.
 * Tests the non-React parts: pure utility functions, selector transforms,
 * filter predicates, and data transformation helpers.
 *
 * Covers:
 *   - src/hooks/admin/seoEditorFilters.ts  — CMS page filter utilities
 *   - src/lib/decision-adapters.ts          — normalizeClientAction, normalizeApprovalBatch, badgeForBatch
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

import { badgeForBatch, normalizeClientAction, normalizeApprovalBatch } from '../../src/lib/decision-adapters';

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

describe('src/lib/decision-adapters — normalizeClientAction', () => {
  const baseAction = {
    id: 'action-1',
    workspaceId: 'ws-1',
    sourceType: 'aeo_change' as const,
    title: 'Fix AEO issue',
    summary: 'Your answer engine optimization needs attention',
    priority: 'high' as const,
    status: 'pending' as const,
    payload: { diffs: [{ page: '/a' }, { page: '/b' }, { page: '/c' }] },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('prefixes id with "ca-"', () => {
    const result = normalizeClientAction(baseAction);
    expect(result.id).toBe('ca-action-1');
  });

  it('sets source to "client_action"', () => {
    const result = normalizeClientAction(baseAction);
    expect(result.source).toBe('client_action');
  });

  it('copies title and summary', () => {
    const result = normalizeClientAction(baseAction);
    expect(result.title).toBe('Fix AEO issue');
    expect(result.summary).toBe('Your answer engine optimization needs attention');
  });

  it('counts items from payload.diffs array', () => {
    const result = normalizeClientAction(baseAction);
    expect(result.itemCount).toBe(3);
  });

  it('counts items from payload.suggestions array', () => {
    const action = {
      ...baseAction,
      sourceType: 'internal_link' as const,
      payload: { suggestions: [{ link: 'a' }, { link: 'b' }] },
    };
    const result = normalizeClientAction(action);
    expect(result.itemCount).toBe(2);
  });

  it('counts items from payload.redirects array', () => {
    const action = {
      ...baseAction,
      sourceType: 'redirect_proposal' as const,
      payload: { redirects: [{ from: '/a', to: '/b' }] },
    };
    const result = normalizeClientAction(action);
    expect(result.itemCount).toBe(1);
  });

  it('defaults itemCount to 1 for unknown payload shape', () => {
    const action = {
      ...baseAction,
      sourceType: 'content_decay' as const,
      payload: { rawData: true },
    };
    const result = normalizeClientAction(action);
    expect(result.itemCount).toBe(1);
  });

  it('isSingleAction is true only for content_decay', () => {
    const decayAction = { ...baseAction, sourceType: 'content_decay' as const };
    expect(normalizeClientAction(decayAction).isSingleAction).toBe(true);
    expect(normalizeClientAction(baseAction).isSingleAction).toBe(false);
  });

  it('uses badge from CLIENT_ACTION_BADGES lookup', () => {
    const result = normalizeClientAction(baseAction);
    expect(result.badge).toBe('AEO');
  });

  it('falls back to humanized sourceType for unknown type', () => {
    const action = { ...baseAction, sourceType: 'custom_type' as never };
    const result = normalizeClientAction(action);
    expect(result.badge).toBe('custom type');
  });
});

describe('src/lib/decision-adapters — normalizeApprovalBatch', () => {
  const baseBatch = {
    id: 'batch-1',
    workspaceId: 'ws-1',
    name: 'SEO Editor — 5 pages',
    status: 'pending' as const,
    items: [
      { id: 'i1', pageId: 'p1', field: 'title', before: 'Old', after: 'New' },
      { id: 'i2', pageId: 'p2', field: 'title', before: 'Old2', after: 'New2' },
    ],
    note: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  } as never;

  it('prefixes id with "ab-"', () => {
    const result = normalizeApprovalBatch(baseBatch);
    expect(result.id).toBe('ab-batch-1');
  });

  it('sets source to "approval_batch"', () => {
    expect(normalizeApprovalBatch(baseBatch).source).toBe('approval_batch');
  });

  it('uses batch name as title', () => {
    expect(normalizeApprovalBatch(baseBatch).title).toBe('SEO Editor — 5 pages');
  });

  it('formats summary with plural "changes" for multiple items', () => {
    const result = normalizeApprovalBatch(baseBatch);
    expect(result.summary).toContain('2 changes');
  });

  it('formats summary with singular "change" for single item', () => {
    const singleItemBatch = { ...baseBatch, items: [{ id: 'i1' }] };
    const result = normalizeApprovalBatch(singleItemBatch);
    expect(result.summary).toContain('1 change');
    expect(result.summary).not.toContain('1 changes');
  });

  it('itemCount matches items.length', () => {
    expect(normalizeApprovalBatch(baseBatch).itemCount).toBe(2);
  });

  it('isSingleAction is always false', () => {
    expect(normalizeApprovalBatch(baseBatch).isSingleAction).toBe(false);
  });

  it('badge derived from batch name', () => {
    expect(normalizeApprovalBatch(baseBatch).badge).toBe('SEO Editor');
  });

  it('priority is undefined (batches carry no priority)', () => {
    expect(normalizeApprovalBatch(baseBatch).priority).toBeUndefined();
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
