/**
 * Unit tests for server/workspace-learnings.ts — pure formatting and prompt functions.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the logger
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock DB-dependent imports
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
}));

vi.mock('../../server/db/outcome-mappers.js', () => ({
  rowToWorkspaceLearnings: vi.fn(() => null),
}));

import { formatLearningsForPrompt } from '../../server/workspace-learnings.js';
import type {
  WorkspaceLearnings,
  ContentLearnings,
  StrategyLearnings,
  OverallLearnings,
} from '../../shared/types/outcome-tracking.js';

// --- Helpers ---

function makeOverall(overrides: Partial<OverallLearnings> = {}): OverallLearnings {
  return {
    totalWinRate: 0.62,
    strongWinRate: 0.28,
    topActionTypes: [
      { type: 'content_published', winRate: 0.75, count: 10 },
      { type: 'meta_updated', winRate: 0.60, count: 8 },
    ],
    recentTrend: 'stable',
    ...overrides,
  };
}

function makeContentLearnings(overrides: Partial<ContentLearnings> = {}): ContentLearnings {
  return {
    winRateByFormat: { content_published: 0.75, brief_created: 0.55 },
    avgDaysToPage1: 38,
    bestPerformingTopics: ['seo tips', 'content strategy', 'keyword research'],
    optimalWordCount: null,
    refreshRecoveryRate: 0.65,
    voiceScoreCorrelation: null,
    ...overrides,
  };
}

function makeStrategyLearnings(overrides: Partial<StrategyLearnings> = {}): StrategyLearnings {
  return {
    winRateByDifficultyRange: { '0-20': 0.8, '21-40': 0.6, '41-60': 0.45 },
    avgTimeToRank: { '30d': 0.7, '60d': 0.8 },
    bestIntentTypes: ['informational', 'transactional'],
    keywordVolumeSweetSpot: { min: 500, max: 8000 },
    ...overrides,
  };
}

function makeLearnings(overrides: Partial<WorkspaceLearnings> = {}): WorkspaceLearnings {
  return {
    workspaceId: 'ws-test',
    computedAt: '2026-03-01T00:00:00Z',
    confidence: 'medium',
    totalScoredActions: 25,
    content: makeContentLearnings(),
    strategy: makeStrategyLearnings(),
    technical: null,
    overall: makeOverall(),
    ...overrides,
  };
}

// --- formatLearningsForPrompt ---

describe('formatLearningsForPrompt', () => {
  it('returns empty string for low confidence', () => {
    const learnings = makeLearnings({ confidence: 'low' });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toBe('');
  });

  it('returns non-empty string for medium confidence', () => {
    const learnings = makeLearnings({ confidence: 'medium' });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns non-empty string for high confidence', () => {
    const learnings = makeLearnings({ confidence: 'high' });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes overall win rate in output', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({ totalWinRate: 0.62, strongWinRate: 0.28 }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('62%');
    expect(result).toContain('28%');
  });

  it('includes WORKSPACE LEARNINGS header with action count and confidence', () => {
    const learnings = makeLearnings({ confidence: 'medium', totalScoredActions: 25 });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('25');
    expect(result).toContain('medium');
  });

  it('includes content-domain specific content for domain=content', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings({
        avgDaysToPage1: 38,
        bestPerformingTopics: ['seo tips', 'content strategy'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    expect(result).toContain('38');
  });

  it('includes best performing topics for content domain', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings({
        bestPerformingTopics: ['seo tips', 'content strategy', 'link building'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    expect(result).toContain('seo tips');
  });

  it('includes content format win rate comparison for domain=content', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings({
        winRateByFormat: { content_published: 0.75, brief_created: 0.45 },
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    // Format comparison line includes both format names
    expect(result).toContain('75%');
    expect(result).toContain('45%');
  });

  it('includes strategy-domain specific content for domain=strategy', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      strategy: makeStrategyLearnings({
        keywordVolumeSweetSpot: { min: 500, max: 8000 },
        bestIntentTypes: ['informational', 'transactional'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    expect(result).toContain('500');
    expect(result).toContain('8000');
  });

  it('includes best intent types for strategy domain', () => {
    const learnings = makeLearnings({
      confidence: 'high',
      strategy: makeStrategyLearnings({
        bestIntentTypes: ['informational', 'transactional'],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    expect(result).toContain('informational');
  });

  it('includes difficulty range win rate for strategy domain', () => {
    const learnings = makeLearnings({
      confidence: 'high',
      strategy: makeStrategyLearnings({
        winRateByDifficultyRange: { '0-20': 0.85 },
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    expect(result).toContain('0-20');
    expect(result).toContain('85%');
  });

  it('does not include content lines when domain=strategy with null content', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: null,
      strategy: makeStrategyLearnings(),
    });
    const result = formatLearningsForPrompt(learnings, 'strategy');
    // Should not contain content-specific phrases
    expect(result).not.toContain('page 1');
  });

  it('does not include strategy lines when domain=content with null strategy', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      content: makeContentLearnings(),
      strategy: null,
    });
    const result = formatLearningsForPrompt(learnings, 'content');
    expect(result).not.toContain('keyword impressions range');
  });

  it('does not exceed ~20 lines of output', () => {
    const learnings = makeLearnings({ confidence: 'high' });
    const result = formatLearningsForPrompt(learnings, 'all');
    const lineCount = result.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(20);
  });

  it('includes trending signal when trend is not stable', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({ recentTrend: 'improving' }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('improving');
  });

  it('does not include trend line when trend is stable', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({ recentTrend: 'stable' }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).not.toContain('Recent trend');
  });

  it('includes top action types when available', () => {
    const learnings = makeLearnings({
      confidence: 'medium',
      overall: makeOverall({
        topActionTypes: [
          { type: 'content_published', winRate: 0.75, count: 10 },
          { type: 'meta_updated', winRate: 0.60, count: 8 },
          { type: 'schema_deployed', winRate: 0.55, count: 6 },
        ],
      }),
    });
    const result = formatLearningsForPrompt(learnings, 'all');
    expect(result).toContain('content published');
  });
});
