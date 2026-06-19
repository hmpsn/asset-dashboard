import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCurationSelection } from '../../../src/components/strategy/hooks/useCurationSelection';

const allIds = ['r1', 'r2', 'r3', 'r4'];

describe('useCurationSelection', () => {
  it('toggles individual ids and reports selectedCount', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.toggle('r1'));
    act(() => result.current.toggle('r3'));
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected('r1')).toBe(true);
    expect(result.current.isSelected('r2')).toBe(false);
  });

  it('select-all-in-filter is a predicate, not N ids — selectedCount = total minus exclusions', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.selectAllInFilter());
    expect(result.current.selectedCount).toBe(4);
    act(() => result.current.toggle('r2')); // exclude one from the all-selection
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.isSelected('r2')).toBe(false);
  });

  it('resolveSelectedIds returns concrete ids from either mode', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.selectAllInFilter());
    act(() => result.current.toggle('r4'));
    expect(result.current.resolveSelectedIds().sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('clear resets to empty', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.selectAllInFilter());
    act(() => result.current.clear());
    expect(result.current.selectedCount).toBe(0);
  });
});
