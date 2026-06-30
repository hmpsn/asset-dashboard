/**
 * Task 2 — Collapse duplicate rank-tracking query keys (#11).
 *
 * CONTRACT:
 *   `rankTrackingKeywords` and `rankTrackingKeywordRows` were two cache buckets
 *   backed by the SAME fetcher. This collapsed them into ONE key
 *   (`rankTrackingKeywords`) and deleted `rankTrackingKeywordRows`. The standalone
 *   RankTracker that previously owned the Rows-only invalidations was retired in
 *   the W4 Keyword Hub cutover, so the surviving guard simply asserts the deleted
 *   key never reappears in the remaining cache-key consumers.
 *
 * WHY THESE TESTS ARE NON-TAUTOLOGICAL:
 *   The `rankTrackingKeywordRows` grep checks the real source files. If the
 *   factory were re-added, the string would reappear and the test would fail —
 *   a static source-file grep keeps the red state visible at test-run time
 *   without requiring a compile error (vitest runs ts-transpilation, not tsc).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) =>
  readFileSync(resolve(import.meta.dirname, '..', rel), 'utf-8'); // readFile-ok — wiring guard

describe('Task 2 — rank-tracking key collapse', () => {
  // ── (a) rankTrackingKeywordRows factory is removed ──────────────────────

  it('queryKeys.ts does NOT contain rankTrackingKeywordRows', () => {
    // Genuine red before deletion: the factory is present → test fails.
    // Green after deletion: the string no longer appears in the file.
    const src = read('src/lib/queryKeys.ts');
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

  // ── Sanity: the rank-tracking consumer still reads rankTrackingKeywords ──
  // The read moved out of KeywordStrategy.tsx into the useTrackKeyword hook during the
  // Phase 0 strategy-page decomposition; this guard follows the code to its new home.

  it('useTrackKeyword reads rankTrackingKeywords and never the deleted Rows key', () => {
    const hook = read('src/components/strategy/hooks/useTrackKeyword.ts');
    expect(hook).toContain('rankTrackingKeywords');
    expect(hook).not.toContain('rankTrackingKeywordRows');
    // The orchestrator must not reintroduce the deleted key either.
    expect(read('src/components/KeywordStrategy.tsx')).not.toContain('rankTrackingKeywordRows');
  });
});
