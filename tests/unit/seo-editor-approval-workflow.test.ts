import { describe, expect, it } from 'vitest';
import {
  toggleSelectAllInSet,
  toggleStringSet,
} from '../../src/components/editor/useSeoEditorApprovalWorkflow';

describe('useSeoEditorApprovalWorkflow set helpers', () => {
  it('toggles individual ids in a set', () => {
    const start = new Set<string>(['a', 'b']);
    const afterRemove = toggleStringSet(start, 'a');
    const afterAdd = toggleStringSet(afterRemove, 'c');

    expect(Array.from(afterRemove).sort()).toEqual(['b']);
    expect(Array.from(afterAdd).sort()).toEqual(['b', 'c']);
  });

  it('toggles select-all using the current selection size and filtered ids', () => {
    const ids = ['p1', 'p2', 'p3'];
    const selectedSome = new Set<string>(['p1']);
    const selectedAll = new Set<string>(ids);

    expect(Array.from(toggleSelectAllInSet(selectedSome, ids)).sort()).toEqual(ids);
    expect(Array.from(toggleSelectAllInSet(selectedAll, ids))).toEqual([]);
  });

  it('treats equal-size but mismatched selection as not-all-selected', () => {
    const ids = ['p1', 'p2'];
    const selectedMismatched = new Set<string>(['p1', 'p3']);

    expect(Array.from(toggleSelectAllInSet(selectedMismatched, ids)).sort()).toEqual(ids);
  });
});
