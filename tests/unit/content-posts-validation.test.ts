/**
 * Unit tests for content post Zod validation schemas.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseJsonSafe } from '../../server/db/json-validation.js';
import { postSectionsArraySchema, reviewChecklistSchema } from '../../server/schemas/content-schemas.js';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

const validSection = {
  index: 0,
  heading: 'Introduction to SEO',
  content: '<p>SEO is important...</p>',
  wordCount: 150,
  targetWordCount: 200,
  keywords: ['seo', 'search engine'],
  status: 'done' as const,
};

const validChecklist = {
  factual_accuracy: true,
  brand_voice: true,
  internal_links: false,
  no_hallucinations: true,
  meta_optimized: true,
  word_count_target: false,
};

describe('postSectionsArraySchema', () => {
  it('parses valid sections array', () => {
    const raw = JSON.stringify([validSection]);
    const result = parseJsonSafe(raw, postSectionsArraySchema, []);
    expect(result).toHaveLength(1);
    expect(result[0].heading).toBe('Introduction to SEO');
    expect(result[0].status).toBe('done');
  });

  it('parses sections with optional error field', () => {
    const withError = { ...validSection, status: 'error', error: 'Generation failed' };
    const result = parseJsonSafe(JSON.stringify([withError]), postSectionsArraySchema, []);
    expect(result[0].error).toBe('Generation failed');
  });

  it('returns fallback for wrong status enum', () => {
    const bad = [{ ...validSection, status: 'invalid' }];
    expect(parseJsonSafe(JSON.stringify(bad), postSectionsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for wrong type (keywords not array)', () => {
    const bad = [{ ...validSection, keywords: 'seo' }];
    expect(parseJsonSafe(JSON.stringify(bad), postSectionsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonSafe('{bad', postSectionsArraySchema, [])).toEqual([]);
  });

  it('returns fallback for null', () => {
    expect(parseJsonSafe(null, postSectionsArraySchema, [])).toEqual([]);
  });

  it('allows extra fields via passthrough', () => {
    const extra = [{ ...validSection, aiModel: 'gpt-4' }];
    const result = parseJsonSafe(JSON.stringify(extra), postSectionsArraySchema, []);
    expect((result[0] as any).aiModel).toBe('gpt-4');
  });
});

describe('reviewChecklistSchema', () => {
  const fallback = {
    factual_accuracy: false, brand_voice: false, internal_links: false,
    no_hallucinations: false, meta_optimized: false, word_count_target: false,
  };

  it('parses valid checklist', () => {
    const result = parseJsonSafe(JSON.stringify(validChecklist), reviewChecklistSchema, fallback);
    expect(result.factual_accuracy).toBe(true);
    expect(result.internal_links).toBe(false);
  });

  it('returns fallback for wrong types', () => {
    const bad = { ...validChecklist, factual_accuracy: 'yes' };
    const result = parseJsonSafe(JSON.stringify(bad), reviewChecklistSchema, fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback for null', () => {
    expect(parseJsonSafe(null, reviewChecklistSchema, fallback)).toBe(fallback);
  });

  it('returns fallback for malformed JSON', () => {
    expect(parseJsonSafe('{bad', reviewChecklistSchema, fallback)).toBe(fallback);
  });
});
