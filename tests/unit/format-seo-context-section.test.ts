import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_SEO_CONTEXT } from '../fixtures/rich-intelligence.js';

const intel: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-03-30T12:00:00.000Z',
  seoContext: RICH_SEO_CONTEXT,
};

describe('formatSeoContextSection persona fidelity', () => {
  it('renders persona pain points at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Proving SEO ROI to C-suite');
    expect(result).toContain('Manual keyword tracking across 500+ pages');
  });

  it('renders persona goals at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Increase organic traffic 30% YoY');
    expect(result).toContain('Automate rank monitoring');
  });

  it('renders persona objections at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('SEO takes too long to show results');
    expect(result).toContain('Another tool to learn');
  });

  it('renders persona buying stage at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('consideration');
    expect(result).toContain('decision');
  });

  it('renders preferred content format at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('case studies and data reports');
    expect(result).toContain('how-to guides and technical docs');
  });

  it('renders persona pain points at standard verbosity (not just names)', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['seoContext'] });
    expect(result).toContain('Proving SEO ROI to C-suite');
  });

  it('compact verbosity renders names + buying stage only', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['seoContext'] });
    expect(result).toContain('Marketing Director');
    expect(result).toContain('SEO Manager');
    expect(result).not.toContain('Proving SEO ROI');
  });
});

describe('formatSeoContextSection page keyword fidelity', () => {
  it('renders page-specific keyword targeting at detailed verbosity when pageKeywords present', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('enterprise seo');
    expect(result).toContain('commercial');
  });

  it('renders secondary keywords when pageKeywords present', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('seo analytics');
  });
});
