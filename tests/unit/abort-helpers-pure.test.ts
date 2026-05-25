// tests/unit/abort-helpers-pure.test.ts
// Pure unit tests for server/abort-helpers.ts
// Uses vi.useFakeTimers() for timer-dependent tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isAbortSignalAborted,
  throwIfSignalAborted,
  composeTimeoutSignal,
  abortableDelay,
} from '../../server/abort-helpers.js';

// ---------------------------------------------------------------------------
// isAbortSignalAborted
// ---------------------------------------------------------------------------
describe('isAbortSignalAborted', () => {
  it('returns false when no signal is provided', () => {
    expect(isAbortSignalAborted(undefined)).toBe(false);
  });

  it('returns false for a live (not yet aborted) signal', () => {
    const ctrl = new AbortController();
    expect(isAbortSignalAborted(ctrl.signal)).toBe(false);
  });

  it('returns true after the controller is aborted', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAbortSignalAborted(ctrl.signal)).toBe(true);
  });

  it('returns true for an already-aborted signal', () => {
    const signal = AbortSignal.abort();
    expect(isAbortSignalAborted(signal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// throwIfSignalAborted
// ---------------------------------------------------------------------------
describe('throwIfSignalAborted', () => {
  it('does nothing when signal is undefined', () => {
    expect(() => throwIfSignalAborted(undefined)).not.toThrow();
  });

  it('does nothing when signal is not aborted', () => {
    const ctrl = new AbortController();
    expect(() => throwIfSignalAborted(ctrl.signal)).not.toThrow();
  });

  it('throws with default message when signal is aborted', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => throwIfSignalAborted(ctrl.signal)).toThrow('Operation cancelled');
  });

  it('throws with a custom message when provided', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => throwIfSignalAborted(ctrl.signal, 'Custom cancel reason')).toThrow('Custom cancel reason');
  });

  it('throws an Error instance', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    try {
      throwIfSignalAborted(ctrl.signal);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

// ---------------------------------------------------------------------------
// composeTimeoutSignal
// ---------------------------------------------------------------------------
describe('composeTimeoutSignal', () => {
  it('returns an AbortSignal when no parent signal is provided', () => {
    const signal = composeTimeoutSignal(10_000);
    expect(signal).toBeDefined();
    expect(typeof signal.aborted).toBe('boolean');
  });

  it('returns a composed signal when a parent signal is provided', () => {
    const ctrl = new AbortController();
    const composed = composeTimeoutSignal(10_000, ctrl.signal);
    expect(composed).toBeDefined();
    expect(composed.aborted).toBe(false);
  });

  it('composed signal is already aborted when the parent signal is pre-aborted', () => {
    const abortedSignal = AbortSignal.abort();
    const composed = composeTimeoutSignal(10_000, abortedSignal);
    expect(composed.aborted).toBe(true);
  });

  it('composed signal aborts when parent controller is aborted', async () => {
    const ctrl = new AbortController();
    const composed = composeTimeoutSignal(30_000, ctrl.signal);
    expect(composed.aborted).toBe(false);

    const abortPromise = new Promise<void>((resolve) => {
      composed.addEventListener('abort', () => resolve(), { once: true });
    });

    ctrl.abort();
    await abortPromise;
    expect(composed.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// abortableDelay
// ---------------------------------------------------------------------------
describe('abortableDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the given delay', async () => {
    const p = abortableDelay(500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves with no signal provided', async () => {
    const p = abortableDelay(100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects immediately when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortableDelay(1000, ctrl.signal)).rejects.toThrow('Operation cancelled');
  });

  it('rejects with custom message when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortableDelay(1000, ctrl.signal, 'custom msg')).rejects.toThrow('custom msg');
  });

  it('rejects with default message when aborted mid-wait', async () => {
    const ctrl = new AbortController();
    const p = abortableDelay(1000, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toThrow('Operation cancelled');
  });

  it('rejects with custom message when aborted mid-wait', async () => {
    const ctrl = new AbortController();
    const p = abortableDelay(1000, ctrl.signal, 'job aborted');
    ctrl.abort();
    await expect(p).rejects.toThrow('job aborted');
  });

  it('does not reject after the timer fires even if abort fires much later', async () => {
    const ctrl = new AbortController();
    const p = abortableDelay(200, ctrl.signal);
    vi.advanceTimersByTime(200);
    // Aborting after resolve should not surface a rejection
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
  });
});
