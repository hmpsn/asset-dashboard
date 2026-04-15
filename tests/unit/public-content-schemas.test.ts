/**
 * Unit tests for public-content Zod schemas.
 *
 * Validates boundary constraints: max lengths, array limits, required fields,
 * and default behaviors for the public content-request endpoints.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { z } from 'zod';

describe('fromAuditSchema', () => {
  let fromAuditSchema: z.ZodType;

  beforeAll(async () => {
    const mod = await import('../../server/schemas/public-content.js');
    fromAuditSchema = mod.fromAuditSchema;
  });

  it('accepts valid input with issues', () => {
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageSlug: '/about',
      pageName: 'About Us',
      issues: ['Missing meta description', 'Title too short'],
    });
    expect(result.success).toBe(true);
  });

  it('defaults issues to empty array when omitted', () => {
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageSlug: '/about',
      pageName: 'About Us',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issues).toEqual([]);
    }
  });

  it('rejects issues array exceeding 50 items', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `Issue ${i}`);
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageSlug: '/about',
      pageName: 'About Us',
      issues: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 50 issues', () => {
    const maxIssues = Array.from({ length: 50 }, (_, i) => `Issue ${i}`);
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageSlug: '/about',
      pageName: 'About Us',
      issues: maxIssues,
    });
    expect(result.success).toBe(true);
  });

  it('rejects individual issue strings exceeding 300 characters', () => {
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageSlug: '/about',
      pageName: 'About Us',
      issues: ['x'.repeat(301)],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required pageSlug', () => {
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageName: 'About Us',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required pageName', () => {
    const result = (fromAuditSchema as z.ZodObject<z.ZodRawShape>).safeParse({
      pageSlug: '/about',
    });
    expect(result.success).toBe(false);
  });
});
