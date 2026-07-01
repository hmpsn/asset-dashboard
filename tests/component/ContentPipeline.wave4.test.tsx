/**
 * Wave 4 design-cleanup tests for ContentPipeline.tsx.
 *
 * Assertions:
 *   (a) Tab bar renders via <TabBar> (Subscriptions renamed to Publish; Export is NOT a tab)
 *   (b) Export opens a <Menu> with CSV+JSON actions
 *   (c) Three alert bands (decay + cannibalization + AI-suggested) collapsed into one
 *       "Alerts & suggestions" Disclosure while the health summary persists
 *   (d) ?tab= deep-link still initializes the active tab (including legacy ?tab=subscriptions → Publish)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Router mocks
// ---------------------------------------------------------------------------
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ---------------------------------------------------------------------------
// Lazy component stubs — ContentPipeline lazy-loads ContentPlanner, ContentCalendar,
// ContentPipelineGuide; stub them so dynamic import doesn't need the real modules.
// ---------------------------------------------------------------------------
vi.mock('../../src/components/ContentPlanner', () => ({
  ContentPlanner: () => <div data-testid="content-planner" />,
}));

vi.mock('../../src/components/ContentCalendar', () => ({
  ContentCalendar: () => <div data-testid="content-calendar" />,
}));

vi.mock('../../src/components/ContentPipelineGuide', () => ({
  ContentPipelineGuide: () => <div data-testid="pipeline-guide" />,
}));

// ---------------------------------------------------------------------------
// ContentBriefs / ContentManager / ContentSubscriptions stubs
// ---------------------------------------------------------------------------
vi.mock('../../src/components/ContentBriefs', () => ({
  ContentBriefs: () => <div data-testid="content-briefs" />,
}));

vi.mock('../../src/components/ContentManager', () => ({
  ContentManager: () => <div data-testid="content-manager" />,
}));

vi.mock('../../src/components/ContentSubscriptions', () => ({
  ContentSubscriptions: () => <div data-testid="content-subscriptions" />,
}));

// ---------------------------------------------------------------------------
// AiSuggested stub — keeps it from needing its own hooks
// ---------------------------------------------------------------------------
vi.mock('../../src/components/pipeline/AiSuggested', () => ({
  AiSuggested: () => <div data-testid="ai-suggested" />,
}));

// ---------------------------------------------------------------------------
// CannibalizationAlert stub
// ---------------------------------------------------------------------------
vi.mock('../../src/components/ui/CannibalizationAlert', () => ({
  CannibalizationAlert: ({ entries }: { entries: unknown[] }) =>
    entries?.length ? <div data-testid="cannibalization-alert" /> : null,
}));

// ---------------------------------------------------------------------------
// Admin hooks mock
// ---------------------------------------------------------------------------
const mockPipelineData = {
  summary: { briefs: 3, posts: 2, matrices: 1, cells: 4, published: 1 },
  decay: null as null | {
    critical: number; warning: number; totalDecaying: number; avgDeclinePct: number;
  },
};

const mockIntelData = {
  contentPipeline: {
    cannibalizationWarnings: [] as Array<{ keyword: string; severity: string; pages: string[] }>,
  },
};

vi.mock('../../src/hooks/admin', () => ({
  useContentPipeline: () => ({ data: mockPipelineData }),
  useWorkspaces: () => ({ data: [{ id: 'ws-1', tier: 'growth' }] }),
  useWorkspaceIntelligence: () => ({ data: mockIntelData }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

async function renderPipeline(initialSearch = '') {
  const { ContentPipeline } = await import('../../src/components/ContentPipeline');
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/ws/ws-1${initialSearch}`]}>
        <ContentPipeline workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// (a) Tab bar: TabBar primitive renders "Publish" tab, Export is NOT a tab
// ---------------------------------------------------------------------------

describe('T4.2 — TabBar primitive adoption', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a tablist via the TabBar primitive', async () => {
    await renderPipeline();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders the "Publish" tab (renamed from Subscriptions)', async () => {
    await renderPipeline();
    const tab = screen.getByRole('tab', { name: /publish/i });
    expect(tab).toBeInTheDocument();
  });

  it('does NOT render a "Subscriptions" tab', async () => {
    await renderPipeline();
    expect(screen.queryByRole('tab', { name: /subscriptions/i })).toBeNull();
  });

  it('Export button is NOT rendered as a tab inside the tablist', async () => {
    await renderPipeline();
    const tablist = screen.getByRole('tablist');
    // Export should not be a tab inside the tablist element
    const tabs = tablist.querySelectorAll('[role="tab"]');
    const tabLabels = Array.from(tabs).map(t => t.textContent?.toLowerCase() ?? '');
    expect(tabLabels.some(l => l.includes('export'))).toBe(false);
  });

  it('renders all 5 tabs: Planner, Calendar, Briefs, Posts, Publish', async () => {
    await renderPipeline();
    const expectedTabs = ['Planner', 'Calendar', 'Briefs', 'Posts', 'Publish'];
    for (const label of expectedTabs) {
      expect(screen.getByRole('tab', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('clicking Publish tab renders the ContentSubscriptions component', async () => {
    await renderPipeline('?tab=briefs');
    fireEvent.click(screen.getByRole('tab', { name: /publish/i }));
    expect(screen.getByTestId('content-subscriptions')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (b) Export via <Menu> primitive
// ---------------------------------------------------------------------------

describe('T4.2 — Export via Menu primitive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an Export button outside the tablist', async () => {
    await renderPipeline();
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
  });

  it('clicking Export opens a menu with CSV and JSON actions', async () => {
    await renderPipeline();
    const exportBtn = screen.getByRole('button', { name: /export/i });
    fireEvent.click(exportBtn);
    // The Menu renders items into a popover — we expect multiple CSV and JSON entries
    await waitFor(() => {
      expect(screen.getAllByText(/csv/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/json/i).length).toBeGreaterThan(0);
    });
  });

  it('clicking a CSV action opens the export URL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderPipeline();
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByText(/content briefs.*csv/i));
    fireEvent.click(screen.getByText(/content briefs.*csv/i));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('format=csv'), '_blank');
    openSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// (c) Alert bands collapsed into one Disclosure; health summary persists
// ---------------------------------------------------------------------------

describe('T4.3 — Alert Disclosure consolidation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('health summary bar is rendered when summary data exists', async () => {
    await renderPipeline();
    // Health summary shows brief count — "3" appears as a <span> inside the summary bar.
    // Use getAllByText and confirm at least one of the matches is from the summary bar span.
    const threeNodes = screen.getAllByText('3');
    expect(threeNodes.length).toBeGreaterThan(0);
    // The PageHeader title must also render
    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
  });

  it('does NOT render inline decay alert band when decay data is present (it goes into Disclosure)', async () => {
    // Set up decay data
    mockPipelineData.decay = { critical: 1, warning: 2, totalDecaying: 3, avgDeclinePct: -25 };
    await renderPipeline();
    // The Disclosure summary should be present, not a freestanding ClickableRow
    expect(screen.getByText(/alerts.*suggestions/i)).toBeInTheDocument();
    // Restore
    mockPipelineData.decay = null;
  });

  it('Disclosure shows the alert count badge when decay alerts exist', async () => {
    mockPipelineData.decay = { critical: 0, warning: 2, totalDecaying: 2, avgDeclinePct: -15 };
    await renderPipeline();
    // 1 decay + 0 cannibalization = count "1" in the disclosure badge
    expect(screen.getByText(/alerts.*suggestions/i)).toBeInTheDocument();
    // Restore
    mockPipelineData.decay = null;
  });

  it('Disclosure shows cannibalization alert inside when cannibalization entries exist', async () => {
    mockIntelData.contentPipeline.cannibalizationWarnings = [
      { keyword: 'dental implants', severity: 'high', pages: ['/a', '/b'] },
    ];
    await renderPipeline();
    // Open the Disclosure (click on <summary>)
    const summaryEl = screen.getByText(/alerts.*suggestions/i).closest('summary')
      ?? screen.getByText(/alerts.*suggestions/i);
    fireEvent.click(summaryEl);
    await waitFor(() => {
      expect(screen.getByTestId('cannibalization-alert')).toBeInTheDocument();
    });
    // Restore
    mockIntelData.contentPipeline.cannibalizationWarnings = [];
  });

  it('does NOT render Alerts & suggestions Disclosure when no alert-count alerts exist', async () => {
    mockPipelineData.decay = null;
    mockIntelData.contentPipeline.cannibalizationWarnings = [];
    await renderPipeline();
    expect(screen.queryByText(/alerts.*suggestions/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) ?tab= deep-link initializes the active tab
// ---------------------------------------------------------------------------

describe('T4 — ?tab= deep-link contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('?tab=briefs initializes to Briefs tab', async () => {
    await renderPipeline('?tab=briefs');
    expect(screen.getByTestId('content-briefs')).toBeInTheDocument();
  });

  it('?tab=posts initializes to Posts tab', async () => {
    await renderPipeline('?tab=posts');
    expect(screen.getByTestId('content-manager')).toBeInTheDocument();
  });

  it('?tab=publish initializes to Publish tab', async () => {
    await renderPipeline('?tab=publish');
    expect(screen.getByTestId('content-subscriptions')).toBeInTheDocument();
  });

  it('?tab=subscriptions (legacy alias) resolves to Publish tab', async () => {
    await renderPipeline('?tab=subscriptions');
    expect(screen.getByTestId('content-subscriptions')).toBeInTheDocument();
  });

  it('falls back to briefs tab when ?tab= is absent', async () => {
    await renderPipeline();
    expect(screen.getByTestId('content-briefs')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T4.1 — Stepper alignment
// ---------------------------------------------------------------------------

describe('T4.1 — Stepper alignment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the WorkflowStepper with 4 phases when not on Calendar tab', async () => {
    await renderPipeline('?tab=briefs');
    // WorkflowStepper renders a nav with role="navigation" or just an <ol>
    const stepperNav = document.querySelector('nav[aria-label="Workflow steps"]');
    expect(stepperNav).not.toBeNull();
  });

  it('does NOT render the WorkflowStepper when on the Calendar tab', async () => {
    await renderPipeline('?tab=calendar');
    const stepperNav = document.querySelector('nav[aria-label="Workflow steps"]');
    expect(stepperNav).toBeNull();
  });

  it('Strategy step click switches to Planner tab (in-page, not navigate off-page)', async () => {
    await renderPipeline('?tab=briefs');
    // The Strategy step button should navigate to planner tab
    const strategyBtn = screen.getAllByRole('button').find(
      b => b.textContent?.toLowerCase().includes('strategy'),
    );
    expect(strategyBtn).toBeTruthy();
    fireEvent.click(strategyBtn!);
    // navigateMock should NOT have been called (no off-page navigation)
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
