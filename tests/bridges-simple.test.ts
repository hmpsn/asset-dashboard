import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Structural verification tests for PR 2B bridges.
 * These tests read source files and verify that bridge calls exist,
 * ensuring they aren't accidentally removed during refactoring.
 */

describe('PR 2B Bridge Wiring Verification', () => {
  describe('Bridge #2: content decay → suggested brief', () => {
    it('content-decay.ts calls fireBridge with bridge-decay-suggested-brief', () => {
      const src = readFileSync('server/routes/content-decay.ts', 'utf-8');
      expect(src).toContain('fireBridge');
      expect(src).toContain('bridge-decay-suggested-brief');
      expect(src).toContain('createSuggestedBrief');
    });
  });

  describe('Bridge #3: strategy updated → invalidate intelligence cache', () => {
    it('keyword-strategy.ts calls debouncedStrategyInvalidate', () => {
      const src = readFileSync('server/routes/keyword-strategy.ts', 'utf-8');
      expect(src).toContain('debouncedStrategyInvalidate');
      expect(src).toContain('invalidateIntelligenceCache');
    });

    it('public-portal.ts calls debouncedStrategyInvalidate', () => {
      const src = readFileSync('server/routes/public-portal.ts', 'utf-8');
      expect(src).toContain('debouncedStrategyInvalidate');
    });
  });

  describe('Bridge #4: insight resolved → tracked action (pre-existing)', () => {
    it('insights.ts calls recordAction on resolution', () => {
      const src = readFileSync('server/routes/insights.ts', 'utf-8');
      expect(src).toContain('recordAction');
      expect(src).toContain('getActionBySource');
      expect(src).toContain('insight_acted_on');
    });
  });

  describe('Bridge #5: page analysis → clear caches', () => {
    it('webflow-keywords.ts calls debouncedPageAnalysisInvalidate', () => {
      const src = readFileSync('server/routes/webflow-keywords.ts', 'utf-8');
      expect(src).toContain('debouncedPageAnalysisInvalidate');
      expect(src).toContain('clearSeoContextCache');
      expect(src).toContain('invalidateIntelligenceCache');
    });

    it('jobs.ts calls debouncedPageAnalysisInvalidate', () => {
      const src = readFileSync('server/routes/jobs.ts', 'utf-8');
      expect(src).toContain('debouncedPageAnalysisInvalidate');
      expect(src).toContain('clearSeoContextCache');
    });
  });

  describe('Bridge #7: recordAction → auto-resolve insights', () => {
    it('outcome-tracking.ts calls fireBridge with bridge-action-auto-resolve', () => {
      const src = readFileSync('server/outcome-tracking.ts', 'utf-8');
      expect(src).toContain('fireBridge');
      expect(src).toContain('bridge-action-auto-resolve');
      expect(src).toContain('resolveInsight');
    });
  });

  describe('Bridge #11: workspace settings → cascade invalidation', () => {
    it('workspaces.ts calls debouncedSettingsCascade', () => {
      const src = readFileSync('server/routes/workspaces.ts', 'utf-8');
      expect(src).toContain('debouncedSettingsCascade');
      expect(src).toContain('invalidatePageCache');
      expect(src).toContain('invalidateSubCachePrefix');
    });
  });

  describe('Bridge #13: recordAction → create annotation', () => {
    it('outcome-tracking.ts calls fireBridge with bridge-action-annotation', () => {
      const src = readFileSync('server/outcome-tracking.ts', 'utf-8');
      expect(src).toContain('bridge-action-annotation');
      expect(src).toContain('createAnnotation');
    });
  });
});
