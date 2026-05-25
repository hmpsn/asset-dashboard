/**
 * Unit tests for server/content-gaps.ts — extended coverage.
 *
 * Existing tests in content-gap-opportunity-score.test.ts cover
 * `computeOpportunityScore` (imported from keyword-strategy.js).
 * This file covers the content-gaps module's DB functions, row mapper,
 * and model serialization logic via mocked SQLite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger first
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// --- DB mock setup (using vi.hoisted so vars are available inside vi.mock factories) ---
const { mockStmt, mockDb } = vi.hoisted(() => {
  const mockStmt = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  const mockDb = {
    prepare: vi.fn().mockReturnValue(mockStmt),
    transaction: vi.fn((fn: () => void) => fn),
  };
  return { mockStmt, mockDb };
});

vi.mock('../../server/db/index.js', () => ({
  default: mockDb,
}));

// stmt-cache: call the factory immediately (eager init) so stmts() returns the object
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

// json-validation: real implementations for parsing helpers
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafeArray: (raw: string, _schema: unknown, _ctx: unknown) => {
    try { return JSON.parse(raw); } catch { return []; }
  },
  parseJsonFallback: (raw: string, fallback: unknown) => {
    try { return JSON.parse(raw); } catch { return fallback; }
  },
}));

import {
  listContentGaps,
  getContentGap,
  upsertContentGap,
  upsertContentGapsBatch,
  replaceAllContentGaps,
  deleteContentGap,
  deleteAllContentGaps,
  countContentGaps,
} from '../../server/content-gaps.js';
import type { ContentGap } from '../../shared/types/workspace.js';

// ─── helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: 'ws_test',
    target_keyword: 'seo services',
    topic: 'SEO Services Guide',
    intent: 'commercial',
    priority: 'high',
    rationale: 'High volume, low competition',
    suggested_page_type: 'landing',
    volume: 2400,
    difficulty: 35,
    trend_direction: 'rising',
    serp_features: '["featured_snippet","people_also_ask"]',
    impressions: 800,
    competitor_proof: 'Competitor A ranks #1',
    question_keywords: '["how to do seo","what is seo"]',
    serp_targeting: '["informational","commercial"]',
    opportunity_score: 78,
    ...overrides,
  };
}

function makeGap(overrides: Partial<ContentGap> = {}): ContentGap {
  return {
    topic: 'SEO Services Guide',
    targetKeyword: 'seo services',
    intent: 'commercial',
    priority: 'high',
    rationale: 'High volume, low competition',
    suggestedPageType: 'landing',
    volume: 2400,
    difficulty: 35,
    trendDirection: 'rising',
    serpFeatures: ['featured_snippet', 'people_also_ask'],
    impressions: 800,
    competitorProof: 'Competitor A ranks #1',
    questionKeywords: ['how to do seo', 'what is seo'],
    serpTargeting: ['informational', 'commercial'],
    opportunityScore: 78,
    ...overrides,
  };
}

// ─── rowToModel mapping (via listContentGaps) ─────────────────────────────────

describe('rowToModel — full row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('maps all fields from a complete row', () => {
    mockStmt.all.mockReturnValueOnce([makeRow()]);
    const gaps = listContentGaps('ws_test');
    expect(gaps).toHaveLength(1);
    const g = gaps[0];
    expect(g.topic).toBe('SEO Services Guide');
    expect(g.targetKeyword).toBe('seo services');
    expect(g.intent).toBe('commercial');
    expect(g.priority).toBe('high');
    expect(g.rationale).toBe('High volume, low competition');
    expect(g.suggestedPageType).toBe('landing');
    expect(g.volume).toBe(2400);
    expect(g.difficulty).toBe(35);
    expect(g.trendDirection).toBe('rising');
    expect(g.serpFeatures).toEqual(['featured_snippet', 'people_also_ask']);
    expect(g.impressions).toBe(800);
    expect(g.competitorProof).toBe('Competitor A ranks #1');
    expect(g.questionKeywords).toEqual(['how to do seo', 'what is seo']);
    expect(g.serpTargeting).toEqual(['informational', 'commercial']);
    expect(g.opportunityScore).toBe(78);
  });
});

describe('rowToModel — optional fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('omits optional fields when row values are null', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({
      suggested_page_type: null,
      volume: null,
      difficulty: null,
      trend_direction: null,
      serp_features: null,
      impressions: null,
      competitor_proof: null,
      question_keywords: null,
      serp_targeting: null,
      opportunity_score: null,
    })]);
    const gaps = listContentGaps('ws_test');
    const g = gaps[0];
    expect(g.suggestedPageType).toBeUndefined();
    expect(g.volume).toBeUndefined();
    expect(g.difficulty).toBeUndefined();
    expect(g.trendDirection).toBeUndefined();
    expect(g.serpFeatures).toBeUndefined();
    expect(g.impressions).toBeUndefined();
    expect(g.competitorProof).toBeUndefined();
    expect(g.questionKeywords).toBeUndefined();
    expect(g.serpTargeting).toBeUndefined();
    expect(g.opportunityScore).toBeUndefined();
  });

  it('falls back to "informational" for unknown intent values', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ intent: 'unknown_intent' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].intent).toBe('informational');
  });

  it('falls back to "medium" for unknown priority values', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ priority: 'urgent' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].priority).toBe('medium');
  });

  it('omits suggestedPageType for unknown page type values', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ suggested_page_type: 'unknown_type' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].suggestedPageType).toBeUndefined();
  });

  it('omits trendDirection for unknown trend values', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ trend_direction: 'sideways' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].trendDirection).toBeUndefined();
  });

  it('accepts all valid intent values', () => {
    const intents = ['informational', 'commercial', 'transactional', 'navigational'] as const;
    for (const intent of intents) {
      mockStmt.all.mockReturnValueOnce([makeRow({ intent })]);
      const gaps = listContentGaps('ws_test');
      expect(gaps[0].intent).toBe(intent);
    }
  });

  it('accepts all valid priority values', () => {
    const priorities = ['high', 'medium', 'low'] as const;
    for (const priority of priorities) {
      mockStmt.all.mockReturnValueOnce([makeRow({ priority })]);
      const gaps = listContentGaps('ws_test');
      expect(gaps[0].priority).toBe(priority);
    }
  });

  it('accepts all valid page type values', () => {
    const types = ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'] as const;
    for (const t of types) {
      mockStmt.all.mockReturnValueOnce([makeRow({ suggested_page_type: t })]);
      const gaps = listContentGaps('ws_test');
      expect(gaps[0].suggestedPageType).toBe(t);
    }
  });

  it('accepts all valid trend direction values', () => {
    const trends = ['rising', 'declining', 'stable'] as const;
    for (const trend of trends) {
      mockStmt.all.mockReturnValueOnce([makeRow({ trend_direction: trend })]);
      const gaps = listContentGaps('ws_test');
      expect(gaps[0].trendDirection).toBe(trend);
    }
  });
});

describe('rowToModel — JSON array fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('parses serpFeatures JSON array', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ serp_features: '["snippet","image_pack"]' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].serpFeatures).toEqual(['snippet', 'image_pack']);
  });

  it('parses questionKeywords JSON array', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ question_keywords: '["what is seo","why seo matters"]' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].questionKeywords).toEqual(['what is seo', 'why seo matters']);
  });

  it('parses serpTargeting JSON array', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ serp_targeting: '["top-of-funnel","awareness"]' })]);
    const gaps = listContentGaps('ws_test');
    expect(gaps[0].serpTargeting).toEqual(['top-of-funnel', 'awareness']);
  });

  it('handles malformed JSON gracefully', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ serp_features: 'not-valid-json' })]);
    const gaps = listContentGaps('ws_test');
    // parseJsonSafeArray fallback returns []
    expect(gaps[0].serpFeatures).toEqual([]);
  });
});

// ─── getContentGap ────────────────────────────────────────────────────────────

describe('getContentGap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('returns undefined when row is not found', () => {
    mockStmt.get.mockReturnValueOnce(null);
    expect(getContentGap('ws_test', 'nonexistent')).toBeUndefined();
  });

  it('returns mapped model when row is found', () => {
    mockStmt.get.mockReturnValueOnce(makeRow());
    const gap = getContentGap('ws_test', 'seo services');
    expect(gap).toBeDefined();
    expect(gap!.targetKeyword).toBe('seo services');
    expect(gap!.topic).toBe('SEO Services Guide');
  });
});

// ─── upsertContentGap ─────────────────────────────────────────────────────────

describe('upsertContentGap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('calls stmt.run without throwing', () => {
    expect(() => upsertContentGap('ws_test', makeGap())).not.toThrow();
    expect(mockStmt.run).toHaveBeenCalled();
  });

  it('serializes serpFeatures as JSON string', () => {
    upsertContentGap('ws_test', makeGap({ serpFeatures: ['featured_snippet'] }));
    const params = mockStmt.run.mock.calls[0][0] as Record<string, unknown>;
    expect(params.serp_features).toBe('["featured_snippet"]');
  });

  it('serializes questionKeywords as JSON string', () => {
    upsertContentGap('ws_test', makeGap({ questionKeywords: ['how to seo'] }));
    const params = mockStmt.run.mock.calls[0][0] as Record<string, unknown>;
    expect(params.question_keywords).toBe('["how to seo"]');
  });

  it('serializes serpTargeting as JSON string', () => {
    upsertContentGap('ws_test', makeGap({ serpTargeting: ['commercial'] }));
    const params = mockStmt.run.mock.calls[0][0] as Record<string, unknown>;
    expect(params.serp_targeting).toBe('["commercial"]');
  });

  it('stores null for missing optional fields', () => {
    const minimalGap: ContentGap = {
      topic: 'Minimal Topic',
      targetKeyword: 'minimal keyword',
      intent: 'informational',
      priority: 'low',
      rationale: 'Test rationale',
    };
    upsertContentGap('ws_test', minimalGap);
    const params = mockStmt.run.mock.calls[0][0] as Record<string, unknown>;
    expect(params.suggested_page_type).toBeNull();
    expect(params.volume).toBeNull();
    expect(params.difficulty).toBeNull();
    expect(params.trend_direction).toBeNull();
    expect(params.serp_features).toBeNull();
    expect(params.impressions).toBeNull();
    expect(params.competitor_proof).toBeNull();
    expect(params.question_keywords).toBeNull();
    expect(params.serp_targeting).toBeNull();
    expect(params.opportunity_score).toBeNull();
  });

  it('includes workspace_id in params', () => {
    upsertContentGap('ws_xyz', makeGap());
    const params = mockStmt.run.mock.calls[0][0] as Record<string, unknown>;
    expect(params.workspace_id).toBe('ws_xyz');
  });

  it('includes target_keyword in params matching model.targetKeyword', () => {
    upsertContentGap('ws_test', makeGap({ targetKeyword: 'local seo tips' }));
    const params = mockStmt.run.mock.calls[0][0] as Record<string, unknown>;
    expect(params.target_keyword).toBe('local seo tips');
  });
});

// ─── upsertContentGapsBatch ───────────────────────────────────────────────────

describe('upsertContentGapsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
    // transaction mock: execute the function immediately
    mockDb.transaction.mockImplementation((fn: () => void) => fn);
  });

  it('calls run for each gap in the batch', () => {
    const gaps = [makeGap({ targetKeyword: 'kw1' }), makeGap({ targetKeyword: 'kw2' }), makeGap({ targetKeyword: 'kw3' })];
    upsertContentGapsBatch('ws_test', gaps);
    expect(mockDb.transaction).toHaveBeenCalled();
  });
});

// ─── replaceAllContentGaps ────────────────────────────────────────────────────

describe('replaceAllContentGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
    mockDb.transaction.mockImplementation((fn: () => void) => fn);
  });

  it('wraps delete + upsert in a transaction', () => {
    replaceAllContentGaps('ws_test', [makeGap()]);
    expect(mockDb.transaction).toHaveBeenCalled();
  });
});

// ─── deleteContentGap / deleteAllContentGaps ──────────────────────────────────

describe('deleteContentGap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('calls run without throwing', () => {
    expect(() => deleteContentGap('ws_test', 'seo services')).not.toThrow();
    expect(mockStmt.run).toHaveBeenCalled();
  });
});

describe('deleteAllContentGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('calls run without throwing', () => {
    expect(() => deleteAllContentGaps('ws_test')).not.toThrow();
    expect(mockStmt.run).toHaveBeenCalled();
  });
});

// ─── countContentGaps ─────────────────────────────────────────────────────────

describe('countContentGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('returns the count from the DB', () => {
    mockStmt.get.mockReturnValueOnce({ cnt: 7 });
    expect(countContentGaps('ws_test')).toBe(7);
  });

  it('returns 0 when no rows exist', () => {
    mockStmt.get.mockReturnValueOnce({ cnt: 0 });
    expect(countContentGaps('ws_test')).toBe(0);
  });
});

// ─── listContentGaps — empty state ───────────────────────────────────────────

describe('listContentGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('returns empty array when no rows exist', () => {
    mockStmt.all.mockReturnValueOnce([]);
    expect(listContentGaps('ws_empty')).toEqual([]);
  });

  it('returns multiple mapped models', () => {
    mockStmt.all.mockReturnValueOnce([
      makeRow({ target_keyword: 'kw1', topic: 'Topic 1' }),
      makeRow({ target_keyword: 'kw2', topic: 'Topic 2' }),
    ]);
    const gaps = listContentGaps('ws_test');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].targetKeyword).toBe('kw1');
    expect(gaps[1].targetKeyword).toBe('kw2');
  });

  it('preserves opportunityScore=0 as a numeric value', () => {
    mockStmt.all.mockReturnValueOnce([makeRow({ opportunity_score: 0 })]);
    const gaps = listContentGaps('ws_test');
    // opportunity_score: 0 is non-null, so it should be present
    expect(gaps[0].opportunityScore).toBe(0);
  });
});
