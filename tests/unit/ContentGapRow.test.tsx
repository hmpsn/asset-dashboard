// Wave 2 T4 — shared ContentGapRow primitive tests.
//
// Covers the SIX audience axes and the FLAG-OFF byte-identity gate (gen-quality
// Contract 3) directly against the shared component:
//   - briefing  (FLAG-SENSITIVE): the two ovGainActive deltas + triple OFF-default.
//   - admin:     `KD NN` prefix + est-clicks-ALWAYS (ungated).
//   - strategy-tab: `Difficulty NN` prefix + 'Expanded pick' when backfilled +
//                   'Data-backed' chip (never est-clicks).
//
// The RecommendedForYou.test.tsx companion exercises the SAME briefing deltas through
// the real call site (the end-to-end byte-identity proof); this file pins the shared
// primitive's audience parameterization in isolation.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentGapRow, type ContentGapRowData } from '../../src/components/shared/ContentGapRow';
import type { BadgeTone } from '../../src/components/ui';

// Per-surface intentTone maps (axis c) — admin and client diverge.
const adminIntentTone = (intent?: string): BadgeTone =>
  intent === 'commercial' ? 'blue' : intent === 'informational' ? 'emerald' : 'zinc';
const clientIntentTone = (intent?: string): BadgeTone =>
  intent === 'commercial' ? 'teal' : intent === 'informational' ? 'blue' : 'zinc';

function gap(over: Partial<ContentGapRowData> = {}): ContentGapRowData {
  return {
    topic: 'Enterprise CRM software',
    targetKeyword: 'enterprise crm software',
    intent: 'commercial',
    rationale: 'High commercial intent with proven demand.',
    volume: 8000, // 8000 × 0.103 = 824 → above the impact<10 floor
    difficulty: 25,
    trendDirection: 'rising',
    opportunityScore: 87,
    ...over,
  };
}

