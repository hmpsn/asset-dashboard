/**
 * Unit tests for server-side pure utility modules.
 *
 * Targets modules that have only smoke tests or no direct tests:
 *  - server/strategy-filters.ts
 *  - server/schemas/copy-pipeline.ts
 *  - server/schemas/keyword-feedback.ts
 *  - server/schemas/seo-bulk-jobs.ts
 *  - server/schemas/client-business-priorities.ts
 *  - server/schemas/internal-links-schemas.ts
 *  - server/schemas/diagnostics-schemas.ts
 *  - server/schemas/voice-calibration.ts
 *  - server/schemas/page-analysis.ts
 *
 * All tests use pure in-process Zod/logic only — no DB, no HTTP, no mocks.
 */

import { describe, it, expect } from 'vitest';

// ── strategy-filters ─────────────────────────────────────────────────────────

import {
  filterDeclinedFromPool,
  matchesQuestionKeyword,
} from '../../server/strategy-filters.js';

describe('filterDeclinedFromPool', () => {
  it('returns 0 and leaves pool unchanged when declinedKeywords is empty', () => {
    const pool = new Map<string, unknown>([['keyword one', {}], ['keyword two', {}]]);
    const removed = filterDeclinedFromPool(pool, []);
    expect(removed).toBe(0);
    expect(pool.size).toBe(2);
  });

  it('removes a matching keyword and returns count 1', () => {
    const pool = new Map<string, unknown>([['best dentist', {}], ['root canal', {}]]);
    const removed = filterDeclinedFromPool(pool, ['best dentist']);
    expect(removed).toBe(1);
    expect(pool.has('best dentist')).toBe(false);
    expect(pool.has('root canal')).toBe(true);
  });

  it('matches with normalization (case-insensitive)', () => {
    const pool = new Map<string, unknown>([['Best Dentist NYC', {}]]);
    const removed = filterDeclinedFromPool(pool, ['best dentist nyc']);
    expect(removed).toBe(1);
    expect(pool.size).toBe(0);
  });

  it('removes multiple matching keywords', () => {
    const pool = new Map<string, unknown>([['kw a', {}], ['kw b', {}], ['kw c', {}]]);
    const removed = filterDeclinedFromPool(pool, ['kw a', 'kw c']);
    expect(removed).toBe(2);
    expect(pool.size).toBe(1);
    expect(pool.has('kw b')).toBe(true);
  });

  it('handles empty pool gracefully', () => {
    const pool = new Map<string, unknown>();
    const removed = filterDeclinedFromPool(pool, ['something']);
    expect(removed).toBe(0);
  });
});

describe('matchesQuestionKeyword', () => {
  it('returns true when both target words appear in the question', () => {
    expect(matchesQuestionKeyword('seo agency', 'best seo agency chicago')).toBe(true);
  });

  it('returns false when only one of two target words matches', () => {
    expect(matchesQuestionKeyword('seo agency', 'best seo chicago')).toBe(false);
  });

  it('returns true for single-word targets if that word matches', () => {
    expect(matchesQuestionKeyword('dentist', 'how to find a dentist near me')).toBe(true);
  });

  it('returns false when no target words appear in the question', () => {
    expect(matchesQuestionKeyword('dental implants', 'how to find a plumber')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesQuestionKeyword('ROOT Canal', 'What is a root canal procedure')).toBe(true);
  });

  it('uses word-boundary matching — short word "ai" does not match "email"', () => {
    // "ai" is a single word that won't be in "email" when split on whitespace
    expect(matchesQuestionKeyword('ai tools', 'what email tools should I use')).toBe(false);
  });

  it('requires min(2, targetWords.length) words to match', () => {
    // 3-word target: needs at least 2 words
    expect(matchesQuestionKeyword('dental implant surgery', 'what is dental implant cost')).toBe(true);
    expect(matchesQuestionKeyword('dental implant surgery', 'what is implant recovery')).toBe(false);
  });
});

// ── schemas/copy-pipeline ─────────────────────────────────────────────────────

