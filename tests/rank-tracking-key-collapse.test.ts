/**
 * Task 2 — Collapse duplicate rank-tracking query keys (#11).
 *
 * CONTRACT:
 *   `rankTrackingKeywords` and `rankTrackingKeywordRows` were two cache buckets
 *   backed by the SAME fetcher. This task collapses them into ONE key
 *   (`rankTrackingKeywords`), deletes `rankTrackingKeywordRows`, and re-points
 *   the Rows-ONLY invalidations (togglePin, snapshot) to the surviving key so
 *   the list still refreshes after a pin/snapshot mutation.
 *
 * WHY THESE TESTS ARE NON-TAUTOLOGICAL:
 *   (a) The `rankTrackingKeywordRows` test compiles against the real module. If
 *       the factory still exists, the property access won't be undefined and the
 *       test passes vacuously — but after deletion the TypeScript compiler will
 *       error on the access (legitimate red). A static source-file grep is used
 *       instead so the red state is visible at test-run time without requiring a
 *       compile error (vitest runs ts-transpilation, not full tsc type-check).
 *   (b) The togglePin/snapshot re-point tests use bounded source-file slices
 *       (same technique as cache-invalidation-cluster.test.ts) to ensure the
 *       assertion is satisfied by the specific mutation's onSuccess body, not a
 *       sibling function's invalidation call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) =>
  readFileSync(resolve(import.meta.dirname, '..', rel), 'utf-8'); // readFile-ok — wiring guard

/** Returns the source slice starting at `start`, bounded by the first occurrence
 *  of any `boundaryMarkers` after the start marker (or EOF if none). */
function boundedSlice(src: string, start: string, boundaryMarkers: string[]): string {
  const startIdx = src.indexOf(start);
  if (startIdx === -1) throw new Error(`boundedSlice: marker not found: ${start}`);
  const after = startIdx + start.length;
  let end = src.length;
  for (const marker of boundaryMarkers) {
    const idx = src.indexOf(marker, after);
    if (idx !== -1 && idx < end) end = idx;
  }
  return src.slice(startIdx, end);
}

describe('Task 2 — rank-tracking key collapse', () => {
  // ── (a) rankTrackingKeywordRows factory is removed ──────────────────────

  it('queryKeys.ts does NOT contain rankTrackingKeywordRows', () => {
    // Genuine red before deletion: the factory is present → test fails.
    // Green after deletion: the string no longer appears in the file.
    const src = read('src/lib/queryKeys.ts');
    expect(src).not.toContain('rankTrackingKeywordRows');
  });

  it('RankTracker.tsx does NOT reference rankTrackingKeywordRows', () => {
    // Genuine red: RankTracker currently uses rankTrackingKeywordRows for its query.
    const src = read('src/components/RankTracker.tsx');
    expect(src).not.toContain('rankTrackingKeywordRows');
  });

  it('useWsInvalidation.ts does NOT reference rankTrackingKeywordRows', () => {
    // Genuine red: two paired Rows invalidations are present before this task.
    const src = read('src/hooks/useWsInvalidation.ts');
    expect(src).not.toContain('rankTrackingKeywordRows');
  });

  it('useKeywordCommandCenter.ts does NOT reference rankTrackingKeywordRows', () => {
    // Genuine red: two paired Rows invalidations are present before this task.
    const src = read('src/hooks/admin/useKeywordCommandCenter.ts');
    expect(src).not.toContain('rankTrackingKeywordRows');
  });

  // ── (b) togglePin and snapshot are RE-POINTED (not deleted) to rankTrackingKeywords

  it('togglePin onSuccess invalidates rankTrackingKeywords (re-pointed, not deleted)', () => {
    const src = read('src/components/RankTracker.tsx');
    // Bound from the togglePin mutationFn to the snapshotMutation declaration so
    // a sibling's call cannot satisfy this assertion.
    const section = boundedSlice(
      src,
      'mutationFn: (query: string) => rankTracking.togglePin(',
      ['const snapshotMutation', 'const addKeyword'],
    );
    // Must invalidate the surviving key (list stays fresh after a pin toggle)
    expect(section).toContain('rankTrackingKeywords');
    // Must NOT invalidate the deleted key (delete-not-repoint would leave a stale list)
    expect(section).not.toContain('rankTrackingKeywordRows');
  });

  it('snapshot onSuccess invalidates rankTrackingKeywords (re-pointed, not deleted)', () => {
    const src = read('src/components/RankTracker.tsx');
    // Bound from snapshotMutation to the next named function/const after it.
    const section = boundedSlice(
      src,
      'mutationFn: () => rankTracking.snapshot(',
      ['const addKeyword', 'function addKeyword', 'const removeKeyword'],
    );
    // Must invalidate the surviving key
    expect(section).toContain('rankTrackingKeywords');
    // Must NOT invalidate the deleted key
    expect(section).not.toContain('rankTrackingKeywordRows');
  });

  // ── Sanity: KeywordStrategy still reads rankTrackingKeywords ─────────────

  it('KeywordStrategy.tsx still reads rankTrackingKeywords (unchanged)', () => {
    const src = read('src/components/KeywordStrategy.tsx');
    expect(src).toContain('rankTrackingKeywords');
    // And it must not have acquired the deleted key
    expect(src).not.toContain('rankTrackingKeywordRows');
  });
});
