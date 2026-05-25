// tests/component/brand/IdentityTab.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IdentityTab } from '../../../src/components/brand/IdentityTab';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockList = vi.fn();
const mockGenerate = vi.fn();
const mockRefine = vi.fn();
const mockUpdateStatus = vi.fn();
const mockExport = vi.fn();
const mockToast = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('../../../src/api/brand-engine', () => ({
  identity: {
    list: (...args: unknown[]) => mockList(...args),
    generate: (...args: unknown[]) => mockGenerate(...args),
    refine: (...args: unknown[]) => mockRefine(...args),
    updateStatus: (...args: unknown[]) => mockUpdateStatus(...args),
    export: (...args: unknown[]) => mockExport(...args),
  },
}));

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeliverable(overrides: Partial<{
  id: string;
  deliverableType: string;
  content: string;
  status: string;
}> = {}) {
  return {
    id: 'del-1',
    workspaceId: 'ws-1',
    deliverableType: 'mission',
    content: 'We exist to help businesses grow.',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderIdentityTab(workspaceId = 'ws-1') {
  return render(<IdentityTab workspaceId={workspaceId} />, { wrapper });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IdentityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pending query (loading state)
    mockList.mockReturnValue(new Promise(() => {}));
  });

  // Loading state
  it('shows skeleton loading state while fetching deliverables', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    const { container } = renderIdentityTab();
    // Loading state renders skeleton shimmer divs — check via animate-pulse class
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  // Error state
  it('shows error message and retry button when query fails', async () => {
    mockList.mockRejectedValue(new Error('Network error'));
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText(/failed to load brand deliverables/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  // Empty state
  it('shows empty state with Generate Mission button when no deliverables', async () => {
    mockList.mockResolvedValue([]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText('No brand deliverables yet')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /generate mission/i })).toBeInTheDocument();
  });

  // Populated state — tier sections
  it('renders tier section headings when deliverables exist', async () => {
    mockList.mockResolvedValue([makeDeliverable()]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText('Essentials')).toBeInTheDocument();
    });
    expect(screen.getByText('Professional')).toBeInTheDocument();
    expect(screen.getByText('Premium')).toBeInTheDocument();
  });

  // Deliverable label
  it('renders correct deliverable label for mission type', async () => {
    mockList.mockResolvedValue([makeDeliverable()]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText('Mission Statement')).toBeInTheDocument();
    });
  });

  // Deliverable content
  it('displays deliverable content when present', async () => {
    mockList.mockResolvedValue([makeDeliverable({ content: 'We exist to help businesses grow.' })]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText(/we exist to help businesses grow/i)).toBeInTheDocument();
    });
  });

  // Draft badge
  it('shows Draft badge for a draft deliverable', async () => {
    mockList.mockResolvedValue([makeDeliverable({ status: 'draft' })]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });
  });

  // Approved badge
  it('shows Approved badge for an approved deliverable', async () => {
    mockList.mockResolvedValue([makeDeliverable({ status: 'approved' })]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
    });
  });

  // Generate button (no content)
  it('shows Generate button when deliverable has no content', async () => {
    mockList.mockResolvedValue([makeDeliverable({ content: '' })]);
    renderIdentityTab();
    await waitFor(() => {
      // Multiple Generate buttons appear (one per deliverable without content)
      const generateButtons = screen.getAllByRole('button', { name: /^generate$/i });
      expect(generateButtons.length).toBeGreaterThan(0);
    });
  });

  // Regenerate button (has content)
  it('shows Regenerate button when deliverable has content', async () => {
    mockList.mockResolvedValue([makeDeliverable()]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    });
  });

  // Refine form visible when content present
  it('shows refinement input when deliverable has content', async () => {
    mockList.mockResolvedValue([makeDeliverable()]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Refinement direction...')).toBeInTheDocument();
    });
  });

  // Generate from empty state
  it('calls identity.generate when Generate Mission button is clicked in empty state', async () => {
    mockList.mockResolvedValue([]);
    mockGenerate.mockResolvedValue(makeDeliverable());
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate mission/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /generate mission/i }));
    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith('ws-1', { deliverableType: 'mission' });
    });
  });

  // Export All button disabled when 0 approved
  it('Export All button is disabled when no deliverables are approved', async () => {
    mockList.mockResolvedValue([makeDeliverable({ status: 'draft' })]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export all/i })).toBeDisabled();
    });
  });

  // Export All button enabled when some approved
  it('Export All button is enabled and shows count when deliverables are approved', async () => {
    mockList.mockResolvedValue([makeDeliverable({ status: 'approved' })]);
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export all/i })).not.toBeDisabled();
    });
    expect(screen.getByText('(1 approved)')).toBeInTheDocument();
  });

  // Export triggers API
  it('calls identity.export when Export All is clicked', async () => {
    mockList.mockResolvedValue([makeDeliverable({ status: 'approved' })]);
    mockExport.mockResolvedValue({ markdown: '# Brand Identity\n\nMission: grow.' });
    // Mock URL + DOM methods to avoid jsdom errors
    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export all/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /export all/i }));
    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith('ws-1');
    });
  });

  // Retry button calls invalidateQueries
  it('retry button triggers query invalidation', async () => {
    mockList.mockRejectedValue(new Error('Network error'));
    renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  // No purple class in output
  it('contains no purple color classes (Four Laws compliance)', async () => {
    mockList.mockResolvedValue([makeDeliverable()]);
    const { container } = renderIdentityTab();
    await waitFor(() => {
      expect(screen.getByText('Mission Statement')).toBeInTheDocument();
    });
    expect(container.innerHTML).not.toMatch(/purple-/);
  });
});
