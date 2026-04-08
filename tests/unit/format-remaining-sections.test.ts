import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import {
  RICH_SEO_CONTEXT,
  RICH_CLIENT_SIGNALS,
  RICH_OPERATIONAL,
  RICH_CONTENT_PIPELINE,
  RICH_SITE_HEALTH,
} from '../fixtures/rich-intelligence.js';

const minSeo = { ...RICH_SEO_CONTEXT, personas: [], pageKeywords: undefined };

describe('formatClientSignalsSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    clientSignals: RICH_CLIENT_SIGNALS,
  };

  it('renders businessPriorities at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['clientSignals'] });
    expect(result).toContain('Launch APAC');
  });

  it('renders keywordFeedback at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['clientSignals'] });
    expect(result).toContain('enterprise seo');
    expect(result).toContain('80%');
  });

  it('renders contentGapVotes at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['clientSignals'] });
    expect(result).toContain('AI in SEO');
  });

  it('renders serviceRequests at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['clientSignals'] });
    expect(result).toContain('1 pending');
  });
});

describe('formatOperationalSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    operational: RICH_OPERATIONAL,
  };

  it('renders pendingJobs at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['operational'] });
    expect(result).toContain('3');
  });

  it('renders annotations at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['operational'] });
    expect(result).toContain('Core algorithm update');
  });

  it('renders insightAcceptanceRate at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['operational'] });
    expect(result).toContain('70%');
  });

  it('renders workOrders at standard verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'standard', sections: ['operational'] });
    expect(result).toMatch(/work order/i);
  });
});

describe('formatContentPipelineSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    contentPipeline: RICH_CONTENT_PIPELINE,
  };

  it('renders cannibalization warnings at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['contentPipeline'] });
    expect(result).toContain('seo tools');
    expect(result).toMatch(/cannibalization/i);
  });

  it('renders decay alert page URLs at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['contentPipeline'] });
    expect(result).toContain('/blog/old-guide');
    expect(result).toContain('45');
  });
});

describe('formatSiteHealthSection assembled fields', () => {
  const intel: WorkspaceIntelligence = {
    version: 1, workspaceId: 'ws-t', assembledAt: '2026-03-30T00:00:00Z',
    seoContext: minSeo,
    siteHealth: RICH_SITE_HEALTH,
  };

  it('renders schema validation breakdown at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['siteHealth'] });
    expect(result).toContain('15 valid');
  });

  it('renders CWV metrics at detailed verbosity', () => {
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['siteHealth'] });
    expect(result).toContain('LCP');
    expect(result).toContain('2.1');
  });
});
