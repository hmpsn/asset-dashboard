import { describe, expect, it } from 'vitest';

import {
  normalizeSeoRewritePairs,
  normalizeSeoRewriteVariations,
} from '../../server/webflow-seo-rewrite-utils.js';

describe('SEO rewrite output normalization', () => {
  it('accepts object-wrapped variations and rejects duplicate padding', () => {
    expect(normalizeSeoRewriteVariations({
      variations: [
        'Technical SEO Services That Grow Revenue',
        'Technical SEO Services That Grow Revenue',
        'Fix Site Issues Before They Cost Rankings',
        'Turn Search Problems Into Better Leads',
      ],
    }, 60)).toEqual([
      'Technical SEO Services That Grow Revenue',
      'Fix Site Issues Before They Cost Rankings',
      'Turn Search Problems Into Better Leads',
    ]);

    expect(normalizeSeoRewriteVariations({
      variations: ['One usable title', 'One usable title', 'Two usable title'],
    }, 60)).toEqual([]);
  });

  it('rejects prose, partial pairs, and dangling both-mode output', () => {
    expect(normalizeSeoRewriteVariations('Here are three options', 60)).toEqual([]);
    expect(normalizeSeoRewritePairs({
      pairs: [
        { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
        { title: 'Technical SEO That Converts', description: '' },
        { title: 'Fix Organic Search Gaps', description: 'Prioritize the pages and fixes most likely to improve qualified leads.' },
      ],
    })).toEqual([]);
  });

  it('returns aligned object-wrapped title and description pairs', () => {
    expect(normalizeSeoRewritePairs({
      pairs: [
        { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
        { title: 'Technical SEO That Converts', description: 'Prioritize the site fixes most likely to turn search demand into leads.' },
        { title: 'Search Strategy Built to Rank', description: 'Use page-level keyword data to align content, fixes, and measurable growth.' },
      ],
    })).toEqual([
      { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
      { title: 'Technical SEO That Converts', description: 'Prioritize the site fixes most likely to turn search demand into leads.' },
      { title: 'Search Strategy Built to Rank', description: 'Use page-level keyword data to align content, fixes, and measurable growth.' },
    ]);
  });
});
