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
