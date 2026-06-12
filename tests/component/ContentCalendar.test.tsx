// tests/component/ContentCalendar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContentCalendar } from '../../src/components/ContentCalendar';

// ── Router mocks ──────────────────────────────────────────────────────────────
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── Hook mock ─────────────────────────────────────────────────────────────────
// W6.6: the rebuilt calendar also reads the admin posts list (for the
// schedule-a-draft picker), so the barrel mock must expose useAdminPostsList too.
vi.mock('../../src/hooks/admin', () => ({
  useContentCalendar: vi.fn(),
  useAdminPostsList: vi.fn(),
}));

// ── Toast mock — the calendar surfaces schedule/suggest results via toast. ──────
vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── Content API mock — schedule-a-draft + suggest-dates call these. ─────────────
vi.mock('../../src/api/content', () => ({
  contentPosts: {
    setPlannedDate: vi.fn().mockResolvedValue(undefined),
    suggestDates: vi.fn().mockResolvedValue({ suggestions: [] }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderContentCalendar(workspaceId = 'ws1') {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/ws/ws1']}>
        <ContentCalendar workspaceId={workspaceId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const today = new Date();
const todayIso = today.toISOString();

// W6.6: CalendarItem now carries a `kind` ('published' | 'planned' | 'created')
// that drives the visual treatment. Fixtures mirror the real derived shape.
const mockItems = [
  {
    id: 'brief-1',
    type: 'brief' as const,
    label: 'SEO Strategy Brief',
    sublabel: 'seo strategy',
    status: 'created',
    date: todayIso,
    kind: 'created' as const,
  },
  {
    id: 'post-1',
    type: 'post' as const,
    label: 'How to Improve SEO',
    sublabel: 'seo tips',
    status: 'approved',
    date: todayIso,
    publishedAt: todayIso,
    kind: 'published' as const,
  },
  {
    id: 'req-1',
    type: 'request' as const,
    label: 'Content for Landing Page',
    sublabel: 'landing page seo',
    status: 'requested',
    date: todayIso,
    kind: 'created' as const,
  },
  {
    id: 'mat-1',
    type: 'matrix' as const,
    label: 'City Service Pages',
    sublabel: '12 cells',
    status: 'published',
    date: todayIso,
    kind: 'created' as const,
  },
];

async function getAdminHooks() {
  return import('../../src/hooks/admin');
}

describe('ContentCalendar', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    navigateMock.mockReset();
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: mockItems,
      isLoading: false,
    } as ReturnType<typeof hooks.useContentCalendar>);
    // Posts list backs the schedule-a-draft picker; empty by default.
    vi.mocked(hooks.useAdminPostsList).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof hooks.useAdminPostsList>);
  });

  it('renders without crash', () => {
    renderContentCalendar();
    expect(document.body).toBeTruthy();
  });

  it('shows the "Content Calendar" heading', () => {
    renderContentCalendar();
    expect(screen.getByText('Content Calendar')).toBeInTheDocument();
  });

  it('shows loading spinner when data is loading', async () => {
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: [],
      isLoading: true,
    } as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('renders the calendar grid with day headers', () => {
    renderContentCalendar();
    // All 7 day abbreviations should be present
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
      expect(screen.getByText(day)).toBeInTheDocument();
    });
  });

  it('shows the current month and year in the navigation bar', () => {
    renderContentCalendar();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(screen.getByText(monthYear)).toBeInTheDocument();
  });

  it('renders previous month navigation button', () => {
    renderContentCalendar();
    expect(screen.getByTitle('Previous month')).toBeInTheDocument();
  });

  it('renders next month navigation button', () => {
    renderContentCalendar();
    expect(screen.getByTitle('Next month')).toBeInTheDocument();
  });

  it('navigates to the previous month when prev button is clicked', () => {
    renderContentCalendar();
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const expected = prevMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    fireEvent.click(screen.getByTitle('Previous month'));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('navigates to the next month when next button is clicked', () => {
    renderContentCalendar();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const expected = nextMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    fireEvent.click(screen.getByTitle('Next month'));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('shows "Today" button when navigated away from current month', () => {
    renderContentCalendar();
    fireEvent.click(screen.getByTitle('Next month'));
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
  });

  it('returns to current month when "Today" button is clicked', () => {
    renderContentCalendar();
    const currentMonthLabel = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    fireEvent.click(screen.getByTitle('Next month'));
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(screen.getByText(currentMonthLabel)).toBeInTheDocument();
  });

  it('renders type filter buttons (All, Briefs, Posts, Requests, Matrix Cells)', () => {
    renderContentCalendar();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Briefs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Requests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Matrix Cells' })).toBeInTheDocument();
  });

  it('shows month stat cards for Briefs, Posts, Requests, Matrix Cells, Published', () => {
    renderContentCalendar();
    // These labels appear in stat cards (and possibly filter buttons too — use getAllByText)
    expect(screen.getAllByText('Briefs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Posts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Requests').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Matrix Cells').length).toBeGreaterThan(0);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('renders calendar item labels in the current-month grid cells', () => {
    renderContentCalendar();
    expect(screen.getByText('SEO Strategy Brief')).toBeInTheDocument();
  });

  it('shows empty state when no items exist', async () => {
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    expect(screen.getByText('No content items yet')).toBeInTheDocument();
  });

  it('shows "Create a Brief" CTA in empty state', async () => {
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    expect(screen.getByRole('button', { name: /create a brief/i })).toBeInTheDocument();
  });

  it('navigates to content-pipeline briefs tab when "Create a Brief" is clicked', async () => {
    // W6.6 / D1 fold: seo-briefs is now a zombie redirect → content-pipeline?tab=briefs.
    // The CTA targets the destination directly rather than bouncing through the redirect.
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    fireEvent.click(screen.getByRole('button', { name: /create a brief/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('content-pipeline'));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('tab=briefs'));
  });

  it('shows selected day detail panel when a calendar day is clicked', () => {
    renderContentCalendar();
    const dayCells = screen.getAllByRole('button').filter(b => b.className.includes('min-h'));
    const cellWithItem = dayCells.find(b => b.textContent?.includes('SEO Strategy Brief'));
    expect(cellWithItem).toBeDefined();

    fireEvent.click(cellWithItem!);
    expect(screen.getByText('4 items')).toBeInTheDocument();
  });

  it('shows item label in selected day detail panel', () => {
    renderContentCalendar();
    const dayCells = screen.getAllByRole('button').filter(b => b.className.includes('min-h'));
    // Find a cell that contains our test item label
    const cellWithItem = dayCells.find(b => b.textContent?.includes('SEO Strategy Brief'));
    expect(cellWithItem).toBeDefined();

    fireEvent.click(cellWithItem!);
    const panels = screen.getAllByText('SEO Strategy Brief');
    expect(panels.length).toBeGreaterThan(0);
  });

  // ── FM-2: Error path behavioral tests ─────────────────────────────────────────

  it('renders ErrorState when data load fails — not a silently empty calendar (FM-2)', async () => {
    const hooks = await getAdminHooks();
    // data: undefined models a first-load error with no cached data. ErrorState is
    // only shown when there is no stale cache to fall back on (isError && !data).
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    // ErrorState title, not an empty calendar
    expect(screen.getByText("Couldn't load calendar data")).toBeInTheDocument();
    // Calendar grid should NOT render when in error state
    expect(screen.queryByText('Content Calendar')).not.toBeInTheDocument();
  });

  it('ErrorState for calendar contains a Retry button that calls refetch (FM-2)', async () => {
    const refetchMock = vi.fn().mockResolvedValue(undefined);
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
    } as unknown as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('keeps the calendar visible on a background refetch error when stale data is cached (FM-2)', async () => {
    const hooks = await getAdminHooks();
    // isError true but data present (stale cache from a prior successful fetch).
    // The calendar must stay rendered rather than collapsing to ErrorState.
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: mockItems,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    // Calendar chrome is still present; ErrorState is NOT shown.
    expect(screen.getByText('Content Calendar')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load calendar data")).not.toBeInTheDocument();
  });
});
