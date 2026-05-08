import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCmsEditorSaveWorkflow } from '../../src/components/cms-editor/useCmsEditorSaveWorkflow';

vi.mock('../../src/api/client', () => ({
  patch: vi.fn(),
}));

import { patch } from '../../src/api/client';

const mockedPatch = vi.mocked(patch);

function createStateTracker<T>(initial: T) {
  let current = initial;
  const setter = vi.fn((update: T | ((previous: T) => T)) => {
    current = typeof update === 'function'
      ? (update as (previous: T) => T)(current)
      : update;
  });
  return {
    setter,
    read: () => current,
  };
}

describe('useCmsEditorSaveWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call API when no edits exist for itemId', async () => {
    const setSaving = createStateTracker<Set<string>>(new Set());
    const setErrors = createStateTracker<Record<string, string>>({});
    const setDirty = createStateTracker<Set<string>>(new Set());
    const setSaved = createStateTracker<Set<string>>(new Set());
    const refreshStates = vi.fn();

    const { result } = renderHook(() =>
      useCmsEditorSaveWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        edits: {},
        setSaving: setSaving.setter,
        setErrors: setErrors.setter,
        setDirty: setDirty.setter,
        setSaved: setSaved.setter,
        refreshStates,
      })
    );

    await act(async () => {
      await result.current.saveItem('coll-1', 'item-1');
    });

    expect(mockedPatch).not.toHaveBeenCalled();
    expect(setSaving.read().size).toBe(0);
    expect(setErrors.read()).toEqual({});
    expect(setDirty.read().size).toBe(0);
    expect(setSaved.read().size).toBe(0);
    expect(refreshStates).not.toHaveBeenCalled();
  });

  it('saves successfully and updates dirty/saved state', async () => {
    mockedPatch.mockResolvedValue({ success: true });
    const setSaving = createStateTracker<Set<string>>(new Set());
    const setErrors = createStateTracker<Record<string, string>>({ 'item-1': 'old' });
    const setDirty = createStateTracker<Set<string>>(new Set(['item-1']));
    const setSaved = createStateTracker<Set<string>>(new Set());
    const refreshStates = vi.fn();

    const { result } = renderHook(() =>
      useCmsEditorSaveWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        edits: { 'item-1': { name: 'Updated title' } },
        setSaving: setSaving.setter,
        setErrors: setErrors.setter,
        setDirty: setDirty.setter,
        setSaved: setSaved.setter,
        refreshStates,
      })
    );

    await act(async () => {
      await result.current.saveItem('coll-1', 'item-1');
    });

    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/webflow/collections/coll-1/items/item-1',
      {
        fieldData: { name: 'Updated title' },
        siteId: 'site-1',
        workspaceId: 'ws-1',
      }
    );
    expect(setDirty.read().has('item-1')).toBe(false);
    expect(setSaved.read()).toEqual(new Set(['item-1']));
    expect(setErrors.read()).toEqual({});
    expect(setSaving.read().size).toBe(0);
    expect(refreshStates).toHaveBeenCalledTimes(1);
  });

  it('surfaces API error message and does not mark as saved', async () => {
    mockedPatch.mockResolvedValue({ success: false, error: 'Validation failed' });
    const setSaving = createStateTracker<Set<string>>(new Set());
    const setErrors = createStateTracker<Record<string, string>>({});
    const setDirty = createStateTracker<Set<string>>(new Set(['item-1']));
    const setSaved = createStateTracker<Set<string>>(new Set());
    const refreshStates = vi.fn();

    const { result } = renderHook(() =>
      useCmsEditorSaveWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        edits: { 'item-1': { name: 'Updated title' } },
        setSaving: setSaving.setter,
        setErrors: setErrors.setter,
        setDirty: setDirty.setter,
        setSaved: setSaved.setter,
        refreshStates,
      })
    );

    await act(async () => {
      await result.current.saveItem('coll-1', 'item-1');
    });

    expect(setErrors.read()).toEqual({ 'item-1': 'Validation failed' });
    expect(setDirty.read().has('item-1')).toBe(true);
    expect(setSaved.read().size).toBe(0);
    expect(setSaving.read().size).toBe(0);
    expect(refreshStates).not.toHaveBeenCalled();
  });

  it('surfaces network errors and always clears saving state', async () => {
    mockedPatch.mockRejectedValue(new Error('network'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setSaving = createStateTracker<Set<string>>(new Set());
    const setErrors = createStateTracker<Record<string, string>>({});
    const setDirty = createStateTracker<Set<string>>(new Set(['item-1']));
    const setSaved = createStateTracker<Set<string>>(new Set());
    const refreshStates = vi.fn();

    const { result } = renderHook(() =>
      useCmsEditorSaveWorkflow({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        edits: { 'item-1': { name: 'Updated title' } },
        setSaving: setSaving.setter,
        setErrors: setErrors.setter,
        setDirty: setDirty.setter,
        setSaved: setSaved.setter,
        refreshStates,
      })
    );

    await act(async () => {
      await result.current.saveItem('coll-1', 'item-1');
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(setErrors.read()).toEqual({ 'item-1': 'Network error' });
    expect(setSaving.read().size).toBe(0);
    expect(refreshStates).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
