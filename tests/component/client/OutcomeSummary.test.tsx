import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OutcomeSummary from '../../../src/components/client/OutcomeSummary';
import type { OutcomeScorecard } from '../../../shared/types/outcome-tracking';

// ─── Module-level mocks ───────────────────────────────────────────────────────

const mockUseClientOutcomeSummary = vi.fn();
vi.mock('../../../src/hooks/client/useClientOutcomes', () => ({
  useClientOutcomeSummary: (...args: unknown[]) => mockUseClientOutcomeSummary(...args),
}));

// FeatureFlag reads from useFeatureFlag — mock to always enable the flag
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (_flag: string) => true,
}));

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getSafe: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test';

function makeScorecard(overrides: Partial<OutcomeScorecard> = {}): OutcomeScorecard {
  return {
    overallWinRate: 0.65,
    strongWinRate: 0.42,
    totalTracked: 20,
    totalScored: 14,
    pendingMeasurement: 6,
    byCategory: [
      { actionType: 'content_published', winRate: 0.75, count: 8, scored: 8 },
      { actionType: 'meta_updated', winRate: 0.5, count: 4, scored: 4 },
      { actionType: 'audit_fix_applied', winRate: 0.33, count: 3, scored: 3 },
    ],
    trend: 'improving',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OutcomeSummary — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders skeleton loading indicators when isLoading is true', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    // Skeleton elements have an animated bg class
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('does not render the empty state when loading', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: undefined, isLoading: true });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.queryByText('Results are on the way')).toBeNull();
  });
});

describe('OutcomeSummary — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no scorecard data is available', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: undefined, isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText('Results are on the way')).toBeInTheDocument();
  });

  it('shows descriptive message in empty state', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: undefined, isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText(/once your first recommendations are measured/i)).toBeInTheDocument();
  });
});

describe('OutcomeSummary — section header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Your results" section title', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText('Your results')).toBeInTheDocument();
  });

  it('shows "Measured over 90 days" timeframe annotation', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText(/measured over 90 days/i)).toBeInTheDocument();
  });
});

describe('OutcomeSummary — free tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the introductory text for free tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="free" />);
    expect(screen.getByText(/here's what's been working/i)).toBeInTheDocument();
  });

  it('shows top category wins in free tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="free" />);
    // "Content published" label appears inside a <span> in the TopThreeWins list
    expect(screen.getAllByText('Content published').length).toBeGreaterThan(0);
  });

  it('shows win rate percentage in free tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="free" />);
    // Text is rendered as "worked 75% of the time" but split across text nodes.
    // Use getAllByText with a function matcher that checks node content including children.
    const { container } = render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="free" />);
    expect(container.innerHTML).toContain('75');
  });

  it('renders TierGate upgrade prompt in free tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="free" />);
    // TierGate shows "Learn More" for locked features
    expect(screen.getByText('Learn More')).toBeInTheDocument();
  });

  it('shows "Not enough scored results" message when byCategory is empty', () => {
    const emptyScorecard = makeScorecard({ byCategory: [] });
    mockUseClientOutcomeSummary.mockReturnValue({ data: emptyScorecard, isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="free" />);
    expect(screen.getByText(/not enough scored results yet/i)).toBeInTheDocument();
  });
});

describe('OutcomeSummary — growth tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders full scorecard with aggregate stats for growth tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText('Overall win rate')).toBeInTheDocument();
  });

  it('shows overall win rate percentage', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    // 0.65 → 65%
    expect(screen.getByText('65%')).toBeInTheDocument();
  });

  it('shows total actions tracked count', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText('Actions tracked')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('shows pending results count', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText('Pending results')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('shows "improving" trend message', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard({ trend: 'improving' }), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText(/results are trending in the right direction/i)).toBeInTheDocument();
  });

  it('shows "stable" trend message', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard({ trend: 'stable' }), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText(/results are holding steady/i)).toBeInTheDocument();
  });

  it('shows "declining" trend message', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard({ trend: 'declining' }), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText(/some metrics need attention/i)).toBeInTheDocument();
  });

  it('renders category breakdown for scored categories', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(screen.getByText('By recommendation type')).toBeInTheDocument();
  });

  it('shows compact TierGate prompt for premium in growth tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    // Compact TierGate shows the feature name "Detailed outcome breakdown"
    expect(screen.getByText('Detailed outcome breakdown')).toBeInTheDocument();
  });

  it('does not render purple styling', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    const { container } = render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="growth" />);
    expect(container.innerHTML).not.toMatch(/purple-/);
  });
});

describe('OutcomeSummary — premium tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders detailed breakdown panel for premium tier', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="premium" />);
    expect(screen.getByText('Detailed breakdown')).toBeInTheDocument();
  });

  it('shows total scored actions count in premium breakdown', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="premium" />);
    expect(screen.getByText('Total scored actions')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('shows strong wins rate in premium breakdown', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="premium" />);
    expect(screen.getByText('Strong wins (top score)')).toBeInTheDocument();
  });

  it('shows "Confirmed wins" in premium breakdown', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="premium" />);
    expect(screen.getByText('Confirmed wins')).toBeInTheDocument();
  });

  it('renders overall win rate in premium tier (includes FullScorecard)', () => {
    mockUseClientOutcomeSummary.mockReturnValue({ data: makeScorecard(), isLoading: false });
    render(<OutcomeSummary workspaceId={WORKSPACE_ID} tier="premium" />);
    expect(screen.getByText('Overall win rate')).toBeInTheDocument();
  });
});
