/**
 * Tests for the WhyHowResult shared presenter and isSendable gate.
 *
 * Covers:
 *  - Compact mode: Why line only, priority order fallbacks, null when no why
 *  - Expanded mode: all three tiers, tier omission when no content
 *  - Result tier: blue badge for estimatedGain, emerald/amber for impactBand fallback
 *  - Never renders "undefined est." or empty tiers
 *  - isSendable gate: true only when insight + result both resolve
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WhyHowResult, isSendable } from '../../../src/components/strategy/shared/WhyHowResult';

describe('WhyHowResult — compact mode (default)', () => {
  it('renders the Why line from insight (highest priority)', () => {
    render(
      <WhyHowResult
        insight="Traffic is dropping 40%"
        description="Should not show"
        rationale="Should not show"
      />
    );
    expect(screen.getByText('Traffic is dropping 40%')).toBeInTheDocument();
    expect(screen.queryByText('Should not show')).not.toBeInTheDocument();
  });

  it('falls back to description when insight is absent', () => {
    render(<WhyHowResult description="Use description fallback" />);
    expect(screen.getByText('Use description fallback')).toBeInTheDocument();
  });

  it('falls back to rationale when insight and description are absent', () => {
    render(<WhyHowResult rationale="Use rationale fallback" />);
    expect(screen.getByText('Use rationale fallback')).toBeInTheDocument();
  });

  it('falls back to competitorProof as last resort', () => {
    render(<WhyHowResult competitorProof="Competitor proof fallback" />);
    expect(screen.getByText('Competitor proof fallback')).toBeInTheDocument();
  });

  it('renders null when all why sources are absent or empty', () => {
    const { container } = render(<WhyHowResult insight="" />);
    expect(container.firstChild).toBeNull();
  });

  it('does NOT render How or Result tiers in compact mode', () => {
    render(
      <WhyHowResult
        insight="Why text"
        howLabel="Do the thing"
        estimatedGain="+340 clicks/mo"
      />
    );
    expect(screen.queryByText('How')).not.toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
    expect(screen.queryByText('+340 clicks/mo')).not.toBeInTheDocument();
  });
});

describe('WhyHowResult — expanded mode', () => {
  it('renders all three tiers when all data is provided', () => {
    render(
      <WhyHowResult
        expanded
        insight="Traffic dropping"
        howLabel="Refresh content brief"
        estimatedGain="+~340 clicks/mo"
      />
    );
    expect(screen.getByText('Why')).toBeInTheDocument();
    expect(screen.getByText('Traffic dropping')).toBeInTheDocument();
    expect(screen.getByText('How')).toBeInTheDocument();
    expect(screen.getByText('Refresh content brief')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('+~340 clicks/mo')).toBeInTheDocument();
  });

  it('omits the How tier when howLabel is not provided', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why text"
        estimatedGain="+100 clicks/mo"
      />
    );
    expect(screen.queryByText('How')).not.toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('omits the Result tier when neither estimatedGain nor impactBand is provided', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why text"
        howLabel="Action label"
      />
    );
    expect(screen.getByText('How')).toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
  });

  it('renders estimatedGain as a blue data badge (aria-label check)', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why"
        estimatedGain="+~340 clicks/mo"
      />
    );
    expect(screen.getByLabelText('Projected result: +~340 clicks/mo')).toBeInTheDocument();
  });

  it('renders impactBand as emerald badge for high impact when estimatedGain is absent', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why"
        impactBand={{ band: 'high' }}
      />
    );
    expect(screen.getByLabelText('Projected result: High impact')).toBeInTheDocument();
  });

  it('renders impactBand as emerald badge for medium impact', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why"
        impactBand={{ band: 'medium' }}
      />
    );
    expect(screen.getByLabelText('Projected result: Medium impact')).toBeInTheDocument();
  });

  it('renders impactBand as amber badge for low impact', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why"
        impactBand={{ band: 'low' }}
      />
    );
    expect(screen.getByLabelText('Projected result: Low impact')).toBeInTheDocument();
  });

  it('prefers estimatedGain over impactBand when both are provided', () => {
    render(
      <WhyHowResult
        expanded
        insight="Why"
        estimatedGain="+500 clicks/mo"
        impactBand={{ band: 'high' }}
      />
    );
    expect(screen.getByLabelText('Projected result: +500 clicks/mo')).toBeInTheDocument();
    expect(screen.queryByText('High impact')).not.toBeInTheDocument();
  });

  it('never renders "undefined est." or empty result text', () => {
    const { container } = render(
      <WhyHowResult
        expanded
        insight="Why"
        estimatedGain={undefined}
        impactBand={undefined}
      />
    );
    expect(container.textContent).not.toContain('undefined');
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
  });
});

describe('isSendable gate', () => {
  it('returns true when insight is non-empty AND estimatedGain is set', () => {
    expect(isSendable({ insight: 'Why text', estimatedGain: '+340 clicks/mo' })).toBe(true);
  });

  it('returns true when insight is non-empty AND impactBand is set', () => {
    expect(isSendable({ insight: 'Why text', impactBand: { band: 'high' } })).toBe(true);
  });

  it('returns false when insight is absent (even if result exists)', () => {
    expect(isSendable({ estimatedGain: '+100 clicks/mo' })).toBe(false);
  });

  it('returns false when insight is empty string', () => {
    expect(isSendable({ insight: '', estimatedGain: '+100 clicks/mo' })).toBe(false);
  });

  it('returns false when insight is present but result is absent', () => {
    expect(isSendable({ insight: 'Why text' })).toBe(false);
  });

  it('uses fallback sources: description counts as insight', () => {
    expect(isSendable({ description: 'Fallback why', estimatedGain: '+50 clicks/mo' })).toBe(true);
  });

  it('uses fallback sources: rationale counts as insight', () => {
    expect(isSendable({ rationale: 'Another fallback', impactBand: { band: 'low' } })).toBe(true);
  });
});

describe('SiteTargetKeywords — managed-set visual states', () => {
  // Note: SiteTargetKeywords tests that cover the new managedKeywordSet prop
  // are in SiteTargetKeywords.test.tsx (the pre-existing test file for that component).
  // This block is a placeholder to remind of the co-location.
  it.todo('In Set state: renders teal dot + In Set badge for keywords in managedKeywordSet');
  it.todo('Candidate state: renders no annotation for keywords absent from managedKeywordSet');
  it.todo('Legacy parity: no annotations when managedKeywordSet is undefined');
});
