// tests/component/BrandHub.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BrandHub } from '../../src/components/BrandHub';

// ── Sub-tab stubs ─────────────────────────────────────────────────────────────
vi.mock('../../src/components/brand/BrandscriptTab', () => ({
  BrandscriptTab: () => <div data-testid="brandscript-tab" />,
}));
vi.mock('../../src/components/brand/DiscoveryTab', () => ({
  DiscoveryTab: () => <div data-testid="discovery-tab" />,
}));
vi.mock('../../src/components/brand/VoiceTab', () => ({
  VoiceTab: () => <div data-testid="voice-tab" />,
}));
vi.mock('../../src/components/brand/IdentityTab', () => ({
  IdentityTab: () => <div data-testid="identity-tab" />,
}));
vi.mock('../../src/components/brand/BrandOverviewTab', () => ({
  BrandOverviewTab: () => <div data-testid="brand-overview-tab" />,
}));
vi.mock('../../src/components/brand/PageStrategyTab', () => ({
  PageStrategyTab: ({ onSelectBlueprint }: { onSelectBlueprint: (id: string) => void }) => (
    <div data-testid="page-strategy-tab">
      <button onClick={() => onSelectBlueprint('bp-1')}>Select Blueprint</button>
    </div>
  ),
}));
vi.mock('../../src/components/brand/BlueprintDetail', () => ({
  BlueprintDetail: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="blueprint-detail">
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));
vi.mock('../../src/components/brand/BlueprintVersionHistory', () => ({
  BlueprintVersionHistory: () => <div data-testid="blueprint-version-history" />,
}));
vi.mock('../../src/components/settings/BusinessFootprintTab', () => ({
  BusinessFootprintTab: ({ legacySection }: { legacySection?: string | null }) => (
    <div data-testid="business-footprint-tab" data-legacy-section={legacySection ?? 'none'}>
      BusinessFootprintTabStub
    </div>
  ),
}));

// ── Background tasks mock ─────────────────────────────────────────────────────
const startJobMock = vi.fn().mockResolvedValue(null);
const findActiveJobMock = vi.fn().mockReturnValue(undefined);

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    jobs: [],
    activeJobs: [],
    startJob: startJobMock,
    trackJob: vi.fn(),
    getJobResult: vi.fn().mockReturnValue(undefined),
    findActiveJob: findActiveJobMock,
    findLatestTerminalJob: vi.fn().mockReturnValue(undefined),
    jobsForWorkspace: vi.fn().mockReturnValue([]),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    dismissJob: vi.fn(),
    clearDone: vi.fn(),
  }),
}));

// ── Toast mock ────────────────────────────────────────────────────────────────
const toastMock = vi.fn();

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── workspaces API mock ───────────────────────────────────────────────────────
const mockGetById = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue({});

