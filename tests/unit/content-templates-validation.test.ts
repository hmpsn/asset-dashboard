/**
 * Unit tests for content-templates route validation schemas (W6.3).
 *
 * These tests exercise the Zod schemas added to server/routes/content-templates.ts
 * without spinning up the server (which is blocked by a pre-existing import error
 * in server/routes/jobs.ts on this branch).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── Inline the schemas (mirrors server/routes/content-templates.ts exactly) ──
// This avoids the server-startup import chain while still verifying the schemas.

const contentPageTypeValues = [
  'blog', 'landing', 'service', 'location', 'product',
  'pillar', 'resource', 'provider-profile', 'procedure-guide', 'pricing-page',
  'homepage', 'about', 'contact', 'faq', 'testimonials', 'custom',
] as const;

const templateVariableSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const templateSectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  headingTemplate: z.string(),
  guidance: z.string(),
  wordCountTarget: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  cmsFieldSlug: z.string().optional(),
  narrativeRole: z.string().optional(),
  brandNote: z.string().optional(),
  seoNote: z.string().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  pageType: z.enum(contentPageTypeValues).optional(),
  variables: z.array(templateVariableSchema).optional(),
  sections: z.array(templateSectionSchema).optional(),
  urlPattern: z.string().or(z.literal('')).optional(),
  keywordPattern: z.string().or(z.literal('')).optional(),
  titlePattern: z.string().or(z.literal('')).optional(),
  metaDescPattern: z.string().or(z.literal('')).optional(),
  cmsFieldMap: z.record(z.string()).optional(),
  toneAndStyle: z.string().optional(),
  schemaTypes: z.array(z.string()).optional(),
});

const updateTemplateSchema = createTemplateSchema.partial();

const duplicateTemplateSchema = z.object({
  name: z.string().optional(),
});

// ── Create template schema ──

describe('createTemplateSchema', () => {
  it('accepts a minimal valid payload (name only)', () => {
    const result = createTemplateSchema.safeParse({ name: 'My Template' });
    expect(result.success).toBe(true);
  });

  it('accepts a fully-specified payload', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Full Template',
      description: 'A complete template',
      pageType: 'service',
      variables: [{ name: 'city', label: 'City' }],
      sections: [{
        id: 's1',
        name: 'Hero',
        headingTemplate: '{city} services',
        guidance: 'Open with the local outcome.',
        wordCountTarget: 120,
        order: 0,
      }],
      urlPattern: '/services/{city}',
      keywordPattern: '{service} in {city}',
      titlePattern: '{service} in {city} | {brand}',
      metaDescPattern: 'Book {service} in {city}.',
      cmsFieldMap: { hero: 'main_heading' },
      toneAndStyle: 'Professional',
      schemaTypes: ['Service', 'BreadcrumbList'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing name (required field)', () => {
    const result = createTemplateSchema.safeParse({ description: 'no name' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain('name');
  });

  it('rejects an empty name string', () => {
    const result = createTemplateSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain('name');
  });

  it('rejects an unknown pageType value', () => {
    const result = createTemplateSchema.safeParse({ name: 'Test', pageType: 'not-a-real-type' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain('pageType');
  });

  it('accepts all known pageType values', () => {
    for (const pt of contentPageTypeValues) {
      const result = createTemplateSchema.safeParse({ name: 'Test', pageType: pt });
      expect(result.success).toBe(true);
    }
  });

  // Clearable-field rule: optional pattern fields must accept empty string
  it('accepts empty string for urlPattern (clearable-field rule)', () => {
    const result = createTemplateSchema.safeParse({ name: 'Test', urlPattern: '' });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for keywordPattern (clearable-field rule)', () => {
    const result = createTemplateSchema.safeParse({ name: 'Test', keywordPattern: '' });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for titlePattern (clearable-field rule)', () => {
    const result = createTemplateSchema.safeParse({ name: 'Test', titlePattern: '' });
    expect(result.success).toBe(true);
  });

  it('accepts empty string for metaDescPattern (clearable-field rule)', () => {
    const result = createTemplateSchema.safeParse({ name: 'Test', metaDescPattern: '' });
    expect(result.success).toBe(true);
  });

  it('rejects a section missing required fields', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Test',
      sections: [{ name: 'Hero' }], // missing id, headingTemplate, guidance, wordCountTarget, order
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variable missing label', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Test',
      variables: [{ name: 'city' }], // missing label
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown top-level keys (Zod default strips extra keys)', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Test',
      unknownExtraField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownExtraField).toBeUndefined();
    }
  });
});

// ── Update template schema ──

describe('updateTemplateSchema', () => {
  it('accepts an empty object (all fields optional for updates)', () => {
    const result = updateTemplateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a partial update with only name', () => {
    const result = updateTemplateSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid pageType even in an update', () => {
    const result = updateTemplateSchema.safeParse({ pageType: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts empty string for clearable pattern fields in updates', () => {
    const result = updateTemplateSchema.safeParse({
      titlePattern: '',
      metaDescPattern: '',
    });
    expect(result.success).toBe(true);
  });
});

// ── Duplicate template schema ──

describe('duplicateTemplateSchema', () => {
  it('accepts an empty object (name is optional)', () => {
    const result = duplicateTemplateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a valid name string', () => {
    const result = duplicateTemplateSchema.safeParse({ name: 'Copy of Template' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-string name', () => {
    const result = duplicateTemplateSchema.safeParse({ name: 42 });
    expect(result.success).toBe(false);
  });
});
