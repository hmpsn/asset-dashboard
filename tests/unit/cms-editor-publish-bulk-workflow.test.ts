import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCmsEditorPublishBulkWorkflow } from '../../src/components/cms-editor/useCmsEditorPublishBulkWorkflow';
import type { CmsCollection } from '../../src/components/cms-editor/cmsEditorModel';

vi.mock('../../src/api/client', () => ({
  post: vi.fn(),
}));

import { post } from '../../src/api/client';

const mockedPost = vi.mocked(post);

function createSetTracker<T>() {
  let current = new Set<T>();
  const setter = vi.fn((update: Set<T> | ((previous: Set<T>) => Set<T>)) => {
    current = typeof update === 'function' ? update(current) : update;
  });
  return {
    setter,
    read: () => current,
  };
}

const collections: CmsCollection[] = [
  {
    collectionId: 'coll-1',
    collectionName: 'Blog',
    collectionSlug: 'blog',
    seoFields: [
      { id: 'f-1', slug: 'name', displayName: 'Name', type: 'PlainText' },
      { id: 'f-2', slug: 'seo-title', displayName: 'SEO Title', type: 'PlainText' },
      { id: 'f-3', slug: 'meta-description', displayName: 'Meta Description', type: 'PlainText' },
    ],
    items: [
      { id: 'item-1', fieldData: { name: 'Alpha', slug: 'alpha' } },
      { id: 'item-2', fieldData: { name: 'Beta', slug: 'beta' } },
    ],
    total: 2,
  },
  {
    collectionId: 'coll-2',
    collectionName: 'Guides',
    collectionSlug: 'guides',
    seoFields: [
      { id: 'f-1', slug: 'name', displayName: 'Name', type: 'PlainText' },
      { id: 'f-2', slug: 'seo-title', displayName: 'SEO Title', type: 'PlainText' },
      { id: 'f-3', slug: 'meta-description', displayName: 'Meta Description', type: 'PlainText' },
    ],
    items: [{ id: 'item-3', fieldData: { name: 'Gamma', slug: 'gamma' } }],
    total: 1,
  },
];

describe('useCmsEditorPublishBulkWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps publish success badges isolated per collection timer', async () => {
    mockedPost.mockResolvedValue({ success: true });

    const expandedCollections = createSetTracker<string>();
    const expandedItems = createSetTracker<string>();
    const { result } = renderHook(() =>
      useCmsEditorPublishBulkWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        collections,
        saved: new Set(['item-1', 'item-3']),
        approvalSelected: new Set(),
        setExpandedCollections: expandedCollections.setter,
        setExpandedItems: expandedItems.setter,
        aiRewrite: vi.fn().mockResolvedValue(true),
        aiRewriteBoth: vi.fn().mockResolvedValue(true),
      })
    );

    await act(async () => {
      await result.current.publishCollection('coll-1');
      await result.current.publishCollection('coll-2');
    });

    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      '/api/webflow/collections/coll-1/publish',
      { itemIds: ['item-1'], siteId: 'site-1', workspaceId: 'ws-1' }
    );
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      '/api/webflow/collections/coll-2/publish',
      { itemIds: ['item-3'], siteId: 'site-1', workspaceId: 'ws-1' }
    );
    expect(result.current.published).toEqual(new Set(['coll-1', 'coll-2']));

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.published.size).toBe(0);
  });

  it('clears publishing state on publish failure and does not mark published', async () => {
    mockedPost.mockRejectedValue(new Error('publish failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const expandedCollections = createSetTracker<string>();
    const expandedItems = createSetTracker<string>();
    const { result } = renderHook(() =>
      useCmsEditorPublishBulkWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        collections,
        saved: new Set(['item-1']),
        approvalSelected: new Set(),
        setExpandedCollections: expandedCollections.setter,
        setExpandedItems: expandedItems.setter,
        aiRewrite: vi.fn().mockResolvedValue(true),
        aiRewriteBoth: vi.fn().mockResolvedValue(true),
      })
    );

    await act(async () => {
      await result.current.publishCollection('coll-1');
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(result.current.publishing.size).toBe(0);
    expect(result.current.published.size).toBe(0);
    errorSpy.mockRestore();
  });

  it('counts non-throw AI failures in bulk results and expands selected items', async () => {
    const aiRewrite = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const aiRewriteBoth = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const expandedCollections = createSetTracker<string>();
    const expandedItems = createSetTracker<string>();

    const { result } = renderHook(() =>
      useCmsEditorPublishBulkWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        collections,
        saved: new Set(),
        approvalSelected: new Set(['item-1', 'item-2']),
        setExpandedCollections: expandedCollections.setter,
        setExpandedItems: expandedItems.setter,
        aiRewrite,
        aiRewriteBoth,
      })
    );

    await act(async () => {
      await result.current.bulkAiRewrite('all');
    });

    expect(result.current.bulkMode).toBe('idle');
    expect(result.current.bulkProgress).toEqual({ done: 2, total: 2 });
    expect(result.current.bulkResults).toContain('1/2');
    expect(result.current.bulkResults).toContain('(1 failed)');
    expect(expandedCollections.read()).toEqual(new Set(['coll-1']));
    expect(expandedItems.read()).toEqual(new Set(['item-1', 'item-2']));

    expect(aiRewrite).toHaveBeenCalledWith('coll-1', 'item-1', 'name');
    expect(aiRewrite).toHaveBeenCalledWith('coll-1', 'item-2', 'name');
    expect(aiRewriteBoth).toHaveBeenCalledTimes(2);
  });

  it('uses slug-based aiRewrite path for non-all target fields', async () => {
    const aiRewrite = vi.fn().mockResolvedValue(true);
    const aiRewriteBoth = vi.fn().mockResolvedValue(true);
    const expandedCollections = createSetTracker<string>();
    const expandedItems = createSetTracker<string>();

    const { result } = renderHook(() =>
      useCmsEditorPublishBulkWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        collections,
        saved: new Set(),
        approvalSelected: new Set(['item-1']),
        setExpandedCollections: expandedCollections.setter,
        setExpandedItems: expandedItems.setter,
        aiRewrite,
        aiRewriteBoth,
      })
    );

    await act(async () => {
      await result.current.bulkAiRewrite('title');
    });

    expect(aiRewrite).toHaveBeenCalledTimes(1);
    expect(aiRewrite).toHaveBeenCalledWith('coll-1', 'item-1', 'seo-title');
    expect(aiRewriteBoth).not.toHaveBeenCalled();
    expect(result.current.bulkResults).toContain('1/1');
  });
});
