import { describe, expect, it } from 'vitest';
import {
  normalizeInternalLinkSuggestion,
  toInternalLinkClientActionItem,
} from '../../src/lib/internal-link-client-action';

describe('internal link client action helpers', () => {
  it('maps analyzer suggestions to explicit source/target URL+title payload fields', () => {
    const mapped = toInternalLinkClientActionItem({
      fromPage: '/about',
      fromTitle: 'About Us',
      toPage: '/services',
      toTitle: 'Services',
      anchorText: 'SEO services',
      reason: 'Relevant service detail page',
    });

    expect(mapped).toEqual({
      anchorText: 'SEO services',
      targetUrl: '/services',
      targetTitle: 'Services',
      sourcePageUrl: '/about',
      sourcePageTitle: 'About Us',
      contextSnippet: 'Relevant service detail page',
    });
  });

  it('normalizes legacy payload rows without coercing URL fields into title fields', () => {
    const normalized = normalizeInternalLinkSuggestion({
      anchorText: 'SEO services',
      targetUrl: '/services',
      sourcePage: '/about',
    });

    expect(normalized).toEqual({
      anchorText: 'SEO services',
      targetUrl: '/services',
      targetTitle: null,
      sourcePageUrl: '/about',
      sourcePageTitle: null,
      contextSnippet: null,
    });
  });
});
