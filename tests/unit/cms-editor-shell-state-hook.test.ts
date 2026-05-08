import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCmsEditorShellState } from '../../src/components/cms-editor/useCmsEditorShellState';
import type { CmsCollection } from '../../src/components/cms-editor/cmsEditorModel';

const collections: CmsCollection[] = [
  {
    collectionId: 'coll-1',
    collectionName: 'Blog',
    collectionSlug: 'blog',
    seoFields: [
      { id: 'f-1', slug: 'name', displayName: 'Name', type: 'PlainText' },
      { id: 'f-2', slug: 'slug', displayName: 'Slug', type: 'PlainText' },
    ],
    items: [{ id: 'item-1', fieldData: { name: 'Alpha', slug: 'alpha' } }],
    total: 1,
  },
];

describe('useCmsEditorShellState', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists an empty edits map (prevents stale cache resurrection)', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderHook(() => useCmsEditorShellState({ siteId: 'site-empty', collections: [] }));

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith('cms-editor-edits-site-empty', '{}');
    });
  });

  it('updateField marks item dirty and clears saved badge state', () => {
    const { result } = renderHook(() =>
      useCmsEditorShellState({ siteId: 'site-1', collections })
    );

    act(() => {
      result.current.setSaved(new Set(['item-1']));
      result.current.updateField('item-1', 'name', 'Updated Alpha');
    });

    expect(result.current.edits['item-1']?.['name']).toBe('Updated Alpha');
    expect(result.current.dirty.has('item-1')).toBe(true);
    expect(result.current.saved.has('item-1')).toBe(false);
  });

  it('toggle helpers flip collection and item expansion state', () => {
    const { result } = renderHook(() =>
      useCmsEditorShellState({ siteId: 'site-1', collections })
    );

    act(() => {
      result.current.toggleCollection('coll-1');
      result.current.toggleItem('item-1');
      result.current.togglePreview('item-1');
      result.current.toggleHistory('item-1');
    });

    expect(result.current.expandedCollections.has('coll-1')).toBe(true);
    expect(result.current.expandedItems.has('item-1')).toBe(true);
    expect(result.current.previewExpanded.has('item-1')).toBe(true);
    expect(result.current.historyExpanded.has('item-1')).toBe(true);
  });
});
