// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSerializedArtifactSave } from '../../src/hooks/useSerializedArtifactSave';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSerializedArtifactSave', () => {
  it('runs one conditional write at a time and advances authority from accepted responses', async () => {
    const first = deferred<{ revision: number }>();
    const second = deferred<{ revision: number }>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onAccepted = vi.fn();
    const { result } = renderHook(() => useSerializedArtifactSave({
      authority: 4,
      save,
      getAcceptedAuthority: response => response.revision,
      onAccepted,
    }));

    let firstRun!: Promise<{ revision: number }>;
    let secondRun!: Promise<{ revision: number }>;
    act(() => {
      firstRun = result.current('first');
      secondRun = result.current('second');
    });
    await act(async () => { await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, 4, 'first');

    await act(async () => {
      first.resolve({ revision: 5 });
      await firstRun;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, 5, 'second');

    await act(async () => {
      second.resolve({ revision: 6 });
      await secondRun;
    });
    expect(onAccepted).toHaveBeenNthCalledWith(1, { revision: 5 }, 'first');
    expect(onAccepted).toHaveBeenNthCalledWith(2, { revision: 6 }, 'second');
  });

  it('propagates a conflict without retrying the rejected write', async () => {
    const conflict = new Error('This artifact changed. Refresh before saving again.');
    const save = vi.fn().mockRejectedValue(conflict);
    const { result } = renderHook(() => useSerializedArtifactSave({
      authority: 'token-1',
      save,
      getAcceptedAuthority: response => response,
    }));

    await act(async () => {
      await expect(result.current('edit')).rejects.toBe(conflict);
    });
    await act(async () => { await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('token-1', 'edit');
  });

  it('rejects queued work when external authority changes instead of silently rebasing it', async () => {
    const inFlight = deferred<{ revision: number }>();
    const conflict = new Error('revision conflict');
    const save = vi.fn().mockImplementationOnce(() => inFlight.promise);
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
      }),
      { initialProps: { authority: 4 } },
    );

    let firstRun!: Promise<{ revision: number }>;
    let queuedRun!: Promise<{ revision: number }>;
    act(() => {
      firstRun = result.current('first');
      queuedRun = result.current('queued stale edit');
    });
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledWith(4, 'first');

    rerender({ authority: 5 });
    await act(async () => { inFlight.reject(conflict); });
    await expect(firstRun).rejects.toBe(conflict);
    await expect(queuedRun).rejects.toThrow('changed while your edit was waiting to save');

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalledWith(5, 'queued stale edit');
  });

  it('binds a prepared debounce attempt to the authority present when the edit was authored', async () => {
    const save = vi.fn().mockResolvedValue({ revision: 6 });
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
      }),
      { initialProps: { authority: 4 } },
    );

    const prepared = result.current.prepare('authored under revision 4');
    rerender({ authority: 5 });

    await expect(prepared()).rejects.toThrow('changed while your edit was waiting to save');
    expect(save).not.toHaveBeenCalled();
  });

  it('executes a prepared attempt at most once across competing drain paths', async () => {
    const pending = deferred<{ revision: number }>();
    const save = vi.fn().mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSerializedArtifactSave({
      authority: 4,
      save,
      getAcceptedAuthority: response => response.revision,
    }));
    const prepared = result.current.prepare('one payload');

    const timerRun = prepared();
    const flushRun = prepared();
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ revision: 5 });
      await expect(Promise.all([timerRun, flushRun])).resolves.toEqual([
        { revision: 5 },
        { revision: 5 },
      ]);
    });
  });

  it('explicitly retries a failed prepared save against the same attempted authority', async () => {
    const transientFailure = new Error('network unavailable');
    const save = vi.fn()
      .mockRejectedValueOnce(transientFailure)
      .mockResolvedValueOnce({ revision: 5 });
    const { result } = renderHook(() => useSerializedArtifactSave({
      authority: 4,
      save,
      getAcceptedAuthority: response => response.revision,
    }));
    const prepared = result.current.prepare('recoverable edit');

    await expect(prepared()).rejects.toBe(transientFailure);
    await expect(prepared.retry()).resolves.toEqual({ revision: 5 });

    expect(save).toHaveBeenNthCalledWith(1, 4, 'recoverable edit');
    expect(save).toHaveBeenNthCalledWith(2, 4, 'recoverable edit');
  });

  it('refuses an explicit retry when canonical authority changed after the failed request', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network unavailable'));
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
      }),
      { initialProps: { authority: 4 } },
    );
    const prepared = result.current.prepare('stale retry payload');

    await expect(prepared()).rejects.toThrow('network unavailable');
    rerender({ authority: 5 });
    await expect(prepared.retry()).rejects.toThrow('changed after the failed save');

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('allows the queue when the read model merely catches up with its accepted response', async () => {
    const first = deferred<{ revision: number }>();
    const second = deferred<{ revision: number }>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
      }),
      { initialProps: { authority: 4 } },
    );

    let firstRun!: Promise<{ revision: number }>;
    let secondRun!: Promise<{ revision: number }>;
    act(() => {
      firstRun = result.current('first');
      secondRun = result.current('second');
    });
    await act(async () => { await Promise.resolve(); });

    rerender({ authority: 5 });
    await act(async () => {
      first.resolve({ revision: 5 });
      await firstRun;
    });
    expect(save).toHaveBeenNthCalledWith(2, 5, 'second');

    await act(async () => {
      second.resolve({ revision: 6 });
      await secondRun;
    });
  });

  it('keeps an open edit session valid when its in-flight save catches the read model up', async () => {
    const first = deferred<{ revision: number }>();
    const second = deferred<{ revision: number }>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
      }),
      { initialProps: { authority: 4 } },
    );

    const editSession = result.current.captureAuthority();
    const firstPrepared = result.current.prepareAt(editSession, 'first edit');
    let firstRun!: Promise<{ revision: number }>;
    act(() => {
      firstRun = firstPrepared();
    });
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenNthCalledWith(1, 4, 'first edit');

    // A broadcast may refresh the read model before the originating HTTP
    // response reaches this editor. A later edit in the same open session must
    // remain queued until that response proves the revision is ours.
    rerender({ authority: 5 });
    const secondPrepared = result.current.prepareAt(editSession, 'second edit');
    const secondRun = secondPrepared();
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ revision: 5 });
      await firstRun;
    });
    expect(save).toHaveBeenNthCalledWith(2, 5, 'second edit');

    await act(async () => {
      second.resolve({ revision: 6 });
      await secondRun;
    });
  });

  it('invalidates an open edit session when canonical authority changes without a local save in flight', async () => {
    const save = vi.fn().mockResolvedValue({ revision: 6 });
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
      }),
      { initialProps: { authority: 4 } },
    );

    const editSession = result.current.captureAuthority();
    rerender({ authority: 5 });

    await expect(result.current.prepareAt(editSession, 'stale open-editor edit')())
      .rejects.toThrow('changed while your edit was waiting to save');
    expect(save).not.toHaveBeenCalled();
  });

  it('does not apply an accepted response older than authority observed during the flight', async () => {
    const inFlight = deferred<{ revision: number }>();
    const save = vi.fn().mockImplementationOnce(() => inFlight.promise);
    const onAccepted = vi.fn();
    const { result, rerender } = renderHook(
      ({ authority }: { authority: number }) => useSerializedArtifactSave({
        authority,
        save,
        getAcceptedAuthority: response => response.revision,
        onAccepted,
      }),
      { initialProps: { authority: 4 } },
    );

    const run = result.current('stale response');
    await act(async () => { await Promise.resolve(); });
    rerender({ authority: 6 });
    await act(async () => { inFlight.resolve({ revision: 5 }); });

    await expect(run).rejects.toThrow('changed while your edit was saving');
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('keeps a server-accepted save successful when the local acceptance callback throws', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ revision: 5 })
      .mockResolvedValueOnce({ revision: 6 });
    const onAccepted = vi.fn(() => {
      throw new Error('local cache synchronization failed');
    });
    const { result } = renderHook(() => useSerializedArtifactSave({
      authority: 4,
      save,
      getAcceptedAuthority: response => response.revision,
      onAccepted,
    }));

    await act(async () => {
      await expect(result.current('first')).resolves.toEqual({ revision: 5 });
      await expect(result.current('second')).resolves.toEqual({ revision: 6 });
    });

    expect(save).toHaveBeenNthCalledWith(1, 4, 'first');
    expect(save).toHaveBeenNthCalledWith(2, 5, 'second');
    expect(onAccepted).toHaveBeenCalledTimes(2);
  });
});
