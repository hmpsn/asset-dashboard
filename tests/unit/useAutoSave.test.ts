import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from '../../src/hooks/useAutoSave';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls saveFn after delay', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>hello</p>'); });
    expect(saveFn).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledWith('<p>hello</p>');
  });

  it('debounces rapid calls — only fires the last value', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => {
      result.current.scheduleAutoSave('<p>v1</p>');
      result.current.scheduleAutoSave('<p>v2</p>');
      result.current.scheduleAutoSave('<p>v3</p>');
    });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('<p>v3</p>');
  });

  it('flush fires immediately and prevents duplicate timer fire', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 2000));

    act(() => { result.current.scheduleAutoSave('<p>pending</p>'); });
    await act(async () => { await result.current.flush(); });
    expect(saveFn).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saveFn).toHaveBeenCalledTimes(1); // no second fire
  });

  it('flush is a no-op when nothing is pending', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    await act(async () => { await result.current.flush(); });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('calls onError when saveFn throws', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));
    const onError = vi.fn();
    const { result } = renderHook(() => useAutoSave(saveFn, 500, onError));

    act(() => { result.current.scheduleAutoSave('<p>content</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(saveFn).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('new content typed during in-flight save is not lost on flush', async () => {
    let resolveFirstSave!: () => void;
    const firstSavePromise = new Promise<void>(r => { resolveFirstSave = r; });
    let callCount = 0;
    const saveFn = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? firstSavePromise : Promise.resolve();
    });
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>v1</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    act(() => { result.current.scheduleAutoSave('<p>v2</p>'); });

    await act(async () => { resolveFirstSave(); await firstSavePromise; });

    await act(async () => { await result.current.flush(); });
    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(saveFn).toHaveBeenLastCalledWith('<p>v2</p>');
  });
});