vi.mock('../../src/api', () => ({
  workspaces: {
    getById: (...args: unknown[]) => mockGetById(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

const mockWorkspace = {
  id: 'ws-test',
  webflowSiteId: 'site-abc',
  knowledgeBase: 'We do plumbing and HVAC.',
  brandVoice: 'Professional and approachable.',
  personas: [
    {
      id: 'persona-1',
      name: 'Homeowner Harry',
      description: 'Homeowner needing repairs',
      painPoints: ['high costs'],
      goals: ['fast repair'],
      objections: ['too expensive'],
      buyingStage: 'decision' as const,
    },
  ],
};

function renderBrandHub(
  props?: Partial<React.ComponentProps<typeof BrandHub>>,
  options?: { initialEntries?: string[] },
) {
  return render(
    <BrandHub workspaceId="ws-test" {...props} />,
    { wrapper: makeWrapper(options?.initialEntries) },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BrandHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetById.mockResolvedValue(mockWorkspace);
    findActiveJobMock.mockReturnValue(undefined);
    startJobMock.mockResolvedValue(null);
  });

  it('renders without crash with mocked workspace data', async () => {
    renderBrandHub();
    expect(screen.getByText('Brand & AI Context')).toBeInTheDocument();
  });

  it('renders the PageHeader with correct title and subtitle', () => {
    renderBrandHub();
    expect(screen.getByText('Brand & AI Context')).toBeInTheDocument();
    expect(screen.getByText(/Everything that feeds into AI content generation/i)).toBeInTheDocument();
  });

  it('renders the TabBar with all expected tabs', () => {
    renderBrandHub();
    // TabBar renders tabs with role="tab", not role="button"
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /brandscript/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /discovery/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /voice/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /identity/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /business footprint/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /business profile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /locations/i })).not.toBeInTheDocument();
  });

  it('defaults to overview tab showing summary cards and current context sections', async () => {
    renderBrandHub();
    expect(screen.getByTestId('brand-overview-tab')).toBeInTheDocument();
    expect(screen.getByText('Brand Voice & Style')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
    expect(screen.getByText('Audience Personas')).toBeInTheDocument();
    expect(screen.getByText('Page Strategy')).toBeInTheDocument();
  });

  it('overview tab does NOT render sub-tab stubs', () => {
    renderBrandHub();
    expect(screen.queryByTestId('brandscript-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('discovery-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('voice-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('identity-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('business-footprint-tab')).not.toBeInTheDocument();
  });

  it('switches to Brandscript tab and renders stub', async () => {
    renderBrandHub();
    fireEvent.click(screen.getByRole('tab', { name: /brandscript/i }));
    expect(screen.getByTestId('brandscript-tab')).toBeInTheDocument();
    expect(screen.queryByText('Brand Voice & Style')).not.toBeInTheDocument();
  });

  it('switches to Discovery tab and renders stub', () => {
    renderBrandHub();
    fireEvent.click(screen.getByRole('tab', { name: /discovery/i }));
    expect(screen.getByTestId('discovery-tab')).toBeInTheDocument();
  });

  it('switches to Voice tab and renders stub', () => {
    renderBrandHub();
    fireEvent.click(screen.getByRole('tab', { name: /voice/i }));
    expect(screen.getByTestId('voice-tab')).toBeInTheDocument();
  });

  it('switches to Identity tab and renders stub', () => {
    renderBrandHub();
    fireEvent.click(screen.getByRole('tab', { name: /identity/i }));
    expect(screen.getByTestId('identity-tab')).toBeInTheDocument();
  });

  it('switches to Business Footprint tab and renders stub', () => {
    renderBrandHub();
    fireEvent.click(screen.getByRole('tab', { name: /business footprint/i }));
    expect(screen.getByTestId('business-footprint-tab')).toBeInTheDocument();
  });

  it('maps legacy business-profile deep links to the Business Footprint tab', () => {
    renderBrandHub(undefined, { initialEntries: ['/ws/ws-test/brand?tab=business-profile'] });
    expect(screen.getByTestId('business-footprint-tab')).toHaveAttribute('data-legacy-section', 'business-profile');
  });

  it('maps legacy locations deep links to the Business Footprint tab', () => {
    renderBrandHub(undefined, { initialEntries: ['/ws/ws-test/brand?tab=locations'] });
    expect(screen.getByTestId('business-footprint-tab')).toHaveAttribute('data-legacy-section', 'locations');
  });

  it('switching back to Overview tab restores overview content', () => {
    renderBrandHub();
    fireEvent.click(screen.getByRole('tab', { name: /brandscript/i }));
    fireEvent.click(screen.getByRole('tab', { name: /overview/i }));
    expect(screen.getByText('Brand Voice & Style')).toBeInTheDocument();
    expect(screen.queryByTestId('brandscript-tab')).not.toBeInTheDocument();
  });

  it('populates brand voice textarea once workspace data loads', async () => {
    renderBrandHub();
    await waitFor(() => {
      expect(
        screen.getByText('Professional and approachable.')
      ).toBeInTheDocument();
    });
  });

  it('shows (configured) badge next to Brand Voice when brandVoice is set', async () => {
    renderBrandHub();
    await waitFor(() => {
      expect(screen.getAllByText('(configured)').length).toBeGreaterThan(0);
    });
  });

  it('renders Save Brand Voice and Generate from Website buttons', async () => {
    renderBrandHub();
    expect(screen.getByRole('button', { name: /save brand voice/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /generate from website/i }).length).toBeGreaterThan(0);
  });

  it('Generate from Website button is disabled when no webflowSiteId', () => {
    renderBrandHub({ workspaceId: 'ws-test', webflowSiteId: undefined });
    // All "Generate from Website" buttons should be disabled (brand voice + KB + personas)
    const generateButtons = screen.getAllByRole('button', { name: /generate from website/i });
    generateButtons.forEach(btn => {
      expect(btn).toBeDisabled();
    });
  });

  it('Generate from Website button is enabled when webflowSiteId is provided', () => {
    renderBrandHub({ workspaceId: 'ws-test', webflowSiteId: 'site-abc' });
    const generateButtons = screen.getAllByRole('button', { name: /generate from website/i });
    generateButtons.forEach(btn => {
      expect(btn).not.toBeDisabled();
    });
  });

  it('Save Brand Voice calls workspace update mutation', async () => {
    mockUpdate.mockResolvedValue({});
    renderBrandHub();
    await waitFor(() => {
      expect(screen.getByText('Professional and approachable.')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /save brand voice/i }));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'ws-test',
        expect.objectContaining({ brandVoice: expect.any(String) }),
      );
    });
  });

  it('shows toast on successful Save Brand Voice', async () => {
    mockUpdate.mockResolvedValue({});
    renderBrandHub();
    await waitFor(() => screen.getByText('Professional and approachable.'));
    fireEvent.click(screen.getByRole('button', { name: /save brand voice/i }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('Brand voice saved');
    });
  });

  it('shows error toast when Save Brand Voice fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('Network error'));
    renderBrandHub();
    await waitFor(() => screen.getByText('Professional and approachable.'));
    fireEvent.click(screen.getByRole('button', { name: /save brand voice/i }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('Failed to save brand voice', 'error');
    });
  });

  it('shows knowledge base textarea populated from workspace data', async () => {
    renderBrandHub();
    await waitFor(() => {
      expect(screen.getByText('We do plumbing and HVAC.')).toBeInTheDocument();
    });
  });

  it('Audience Personas section shows Manage button when collapsed', () => {
    renderBrandHub();
    expect(screen.getByRole('button', { name: /manage/i })).toBeInTheDocument();
  });

  it('clicking Manage opens persona manager with Add Persona button', async () => {
    renderBrandHub();
    await waitFor(() => screen.getByRole('button', { name: /manage/i }));
    fireEvent.click(screen.getByRole('button', { name: /manage/i }));
    expect(screen.getByRole('button', { name: /add persona/i })).toBeInTheDocument();
  });

  it('collapsed personas section shows persona chips when personas exist', async () => {
    renderBrandHub();
    await waitFor(() => {
      expect(screen.getByText(/Homeowner Harry/)).toBeInTheDocument();
    });
  });

  it('shows "No personas defined" when workspace has no personas', async () => {
    mockGetById.mockResolvedValue({ ...mockWorkspace, personas: [] });
    renderBrandHub();
    await waitFor(() => {
      expect(
        screen.getByText(/No personas defined — AI will use generic audience targeting/i),
      ).toBeInTheDocument();
    });
  });

  it('opening persona manager shows Save Personas button', async () => {
    renderBrandHub();
    await waitFor(() => screen.getByRole('button', { name: /manage/i }));
    fireEvent.click(screen.getByRole('button', { name: /manage/i }));
    expect(screen.getByRole('button', { name: /save personas/i })).toBeInTheDocument();
  });

  it('Add Persona creates a new persona entry in edit mode', async () => {
    renderBrandHub();
    await waitFor(() => screen.getByRole('button', { name: /manage/i }));
    fireEvent.click(screen.getByRole('button', { name: /manage/i }));
    fireEvent.click(screen.getByRole('button', { name: /add persona/i }));
    // A FormInput for the new persona's name should appear
    expect(screen.getAllByDisplayValue('New Persona').length).toBeGreaterThan(0);
  });

  it('renders PageStrategyTab stub on the overview tab', () => {
    renderBrandHub();
    expect(screen.getByTestId('page-strategy-tab')).toBeInTheDocument();
  });

  it('selecting a blueprint shows BlueprintDetail instead of PageStrategyTab', () => {
    renderBrandHub();
    fireEvent.click(screen.getByText('Select Blueprint'));
    expect(screen.getByTestId('blueprint-detail')).toBeInTheDocument();
    expect(screen.getByTestId('blueprint-version-history')).toBeInTheDocument();
    expect(screen.queryByTestId('page-strategy-tab')).not.toBeInTheDocument();
  });

  it('clicking Back in BlueprintDetail returns to PageStrategyTab', () => {
    renderBrandHub();
    fireEvent.click(screen.getByText('Select Blueprint'));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('page-strategy-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('blueprint-detail')).not.toBeInTheDocument();
  });

  it('brand voice generation shows Crawling site... when job is active', () => {
    findActiveJobMock.mockImplementation(({ type }: { type: string }) => {
      if (type === 'brand-voice-generation') {
        return { id: 'job-1', type: 'brand-voice-generation', status: 'running', createdAt: '', updatedAt: '' };
      }
      return undefined;
    });
    renderBrandHub({ workspaceId: 'ws-test', webflowSiteId: 'site-abc' });
    // The generate button should show the running label
    expect(screen.getAllByText(/Crawling site\.\.\./i).length).toBeGreaterThan(0);
  });

  it('shows informational footer on overview tab', () => {
    renderBrandHub();
    expect(screen.getByText(/How it works:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/These three sources — brand voice, knowledge base, and personas/i),
    ).toBeInTheDocument();
  });

  it('shows workspace data loading silently — no spinner text when useQuery is pending', () => {
    // When data is undefined (pending), component renders with empty/default values
    mockGetById.mockReturnValue(new Promise(() => {})); // never resolves
    renderBrandHub();
    // Should still render the shell without crashing
    expect(screen.getByText('Brand & AI Context')).toBeInTheDocument();
    expect(screen.getByText('Brand Voice & Style')).toBeInTheDocument();
  });

  it('persona count label pluralizes correctly', async () => {
    renderBrandHub();
    // Wait for ws data to arrive so ws?.personas has 1 entry before clicking Manage
    await waitFor(() => screen.getByText(/Homeowner Harry/));
    fireEvent.click(screen.getByRole('button', { name: /manage/i }));
    // The label is "{count} persona{count !== 1 ? 's' : ''}" rendered as a span
    await waitFor(() => {
      // Use getAllByText with a function matcher to handle potential split text nodes
      const nodes = screen.getAllByText((content, element) => {
        return !!element && element.tagName !== 'SCRIPT' && /\b1 persona\b/.test(element.textContent ?? '');
      });
      expect(nodes.length).toBeGreaterThan(0);
    });
  });

  it('contains no purple color classes (Four Laws compliance)', () => {
    const { container } = renderBrandHub();
    expect(container.innerHTML).not.toMatch(/purple-/);
  });
});
