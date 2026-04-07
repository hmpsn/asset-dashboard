import { describe, it, expect } from 'vitest';
import {
  formatBrandVoiceForPrompt,
  formatKnowledgeBaseForPrompt,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatPageMapForPrompt,
} from '../../server/workspace-intelligence.js';
import { RICH_SEO_CONTEXT } from '../fixtures/rich-intelligence.js';

describe('formatBrandVoiceForPrompt', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatBrandVoiceForPrompt(null)).toBe('');
    expect(formatBrandVoiceForPrompt(undefined)).toBe('');
    expect(formatBrandVoiceForPrompt('')).toBe('');
  });

  it('wraps brand voice in emphatic header', () => {
    const result = formatBrandVoiceForPrompt('Professional and data-driven.');
    expect(result).toContain('BRAND VOICE');
    expect(result).toContain('MUST match');
    expect(result).toContain('Professional and data-driven.');
  });
});

describe('formatKnowledgeBaseForPrompt', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatKnowledgeBaseForPrompt(null)).toBe('');
    expect(formatKnowledgeBaseForPrompt(undefined)).toBe('');
    expect(formatKnowledgeBaseForPrompt('')).toBe('');
  });

  it('wraps knowledge in emphatic header', () => {
    const result = formatKnowledgeBaseForPrompt('We specialize in enterprise SEO.');
    expect(result).toContain('BUSINESS KNOWLEDGE BASE');
    expect(result).toContain('We specialize in enterprise SEO.');
  });
});

describe('formatKeywordsForPrompt', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatKeywordsForPrompt(null)).toBe('');
    expect(formatKeywordsForPrompt(undefined)).toBe('');
  });

  it('renders site target keywords', () => {
    const result = formatKeywordsForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('Site target keywords');
    expect(result).toContain('enterprise seo');
    expect(result).toContain('analytics platform');
  });

  it('renders business context from strategy', () => {
    const result = formatKeywordsForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('Fortune 500');
  });
});

describe('formatPersonasForPrompt', () => {
  it('returns empty string for null/undefined/empty array', () => {
    expect(formatPersonasForPrompt(null)).toBe('');
    expect(formatPersonasForPrompt(undefined)).toBe('');
    expect(formatPersonasForPrompt([])).toBe('');
  });

  it('renders persona names and descriptions', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('Marketing Director');
    expect(result).toContain('SEO Manager');
  });

  it('renders pain points', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('Proving SEO ROI to C-suite');
    expect(result).toContain('Manual keyword tracking');
  });

  it('renders goals', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('Increase organic traffic');
    expect(result).toContain('Automate rank monitoring');
  });

  it('renders objections', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('SEO takes too long');
    expect(result).toContain('Another tool to learn');
  });

  it('renders buying stage', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('consideration');
    expect(result).toContain('decision');
  });

  it('renders preferred content format', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('case studies');
    expect(result).toContain('how-to guides');
  });

  it('includes TARGET AUDIENCE header', () => {
    const result = formatPersonasForPrompt(RICH_SEO_CONTEXT.personas);
    expect(result).toContain('TARGET AUDIENCE PERSONAS');
  });
});

describe('formatPageMapForPrompt', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatPageMapForPrompt(null)).toBe('');
    expect(formatPageMapForPrompt(undefined)).toBe('');
  });

  it('renders page-to-keyword map', () => {
    const result = formatPageMapForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('/features');
    expect(result).toContain('enterprise seo');
  });

  it('renders keyword header', () => {
    const result = formatPageMapForPrompt(RICH_SEO_CONTEXT);
    expect(result).toContain('KEYWORD');
  });
});
