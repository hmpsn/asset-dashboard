// tests/unit/format-learnings-section.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_LEARNINGS } from '../fixtures/rich-intelligence.js';

const intel: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-03-30T12:00:00.000Z',
  learnings: RICH_LEARNINGS,
  seoContext: {
    strategy: undefined,
    brandVoice: 'Test voice',
    businessContext: 'Test context',
    personas: [],
    knowledgeBase: '',
  },
};

describe('formatLearningsSection fidelity', () => {
  it('renders strong win rate alongside overall', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('62%');
    expect(result).toContain('28%');
  });

  it('renders totalScoredActions count', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('25');
  });

  it('renders content domain learnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('38');
    expect(result).toContain('seo tips');
    expect(result).toContain('67%');
  });

  it('renders strategy domain learnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('0-20');
    expect(result).toContain('informational');
    expect(result).toContain('500');
    expect(result).toContain('8000');
  });

  it('renders technical domain learnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('FAQ');
    expect(result).toContain('HowTo');
    expect(result).toContain('12');
    expect(result).toContain('72%');
  });

  it('renders format comparison for content learnings', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('82%');
    expect(result).toContain('75%');
  });

  it('standard verbosity includes domain learnings summary', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['learnings'] });
    expect(result).toContain('content_refreshed');
    expect(result).toContain('28%');
  });

  it('compact verbosity renders only headline metrics', () => {
    const result = formatForPrompt(intel, { verbosity: 'compact', sections: ['learnings'] });
    expect(result).toContain('62%');
    expect(result).not.toContain('seo tips');
  });

  // Domain filtering tests
  it('domain=content renders ONLY content learnings', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'content' });
    expect(result).toContain('38');
    expect(result).toContain('seo tips');
    expect(result).not.toContain('0-20');
    expect(result).not.toContain('Best intent types');
    expect(result).not.toContain('Schema types producing');
  });

  it('domain=strategy renders ONLY strategy learnings', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'strategy' });
    expect(result).toContain('0-20');
    expect(result).toContain('informational');
    expect(result).not.toContain('seo tips');
    expect(result).not.toContain('Schema types producing');
  });

  it('domain=all renders all domains', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'], learningsDomain: 'all' });
    expect(result).toContain('seo tips');
    expect(result).toContain('0-20');
    expect(result).toContain('FAQ');
  });

  it('default domain (no param) renders all domains', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['learnings'] });
    expect(result).toContain('seo tips');
    expect(result).toContain('0-20');
    expect(result).toContain('FAQ');
  });
});
