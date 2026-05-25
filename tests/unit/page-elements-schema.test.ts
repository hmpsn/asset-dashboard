import { describe, expect, it } from 'vitest';
import { EMPTY_CATALOG, pageElementCatalogSchema } from '../../server/schemas/page-elements-schema.js';

describe('page-elements-schema behavioral contracts', () => {
  it('applies array + diagnostics defaults on partial payloads', () => {
    const parsed = pageElementCatalogSchema.parse({
      extractedAt: '2026-05-25T12:00:00.000Z',
      sourcePublishedAt: null,
    });

    expect(parsed.headings).toEqual([]);
    expect(parsed.tables).toEqual([]);
    expect(parsed.images).toEqual([]);
    expect(parsed.videos).toEqual([]);
    expect(parsed.lists).toEqual([]);
    expect(parsed.testimonials).toEqual([]);
    expect(parsed.codeBlocks).toEqual([]);
    expect(parsed.citations).toEqual([]);
    expect(parsed.diagnostics).toEqual({
      aiClassificationCalls: 0,
      hitAiBudgetCap: false,
      rawCounts: {},
    });
  });

  it('preserves permissive extra root fields via passthrough', () => {
    const parsed = pageElementCatalogSchema.parse({
      extractedAt: '2026-05-25T12:00:00.000Z',
      sourcePublishedAt: null,
      futureField: { keep: true },
    });

    expect(parsed).toMatchObject({
      futureField: { keep: true },
    });
  });

  it('keeps EMPTY_CATALOG sentinel values stable and frozen', () => {
    expect(EMPTY_CATALOG.extractedAt).toBe(new Date(0).toISOString());
    expect(EMPTY_CATALOG.sourcePublishedAt).toBeNull();
    expect(EMPTY_CATALOG.headings).toEqual([]);
    expect(EMPTY_CATALOG.diagnostics).toEqual({
      aiClassificationCalls: 0,
      hitAiBudgetCap: false,
      rawCounts: {},
    });

    expect(Object.isFrozen(EMPTY_CATALOG)).toBe(true);
    expect(Object.isFrozen(EMPTY_CATALOG.headings)).toBe(true);
    expect(Object.isFrozen(EMPTY_CATALOG.diagnostics)).toBe(true);
    expect(() => EMPTY_CATALOG.headings.push({ level: 1, text: 'mutate' })).toThrow();
  });
});
