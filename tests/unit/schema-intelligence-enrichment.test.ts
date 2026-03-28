/**
 * Unit tests for Phase 2A — Schema pipeline enrichment with analytics intelligence.
 *
 * Tests that:
 * 1. SchemaContext accepts new intelligence fields
 * 2. buildSchemaIntelligenceBlock() generates correct prompt text
 * 3. FAQ opportunities are filtered from GSC query data
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SchemaContext } from '../../server/schema-suggester.js';

// ── SchemaContext new fields ────────────────────────────────────

describe('SchemaContext intelligence fields', () => {
  it('accepts _pageHealthScore field', () => {
    const ctx: SchemaContext = {
      _pageHealthScore: 72,
    };
    expect(ctx._pageHealthScore).toBe(72);
  });

  it('accepts _faqOpportunities field', () => {
    const ctx: SchemaContext = {
      _faqOpportunities: [
        { query: 'how to fix leaky faucet', impressions: 450, position: 8 },
        { query: 'what causes dripping faucet', impressions: 200, position: 12 },
      ],
    };
    expect(ctx._faqOpportunities).toHaveLength(2);
    expect(ctx._faqOpportunities![0].query).toBe('how to fix leaky faucet');
  });

  it('accepts _quickWinStatus field', () => {
    const ctx: SchemaContext = {
      _quickWinStatus: true,
    };
    expect(ctx._quickWinStatus).toBe(true);
  });
});

// ── buildSchemaIntelligenceBlock ────────────────────────────────

describe('buildSchemaIntelligenceBlock', () => {
  // Import will fail until implementation exists
  let buildSchemaIntelligenceBlock: (ctx: SchemaContext) => string;

  beforeAll(async () => {
    const mod = await import('../../server/schema-suggester.js');
    buildSchemaIntelligenceBlock = mod.buildSchemaIntelligenceBlock;
  });

  it('returns empty string when no intelligence data present', () => {
    const ctx: SchemaContext = {};
    expect(buildSchemaIntelligenceBlock(ctx)).toBe('');
  });

  it('includes page health score when present', () => {
    const ctx: SchemaContext = {
      _pageHealthScore: 72,
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).toContain('Page Health Score');
    expect(block).toContain('72');
  });

  it('includes health trend when score is present', () => {
    const ctx: SchemaContext = {
      _pageHealthScore: 72,
      _pageHealthTrend: 'improving',
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).toContain('improving');
  });

  it('includes quick win status when true', () => {
    const ctx: SchemaContext = {
      _quickWinStatus: true,
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).toContain('Quick Win');
  });

  it('does not include quick win line when false', () => {
    const ctx: SchemaContext = {
      _quickWinStatus: false,
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).not.toContain('Quick Win');
  });

  it('includes FAQ opportunities when present', () => {
    const ctx: SchemaContext = {
      _faqOpportunities: [
        { query: 'how to fix leaky faucet', impressions: 450, position: 8 },
        { query: 'what causes dripping faucet', impressions: 200, position: 12 },
      ],
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).toContain('FAQ OPPORTUNITIES');
    expect(block).toContain('how to fix leaky faucet');
    expect(block).toContain('450');
    expect(block).toContain('pos 8');
  });

  it('includes guidance note for FAQ opportunities', () => {
    const ctx: SchemaContext = {
      _faqOpportunities: [
        { query: 'how to fix leaky faucet', impressions: 450, position: 8 },
      ],
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    // Should tell the AI to surface as insight, not auto-generate FAQ schema
    expect(block).toMatch(/do NOT auto-generate FAQ/i);
  });

  it('combines all intelligence fields', () => {
    const ctx: SchemaContext = {
      _pageHealthScore: 85,
      _pageHealthTrend: 'stable',
      _quickWinStatus: true,
      _faqOpportunities: [
        { query: 'best plumber near me', impressions: 300, position: 6 },
      ],
    };
    const block = buildSchemaIntelligenceBlock(ctx);
    expect(block).toContain('85');
    expect(block).toContain('Quick Win');
    expect(block).toContain('FAQ OPPORTUNITIES');
    expect(block).toContain('best plumber near me');
  });
});

// ── extractFaqOpportunities ─────────────────────────────────────

describe('extractFaqOpportunities', () => {
  let extractFaqOpportunities: (queryPageData: Array<{ query: string; page: string; impressions: number; position: number }>, pageUrl: string) => Array<{ query: string; impressions: number; position: number }>;

  beforeAll(async () => {
    const mod = await import('../../server/schema-suggester.js');
    extractFaqOpportunities = mod.extractFaqOpportunities;
  });

  it('returns question queries targeting the given page', () => {
    const data = [
      { query: 'how to fix leaky faucet', page: 'https://example.com/plumbing', impressions: 450, position: 8 },
      { query: 'plumbing services near me', page: 'https://example.com/plumbing', impressions: 600, position: 5 },
      { query: 'what causes pipe burst', page: 'https://example.com/plumbing', impressions: 200, position: 12 },
    ];
    const result = extractFaqOpportunities(data, 'https://example.com/plumbing');
    // Only question queries (how, what, why, when, where, which, can, do, does, is, are)
    expect(result).toHaveLength(2);
    expect(result.map(r => r.query)).toContain('how to fix leaky faucet');
    expect(result.map(r => r.query)).toContain('what causes pipe burst');
  });

  it('filters to only the specified page URL', () => {
    const data = [
      { query: 'how to fix leaky faucet', page: 'https://example.com/plumbing', impressions: 450, position: 8 },
      { query: 'how to tile a bathroom', page: 'https://example.com/tiling', impressions: 300, position: 10 },
    ];
    const result = extractFaqOpportunities(data, 'https://example.com/plumbing');
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('how to fix leaky faucet');
  });

  it('sorts by impressions descending', () => {
    const data = [
      { query: 'how to fix leaky faucet', page: 'https://example.com/plumbing', impressions: 200, position: 8 },
      { query: 'what causes pipe burst', page: 'https://example.com/plumbing', impressions: 450, position: 12 },
      { query: 'when to call plumber', page: 'https://example.com/plumbing', impressions: 100, position: 15 },
    ];
    const result = extractFaqOpportunities(data, 'https://example.com/plumbing');
    expect(result[0].impressions).toBe(450);
    expect(result[1].impressions).toBe(200);
    expect(result[2].impressions).toBe(100);
  });

  it('caps at 10 results', () => {
    const data = Array.from({ length: 15 }, (_, i) => ({
      query: `how to question ${i}`,
      page: 'https://example.com/plumbing',
      impressions: 100 + i,
      position: 5 + i,
    }));
    const result = extractFaqOpportunities(data, 'https://example.com/plumbing');
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('returns empty array when no question queries found', () => {
    const data = [
      { query: 'plumbing services', page: 'https://example.com/plumbing', impressions: 600, position: 5 },
      { query: 'best plumber', page: 'https://example.com/plumbing', impressions: 400, position: 7 },
    ];
    const result = extractFaqOpportunities(data, 'https://example.com/plumbing');
    expect(result).toHaveLength(0);
  });
});