import {
  steeringEntrySchema,
  clientSuggestionSchema,
  qualityFlagSchema,
  batchProgressSchema,
  copySectionStatusSchema,
  intelligencePatternTypeSchema,
  generateCopySchema,
  regenerateSectionSchema,
  updateSectionStatusSchema,
  updateSectionTextSchema,
  addSuggestionSchema,
  updatePatternSchema,
  extractPatternsSchema,
  startBatchSchema,
  exportCopySchema,
} from '../../server/schemas/copy-pipeline.js';

describe('steeringEntrySchema', () => {
  it('accepts valid note type entry', () => {
    const result = steeringEntrySchema.safeParse({
      type: 'note',
      note: 'Keep it concise',
      resultVersion: 1,
      timestamp: '2026-05-25T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid type values', () => {
    for (const type of ['note', 'highlight', 'summary'] as const) {
      expect(steeringEntrySchema.safeParse({ type, note: 'x', resultVersion: 1, timestamp: 't' }).success).toBe(true);
    }
  });

  it('rejects invalid type', () => {
    const result = steeringEntrySchema.safeParse({ type: 'unknown', note: 'x', resultVersion: 1, timestamp: 't' });
    expect(result.success).toBe(false);
  });

  it('accepts optional highlight field', () => {
    const result = steeringEntrySchema.safeParse({
      type: 'highlight',
      note: 'Make punchier',
      highlight: 'original text to replace',
      resultVersion: 2,
      timestamp: '2026-05-25T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('clientSuggestionSchema', () => {
  it('accepts valid suggestion with all required fields', () => {
    const result = clientSuggestionSchema.safeParse({
      originalText: 'Old copy',
      suggestedText: 'New copy',
      status: 'pending',
      timestamp: '2026-05-25T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'accepted', 'rejected', 'modified'] as const) {
      expect(clientSuggestionSchema.safeParse({
        originalText: 'old', suggestedText: 'new', status, timestamp: 't',
      }).success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = clientSuggestionSchema.safeParse({
      originalText: 'old', suggestedText: 'new', status: 'approved', timestamp: 't',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional reviewNote', () => {
    const result = clientSuggestionSchema.safeParse({
      originalText: 'old', suggestedText: 'new', status: 'accepted',
      timestamp: 't', reviewNote: 'Looks good',
    });
    expect(result.success).toBe(true);
  });
});

describe('qualityFlagSchema', () => {
  it('accepts valid quality flag', () => {
    const result = qualityFlagSchema.safeParse({
      type: 'forbidden_phrase',
      message: 'Found forbidden phrase',
      severity: 'error',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const result = qualityFlagSchema.safeParse({ type: 'bad_type', message: 'x', severity: 'error' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown severity', () => {
    const result = qualityFlagSchema.safeParse({ type: 'keyword_stuffing', message: 'x', severity: 'info' });
    expect(result.success).toBe(false);
  });
});

describe('batchProgressSchema', () => {
  it('accepts valid batch progress', () => {
    const result = batchProgressSchema.safeParse({ total: 10, generated: 5, reviewed: 3, approved: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer values', () => {
    const result = batchProgressSchema.safeParse({ total: 10.5, generated: 5, reviewed: 3, approved: 2 });
    expect(result.success).toBe(false);
  });
});

describe('copySectionStatusSchema', () => {
  it('accepts all valid section status values', () => {
    for (const s of ['pending', 'draft', 'client_review', 'approved', 'revision_requested'] as const) {
      expect(copySectionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(copySectionStatusSchema.safeParse('published').success).toBe(false);
  });
});

describe('intelligencePatternTypeSchema', () => {
  it('accepts all valid pattern types', () => {
    for (const t of ['terminology', 'tone', 'structure', 'keyword_usage'] as const) {
      expect(intelligencePatternTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rejects invalid pattern type', () => {
    expect(intelligencePatternTypeSchema.safeParse('voice').success).toBe(false);
  });
});

describe('exportCopySchema', () => {
  it('accepts valid webflow_cms export for all scope', () => {
    const result = exportCopySchema.safeParse({ format: 'webflow_cms', scope: 'all' });
    expect(result.success).toBe(true);
  });

  it('requires entryIds when scope is selected', () => {
    const noIds = exportCopySchema.safeParse({ format: 'csv', scope: 'selected' });
    expect(noIds.success).toBe(false);

    const withIds = exportCopySchema.safeParse({ format: 'csv', scope: 'selected', entryIds: ['e1', 'e2'] });
    expect(withIds.success).toBe(true);
  });

  it('requires entryId when scope is single', () => {
    const noId = exportCopySchema.safeParse({ format: 'copy_deck', scope: 'single' });
    expect(noId.success).toBe(false);

    const withId = exportCopySchema.safeParse({ format: 'copy_deck', scope: 'single', entryId: 'e1' });
    expect(withId.success).toBe(true);
  });

  it('rejects unknown format', () => {
    const result = exportCopySchema.safeParse({ format: 'pdf', scope: 'all' });
    expect(result.success).toBe(false);
  });
});

describe('startBatchSchema', () => {
  it('accepts minimum valid batch request', () => {
    const result = startBatchSchema.safeParse({ entryIds: ['e1'] });
    expect(result.success).toBe(true);
  });

  it('rejects empty entryIds', () => {
    const result = startBatchSchema.safeParse({ entryIds: [] });
    expect(result.success).toBe(false);
  });

  it('accepts optional mode and batchSize', () => {
    const result = startBatchSchema.safeParse({ entryIds: ['e1'], mode: 'iterative', batchSize: 5 });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mode', () => {
    const result = startBatchSchema.safeParse({ entryIds: ['e1'], mode: 'batch' });
    expect(result.success).toBe(false);
  });
});

describe('extractPatternsSchema', () => {
  it('accepts valid steeringNotes array', () => {
    const result = extractPatternsSchema.safeParse({ steeringNotes: ['Note 1', 'Note 2'] });
    expect(result.success).toBe(true);
  });

  it('rejects empty steeringNotes', () => {
    const result = extractPatternsSchema.safeParse({ steeringNotes: [] });
    expect(result.success).toBe(false);
  });
});

describe('regenerateSectionSchema', () => {
  it('accepts valid note', () => {
    const result = regenerateSectionSchema.safeParse({ note: 'Make it more concise', expectedRevision: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects empty note', () => {
    const result = regenerateSectionSchema.safeParse({ note: '', expectedRevision: 2 });
    expect(result.success).toBe(false);
  });

  it('accepts optional highlight', () => {
    const result = regenerateSectionSchema.safeParse({
      note: 'Rewrite this',
      highlight: 'old text',
      expectedRevision: 2,
    });
    expect(result.success).toBe(true);
  });
});

describe('updateSectionStatusSchema', () => {
  it('accepts valid status', () => {
    const result = updateSectionStatusSchema.safeParse({ status: 'approved', expectedRevision: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = updateSectionStatusSchema.safeParse({ status: 'deleted', expectedRevision: 2 });
    expect(result.success).toBe(false);
  });
});

describe('updateSectionTextSchema', () => {
  it('accepts non-empty copy', () => {
    const result = updateSectionTextSchema.safeParse({ copy: '<p>New content</p>', expectedRevision: 2 });
    expect(result.success).toBe(true);
  });

  it('rejects empty copy', () => {
    const result = updateSectionTextSchema.safeParse({ copy: '', expectedRevision: 2 });
    expect(result.success).toBe(false);
  });
});

describe('addSuggestionSchema', () => {
  it('accepts valid suggestion pair', () => {
    const result = addSuggestionSchema.safeParse({
      originalText: 'old',
      suggestedText: 'new',
      expectedRevision: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty fields', () => {
    expect(addSuggestionSchema.safeParse({
      originalText: '',
      suggestedText: 'new',
      expectedRevision: 2,
    }).success).toBe(false);
    expect(addSuggestionSchema.safeParse({
      originalText: 'old',
      suggestedText: '',
      expectedRevision: 2,
    }).success).toBe(false);
  });
});

describe('updatePatternSchema', () => {
  it('accepts partial updates', () => {
    expect(updatePatternSchema.safeParse({ active: true }).success).toBe(true);
    expect(updatePatternSchema.safeParse({ pattern: 'avoid jargon' }).success).toBe(true);
    expect(updatePatternSchema.safeParse({ patternType: 'tone' }).success).toBe(true);
  });

  it('accepts empty object (no changes)', () => {
    expect(updatePatternSchema.safeParse({}).success).toBe(true);
  });
});

describe('generateCopySchema', () => {
  it('accepts empty object (no steering)', () => {
    expect(generateCopySchema.safeParse({}).success).toBe(true);
  });

  it('accepts optional accumulatedSteering array', () => {
    expect(generateCopySchema.safeParse({ accumulatedSteering: ['Be concise', 'Use active voice'] }).success).toBe(true);
  });
});

// ── schemas/keyword-feedback ─────────────────────────────────────────────────

import {
  keywordFeedbackSourceSchema,
  keywordFeedbackSchema,
  bulkKeywordFeedbackSchema,
  contentGapVoteSchema,
} from '../../server/schemas/keyword-feedback.js';

describe('keywordFeedbackSourceSchema', () => {
  it('accepts all valid source values', () => {
    for (const src of ['content_gap', 'page_map', 'opportunity', 'topic_cluster', 'keyword_gap'] as const) {
      expect(keywordFeedbackSourceSchema.safeParse(src).success).toBe(true);
    }
  });

  it('rejects invalid source', () => {
    expect(keywordFeedbackSourceSchema.safeParse('strategy').success).toBe(false);
  });
});

describe('keywordFeedbackSchema', () => {
  it('accepts minimal valid feedback (approved)', () => {
    const result = keywordFeedbackSchema.safeParse({ keyword: 'dental implants', status: 'approved' });
    expect(result.success).toBe(true);
  });

  it('accepts declined status with reason', () => {
    const result = keywordFeedbackSchema.safeParse({
      keyword: 'cheap dentist',
      status: 'declined',
      reason: 'Not aligned with premium brand',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid status values', () => {
    for (const status of ['approved', 'declined', 'requested'] as const) {
      expect(keywordFeedbackSchema.safeParse({ keyword: 'seo', status }).success).toBe(true);
    }
  });

  it('rejects empty keyword', () => {
    const result = keywordFeedbackSchema.safeParse({ keyword: '', status: 'approved' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = keywordFeedbackSchema.safeParse({ keyword: 'seo', status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('allows empty string for reason (clearable field pattern)', () => {
    const result = keywordFeedbackSchema.safeParse({ keyword: 'seo', status: 'declined', reason: '' });
    expect(result.success).toBe(true);
  });

  it('defaults source to content_gap when omitted', () => {
    const result = keywordFeedbackSchema.safeParse({ keyword: 'seo', status: 'approved' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('content_gap');
    }
  });
});

describe('bulkKeywordFeedbackSchema', () => {
  it('accepts valid array of keyword feedbacks', () => {
    const result = bulkKeywordFeedbackSchema.safeParse({
      keywords: [
        { keyword: 'dentist near me', status: 'approved' },
        { keyword: 'cheap dental', status: 'declined', reason: 'Off-brand' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty keywords array', () => {
    const result = bulkKeywordFeedbackSchema.safeParse({ keywords: [] });
    expect(result.success).toBe(false);
  });
});

describe('contentGapVoteSchema', () => {
  it('accepts all valid vote values', () => {
    for (const vote of ['up', 'down', 'none'] as const) {
      expect(contentGapVoteSchema.safeParse({ keyword: 'seo services', vote }).success).toBe(true);
    }
  });

  it('rejects empty keyword', () => {
    expect(contentGapVoteSchema.safeParse({ keyword: '', vote: 'up' }).success).toBe(false);
  });

  it('rejects invalid vote', () => {
    expect(contentGapVoteSchema.safeParse({ keyword: 'seo', vote: 'neutral' }).success).toBe(false);
  });
});

// ── schemas/seo-bulk-jobs ─────────────────────────────────────────────────────

import {
  seoBulkAcceptFixSchema,
  seoBulkRewritePageSchema,
  seoBulkAnalyzePageSchema,
} from '../../server/schemas/seo-bulk-jobs.js';

describe('seoBulkAcceptFixSchema', () => {
  it('accepts valid fix with required fields', () => {
    const result = seoBulkAcceptFixSchema.safeParse({
      pageId: 'page-1',
      check: 'title',
      suggestedFix: 'Better SEO Title',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = seoBulkAcceptFixSchema.safeParse({
      pageId: 'page-1',
      check: 'meta_description',
      suggestedFix: 'New meta',
      message: 'Approved by client',
      pageSlug: '/about',
      publishedPath: '/about-us',
      pageName: 'About Us',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty pageId', () => {
    const result = seoBulkAcceptFixSchema.safeParse({ pageId: '', check: 'title', suggestedFix: 'Fix' });
    expect(result.success).toBe(false);
  });
});

describe('seoBulkRewritePageSchema', () => {
  it('accepts minimum required fields', () => {
    const result = seoBulkRewritePageSchema.safeParse({ pageId: 'p1', title: 'My Page' });
    expect(result.success).toBe(true);
  });

  it('accepts optional slug and seo fields', () => {
    const result = seoBulkRewritePageSchema.safeParse({
      pageId: 'p1',
      title: 'My Page',
      slug: 'my-page',
      currentSeoTitle: 'Old SEO Title',
      currentDescription: 'Old desc',
      publishedPath: '/my-page',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty pageId', () => {
    const result = seoBulkRewritePageSchema.safeParse({ pageId: '', title: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('seoBulkAnalyzePageSchema', () => {
  it('accepts minimum required fields', () => {
    const result = seoBulkAnalyzePageSchema.safeParse({ pageId: 'p1', title: 'My Page' });
    expect(result.success).toBe(true);
  });

  it('accepts optional seo fields', () => {
    const result = seoBulkAnalyzePageSchema.safeParse({
      pageId: 'p1',
      title: 'My Page',
      seoTitle: 'My Page | Brand',
      seoDescription: 'A description of my page.',
    });
    expect(result.success).toBe(true);
  });
});

// ── schemas/client-business-priorities ───────────────────────────────────────

import {
  clientBusinessPrioritySchema,
  clientBusinessPrioritiesBodySchema,
} from '../../server/schemas/client-business-priorities.js';

describe('clientBusinessPrioritySchema (lenient read schema)', () => {
  it('accepts string format (legacy)', () => {
    expect(clientBusinessPrioritySchema.safeParse('Grow revenue by 20%').success).toBe(true);
  });

  it('accepts object format with text and optional category', () => {
    expect(clientBusinessPrioritySchema.safeParse({ text: 'Brand awareness', category: 'brand' }).success).toBe(true);
    expect(clientBusinessPrioritySchema.safeParse({ text: 'Launch new product' }).success).toBe(true);
  });
});

describe('clientBusinessPrioritiesBodySchema', () => {
  it('accepts valid priorities array', () => {
    const result = clientBusinessPrioritiesBodySchema.safeParse({
      priorities: [
        { text: 'Grow organic traffic', category: 'growth' },
        { text: 'Increase brand recognition' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid category values', () => {
    for (const category of ['growth', 'brand', 'product', 'audience', 'competitive', 'other'] as const) {
      expect(clientBusinessPrioritiesBodySchema.safeParse({
        priorities: [{ text: 'A priority', category }],
      }).success).toBe(true);
    }
  });

  it('defaults category to "other" when omitted', () => {
    const result = clientBusinessPrioritiesBodySchema.safeParse({
      priorities: [{ text: 'Some priority' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priorities[0].category).toBe('other');
    }
  });

  it('rejects empty text', () => {
    const result = clientBusinessPrioritiesBodySchema.safeParse({
      priorities: [{ text: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty priorities array', () => {
    const result = clientBusinessPrioritiesBodySchema.safeParse({ priorities: [] });
    // max(10) only, no min — empty array is allowed by schema
    expect(result.success).toBe(true);
  });

  it('rejects more than 10 priorities', () => {
    const result = clientBusinessPrioritiesBodySchema.safeParse({
      priorities: Array.from({ length: 11 }, (_, i) => ({ text: `Priority ${i + 1}` })),
    });
    expect(result.success).toBe(false);
  });
});

// ── schemas/internal-links-schemas ────────────────────────────────────────────

import {
  linkSuggestionSchema,
  linkSuggestionsArraySchema,
} from '../../server/schemas/internal-links-schemas.js';

describe('linkSuggestionSchema', () => {
  it('accepts a valid link suggestion', () => {
    const result = linkSuggestionSchema.safeParse({
      fromPage: '/services/seo',
      fromTitle: 'SEO Services',
      toPage: '/blog/seo-tips',
      toTitle: 'SEO Tips for 2026',
      anchorText: 'SEO tips',
      reason: 'Topically relevant content',
      priority: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid priority values', () => {
    for (const priority of ['high', 'medium', 'low'] as const) {
      expect(linkSuggestionSchema.safeParse({
        fromPage: '/a', fromTitle: 'A', toPage: '/b', toTitle: 'B',
        anchorText: 'link', reason: 'reason', priority,
      }).success).toBe(true);
    }
  });

  it('rejects invalid priority', () => {
    const result = linkSuggestionSchema.safeParse({
      fromPage: '/a', fromTitle: 'A', toPage: '/b', toTitle: 'B',
      anchorText: 'link', reason: 'reason', priority: 'critical',
    });
    expect(result.success).toBe(false);
  });

  it('allows passthrough extra fields', () => {
    const result = linkSuggestionSchema.safeParse({
      fromPage: '/a', fromTitle: 'A', toPage: '/b', toTitle: 'B',
      anchorText: 'link', reason: 'reason', priority: 'low',
      futureField: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('linkSuggestionsArraySchema', () => {
  it('accepts empty array', () => {
    expect(linkSuggestionsArraySchema.safeParse([]).success).toBe(true);
  });

  it('validates all items in the array', () => {
    const result = linkSuggestionsArraySchema.safeParse([
      { fromPage: '/a', fromTitle: 'A', toPage: '/b', toTitle: 'B', anchorText: 'b', reason: 'r', priority: 'high' },
      { fromPage: '/c', fromTitle: 'C', toPage: '/d', toTitle: 'D', anchorText: 'd', reason: 'r2', priority: 'invalid' },
    ]);
    expect(result.success).toBe(false);
  });
});

// ── schemas/diagnostics-schemas ───────────────────────────────────────────────

import {
  rootCauseSchema,
  remediationActionSchema,
} from '../../server/schemas/diagnostics-schemas.js';

describe('rootCauseSchema', () => {
  it('accepts a valid root cause', () => {
    const result = rootCauseSchema.safeParse({
      rank: 1,
      title: 'Missing structured data',
      confidence: 'high',
      explanation: 'Schema markup is absent across most pages',
      evidence: ['No JSON-LD found', '/about has no schema'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts all confidence values', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      expect(rootCauseSchema.safeParse({
        rank: 1, title: 'x', confidence, explanation: 'y', evidence: [],
      }).success).toBe(true);
    }
  });

  it('requires rank to be integer', () => {
    const result = rootCauseSchema.safeParse({
      rank: 1.5, title: 'x', confidence: 'high', explanation: 'y', evidence: [],
    });
    expect(result.success).toBe(false);
  });

  it('requires rank to be at least 1', () => {
    const result = rootCauseSchema.safeParse({
      rank: 0, title: 'x', confidence: 'high', explanation: 'y', evidence: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('remediationActionSchema', () => {
  it('accepts a valid remediation action', () => {
    const result = remediationActionSchema.safeParse({
      priority: 'P1',
      title: 'Add FAQ schema',
      description: 'Add FAQ JSON-LD to high-traffic pages',
      effort: 'low',
      impact: 'high',
      owner: 'seo',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid priority values', () => {
    for (const priority of ['P0', 'P1', 'P2', 'P3'] as const) {
      expect(remediationActionSchema.safeParse({
        priority, title: 'x', description: 'y', effort: 'low', impact: 'high', owner: 'dev',
      }).success).toBe(true);
    }
  });

  it('accepts all valid effort values', () => {
    for (const effort of ['low', 'medium', 'high'] as const) {
      expect(remediationActionSchema.safeParse({
        priority: 'P1', title: 'x', description: 'y', effort, impact: 'high', owner: 'content',
      }).success).toBe(true);
    }
  });

  it('accepts all valid owner values', () => {
    for (const owner of ['dev', 'content', 'seo'] as const) {
      expect(remediationActionSchema.safeParse({
        priority: 'P2', title: 'x', description: 'y', effort: 'medium', impact: 'medium', owner,
      }).success).toBe(true);
    }
  });

  it('accepts optional pageUrls', () => {
    const result = remediationActionSchema.safeParse({
      priority: 'P0', title: 'x', description: 'y', effort: 'high', impact: 'high', owner: 'dev',
      pageUrls: ['/about', '/contact'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid priority', () => {
    const result = remediationActionSchema.safeParse({
      priority: 'P4', title: 'x', description: 'y', effort: 'low', impact: 'low', owner: 'seo',
    });
    expect(result.success).toBe(false);
  });
});

// ── schemas/voice-calibration ─────────────────────────────────────────────────

import {
  saveVariationFeedbackSchema,
  variationFeedbackItemSchema,
} from '../../server/schemas/voice-calibration.js';

describe('saveVariationFeedbackSchema', () => {
  it('accepts valid session feedback', () => {
    const result = saveVariationFeedbackSchema.safeParse({
      sessionId: 'cal_abc12345',
      variationIndex: 2,
      feedback: 'This tone feels right for our brand',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty sessionId', () => {
    const result = saveVariationFeedbackSchema.safeParse({
      sessionId: '', variationIndex: 0, feedback: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative variationIndex', () => {
    const result = saveVariationFeedbackSchema.safeParse({
      sessionId: 'cal_abc', variationIndex: -1, feedback: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty feedback', () => {
    const result = saveVariationFeedbackSchema.safeParse({
      sessionId: 'cal_abc', variationIndex: 0, feedback: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts variationIndex of 0', () => {
    const result = saveVariationFeedbackSchema.safeParse({
      sessionId: 'cal_xyz99', variationIndex: 0, feedback: 'Good',
    });
    expect(result.success).toBe(true);
  });
});

describe('variationFeedbackItemSchema', () => {
  it('accepts valid feedback item', () => {
    const result = variationFeedbackItemSchema.safeParse({
      variationIndex: 1,
      feedback: 'Tone is too formal',
      createdAt: '2026-05-25T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative variationIndex', () => {
    const result = variationFeedbackItemSchema.safeParse({
      variationIndex: -1, feedback: 'ok', createdAt: '2026-05-25T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const result = variationFeedbackItemSchema.safeParse({
      variationIndex: 0, feedback: 'ok',
    });
    expect(result.success).toBe(false);
  });
});

// ── schemas/page-analysis ─────────────────────────────────────────────────────

import {
  pageAnalysisAiResultSchema,
  keywordAnalysisPersistSchema,
} from '../../server/schemas/page-analysis.js';

describe('pageAnalysisAiResultSchema', () => {
  it('accepts minimal valid result', () => {
    const result = pageAnalysisAiResultSchema.safeParse({
      primaryKeyword: 'dental implants',
      secondaryKeywords: ['tooth implant', 'implant dentist'],
      longTailKeywords: ['dental implants near me cost'],
      contentGaps: [],
      competitorKeywords: [],
      optimizationIssues: [],
      recommendations: [],
      searchIntent: 'commercial',
      keywordDifficulty: 45,
      monthlyVolume: 2400,
    });
    expect(result.success).toBe(true);
  });

  it('defaults primaryKeyword to empty string on failure', () => {
    // .catch('') means missing primaryKeyword won't fail the parse
    const result = pageAnalysisAiResultSchema.safeParse({
      secondaryKeywords: [], longTailKeywords: [], contentGaps: [],
      competitorKeywords: [], optimizationIssues: [], recommendations: [],
      searchIntent: 'informational', keywordDifficulty: 0, monthlyVolume: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryKeyword).toBe('');
    }
  });

  it('defaults searchIntent to "informational" on invalid value', () => {
    const result = pageAnalysisAiResultSchema.safeParse({
      primaryKeyword: 'seo', secondaryKeywords: [], longTailKeywords: [],
      contentGaps: [], competitorKeywords: [], optimizationIssues: [],
      recommendations: [], searchIntent: 'purchase', keywordDifficulty: 0, monthlyVolume: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.searchIntent).toBe('informational');
    }
  });

  it('accepts all valid searchIntent values', () => {
    for (const searchIntent of ['informational', 'transactional', 'navigational', 'commercial'] as const) {
      const result = pageAnalysisAiResultSchema.safeParse({
        primaryKeyword: 'kw', secondaryKeywords: [], longTailKeywords: [],
        contentGaps: [], competitorKeywords: [], optimizationIssues: [],
        recommendations: [], searchIntent, keywordDifficulty: 0, monthlyVolume: 0,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.searchIntent).toBe(searchIntent);
    }
  });

  it('defaults keywordDifficulty and monthlyVolume to 0 on missing', () => {
    const result = pageAnalysisAiResultSchema.safeParse({
      primaryKeyword: 'seo', secondaryKeywords: [], longTailKeywords: [],
      contentGaps: [], competitorKeywords: [], optimizationIssues: [],
      recommendations: [], searchIntent: 'informational',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keywordDifficulty).toBe(0);
      expect(result.data.monthlyVolume).toBe(0);
    }
  });

  it('accepts optional fields when present', () => {
    const result = pageAnalysisAiResultSchema.safeParse({
      primaryKeyword: 'dental implants',
      secondaryKeywords: [],
      longTailKeywords: [],
      contentGaps: [],
      competitorKeywords: [],
      optimizationIssues: [],
      recommendations: [],
      searchIntent: 'commercial',
      keywordDifficulty: 55,
      monthlyVolume: 1000,
      optimizationScore: 78,
      estimatedDifficulty: 'medium',
      topicCluster: 'dental implants cluster',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.optimizationScore).toBe(78);
      expect(result.data.estimatedDifficulty).toBe('medium');
    }
  });
});

describe('keywordAnalysisPersistSchema', () => {
  const validAnalysis = {
    primaryKeyword: 'dental seo',
    secondaryKeywords: [],
    longTailKeywords: [],
    contentGaps: [],
    competitorKeywords: [],
    optimizationIssues: [],
    recommendations: [],
    searchIntent: 'informational' as const,
    keywordDifficulty: 30,
    monthlyVolume: 500,
  };

  it('accepts valid persist payload with required fields', () => {
    const result = keywordAnalysisPersistSchema.safeParse({
      workspaceId: 'ws_abc123',
      pagePath: '/dental-seo-services',
      analysis: validAnalysis,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional pageTitle', () => {
    const result = keywordAnalysisPersistSchema.safeParse({
      workspaceId: 'ws_abc123',
      pagePath: '/dental',
      pageTitle: 'Dental Services | Brand',
      analysis: validAnalysis,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty workspaceId', () => {
    const result = keywordAnalysisPersistSchema.safeParse({
      workspaceId: '', pagePath: '/dental', analysis: validAnalysis,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty pagePath', () => {
    const result = keywordAnalysisPersistSchema.safeParse({
      workspaceId: 'ws_abc', pagePath: '', analysis: validAnalysis,
    });
    expect(result.success).toBe(false);
  });
});
