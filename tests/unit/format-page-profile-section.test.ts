import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_SEO_CONTEXT, RICH_PAGE_PROFILE } from '../fixtures/rich-intelligence.js';

const minSeo = { ...RICH_SEO_CONTEXT, personas: [], pageKeywords: undefined };

const intel: WorkspaceIntelligence = {
  version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
  seoContext: minSeo,
  pageProfile: RICH_PAGE_PROFILE,
};

describe('formatPageProfileSection fidelity', () => {
  it('renders page path and primary keyword at all verbosities', () => {
    for (const verbosity of ['compact', 'standard', 'detailed'] as const) {
      const result = formatForPrompt(intel, { verbosity, sections: ['pageProfile'] });
      expect(result).toContain('/features');
      expect(result).toContain('enterprise seo');
    }
  });

  it('renders optimization score at all verbosities', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['pageProfile'] });
    expect(result).toContain('78');
  });

  it('renders rank position and trend at standard+', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['pageProfile'] });
    expect(result).toContain('5');
    expect(result).toContain('down');
  });

  it('renders optimization issues at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('Keyword density too low');
  });

  it('renders recommendations at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('Add FAQ schema');
  });

  it('renders content gaps at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('competitor comparison table');
  });

  it('renders keyword presence gaps at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('meta');
  });

  it('renders competitor keywords at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('best seo tool');
  });

  it('renders schema/content/cwv status at detailed', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] });
    expect(result).toContain('warnings');
    expect(result).toContain('published');
    expect(result).toContain('good');
  });
});
