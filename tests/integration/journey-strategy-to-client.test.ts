/**
 * Journey test: Strategy Generation → Client Data Access
 *
 * Verifies that keyword strategy data stored in the workspace's keyword_strategy
 * JSON column survives the full round-trip: write → SQLite TEXT column → Zod parse → read.
 *
 * Failure modes covered:
 *   FM-1  — Stale/missing data (fields lost during JSON round-trip)
 *   FM-12 — Broken chain (strategy saved but inaccessible to downstream consumers)
 *
 * Journey flow:
 *   1. Workspace starts with no keyword strategy
 *   2. Strategy data is saved via updateWorkspace()
 *   3. getWorkspace() returns the strategy data correctly
 *   4. Content gaps, quick wins, page map entries all round-trip intact
 */
import { describe, it, expect, afterEach } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { seedStrategyData } from '../fixtures/strategy-seed.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import type { KeywordStrategy, ContentGap, QuickWin, PageKeywordMap } from '../../shared/types/workspace.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete KeywordStrategy object for testing. */
function buildStrategy(overrides?: Partial<KeywordStrategy>): KeywordStrategy {
  return {
    siteKeywords: ['dental implants', 'cosmetic dentistry', 'teeth whitening'],
    siteKeywordMetrics: [
      { keyword: 'dental implants', volume: 12100, difficulty: 78 },
      { keyword: 'cosmetic dentistry', volume: 6600, difficulty: 65 },
      { keyword: 'teeth whitening', volume: 9900, difficulty: 42 },
    ],
    pageMap: [
      {
        pagePath: '/services/implants',
        pageTitle: 'Dental Implants',
        primaryKeyword: 'dental implants',
        secondaryKeywords: ['implant dentist', 'dental implant cost'],
      },
      {
        pagePath: '/services/cosmetic',
        pageTitle: 'Cosmetic Dentistry',
        primaryKeyword: 'cosmetic dentistry',
        secondaryKeywords: ['cosmetic dental work', 'smile makeover'],
      },
    ] as PageKeywordMap[],
    opportunities: ['invisalign near me', 'emergency dentist', 'pediatric dentistry'],
    contentGaps: [
      {
        topic: 'Complete Guide to Dental Implants',
        targetKeyword: 'dental implant guide',
        intent: 'informational',
        priority: 'high',
        rationale: 'High search volume with no existing coverage on site',
      },
      {
        topic: 'Teeth Whitening Options Compared',
        targetKeyword: 'teeth whitening options',
        intent: 'commercial',
        priority: 'medium',
        rationale: 'Competitor ranks #2, we have no dedicated page',
      },
    ] as ContentGap[],
    quickWins: [
      {
        pagePath: '/services/implants',
        action: 'Add FAQ schema markup',
        estimatedImpact: 'high',
        rationale: 'Page ranks #8, FAQ schema could boost to featured snippet',
        currentKeyword: 'dental implants cost',
        roiScore: 85,
      },
      {
        pagePath: '/blog/whitening-guide',
        action: 'Update title tag to include target keyword',
        estimatedImpact: 'medium',
        rationale: 'Title missing primary keyword, easy fix',
        roiScore: 62,
      },
    ] as QuickWin[],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Journey: Strategy → Client Data Access', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  });

  // ── 1. Happy path: seeded strategy round-trips fully ──────────────────

  it('returns complete strategy after seedStrategyData()', () => {
    const { workspaceId, cleanup } = seedStrategyData();
    cleanups.push(cleanup);

    const ws = getWorkspace(workspaceId);
    expect(ws).toBeDefined();
    expect(ws!.keywordStrategy).toBeDefined();

    const ks = ws!.keywordStrategy!;
    expect(ks.siteKeywords.length).toBeGreaterThan(0);
    expect(ks.opportunities.length).toBeGreaterThan(0);
    expect(ks.generatedAt).toBeTruthy();
    // contentGaps and quickWins are preserved via .passthrough()
    expect(ks.contentGaps).toBeDefined();
    expect(ks.quickWins).toBeDefined();
  });

  // ── 2. No strategy → keywordStrategy is undefined ─────────────────────

  it('returns undefined keywordStrategy for workspace with no strategy', () => {
    const { workspaceId, cleanup } = seedWorkspace();
    cleanups.push(cleanup);

    const ws = getWorkspace(workspaceId);
    expect(ws).toBeDefined();
    expect(ws!.keywordStrategy).toBeUndefined();
  });

  // ── 3. Strategy update overwrites previous strategy ───────────────────

  it('overwrites existing strategy on update', () => {
    const { workspaceId, cleanup } = seedStrategyData();
    cleanups.push(cleanup);

    // Verify original strategy exists
    const before = getWorkspace(workspaceId)!;
    expect(before.keywordStrategy).toBeDefined();
    const originalKeywords = before.keywordStrategy!.siteKeywords;

    // Overwrite with new strategy
    const newStrategy = buildStrategy({
      siteKeywords: ['replacement keyword alpha', 'replacement keyword beta'],
      opportunities: ['new opportunity'],
    });
    updateWorkspace(workspaceId, { keywordStrategy: newStrategy });

    const after = getWorkspace(workspaceId)!;
    expect(after.keywordStrategy).toBeDefined();
    expect(after.keywordStrategy!.siteKeywords).toEqual([
      'replacement keyword alpha',
      'replacement keyword beta',
    ]);
    expect(after.keywordStrategy!.siteKeywords).not.toEqual(originalKeywords);
    expect(after.keywordStrategy!.opportunities).toEqual(['new opportunity']);
  });

  // ── 4. Content gaps: all fields preserved through JSON round-trip ─────

  it('preserves all content gap fields through round-trip', () => {
    const { workspaceId, cleanup } = seedWorkspace();
    cleanups.push(cleanup);

    const strategy = buildStrategy();
    updateWorkspace(workspaceId, { keywordStrategy: strategy });

    const ws = getWorkspace(workspaceId)!;
    const gaps = ws.keywordStrategy!.contentGaps!;
    expect(gaps.length).toBeGreaterThan(0);

    for (const gap of gaps) {
      expect(gap.topic).toEqual(expect.any(String));
      expect(gap.targetKeyword).toEqual(expect.any(String));
      expect(['informational', 'commercial', 'transactional', 'navigational']).toContain(gap.intent);
      expect(['high', 'medium', 'low']).toContain(gap.priority);
      expect(gap.rationale).toEqual(expect.any(String));
    }

    // Verify specific values survive
    const firstGap = gaps[0];
    expect(firstGap.topic).toBe('Complete Guide to Dental Implants');
    expect(firstGap.targetKeyword).toBe('dental implant guide');
  });

  // ── 5. Page map: secondary keywords preserved as arrays ───────────────

  it('preserves pageMap secondary keywords as arrays', () => {
    const { workspaceId, cleanup } = seedWorkspace();
    cleanups.push(cleanup);

    const strategy = buildStrategy();
    updateWorkspace(workspaceId, { keywordStrategy: strategy });

    const ws = getWorkspace(workspaceId)!;
    const pageMap = ws.keywordStrategy!.pageMap!;
    expect(pageMap.length).toBeGreaterThan(0);

    for (const entry of pageMap) {
      expect(entry.pagePath).toEqual(expect.any(String));
      expect(entry.pageTitle).toEqual(expect.any(String));
      expect(entry.primaryKeyword).toEqual(expect.any(String));
      expect(Array.isArray(entry.secondaryKeywords)).toBe(true);
      expect(entry.secondaryKeywords.length).toBeGreaterThan(0);
    }

    // Verify specific values survive — secondary is a real array, not stringified
    const implantPage = pageMap.find(p => p.pagePath === '/services/implants');
    expect(implantPage).toBeDefined();
    expect(implantPage!.secondaryKeywords).toEqual(['implant dentist', 'dental implant cost']);
  });

  // ── 6. Quick wins: numeric fields preserved as numbers ────────────────

  it('preserves quick win numeric fields as numbers', () => {
    const { workspaceId, cleanup } = seedWorkspace();
    cleanups.push(cleanup);

    const strategy = buildStrategy();
    updateWorkspace(workspaceId, { keywordStrategy: strategy });

    const ws = getWorkspace(workspaceId)!;
    const quickWins = ws.keywordStrategy!.quickWins!;
    expect(quickWins.length).toBeGreaterThan(0);

    for (const qw of quickWins) {
      expect(qw.pagePath).toEqual(expect.any(String));
      expect(qw.action).toEqual(expect.any(String));
      expect(['high', 'medium', 'low']).toContain(qw.estimatedImpact);
      expect(qw.rationale).toEqual(expect.any(String));
      // roiScore is a number, not a string
      if (qw.roiScore !== undefined) {
        expect(typeof qw.roiScore).toBe('number');
      }
    }

    // Verify specific numeric values
    const firstWin = quickWins[0];
    expect(firstWin.roiScore).toBe(85);
  });

  // ── 7. Empty arrays: no crash on empty contentGaps/quickWins ──────────

  it('handles strategy with empty contentGaps and quickWins arrays', () => {
    const { workspaceId, cleanup } = seedWorkspace();
    cleanups.push(cleanup);

    const strategy = buildStrategy({
      contentGaps: [],
      quickWins: [],
      pageMap: [],
      opportunities: [],
    });
    updateWorkspace(workspaceId, { keywordStrategy: strategy });

    const ws = getWorkspace(workspaceId)!;
    const ks = ws.keywordStrategy!;

    // Empty arrays survive, not turned into null/undefined
    expect(Array.isArray(ks.contentGaps)).toBe(true);
    expect(ks.contentGaps!.length).toBe(0);
    expect(Array.isArray(ks.quickWins)).toBe(true);
    expect(ks.quickWins!.length).toBe(0);
    expect(Array.isArray(ks.opportunities)).toBe(true);
    expect(ks.opportunities.length).toBe(0);
  });

  // ── 8. Partial update: strategy doesn't clobber other workspace fields ─

  it('does not clear other workspace fields when updating only keywordStrategy', () => {
    const { workspaceId, webflowToken, cleanup } = seedWorkspace();
    cleanups.push(cleanup);

    // Verify workspace has Webflow token set by seed
    const before = getWorkspace(workspaceId)!;
    expect(before.webflowToken).toBe(webflowToken);
    expect(before.liveDomain).toBe('test.example.com');

    // Update only the keyword strategy
    const strategy = buildStrategy();
    updateWorkspace(workspaceId, { keywordStrategy: strategy });

    // Other fields must still be intact
    const after = getWorkspace(workspaceId)!;
    expect(after.webflowToken).toBe(webflowToken);
    expect(after.liveDomain).toBe('test.example.com');
    expect(after.keywordStrategy).toBeDefined();
    expect(after.keywordStrategy!.siteKeywords.length).toBeGreaterThan(0);
  });
});
