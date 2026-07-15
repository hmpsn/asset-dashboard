import { describe, expect, it } from 'vitest';
import {
  canonicalChunkName,
  canonicalStaticAssetName,
  evaluateBudget,
  stripAssetHash,
  MIN_SLACK_BYTES,
  NEW_ASSET_CAP_BYTES,
  type BudgetEntry,
} from '../../scripts/verify-bundle-budget';

// These pure helpers are the fragile, bundler-naming-coupled part of the gate; keeping them
// import-safe (behind an entry guard) so they can be unit-tested is the point of the refactor.

describe('stripAssetHash', () => {
  it('strips an 8+ char content hash suffix but keeps dir and extension', () => {
    expect(stripAssetHash('assets/index-AbCd1234.css')).toBe('assets/index.css');
    expect(stripAssetHash('assets/vendor-DeadBeef99.js')).toBe('assets/vendor.js');
  });

  it('leaves a short trailing segment (not a hash) intact', () => {
    // 'left' is 4 chars — below the 8-char hash threshold — so it is preserved.
    expect(stripAssetHash('chevron-left.js')).toBe('chevron-left.js');
  });

  it('documents the known over-strip edge: a long non-hash trailing word is stripped', () => {
    // 'subscriptions' (13 chars) matches the hash regex, so this collapses to 'content.js'.
    // Guarded so a future tightening of the regex is a deliberate, test-visible change.
    expect(stripAssetHash('content-subscriptions.js')).toBe('content.js');
  });
});

describe('canonicalChunkName', () => {
  it('names the HTML entry by its chunk name, never js:index.html', () => {
    // Vite sets src='index.html' on the main app entry; the emitted JS is the app bundle.
    expect(canonicalChunkName('index.html', { src: 'index.html', name: 'index', file: 'assets/index-HASH1234.js', isEntry: true })).toBe('js:index');
  });

  it('falls back to the emitted file basename for a nameless html entry', () => {
    expect(canonicalChunkName('index.html', { src: 'index.html', file: 'assets/index-HASH1234.js', isEntry: true })).toBe('js:index.js');
  });

  it('prefers a non-html src', () => {
    expect(canonicalChunkName('x', { src: 'src/pages/Foo.tsx', file: 'assets/Foo-HASH1234.js' })).toBe('js:src/pages/Foo.tsx');
  });

  it('uses the chunk name when there is no src', () => {
    expect(canonicalChunkName('x', { name: 'shared', file: 'assets/shared-HASH1234.js' })).toBe('js:shared');
  });
});

describe('canonicalStaticAssetName', () => {
  it('hash-strips css, leaves fonts hash-intact, prefixes each by kind', () => {
    expect(canonicalStaticAssetName('assets/index-AbCd1234.css')).toBe('css:assets/index.css');
    expect(canonicalStaticAssetName('/fonts/fa-sharp-regular-400.woff2')).toBe('font:fonts/fa-sharp-regular-400.woff2');
    expect(canonicalStaticAssetName('assets/logo-DeadBeef99.svg')).toBe('asset:assets/logo.svg');
  });
});

function baselineOf(entries: Record<string, number>, tolerance = 0.05): {
  version: 1; updatedAt: string; tolerance: number; total: number; entries: Record<string, number>;
} {
  return {
    version: 1,
    updatedAt: '2026-07-05',
    tolerance,
    total: Object.values(entries).reduce((sum, bytes) => sum + bytes, 0),
    entries,
  };
}

describe('evaluateBudget', () => {
  it('passes when every baselined asset is within budget and total holds', () => {
    const baseline = baselineOf({ 'js:index': 90_000, 'css:assets/index.css': 10_000 });
    const entries: BudgetEntry[] = [
      { name: 'js:index', gzipBytes: 90_500 },
      { name: 'css:assets/index.css', gzipBytes: 10_000 },
    ];
    const result = evaluateBudget(entries, baseline);
    expect(result.regressions).toHaveLength(0);
    expect(result.oversizeNewEntries).toHaveLength(0);
    expect(result.totalExceeded).toBe(false);
  });

  it('flags a baselined asset that grows past its per-entry budget', () => {
    const baseline = baselineOf({ 'js:index': 90_000 });
    const result = evaluateBudget([{ name: 'js:index', gzipBytes: 120_000 }], baseline);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]?.name).toBe('js:index');
  });

  it('applies an absolute slack floor so a byte-shift on a tiny chunk does not fail (#4)', () => {
    // 137B baseline: % budget is ceil(137*1.05)=144, but the slack floor lifts it to 137+512=649.
    const baseline = baselineOf({ 'js:chevron-left': 137 });
    const withinSlack = evaluateBudget([{ name: 'js:chevron-left', gzipBytes: 200 }], baseline);
    expect(withinSlack.regressions).toHaveLength(0);
    // A genuine jump beyond the slack floor still fails.
    const beyondSlack = evaluateBudget([{ name: 'js:chevron-left', gzipBytes: 137 + MIN_SLACK_BYTES + 1 }], baseline);
    expect(beyondSlack.regressions).toHaveLength(1);
  });

  it('warns on a small new asset but FAILS a new asset over the cap (#1)', () => {
    const baseline = baselineOf({ 'js:index': 90_000 });
    const smallNew = evaluateBudget([
      { name: 'js:index', gzipBytes: 90_000 },
      { name: 'js:tiny-new-icon', gzipBytes: 400 },
    ], baseline);
    expect(smallNew.newEntries.map(e => e.name)).toContain('js:tiny-new-icon');
    expect(smallNew.oversizeNewEntries).toHaveLength(0);

    const heavyNew = evaluateBudget([
      { name: 'js:index', gzipBytes: 90_000 },
      { name: 'js:huge-new-route', gzipBytes: NEW_ASSET_CAP_BYTES + 1 },
    ], baseline);
    expect(heavyNew.oversizeNewEntries.map(e => e.name)).toContain('js:huge-new-route');
  });

  it('fails on aggregate bloat even when no single entry regresses (#1 route-split guard)', () => {
    // A route split into two new small-ish chunks: neither over the per-new cap, but together
    // they push the total past the aggregate ceiling.
    const baseline = baselineOf({ 'js:index': 100_000 });
    const result = evaluateBudget([
      { name: 'js:index', gzipBytes: 100_000 },
      { name: 'js:split-a', gzipBytes: 30_000 },
      { name: 'js:split-b', gzipBytes: 30_000 },
    ], baseline);
    expect(result.oversizeNewEntries).toHaveLength(0); // each under the 50 KiB new-asset cap
    expect(result.totalExceeded).toBe(true); // but aggregate 160k > 100k*1.05
  });
});
