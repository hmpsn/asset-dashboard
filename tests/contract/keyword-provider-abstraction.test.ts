import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const KEYWORD_CALLERS = [
  'server/keyword-strategy-seo-data.ts',
  'server/keyword-strategy-generation.ts',
  'server/keyword-strategy-ai-synthesis.ts',
  'server/keyword-recommendations.ts',
];

describe('keyword provider abstraction contract', () => {
  it('keeps strategy and recommendation orchestrators behind SeoDataProvider', () => {
    for (const file of KEYWORD_CALLERS) {
      const source = readFileSync(file, 'utf-8'); // readFile-ok - contract guard: keyword orchestrators must not import provider-specific DataForSEO code.
      expect(source).not.toMatch(/dataforseo-provider/);
      expect(source).not.toMatch(/new DataForSeoProvider/);
      expect(source).not.toMatch(/dataforseo_labs\/google/);
      expect(source).not.toMatch(/keywords_data\/google_ads/);
    }
  });
});
