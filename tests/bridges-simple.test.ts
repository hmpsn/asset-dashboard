import { describe, it, expect } from 'vitest';
import { expectContainsAll, readProjectFile } from './helpers/source-contracts';

/**
 * Structural verification tests for PR 2B bridges.
 * These tests read source files and verify that bridge calls exist,
 * ensuring they aren't accidentally removed during refactoring.
 */

describe('PR 2B Bridge Wiring Verification', () => {
  describe('Bridge #2: content decay → suggested brief', () => {
    it('content-decay.ts calls fireBridge with bridge-decay-suggested-brief', () => {
      const src = readProjectFile('server/routes/content-decay.ts');
      expectContainsAll(src, ['fireBridge', 'bridge-decay-suggested-brief', 'createSuggestedBrief']);
    });
  });

  describe('Bridge #3: strategy updated → invalidate intelligence cache', () => {
    it('keyword-strategy.ts calls debouncedStrategyInvalidate', () => {
      const src = readProjectFile('server/routes/keyword-strategy.ts');
      expectContainsAll(src, ['debouncedStrategyInvalidate', 'invalidateIntelligenceCache']);
    });

    it('public-portal.ts calls debouncedStrategyInvalidate', () => {
      const src = readProjectFile('server/routes/public-portal.ts');
      expect(src).toContain('debouncedStrategyInvalidate');
    });
  });

  describe('Bridge #4: insight resolved → tracked action (pre-existing)', () => {
    // The resolve route delegates the tracked-action recording to the shared
    // recordInsightResolutionOutcome helper (so the MCP resolve_insight tool feeds
    // outcome learning identically). Verify both halves of the wiring survive.
    it('insights.ts route wires resolution to the shared outcome helper', () => {
      const src = readProjectFile('server/routes/insights.ts');
      expect(src).toContain('recordInsightResolutionOutcome');
    });

    it('outcome-tracking.ts records the tracked action for resolved insights', () => {
      const src = readProjectFile('server/outcome-tracking.ts');
      expectContainsAll(src, ['recordInsightResolutionOutcome', 'recordAction', 'getActionBySource', 'insight_acted_on']);
    });
  });

  describe('Bridge #5: page analysis → invalidate intelligence cache', () => {
    it('webflow-keywords.ts calls debouncedPageAnalysisInvalidate', () => {
      const src = readProjectFile('server/routes/webflow-keywords.ts');
      expectContainsAll(src, ['debouncedPageAnalysisInvalidate', 'invalidateIntelligenceCache']);
    });

    it('page-analysis-job.ts calls debouncedPageAnalysisInvalidate', () => {
      const src = readProjectFile('server/page-analysis-job.ts');
      expectContainsAll(src, ['debouncedPageAnalysisInvalidate', 'invalidateIntelligenceCache']);
    });
  });

  describe('Bridge #7: recordAction → auto-resolve insights', () => {
    it('outcome-tracking.ts calls fireBridge with bridge-action-auto-resolve', () => {
      const src = readProjectFile('server/outcome-tracking.ts');
      expectContainsAll(src, ['fireBridge', 'bridge-action-auto-resolve', 'resolveInsight']);
    });
  });

  describe('Bridge #11: workspace settings → cascade invalidation', () => {
    it('workspaces.ts calls debouncedSettingsCascade', () => {
      const src = readProjectFile('server/routes/workspaces.ts');
      expectContainsAll(src, ['debouncedSettingsCascade', 'invalidatePageCache', 'invalidateSubCachePrefix']);
    });
  });

  describe('Bridge #13: recordAction → create annotation', () => {
    it('outcome-tracking.ts calls fireBridge with bridge-action-annotation', () => {
      const src = readProjectFile('server/outcome-tracking.ts');
      expectContainsAll(src, ['bridge-action-annotation', 'createAnnotation']);
    });
  });
});
