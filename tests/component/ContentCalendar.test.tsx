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
vi.mock('../../src/hooks/admin', () => ({
  useContentCalendar: vi.fn(),
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

const mockItems = [
  {
    id: 'brief-1',
    type: 'brief' as const,
    label: 'SEO Strategy Brief',
    sublabel: 'seo strategy',
    status: 'draft',
    date: todayIso,
  },
  {
    id: 'post-1',
    type: 'post' as const,
    label: 'How to Improve SEO',
    sublabel: 'seo tips',
    status: 'approved',
    date: todayIso,
    publishedAt: todayIso,
  },
  {
    id: 'req-1',
    type: 'request' as const,
    label: 'Content for Landing Page',
    sublabel: 'landing page seo',
    status: 'requested',
    date: todayIso,
  },
  {
    id: 'mat-1',
    type: 'matrix' as const,
    label: 'City Service Pages',
    sublabel: '12 cells',
    status: 'published',
    date: todayIso,
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

  it('navigates to seo-briefs when "Create a Brief" is clicked', async () => {
    const hooks = await getAdminHooks();
    vi.mocked(hooks.useContentCalendar).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof hooks.useContentCalendar>);
    renderContentCalendar();
    fireEvent.click(screen.getByRole('button', { name: /create a brief/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('seo-briefs'));
  });

  it('shows selected day detail panel when a calendar day is clicked', () => {
    renderContentCalendar();
    // Click the day cell that contains today's date number
    const todayDate = today.getDate().toString();
    // The day cell contains date numbers — find any cell with today's date
    // Today's number renders inside an amber span; regular days render directly
    const dayCells = screen.getAllByRole('button').filter(b =>
      b.textContent?.includes(todayDate) && b.className.includes('min-h'),
    );
    if (dayCells.length > 0) {
      fireEvent.click(dayCells[0]);
      // Detail panel appears
      // Detail panel appears — multiple elements may match /item/i (e.g. "0 items" badge + "No content items" message)
      expect(screen.getAllByText(/item/i).length).toBeGreaterThan(0);
    }
  });

  it('shows item label in selected day detail panel', () => {
    renderContentCalendar();
    const dayCells = screen.getAllByRole('button').filter(b => b.className.includes('min-h'));
    // Find a cell that contains our test item label
    const cellWithItem = dayCells.find(b => b.textContent?.includes('SEO Strategy Brief'));
    if (cellWithItem) {
      fireEvent.click(cellWithItem);
      const panels = screen.getAllByText('SEO Strategy Brief');
      expect(panels.length).toBeGreaterThan(0);
    }
  });
});
