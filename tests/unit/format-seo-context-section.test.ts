import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence, SeoContextSlice } from '../../shared/types/intelligence.js';
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

describe('formatSeoContextSection brand voice fidelity', () => {
  it('renders effectiveBrandVoiceBlock verbatim when non-empty', () => {
    // Happy path: the authority-applied block from buildSeoContext is injected
    // into the output without re-formatting. Drop of this assertion would let
    // a regression silently strip voice content from every downstream prompt.
    const result = formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('BRAND VOICE & STYLE');
    expect(result).toContain('Professional, data-driven, and authoritative. No fluff or filler content.');
  });

  it('renders no voice block when effectiveBrandVoiceBlock is empty (calibrated-empty path)', () => {
    // Post-fix regression guard: when effectiveBrandVoiceBlock is empty, the section
    // must render NOTHING for the voice position — even if the raw `brandVoice` field
    // is populated. Previously, a fallback injected `ctx.brandVoice` here, which
    // re-introduced legacy voice for calibrated-but-no-samples workspaces (directly
    // contradicting Layer 2 DNA/guardrails in the system prompt). That fallback is
    // now deleted. The only legitimate voice source in the user prompt is the
    // authority-applied block.
    const emptyVoiceIntel: WorkspaceIntelligence = {
      ...intel,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        brandVoice: 'This raw legacy voice MUST NOT appear in prompts',
        effectiveBrandVoiceBlock: '',
      } satisfies SeoContextSlice,
    };
    const result = formatForPrompt(emptyVoiceIntel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).not.toContain('This raw legacy voice MUST NOT appear in prompts');
    expect(result).not.toContain('BRAND VOICE & STYLE');
  });

  it('renders voice block from effectiveBrandVoiceBlock even when raw brandVoice differs', () => {
    // Authority path: if a caller constructs a slice where raw brandVoice and
    // effectiveBrandVoiceBlock diverge (e.g. calibrated profile has samples, legacy
    // brandVoice is stale), the output must come from effectiveBrandVoiceBlock only.
    const divergentIntel: WorkspaceIntelligence = {
      ...intel,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        brandVoice: 'STALE LEGACY VOICE',
        effectiveBrandVoiceBlock: '\n\nBRAND VOICE REFERENCE (samples):\n- FRESH SAMPLE VOICE',
      } satisfies SeoContextSlice,
    };
    const result = formatForPrompt(divergentIntel, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('FRESH SAMPLE VOICE');
    expect(result).not.toContain('STALE LEGACY VOICE');
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

describe('formatSeoContextSection — PR6 (Spine D) top opportunity + quick wins + cannibalization', () => {
  const withSpineD: WorkspaceIntelligence = {
    ...intel,
    seoContext: {
      ...RICH_SEO_CONTEXT,
      topOpportunity: {
        recommendationId: 'rec-1',
        value: 82,
        emvPerWeek: 1450,
        components: [
          { dimension: 'demand', rawValue: 2400, normalized: 0.8, weight: 0.25, contribution: 0.20, evidence: '2,400 monthly searches' },
          { dimension: 'winnability', rawValue: 7, normalized: 0.6, weight: 0.2, contribution: 0.12, evidence: 'currently ranking position 7' },
          { dimension: 'intent', rawValue: 'transactional', normalized: 0.9, weight: 0.15, contribution: 0.135, evidence: 'transactional intent' },
          { dimension: 'effort', rawValue: 0.5, normalized: 0.9, weight: 0.1, contribution: 0.09, evidence: 'low-effort title fix' },
        ],
      },
      quickWins: [
        { pagePath: '/services', action: 'Add internal links to /pricing', estimatedImpact: 'high', rationale: 'authority flow', roiScore: 88 },
      ],
      cannibalizationIssues: [
        {
          keyword: 'seo tools',
          pages: [
            { path: '/features', source: 'keyword_map' },
            { path: '/blog/best-seo-tools', source: 'gsc' },
          ],
          severity: 'medium',
          recommendation: 'Consolidate to /features',
        },
      ],
      strategy: {
        ...RICH_SEO_CONTEXT.strategy!,
        contentGaps: [
          { topic: 'AEO strategy guide', targetKeyword: 'aeo strategy', intent: 'informational', priority: 'high', rationale: 'rising trend', opportunityScore: 74, trendDirection: 'rising' },
        ],
      },
    } satisfies SeoContextSlice,
  };

  it('emits the #1 opportunity value + components but NEVER the dollar emvPerWeek (this formatter is client-reachable via formatForPrompt)', () => {
    const result = formatForPrompt(withSpineD, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('#1 OPPORTUNITY');
    expect(result).toContain('82/100');
    // Client-safe by construction: the client search-chat advisor reaches this formatter,
    // so the dollar emvPerWeek (1,450) must NOT appear. Admin gets it via recSummary.
    expect(result).not.toContain('1,450');
    expect(result).not.toContain('/week');
    expect(result).not.toMatch(/\$\d/);
  });

  it('emits only the top-3 components by contribution (token budget), not all 4', () => {
    const result = formatForPrompt(withSpineD, { verbosity: 'detailed', sections: ['seoContext'] });
    // demand (0.20), intent (0.135), winnability (0.12) are the top 3
    expect(result).toContain('2,400 monthly searches');
    expect(result).toContain('transactional intent');
    expect(result).toContain('currently ranking position 7');
    // effort (0.09) is the 4th — must be dropped
    expect(result).not.toContain('low-effort title fix');
  });

  it('emits quick wins with the grounded ROI score (SI1)', () => {
    const result = formatForPrompt(withSpineD, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Quick wins');
    expect(result).toContain('Add internal links to /pricing');
    expect(result).toContain('ROI 88');
  });

  it('emits enriched content gaps with opportunityScore + trendDirection (SI2)', () => {
    const result = formatForPrompt(withSpineD, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Content gaps');
    expect(result).toContain('aeo strategy');
    expect(result).toContain('opportunity 74');
    expect(result).toContain('rising');
  });

  it('emits cannibalization issues (SI4)', () => {
    const result = formatForPrompt(withSpineD, { verbosity: 'detailed', sections: ['seoContext'] });
    expect(result).toContain('Keyword cannibalization');
    expect(result).toContain('seo tools');
    expect(result).toContain('Consolidate to /features');
  });

  it('omits Spine D sections at compact verbosity (token budget)', () => {
    const result = formatForPrompt(withSpineD, { verbosity: 'compact', sections: ['seoContext'] });
    expect(result).not.toContain('Quick wins');
    expect(result).not.toContain('Keyword cannibalization');
    expect(result).not.toContain('Content gaps');
  });
});