describe('ContentGapRow — briefing audience (FLAG-SENSITIVE, gen-quality Contract 3)', () => {
  describe('flag-OFF (default / all prod) renders the PRE-P4 surface byte-identically', () => {
    it('absent ovGainActive prop → "NN/100" badge + est-clicks line; no "Opportunity NN"', () => {
      render(<ContentGapRow audience="briefing" data={gap()} intentTone={clientIntentTone} />);
      expect(screen.getByText('87/100')).toBeInTheDocument();
      expect(screen.getByText(/~824\/mo est\. clicks at rank #3/)).toBeInTheDocument();
      expect(screen.queryByText('Opportunity 87')).not.toBeInTheDocument();
    });

    it('explicit ovGainActive={false} is byte-identical to the absent prop', () => {
      render(<ContentGapRow audience="briefing" data={gap()} intentTone={clientIntentTone} ovGainActive={false} />);
      expect(screen.getByText('87/100')).toBeInTheDocument();
      expect(screen.getByText(/est\. clicks at rank #3/)).toBeInTheDocument();
      expect(screen.queryByText('Opportunity 87')).not.toBeInTheDocument();
    });

    it('preserves the <10 impact floor (low volume suppresses the est-clicks line)', () => {
      // 50 × 0.103 = 5.15 → round 5 → < 10 floor → line omitted (the OFF byte contract).
      render(<ContentGapRow audience="briefing" data={gap({ volume: 50 })} intentTone={clientIntentTone} />);
      expect(screen.queryByText(/est\. clicks at rank #3/)).not.toBeInTheDocument();
      // badge still renders OFF-style
      expect(screen.getByText('87/100')).toBeInTheDocument();
    });
  });

  describe('flag-ON renders the OV-EMV surface', () => {
    it('ovGainActive → "Opportunity NN" badge and NO est-clicks line', () => {
      render(<ContentGapRow audience="briefing" data={gap()} intentTone={clientIntentTone} ovGainActive />);
      expect(screen.getByText('Opportunity 87')).toBeInTheDocument();
      expect(screen.queryByText('87/100')).not.toBeInTheDocument();
      expect(screen.queryByText(/est\. clicks at rank #3/)).not.toBeInTheDocument();
    });
  });

  it('uses the KD prefix (not Difficulty)', () => {
    render(<ContentGapRow audience="briefing" data={gap()} intentTone={clientIntentTone} />);
    expect(screen.getByText('KD 25')).toBeInTheDocument();
    expect(screen.queryByText('Difficulty 25')).not.toBeInTheDocument();
  });
});

describe('ContentGapRow — volume===0 gate (Fix 2: briefing renders, strategy-tab suppresses)', () => {
  // Pre-fix: briefing with volume===0 was suppressed (same as strategy-tab) — incorrect.
  // Post-fix: only strategy-tab requires volume>0; briefing (and admin) render at volume===0.
  it('briefing + volume===0 → "0/mo" cell renders (was suppressed pre-fix)', () => {
    render(<ContentGapRow audience="briefing" data={gap({ volume: 0 })} intentTone={clientIntentTone} />);
    expect(screen.getByText('0/mo')).toBeInTheDocument();
  });

  it('admin + volume===0 → "0/mo" cell renders (unchanged from pre-fix behaviour)', () => {
    render(<ContentGapRow audience="admin" data={gap({ volume: 0 })} intentTone={adminIntentTone} />);
    expect(screen.getByText('0/mo')).toBeInTheDocument();
  });

  it('strategy-tab + volume===0 → volume cell suppressed (unchanged from pre-fix behaviour)', () => {
    render(<ContentGapRow audience="strategy-tab" data={gap({ volume: 0 })} intentTone={clientIntentTone} />);
    expect(screen.queryByText('0/mo')).not.toBeInTheDocument();
  });
});

describe('ContentGapRow — admin audience', () => {
  it('renders the "KD NN" prefix', () => {
    render(<ContentGapRow audience="admin" data={gap()} intentTone={adminIntentTone} />);
    expect(screen.getByText('KD 25')).toBeInTheDocument();
    expect(screen.queryByText('Difficulty 25')).not.toBeInTheDocument();
  });

  it('renders the est-clicks line ALWAYS (ungated — never receives ovGainActive)', () => {
    render(<ContentGapRow audience="admin" data={gap()} intentTone={adminIntentTone} />);
    expect(screen.getByText(/~824\/mo est\. clicks at rank #3/)).toBeInTheDocument();
  });

  it('badge is always "NN/100" (no flag relabel on admin)', () => {
    render(<ContentGapRow audience="admin" data={gap()} intentTone={adminIntentTone} />);
    expect(screen.getByText('87/100')).toBeInTheDocument();
    expect(screen.queryByText('Opportunity 87')).not.toBeInTheDocument();
  });

  it('does not render the strategy-tab "Data-backed" chip', () => {
    render(<ContentGapRow audience="admin" data={gap()} intentTone={adminIntentTone} />);
    expect(screen.queryByText('Data-backed')).not.toBeInTheDocument();
  });
});

describe('ContentGapRow — strategy-tab audience', () => {
  it('renders the "Difficulty NN" prefix (not KD)', () => {
    render(<ContentGapRow audience="strategy-tab" data={gap()} intentTone={clientIntentTone} />);
    expect(screen.getByText('Difficulty 25')).toBeInTheDocument();
    expect(screen.queryByText('KD 25')).not.toBeInTheDocument();
  });

  it('renders "Expanded pick" when backfilled, and omits it otherwise', () => {
    const { unmount } = render(
      <ContentGapRow audience="strategy-tab" data={gap({ backfilled: true })} intentTone={clientIntentTone} />,
    );
    expect(screen.getByText('Expanded pick')).toBeInTheDocument();
    unmount();
    render(<ContentGapRow audience="strategy-tab" data={gap({ backfilled: false })} intentTone={clientIntentTone} />);
    expect(screen.queryByText('Expanded pick')).not.toBeInTheDocument();
  });

  it('renders the "Data-backed" chip and NEVER the est-clicks line', () => {
    render(<ContentGapRow audience="strategy-tab" data={gap()} intentTone={clientIntentTone} />);
    expect(screen.getByText('Data-backed')).toBeInTheDocument();
    expect(screen.queryByText(/est\. clicks at rank #3/)).not.toBeInTheDocument();
  });
});
