/**
 * Extended tests for useSeoEditorApprovalWorkflow pure helpers.
 *
 * Existing coverage (seo-editor-approval-workflow.test.ts):
 *   - toggleStringSet: add/remove
 *   - toggleSelectAllInSet: partial selection → all, all → empty
 *   - toggleSelectAllInSet: mismatched equal-size sets treated as partial
 *
 * NEW tests below cover edge cases not yet tested:
 *   - toggleStringSet with empty set
 *   - toggleStringSet idempotency (add then remove same ID)
 *   - toggleStringSet immutability (original set not mutated)
 *   - toggleSelectAllInSet with empty ids array
 *   - toggleSelectAllInSet with empty current selection and non-empty ids
 *   - toggleSelectAllInSet: ids is a superset (extra filtered ids not in previous)
 *   - toggleSelectAllInSet immutability
 *   - Multiple toggle cycles are consistent
 */

import { describe, expect, it } from 'vitest';
import {
  toggleSelectAllInSet,
  toggleStringSet,
} from '../../src/components/editor/useSeoEditorApprovalWorkflow.js';

// ── toggleStringSet edge cases ────────────────────────────────────────────────

describe('toggleStringSet — edge cases', () => {
  it('adds to an empty set', () => {
    const result = toggleStringSet(new Set<string>(), 'p1');
    expect(Array.from(result)).toEqual(['p1']);
  });

  it('removing from a single-element set yields empty set', () => {
    const result = toggleStringSet(new Set<string>(['p1']), 'p1');
    expect(result.size).toBe(0);
  });

  it('add then remove returns to original size', () => {
    const start = new Set<string>(['a', 'b']);
    const added = toggleStringSet(start, 'c');
    const removed = toggleStringSet(added, 'c');
    expect(removed.size).toBe(2);
    expect(removed.has('a')).toBe(true);
    expect(removed.has('b')).toBe(true);
    expect(removed.has('c')).toBe(false);
  });

  it('does not mutate the original set', () => {
    const original = new Set<string>(['a', 'b']);
    const originalSize = original.size;
    toggleStringSet(original, 'c');
    expect(original.size).toBe(originalSize);
  });

  it('produces a new Set instance on every call', () => {
    const original = new Set<string>(['a']);
    const result = toggleStringSet(original, 'b');
    expect(result).not.toBe(original);
  });

  it('removes the correct ID when multiple are present', () => {
    const set = new Set<string>(['x', 'y', 'z']);
    const result = toggleStringSet(set, 'y');
    expect(Array.from(result).sort()).toEqual(['x', 'z']);
  });

  it('toggling an ID twice returns to the original membership', () => {
    const original = new Set<string>(['a', 'b', 'c']);
    const afterAdd = toggleStringSet(original, 'd');
    const afterRemove = toggleStringSet(afterAdd, 'd');
    expect(afterRemove.has('d')).toBe(false);
    expect(Array.from(afterRemove).sort()).toEqual(Array.from(original).sort());
  });
});

// ── toggleSelectAllInSet edge cases ───────────────────────────────────────────

describe('toggleSelectAllInSet — edge cases', () => {
  it('returns empty set when ids array is empty', () => {
    const result = toggleSelectAllInSet(new Set<string>(['p1', 'p2']), []);
    // ids.length > 0 is false → hasAllIdsSelected is false → returns new Set(ids) = empty
    expect(result.size).toBe(0);
  });

  it('selects all ids when current selection is empty', () => {
    const ids = ['p1', 'p2', 'p3'];
    const result = toggleSelectAllInSet(new Set<string>(), ids);
    expect(Array.from(result).sort()).toEqual(ids.sort());
  });

  it('selects all when only some ids are in previous selection', () => {
    const ids = ['p1', 'p2', 'p3'];
    const result = toggleSelectAllInSet(new Set<string>(['p2']), ids);
    expect(Array.from(result).sort()).toEqual(ids.sort());
  });

  it('deselects all (returns empty) when all ids are already selected', () => {
    const ids = ['p1', 'p2', 'p3'];
    const result = toggleSelectAllInSet(new Set<string>(ids), ids);
    expect(result.size).toBe(0);
  });

  it('does not mutate the original set', () => {
    const original = new Set<string>(['p1', 'p2']);
    const ids = ['p1', 'p2'];
    toggleSelectAllInSet(original, ids);
    expect(original.size).toBe(2);
  });

  it('returns a new Set instance', () => {
    const original = new Set<string>(['p1']);
    const ids = ['p1', 'p2'];
    const result = toggleSelectAllInSet(original, ids);
    expect(result).not.toBe(original);
  });

  it('two full cycles restore empty selection', () => {
    const ids = ['p1', 'p2'];
    const allSelected = toggleSelectAllInSet(new Set<string>(), ids);
    const deselected = toggleSelectAllInSet(allSelected, ids);
    expect(deselected.size).toBe(0);
  });

  it('handles single-element ids array with matching selection', () => {
    const ids = ['only'];
    const result = toggleSelectAllInSet(new Set<string>(['only']), ids);
    expect(result.size).toBe(0);
  });
});
