import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { KeywordCommandCenter } from '../../src/components/KeywordCommandCenter';
import {
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterResponse,
} from '../../shared/types/keyword-command-center';
import { TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking';

const mutateMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenter: vi.fn(),
  useKeywordCommandCenterAction: vi.fn(),
}));

const payload: KeywordCommandCenterResponse = {
  rows: [
    {
      keyword: 'cosmetic dentistry',
      normalizedKeyword: 'cosmetic dentistry',
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY,
      statusLabel: 'In Strategy',
      sourceLabels: [{ kind: 'page_assignment', label: 'Page assignment', detail: 'Cosmetic Dentistry' }],
      metrics: { volume: 700, difficulty: 29, currentPosition: 6, impressions: 500, ctr: 0.024 },
      assignment: { pagePath: '/services/cosmetic-dentistry', pageTitle: 'Cosmetic Dentistry', role: 'page_keyword' },
      tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE, source: 'strategy_primary', pinned: false },
      nextActions: [
        { type: 'view_rankings', label: 'View rankings', detail: 'Open Rank Tracker.', tone: 'blue', keyword: 'cosmetic dentistry', targetTab: 'seo-ranks' },
        { type: 'review_page', label: 'Review page', detail: 'Open Page Intelligence.', tone: 'teal', keyword: 'cosmetic dentistry', pagePath: '/services/cosmetic-dentistry', targetTab: 'page-intelligence' },
      ],
      isProtected: false,
    },
    {
      keyword: 'best teeth whitening strips',
      normalizedKeyword: 'best teeth whitening strips',
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE,
      statusLabel: 'Raw Evidence',
      sourceLabels: [{ kind: 'raw_evidence', label: 'Raw provider evidence', detail: 'competitor.example' }],
      metrics: { volume: 2400, difficulty: 65 },
      assignment: { role: 'raw_evidence' },
      tracking: { status: 'not_tracked' },
      nextActions: [
        { type: 'promote_evidence', label: 'Promote evidence', detail: 'Track this keyword.', tone: 'teal', keyword: 'best teeth whitening strips' },
        { type: 'decline', label: 'Decline', detail: 'Suppress this keyword.', tone: 'red', keyword: 'best teeth whitening strips' },
      ],
      isProtected: false,
      rawEvidenceOnly: true,
    },
    {
      keyword: 'old strategy keyword',
      normalizedKeyword: 'old strategy keyword',
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RETIRED,
      statusLabel: 'Retired',
      sourceLabels: [{ kind: 'tracking', label: 'Rank tracking', detail: 'strategy primary' }],
      metrics: {},
      tracking: { status: TRACKED_KEYWORD_STATUS.DEPRECATED, source: 'strategy_primary' },
      nextActions: [
        { type: 'restore', label: 'Restore', detail: 'Restore this keyword.', tone: 'teal', keyword: 'old strategy keyword' },
      ],
      isProtected: false,
    },
  ],
  counts: {
    total: 3,
    inStrategy: 1,
    tracked: 1,
    needsReview: 0,
    evidence: 1,
    retired: 1,
    declined: 0,
  },
  filters: [
    { id: 'all', label: 'All', count: 3 },
    { id: 'in_strategy', label: 'In Strategy', count: 1 },
    { id: 'tracked', label: 'Tracked', count: 1 },
    { id: 'needs_review', label: 'Needs Review', count: 0 },
    { id: 'content', label: 'Content', count: 0 },
    { id: 'page_assigned', label: 'Page Assigned', count: 1 },
    { id: 'raw_evidence', label: 'Raw Evidence', count: 1 },
    { id: 'requested', label: 'Requested', count: 0 },
    { id: 'declined', label: 'Declined', count: 0 },
    { id: 'retired', label: 'Retired', count: 1 },
  ],
  rawEvidenceTotal: 1,
  rawEvidenceReturned: 1,
  generatedAt: '2026-05-20T10:00:00.000Z',
};

describe('KeywordCommandCenter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    navigateMock.mockReset();
    const hooks = await import('../../src/hooks/admin/useKeywordCommandCenter');
    vi.mocked(hooks.useKeywordCommandCenter).mockReturnValue({
      data: payload,
      isLoading: false,
      error: null,
    } as ReturnType<typeof hooks.useKeywordCommandCenter>);
    vi.mocked(hooks.useKeywordCommandCenterAction).mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      variables: undefined,
    } as ReturnType<typeof hooks.useKeywordCommandCenterAction>);
  });

  it('renders lifecycle summaries and raw evidence as evidence, not selected strategy action', () => {
    render(<KeywordCommandCenter workspaceId="ws-1" />);

    expect(screen.getByText('Keywords')).toBeInTheDocument();
    expect(screen.getByText('Keyword Universe')).toBeInTheDocument();
    expect(screen.getAllByText('In Strategy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Raw Evidence').length).toBeGreaterThan(0);
    expect(screen.getByText('Raw provider evidence · competitor.example')).toBeInTheDocument();
  });

  it('filters and searches the keyword universe together', () => {
    render(<KeywordCommandCenter workspaceId="ws-1" />);

    fireEvent.click(screen.getByRole('button', { name: /^raw evidence\s*1$/i }));
    expect(screen.getAllByText('best teeth whitening strips').length).toBeGreaterThan(0);
    expect(screen.queryByText('cosmetic dentistry')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search keywords'), { target: { value: 'cosmetic' } });
    expect(screen.getByText('No keywords match this view')).toBeInTheDocument();
  });

  it('opens drawer actions without publishing or live metadata writes', () => {
    render(<KeywordCommandCenter workspaceId="ws-1" />);

    fireEvent.click(screen.getByText('best teeth whitening strips'));
    const drawer = screen.getByText('Safe Next Actions').closest('div')!.parentElement!;
    fireEvent.click(within(drawer).getByRole('button', { name: /promote evidence/i }));

    expect(mutateMock).toHaveBeenCalledWith({
      action: 'promote_evidence',
      keyword: 'best teeth whitening strips',
      pagePath: undefined,
    });
    expect(screen.getByText(/They do not publish content or write live metadata/i)).toBeInTheDocument();
  });
});
