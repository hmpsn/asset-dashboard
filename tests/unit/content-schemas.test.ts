import { describe, expect, it } from 'vitest';
import { outlineItemSchema, postSectionSchema } from '../../server/schemas/content-schemas.js';

describe('content schemas', () => {
  it('accepts a valid outline item', () => {
    const result = outlineItemSchema.safeParse({
      heading: 'Introduction',
      notes: 'Set context for the topic.',
      subheadings: ['Why this matters'],
      keywords: ['seo'],
      wordCount: 120,
    });

    expect(result.success).toBe(true);
  });

  it('rejects outline items missing required fields', () => {
    const result = outlineItemSchema.safeParse({
      heading: 'Introduction',
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid post section status enum values', () => {
    const base = {
      index: 0,
      heading: 'Section',
      content: '<p>Text</p>',
      wordCount: 80,
      targetWordCount: 120,
      keywords: ['seo'],
    };

    expect(postSectionSchema.safeParse({ ...base, status: 'pending' }).success).toBe(true);
    expect(postSectionSchema.safeParse({ ...base, status: 'generating' }).success).toBe(true);
    expect(postSectionSchema.safeParse({ ...base, status: 'done' }).success).toBe(true);
    expect(postSectionSchema.safeParse({ ...base, status: 'error' }).success).toBe(true);
  });

  it('rejects invalid post section status enum values', () => {
    const result = postSectionSchema.safeParse({
      index: 0,
      heading: 'Section',
      content: '<p>Text</p>',
      wordCount: 80,
      targetWordCount: 120,
      keywords: ['seo'],
      status: 'complete',
    });

    expect(result.success).toBe(false);
  });
});
