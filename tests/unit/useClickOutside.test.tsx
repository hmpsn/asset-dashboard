import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClickOutside } from '../../src/hooks/useClickOutside';

describe('useClickOutside', () => {
  let container: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    outside = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(outside);
  });

  afterEach(() => {
    document.body.removeChild(container);
    document.body.removeChild(outside);
  });

  it('fires onOutside when a mousedown occurs outside the ref element', () => {
    const onOutside = vi.fn();
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, onOutside));

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onOutside).toHaveBeenCalledOnce();
  });

  it('does NOT fire onOutside when active===false', () => {
    const onOutside = vi.fn();
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, onOutside, false));

    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onOutside).not.toHaveBeenCalled();
  });

  it('does NOT fire for clicks inside the ref element', () => {
    const onOutside = vi.fn();
    const inner = document.createElement('span');
    container.appendChild(inner);
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, onOutside));

    act(() => {
      inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onOutside).not.toHaveBeenCalled();
  });
});
