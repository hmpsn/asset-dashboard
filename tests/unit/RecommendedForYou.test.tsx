// SEO Gen-Quality P4 (Contract 3) — RecommendedForYou flag-gate component test.
//
// Pins the two client-facing deltas to the per-workspace `seo-generation-quality`
// umbrella (threaded down as the `ovGainActive` prop, resolved server-side in
// buildBriefingClientView):
//   delta 1 — opportunity-score badge: OFF → "NN/100" (pre-P4) · ON → "Opportunity NN".
//   delta 2 — `volume × 0.103` "est. clicks at rank #3" line: OFF → present · ON → absent.
//
// Flag-OFF MUST render byte-identically to pre-P4 (= all prod today, umbrella default OFF).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecommendedForYou } from '../../src/components/client/Briefing/RecommendedForYou';
import type { BriefingRecommendation } from '../../shared/types/briefing';

// TierGate (wrapping the rows) consults useFeatureFlag internally — mock it off so the
// growth-tier render path is the un-gated one (free-tier would blur + overlay an upgrade CTA).
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));

function rec(over: Partial<BriefingRecommendation> = {}): BriefingRecommendation {
  return {
    topic: 'Enterprise CRM software',
    targetKeyword: 'enterprise crm software',
    intent: 'commercial',
    priority: 'high',
    rationale: 'High commercial intent with proven demand.',
    volume: 8000, // 8000 × 0.103 = 824 → well above the impact<10 floor
    difficulty: 25,
    trendDirection: 'rising',
    opportunityScore: 87,
    ...over,
  };
}

describe('RecommendedForYou — P4 ovGainActive flag gate (Contract 3)', () => {
  describe('flag-OFF (default / all prod) renders the PRE-P4 surface', () => {
    it('renders the "NN/100" opportunity badge (not the OV "Opportunity NN" label)', () => {
      render(<RecommendedForYou recommendations={[rec()]} tier="growth" onRequestBrief={() => {}} />);
      expect(screen.getByText('87/100')).toBeInTheDocument();
      expect(screen.queryByText('Opportunity 87')).not.toBeInTheDocument();
    });

    it('renders the "est. clicks at rank #3" volume×0.103 estimate line', () => {
      render(<RecommendedForYou recommendations={[rec()]} tier="growth" onRequestBrief={() => {}} />);
      // 8000 × 0.103 = 824
      expect(screen.getByText(/~824\/mo est\. clicks at rank #3/)).toBeInTheDocument();
    });

    it('absent ovGainActive prop defaults OFF (byte-identical to the explicit false)', () => {
      // No ovGainActive prop at all → default false → pre-P4 surface.
      render(<RecommendedForYou recommendations={[rec()]} tier="growth" onRequestBrief={() => {}} />);
      expect(screen.getByText('87/100')).toBeInTheDocument();
      expect(screen.getByText(/est\. clicks at rank #3/)).toBeInTheDocument();
    });
  });

  describe('flag-ON renders the new OV-EMV surface', () => {
    it('renders the "Opportunity NN" badge (not the pre-P4 "NN/100")', () => {
      render(<RecommendedForYou recommendations={[rec()]} tier="growth" onRequestBrief={() => {}} ovGainActive />);
      expect(screen.getByText('Opportunity 87')).toBeInTheDocument();
      expect(screen.queryByText('87/100')).not.toBeInTheDocument();
    });

    it('suppresses the "est. clicks at rank #3" line (one basis — no competing estimator)', () => {
      render(<RecommendedForYou recommendations={[rec()]} tier="growth" onRequestBrief={() => {}} ovGainActive />);
      expect(screen.queryByText(/est\. clicks at rank #3/)).not.toBeInTheDocument();
    });
  });
});
