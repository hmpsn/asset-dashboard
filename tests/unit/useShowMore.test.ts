// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShowMore } from '../../src/hooks/useShowMore.js';

const ITEMS = ['a', 'b', 'c', 'd', 'e'];

// ── Absent maxVisible (byte-identical contract) ─────────────────────────────

describe('useShowMore — maxVisible absent', () => {
  it('returns the full list when maxVisible is undefined', () => {
    const { result } = renderHook(() => useShowMore(ITEMS));
    expect(result.current.visible).toEqual(ITEMS);
  });

  it('canExpand is false when maxVisible is undefined', () => {
    const { result } = renderHook(() => useShowMore(ITEMS));
    expect(result.current.canExpand).toBe(false);
  });

  it('hiddenCount is 0 when maxVisible is undefined', () => {
    const { result } = renderHook(() => useShowMore(ITEMS));
    expect(result.current.hiddenCount).toBe(0);
  });

  it('expanded is false when maxVisible is undefined', () => {
    const { result } = renderHook(() => useShowMore(ITEMS));
    expect(result.current.expanded).toBe(false);
  });

  it('toggle is a no-op when maxVisible is undefined', () => {
    const { result } = renderHook(() => useShowMore(ITEMS));
    act(() => { result.current.toggle(); });
    expect(result.current.visible).toEqual(ITEMS);
    expect(result.current.expanded).toBe(false);
  });

  it('returns full list for empty array with undefined maxVisible', () => {
    const { result } = renderHook(() => useShowMore([]));
    expect(result.current.visible).toEqual([]);
    expect(result.current.canExpand).toBe(false);
  });
});

// ── maxVisible >= items.length (no capping needed) ──────────────────────────

describe('useShowMore — maxVisible >= items.length', () => {
  it('returns full list when maxVisible equals items.length', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 5));
    expect(result.current.visible).toEqual(ITEMS);
    expect(result.current.canExpand).toBe(false);
    expect(result.current.hiddenCount).toBe(0);
  });

  it('returns full list when maxVisible exceeds items.length', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 100));
    expect(result.current.visible).toEqual(ITEMS);
    expect(result.current.canExpand).toBe(false);
  });
});

// ── maxVisible < items.length (capping active) ───────────────────────────────

describe('useShowMore — maxVisible < items.length (capped)', () => {
  it('returns slice of items when capped', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    expect(result.current.visible).toEqual(['a', 'b', 'c']);
  });

  it('canExpand is true when capped', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    expect(result.current.canExpand).toBe(true);
  });

  it('hiddenCount reflects remaining items', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    expect(result.current.hiddenCount).toBe(2);
  });

  it('expanded is false initially when capped', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    expect(result.current.expanded).toBe(false);
  });

  it('toggle expands to full list', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    act(() => { result.current.toggle(); });
    expect(result.current.visible).toEqual(ITEMS);
    expect(result.current.expanded).toBe(true);
  });

  it('hiddenCount is 0 when expanded', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    act(() => { result.current.toggle(); });
    expect(result.current.hiddenCount).toBe(0);
  });

  it('toggle collapses back to capped slice', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 3));
    act(() => { result.current.toggle(); });
    act(() => { result.current.toggle(); });
    expect(result.current.visible).toEqual(['a', 'b', 'c']);
    expect(result.current.expanded).toBe(false);
    expect(result.current.hiddenCount).toBe(2);
  });

  it('maxVisible of 1 shows only first item', () => {
    const { result } = renderHook(() => useShowMore(ITEMS, 1));
    expect(result.current.visible).toEqual(['a']);
    expect(result.current.hiddenCount).toBe(4);
  });
});

// ── timeAgo double-"ago" guard (regression) ──────────────────────────────────

import { timeAgo } from '../../src/lib/timeAgo.js';

describe('timeAgo — long style already includes "ago"', () => {
  it('long style returns a string ending with "ago"', () => {
    // Create a timestamp 2 minutes in the past so it's not "just now"
    const past = new Date(Date.now() - 2 * 60_000).toISOString();
    const result = timeAgo(past, { style: 'long' });
    expect(result).toMatch(/ago$/);
  });

  it('long style does NOT include double "ago ago"', () => {
    const past = new Date(Date.now() - 90 * 60_000).toISOString();
    const result = timeAgo(past, { style: 'long' });
    expect(result).not.toMatch(/ago ago/);
    // Concatenating with " ago" as the buggy template did would produce "X ago ago"
    expect(`${result} ago`).toMatch(/ago ago/);
  });
});
