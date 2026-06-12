import { describe, expect, it } from 'vitest';
import { capitalizeWord } from '../../server/utils/strings.js';

describe('capitalizeWord', () => {
  it('capitalizes normal words', () => {
    expect(capitalizeWord('analytics')).toBe('Analytics');
  });

  it('uppercases known acronyms', () => {
    expect(capitalizeWord('seo')).toBe('SEO');
    expect(capitalizeWord('ga4')).toBe('GA4');
  });
});
