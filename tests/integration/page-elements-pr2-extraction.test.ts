/**
 * Integration tests for PR2 page-element extractors. Runs each fixture
 * end-to-end through extractPageElements and asserts the catalog shape
 * matches expected counts + classifications.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageElements } from '../../server/schema/extractors/page-elements.js';
import { createAiBudget } from '../../server/schema/extractors/page-elements/ai-budget.js';

function fixtureHtml(name: string): string {
  return readFileSync(join(__dirname, `../fixtures/page-elements/${name}`), 'utf-8');
}

describe('PR2 page-element extraction (integration)', () => {
  const opts = {
    pageBaseUrl: 'https://example.com',
    sourcePublishedAt: null,
    aiBudget: createAiBudget(0), // AI off — pattern-only
  };

  it('webflow-service-pricing-table.html — extracts 1 pricing table with 4 rows × 4 cols', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-service-pricing-table.html'), opts);
    expect(catalog.tables).toHaveLength(1);
    expect(catalog.tables[0].rowCount).toBe(4);
    expect(catalog.tables[0].colCount).toBe(4);
    expect(catalog.tables[0].isPricingLike).toBe(true);
    expect(catalog.tables[0].isComparisonLike).toBe(true);
    expect(catalog.tables[0].caption).toBe('Pricing tiers');
  });

  it('webflow-testimonials.html — extracts 3 testimonials, 2 with ratings', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-testimonials.html'), opts);
    expect(catalog.testimonials).toHaveLength(3);
    expect(catalog.testimonials.filter(t => t.rating != null)).toHaveLength(2);
    expect(catalog.testimonials[0].rating).toBe(5);
    expect(catalog.testimonials[0].author).toContain('Jane Smith');
  });

  it('webflow-decorative-images.html — classifies 1 hero / 2 informative / 3 decorative', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-decorative-images.html'), opts);
    const byRole = {
      hero: catalog.images.filter(i => i.role === 'hero').length,
      informative: catalog.images.filter(i => i.role === 'informative').length,
      decorative: catalog.images.filter(i => i.role === 'decorative').length,
    };
    expect(byRole.hero).toBe(1);
    expect(byRole.informative).toBe(2);
    expect(byRole.decorative).toBe(3);
  });

  it('webflow-mixed-elements-pr2.html — extracts hero + table + gallery images + testimonials together', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-mixed-elements-pr2.html'), opts);
    expect(catalog.images.filter(i => i.role === 'hero')).toHaveLength(1);
    expect(catalog.images.filter(i => i.role === 'informative').length).toBeGreaterThanOrEqual(2);
    expect(catalog.tables).toHaveLength(1);
    expect(catalog.tables[0].isPricingLike).toBe(true);
    expect(catalog.testimonials).toHaveLength(2);
    expect(catalog.testimonials.length).toBeGreaterThan(0); // guard for .every() below
    expect(catalog.testimonials.every(t => t.rating === 5)).toBe(true);
  });

  it('extractor never throws on malformed HTML', async () => {
    const catalog = await extractPageElements('<<<<not html>>>>', opts);
    expect(catalog.images).toEqual([]);
    expect(catalog.tables).toEqual([]);
    expect(catalog.testimonials).toEqual([]);
  });
});
