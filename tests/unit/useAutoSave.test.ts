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

  it('captures an optional prepared save when the edit is scheduled', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const preparedRun = vi.fn().mockResolvedValue(undefined);
    const prepareSave = vi.fn(() => preparedRun);
    const { result } = renderHook(() => useAutoSave(
      saveFn,
      500,
      undefined,
      undefined,
      prepareSave,
    ));

    act(() => { result.current.scheduleAutoSave('<p>bound</p>'); });
    expect(prepareSave).toHaveBeenCalledWith('<p>bound</p>');
    expect(preparedRun).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(500); });
    expect(preparedRun).toHaveBeenCalledTimes(1);
    expect(saveFn).not.toHaveBeenCalled();
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

  it('transitions saveStatus to "error" (not "saved") when saveFn rejects', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>content</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(result.current.saveStatus).toBe('error');
  });

  it('saveStatus never transitions to "saved" after a failed save', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network failure'));
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    const statusHistory: string[] = [];
    // Track status by polling after the timer fires
    act(() => { result.current.scheduleAutoSave('<p>v1</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    statusHistory.push(result.current.saveStatus);
    // Advance the 1500ms "saved→idle" window — it must NOT transition through 'saved'
    await act(async () => { vi.advanceTimersByTime(1500); });
    statusHistory.push(result.current.saveStatus);

    expect(statusHistory).not.toContain('saved');
    expect(statusHistory[0]).toBe('error');
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

  it('flush awaits in-flight save and does not double-fire on identical content', async () => {
    let resolveFirstSave!: () => void;
    const firstSavePromise = new Promise<void>(r => { resolveFirstSave = r; });
    let callCount = 0;
    const saveFn = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? firstSavePromise : Promise.resolve();
    });
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>only</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledTimes(1); // in flight, not resolved yet

    // flush() awaits the in-flight save; pendingHtml is null after the save
    // settles for the same content, so no second call should fire.
    const flushed = act(async () => { await result.current.flush(); });
    await act(async () => { resolveFirstSave(); });
    await flushed;

    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('flush does not retry an in-flight save that fails', async () => {
    let rejectSave!: (reason?: unknown) => void;
    const inFlightSave = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    const saveFn = vi.fn().mockReturnValue(inFlightSave);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>conflicting edit</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledTimes(1);

    let flushResult!: { ok: boolean };
    const flushing = act(async () => { flushResult = await result.current.flush(); });
    await act(async () => { rejectSave(new Error('revision conflict')); });
    await flushing;

    expect(flushResult).toEqual({ ok: false });
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit prepared retry instead of replaying a rejected one-shot promise', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const firstFailure = new Error('transient failure');
    const run = vi.fn().mockRejectedValue(firstFailure);
    const retry = vi.fn().mockResolvedValue(undefined);
    const preparedRun = Object.assign(run, { retry });
    const { result } = renderHook(() => useAutoSave(
      saveFn,
      500,
      undefined,
      undefined,
      () => preparedRun,
    ));

    act(() => { result.current.scheduleAutoSave('<p>recover me</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.saveStatus).toBe('error');

    let retryResult!: { ok: boolean };
    await act(async () => { retryResult = await result.current.retry(); });

    expect(retryResult).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(saveFn).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('saved');
  });

  it('flush returns { ok: true } when save succeeds', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>hello</p>'); });
    const flushResult = await act(async () => result.current.flush());

    expect(flushResult).toEqual({ ok: true });
  });

  it('flush returns { ok: false } when save fails', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>hello</p>'); });
    const flushResult = await act(async () => result.current.flush());

    expect(flushResult).toEqual({ ok: false });
  });

  it('calls onSuccess when saveFn resolves', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAutoSave(saveFn, 500, undefined, onSuccess));

    act(() => { result.current.scheduleAutoSave('<p>content</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(saveFn).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not call onSuccess when saveFn rejects', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('failure'));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAutoSave(saveFn, 500, undefined, onSuccess));

    act(() => { result.current.scheduleAutoSave('<p>content</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(saveFn).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('keeps an accepted save successful when the local success callback throws', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn(() => {
      throw new Error('local success feedback failed');
    });
    const { result } = renderHook(() => useAutoSave(saveFn, 500, undefined, onSuccess));

    act(() => { result.current.scheduleAutoSave('<p>accepted</p>'); });
    const flushResult = await act(async () => result.current.flush());

    expect(flushResult).toEqual({ ok: true });
    expect(result.current.saveStatus).toBe('saved');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected save failed when the local error callback throws', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('revision conflict'));
    const onError = vi.fn(() => {
      throw new Error('local error feedback failed');
    });
    const { result } = renderHook(() => useAutoSave(saveFn, 500, onError));

    act(() => { result.current.scheduleAutoSave('<p>rejected</p>'); });
    const flushResult = await act(async () => result.current.flush());

    expect(flushResult).toEqual({ ok: false });
    expect(result.current.saveStatus).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('flush returns { ok: true } when nothing is pending', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    const flushResult = await act(async () => result.current.flush());

    expect(saveFn).not.toHaveBeenCalled();
    // lastSaveOkRef starts true, so flush with nothing pending returns ok: true
    expect(flushResult).toEqual({ ok: true });
  });

  it('does not crash or warn when component unmounts mid-save', async () => {
    let resolveSave!: () => void;
    const savePromise = new Promise<void>(r => { resolveSave = r; });
    const saveFn = vi.fn().mockImplementation(() => savePromise);
    const { result, unmount } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>v1</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalled();

    // Unmount while save is in flight
    unmount();

    // Resolve after unmount — should not throw or attempt setState on unmounted component
    await act(async () => { resolveSave(); await savePromise; });
    // Advance time past the 1500ms saved→idle timer to confirm no leak
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('does not invisibly retry a completed failed save during unmount', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('revision conflict'));
    const { result, unmount } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>rejected</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.saveStatus).toBe('error');
    expect(saveFn).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('saves only a newer pending buffer after an in-flight save settles during unmount', async () => {
    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>(resolve => { resolveFirstSave = resolve; });
    const saveFn = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined);
    const { result, unmount } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>v1</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    act(() => { result.current.scheduleAutoSave('<p>v2</p>'); });
    unmount();

    await act(async () => {
      resolveFirstSave();
      await firstSave;
      await Promise.resolve();
    });

    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(saveFn).toHaveBeenLastCalledWith('<p>v2</p>');
  });

  // ── resetSaveOk: out-of-band-retry recovery ──────────────────────────────────
  // Regression for the PostEditor section-retry bug: a manual retry that saves
  // OUTSIDE the hook leaves lastSaveOkRef=false, so the next flush() (with nothing
  // pending) returns { ok: false } and edit-mode exit is silently blocked forever.
  // resetSaveOk() is how the caller restores the hook's ok-state after such a save.
  it('after a failed save, flush returns { ok: false } until resetSaveOk is called', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    // Trigger a failure so lastSaveOkRef flips to false.
    act(() => { result.current.scheduleAutoSave('<p>boom</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.saveStatus).toBe('error');

    // With pendingHtml cleared after the failed attempt drains, flush re-fires the
    // failed payload (still pending) — it fails again, ok stays false.
    let flushed = await act(async () => result.current.flush());
    expect(flushed).toEqual({ ok: false });

    // Simulate the out-of-band retry succeeding: caller resets the ok-state.
    act(() => { result.current.resetSaveOk(); });
    expect(result.current.saveStatus).toBe('idle');

    // Now a flush with nothing pending reports ok again, so Done can exit edit mode.
    flushed = await act(async () => result.current.flush());
    expect(flushed).toEqual({ ok: true });
  });

  it('resetSaveOk clears pending content so a stale failed payload does not re-fire', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>stale</p>'); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledTimes(1);

    // resetSaveOk drops the pending payload; a subsequent flush must not re-save it.
    act(() => { result.current.resetSaveOk(); });
    await act(async () => { await result.current.flush(); });
    expect(saveFn).toHaveBeenCalledTimes(1);
  });
});
