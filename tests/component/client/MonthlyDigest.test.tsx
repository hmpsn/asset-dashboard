import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthlyDigestContent } from '../../../src/components/client/MonthlyDigest';
import type { MonthlyDigestData } from '../../../shared/types/narrative';

const noDataDigest: MonthlyDigestData = {
  availability: 'no_data',
  month: 'May 2026',
  period: {
    start: '2026-05-01T00:00:00.000Z',
    end: '2026-05-22T23:59:59.999Z',
  },
  summary: 'No current-month results are available yet. This digest will update after search activity, site visits, completed work, or measured results are recorded.',
  wins: [],
  issuesAddressed: [],
  metrics: {
    clicksChange: 0,
    impressionsChange: 0,
    avgPositionChange: 0,
    pagesOptimized: 0,
  },
  roiHighlights: [],
};

describe('MonthlyDigestContent', () => {
  it('renders an explicit truthful current-month no-data state', () => {
    render(<MonthlyDigestContent digest={noDataDigest} />);

    expect(screen.getByText('May 2026 Performance')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This month is still taking shape');
    expect(screen.getByRole('status')).toHaveTextContent('No current-month results are available yet');
    expect(screen.queryByText(/held steady|solid baseline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Wins this month')).not.toBeInTheDocument();
  });

  it('labels client-side execution without assigning agency credit and leaves legacy attribution neutral', () => {
    const digest: MonthlyDigestData = {
      ...noDataDigest,
      availability: 'ready',
      summary: 'Measured results are available.',
      roiHighlights: [
        {
          pageTitle: 'Client-built page',
          pageUrl: '/client-built',
          action: 'Published new post',
          result: 'Win (+20%)',
          clicksGained: 20,
          attributedValue: 80,
          attribution: 'externally_executed',
        },
        {
          pageTitle: 'Legacy page',
          pageUrl: '/legacy',
          action: 'Updated meta description',
          result: 'Win (+10%)',
          clicksGained: 10,
          attributedValue: 40,
        },
      ],
    };

    render(<MonthlyDigestContent digest={digest} />);

    const clientSideRow = screen.getByText('Client-built page').closest('li');
    const legacyRow = screen.getByText('Legacy page').closest('li');
    expect(clientSideRow).not.toBeNull();
    expect(legacyRow).not.toBeNull();
    expect(within(clientSideRow!).getByText('Implemented on your side')).toBeInTheDocument();
    expect(within(legacyRow!).queryByText(/implemented|shipped|agency/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we implemented|we shipped/i)).not.toBeInTheDocument();
  });
});
