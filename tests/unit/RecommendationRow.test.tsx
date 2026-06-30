import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecommendationRow } from '../../src/components/admin/recommendations/RecommendationRow';
import type { Recommendation } from '../../shared/types/recommendations';

const makeRec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: 'r1', workspaceId: 'ws1', priority: 'fix_now', type: 'metadata',
  title: 'Fix the homepage title', description: 'expanded-description', insight: 'insight text',
  impact: 'high', effort: 'low', impactScore: 80,
  opportunity: {
    value: 72, emvPerWeek: 1500, predictedEmv: 0, roiPerEffortDay: 0, confidence: 0.8,
    calibration: 1, groundedSpine: [], components: [], calibrationVersion: 'v1', modelVersion: 'v1',
  },
  source: 'audit', affectedPages: ['/'], trafficAtRisk: 0, impressionsAtRisk: 0,
  estimatedGain: '+10 clicks', actionType: 'manual', status: 'pending',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as unknown as Recommendation);

describe('RecommendationRow', () => {
  it('renders priority, title, OV and emv', () => {
    render(<RecommendationRow rec={makeRec()} />);
    expect(screen.getByText('Fix Now')).toBeInTheDocument();
    expect(screen.getByText('Fix the homepage title')).toBeInTheDocument();
    expect(screen.getByText('OV 72')).toBeInTheDocument();
    expect(screen.getByText('$1.5k/wk')).toBeInTheDocument();
  });

  it('omits the Fix CTA when onFixCta is absent', () => {
    render(<RecommendationRow rec={makeRec()} />);
    expect(screen.queryByRole('button', { name: /^fix$/i })).not.toBeInTheDocument();
  });

  it('shows a Fix CTA when onFixCta is provided and fires it without toggling expand', () => {
    const onFixCta = vi.fn();
    const { container } = render(<RecommendationRow rec={makeRec()} onFixCta={onFixCta} />);
    expect(screen.queryByText('expanded-description')).not.toBeInTheDocument();
    expect(container.querySelector('button button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^fix$/i }));
    expect(onFixCta).toHaveBeenCalledOnce();
    // stopPropagation: the row did not expand
    expect(screen.queryByText('expanded-description')).not.toBeInTheDocument();
  });

  it('expands to show the description when the row is clicked', () => {
    render(<RecommendationRow rec={makeRec()} />);
    fireEvent.click(screen.getByText('Fix the homepage title'));
    expect(screen.getByText('expanded-description')).toBeInTheDocument();
  });
});
