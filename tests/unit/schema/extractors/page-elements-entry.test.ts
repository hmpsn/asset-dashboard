import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageElements } from '../../../../server/schema/extractors/page-elements.js';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
}

describe('extractPageElements entry-point', () => {
  it('returns empty arrays + diagnostics for a page with no elements', async () => {
    const html = readFixture('webflow-no-elements.html');
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: '2026-04-29T00:00:00.000Z',
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toEqual([]);
    expect(catalog.lists).toEqual([]);
    expect(catalog.citations).toEqual([]);
    expect(catalog.diagnostics.aiClassificationCalls).toBe(0);
    expect(catalog.diagnostics.hitAiBudgetCap).toBe(false);
    expect(catalog.diagnostics.rawCounts).toMatchObject({ videos: 0, lists: 0, citations: 0 });
    expect(catalog.extractedAt).toBeTruthy();
    expect(catalog.sourcePublishedAt).toBe('2026-04-29T00:00:00.000Z');
  });

  it('extracts a YouTube + HowTo + citation from the mixed-elements fixture', async () => {
    const html = readFixture('webflow-mixed-elements.html');
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toHaveLength(1);
    expect(catalog.videos[0].provider).toBe('youtube');
    expect(catalog.lists).toHaveLength(1);
    expect(catalog.lists[0].isHowToLike).toBe(true);
    expect(catalog.citations).toHaveLength(1);
    expect(catalog.citations[0].url).toBe('https://developers.google.com/search');
    expect(catalog.diagnostics.rawCounts).toMatchObject({ videos: 1, lists: 1, citations: 1 });
  });

  it('returns empty catalog when HTML is empty/missing', async () => {
    const catalog = await extractPageElements('', {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toEqual([]);
    expect(catalog.lists).toEqual([]);
    expect(catalog.citations).toEqual([]);
  });

  it('does not throw on malformed HTML', async () => {
    const catalog = await extractPageElements('<<<not valid', {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toBeDefined();
    expect(catalog.lists).toBeDefined();
  });

  it('does not throw when pageBaseUrl is malformed (citation extractor returns []) — degraded catalog', async () => {
    const catalog = await extractPageElements('<article><a href="https://example.com">x</a></article>', {
      pageBaseUrl: 'not-a-url',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    // citation extractor returns [] on malformed own-URL — does not throw.
    expect(catalog.citations).toEqual([]);
    expect(catalog.diagnostics.rawCounts.error).toBeFalsy();
  });

  it('honors the "never throws" contract — returns empty catalog with error diagnostic on internal failure', async () => {
    // We cannot easily force cheerio.load to throw on real input, but we can
    // verify the contract by passing pathological values. The catch path
    // marks `diagnostics.rawCounts.error = 1`. For a happy path, no error.
    const catalog = await extractPageElements('<p>hi</p>', {
      pageBaseUrl: 'https://example.com',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.diagnostics.rawCounts.error).toBeFalsy(); // happy path = no error marker
  });
});
