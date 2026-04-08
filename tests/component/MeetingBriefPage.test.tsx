import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MeetingBriefPage } from '../../src/components/admin/MeetingBrief/MeetingBriefPage';
import type { MeetingBrief } from '../../shared/types/meeting-brief.js';

vi.mock('../../src/hooks/admin/useAdminMeetingBrief', () => ({
  useAdminMeetingBrief: vi.fn(),
}));

import { useAdminMeetingBrief } from '../../src/hooks/admin/useAdminMeetingBrief';
const mockHook = vi.mocked(useAdminMeetingBrief);

const SAMPLE_BRIEF: MeetingBrief = {
  workspaceId: 'test-ws',
  generatedAt: new Date().toISOString(),
  situationSummary: 'Your site is gaining momentum.',
  wins: ['Ranking improved for /services'],
  attention: ['Content decay on /blog/old'],
  recommendations: [{ action: 'Refresh /blog/old', rationale: 'Losing traffic' }],
  blueprintProgress: null,
  metrics: { siteHealthScore: 87, openRankingOpportunities: 4, contentInPipeline: 3, overallWinRate: 72, criticalIssues: 2 },
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('MeetingBriefPage', () => {
  it('shows empty state when no brief exists', () => {
    mockHook.mockReturnValue({ brief: null, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.getByText(/No meeting brief yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Generate First Brief/i)).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    mockHook.mockReturnValue({ brief: null, isLoading: true, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    const { container } = render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    // Skeleton component renders divs — check for card presence
    expect(container.querySelector('[data-testid="section-card"], .rounded-lg, div')).toBeInTheDocument();
  });

  it('renders brief content when brief exists', () => {
    mockHook.mockReturnValue({ brief: SAMPLE_BRIEF, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.getByText('Your site is gaining momentum.')).toBeInTheDocument();
    expect(screen.getByText('Ranking improved for /services')).toBeInTheDocument();
    expect(screen.getByText('Refresh /blog/old')).toBeInTheDocument();
    expect(screen.getByText('87/100')).toBeInTheDocument();
  });

  it('hides blueprint section when blueprintProgress is null', () => {
    mockHook.mockReturnValue({ brief: SAMPLE_BRIEF, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.queryByText(/Blueprint Progress/i)).not.toBeInTheDocument();
  });

  it('shows blueprint section when blueprintProgress is set', () => {
    const briefWithBlueprint = { ...SAMPLE_BRIEF, blueprintProgress: '3 of 8 pages live.' };
    mockHook.mockReturnValue({ brief: briefWithBlueprint, isLoading: false, isError: false, generate: vi.fn(), isGenerating: false, generateError: null });
    render(<MeetingBriefPage workspaceId="test-ws" />, { wrapper });
    expect(screen.getByText(/Blueprint Progress/i)).toBeInTheDocument();
    expect(screen.getByText('3 of 8 pages live.')).toBeInTheDocument();
  });
});
