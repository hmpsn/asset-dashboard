import { describe, expect, it } from 'vitest';

import { normalizeAeoReviewResponse } from '../../server/aeo-page-review.js';

describe('normalizeAeoReviewResponse', () => {
  it('normalizes effort labels and marks unsupported citation recommendations for research', () => {
    const review = normalizeAeoReviewResponse({
      overallScore: 72,
      summary: 'Good foundation.',
      changes: [
        {
          changeType: 'add_citations',
          location: 'Evidence section',
          suggestedChange: 'Cite CDC data on this claim.',
          rationale: 'Trust signal.',
          effort: 'quick (< 15 min)',
          priority: 'high',
          aeoImpact: 'Improves citation confidence.',
        },
        {
          changeType: 'add_citations',
          location: 'Intro',
          suggestedChange: 'Cite the existing industry survey.',
          rationale: 'Trust signal.',
          effort: 'significant (1+ hours)',
          priority: 'medium',
          aeoImpact: 'Improves citation confidence.',
          verifiedSourceEvidence: 'Knowledge base: 2025 industry survey from Example Institute.',
        },
      ],
    });

    expect(review.changes[0].effort).toBe('quick');
    expect(review.changes[0].requiresSourceResearch).toBe(true);
    expect(review.changes[0].suggestedChange).toMatch(/^Research needed before client handoff/);
    expect(review.changes[1].effort).toBe('significant');
    expect(review.changes[1].requiresSourceResearch).toBe(false);
    expect(review.changes[1].verifiedSourceEvidence).toContain('2025 industry survey');
    expect(review.quickWinCount).toBe(1);
  });
});
