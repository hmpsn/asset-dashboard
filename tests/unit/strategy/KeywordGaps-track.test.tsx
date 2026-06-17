import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeywordGaps } from '../../../src/components/strategy/KeywordGaps';
import { keywordTrackingKey } from '../../../src/lib/keywordTracking';

const gaps = [
  { keyword: 'enterprise crm', volume: 1000, difficulty: 25, competitorPosition: 3, competitorDomain: 'rival.com' },
  { keyword: 'crm pricing', volume: 500, difficulty: 40, competitorPosition: 5, competitorDomain: 'rival.com' },
];
const kd = (n?: number) => `kd-${n}`;

describe('KeywordGaps inline Track (Phase 4b CompetitorEvidence)', () => {
  it('renders a Track button per row when onTrack is provided and calls it with the keyword', () => {
    const onTrack = vi.fn();
    render(
      <KeywordGaps
        keywordGaps={gaps}
        difficultyColor={kd}
        trackedKeywords={new Set()}
        trackingPending={new Set()}
        trackingErrors={new Map()}
        onTrack={onTrack}
      />,
    );
    const trackButtons = screen.getAllByTitle('Track');
    expect(trackButtons).toHaveLength(2);
    fireEvent.click(trackButtons[0]);
    expect(onTrack).toHaveBeenCalledWith('enterprise crm');
  });

  it('shows the tracked state and renders a track error for the matching row', () => {
    render(
      <KeywordGaps
        keywordGaps={gaps}
        difficultyColor={kd}
        trackedKeywords={new Set([keywordTrackingKey('enterprise crm')])}
        trackingPending={new Set()}
        trackingErrors={new Map([[keywordTrackingKey('crm pricing'), 'Failed to track keyword. Please try again.']])}
        onTrack={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Tracking')).toBeInTheDocument();
    expect(screen.getByText(/Failed to track keyword/)).toBeInTheDocument();
  });

  it('renders NO Track button when onTrack is omitted (legacy parity), View-in-Hub still works', () => {
    const navigate = vi.fn();
    render(<KeywordGaps keywordGaps={gaps} difficultyColor={kd} workspaceId="ws1" navigate={navigate} />);
    expect(screen.queryByTitle('Track')).not.toBeInTheDocument();
    const hubButtons = screen.getAllByTitle('View in Hub');
    expect(hubButtons).toHaveLength(2);
    fireEvent.click(hubButtons[0]);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('seo-keywords'));
  });
});
