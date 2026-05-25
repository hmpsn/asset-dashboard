// tests/component/brand/BatchGenerationPanel.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BatchGenerationPanel } from '../../../src/components/brand/BatchGenerationPanel';
import type { BlueprintEntry } from '../../../shared/types/page-strategy';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockStartBatch = vi.fn();
const mockUseBatchJob = vi.fn();
const mockUseCopyStatus = vi.fn();

vi.mock('../../../src/hooks/admin/useCopyPipeline', () => ({
  useStartBatch: (_wsId: string, _bpId: string) => mockStartBatch(),
  useBatchJob: (...args: unknown[]) => mockUseBatchJob(...args),
  useCopyStatus: (...args: unknown[]) => mockUseCopyStatus(...args),
}));

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<BlueprintEntry> = {}): BlueprintEntry {
  return {
    id: 'entry-1',
    blueprintId: 'bp-1',
    workspaceId: 'ws-1',
    name: 'Home Page',
    slug: '/',
    pageType: 'homepage',
    scope: 'included',
    sortOrder: 0,
    status: 'draft',
    targetKeywords: [],
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

function renderPanel(entries: BlueprintEntry[] = [makeEntry()]) {
  return render(
    <BatchGenerationPanel workspaceId="ws-1" blueprintId="bp-1" entries={entries} />,
    { wrapper },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BatchGenerationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartBatch.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });
    mockUseBatchJob.mockReturnValue({ data: null, isLoading: false });
    mockUseCopyStatus.mockReturnValue({ data: null });
  });

  // Empty state
  it('shows empty state when entries array is empty', () => {
    renderPanel([]);
    expect(screen.getByText('No blueprint entries')).toBeInTheDocument();
    expect(screen.getByText(/add entries to the blueprint/i)).toBeInTheDocument();
  });

  // Renders without crash
  it('renders without crash when entries are provided', () => {
    renderPanel();
    expect(screen.getByText('Select Pages')).toBeInTheDocument();
  });

  // Entry count display
  it('shows selected/total count in header', () => {
    renderPanel([makeEntry({ id: 'e1' }), makeEntry({ id: 'e2', name: 'About' })]);
    expect(screen.getByText('2/2 selected')).toBeInTheDocument();
  });

  // Entry names rendered
  it('renders entry names in the list', () => {
    renderPanel([makeEntry({ name: 'Home Page' }), makeEntry({ id: 'e2', name: 'About Us' })]);
    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.getByText('About Us')).toBeInTheDocument();
  });

  // Select all / Deselect all toggle
  it('shows Deselect all when all entries are selected', () => {
    renderPanel([makeEntry()]);
    expect(screen.getByRole('button', { name: /deselect all/i })).toBeInTheDocument();
  });

  it('clicking Deselect all deselects entries and shows Select all', () => {
    renderPanel([makeEntry()]);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    expect(screen.getByRole('button', { name: /select all/i })).toBeInTheDocument();
    expect(screen.getByText('0/1 selected')).toBeInTheDocument();
  });

  // Generate button disabled when nothing selected
  it('shows warning and disables generate button when no entries selected', () => {
    renderPanel([makeEntry()]);
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/select at least one page/i);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });

  // Generate button enabled when entries selected
  it('generate button is enabled when entries are selected', () => {
    renderPanel([makeEntry()]);
    // aria-label: "Generate copy for 1 selected page"
    expect(screen.getByRole('button', { name: /generate copy for 1 selected page/i })).not.toBeDisabled();
  });

  // Pluralization in generate button
  it('generate button label pluralizes correctly for multiple pages', () => {
    renderPanel([makeEntry({ id: 'e1' }), makeEntry({ id: 'e2', name: 'About' })]);
    // aria-label: "Generate copy for 2 selected pages"
    expect(screen.getByRole('button', { name: /generate copy for 2 selected pages/i })).toBeInTheDocument();
  });

  // Generation mode selector
  it('renders Review Inbox and Iterative Batch mode buttons', () => {
    renderPanel();
    expect(screen.getByRole('radio', { name: /review inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /iterative batch/i })).toBeInTheDocument();
  });

  // Default mode is review_inbox
  it('defaults to Review Inbox mode (aria-checked=true)', () => {
    renderPanel();
    expect(screen.getByRole('radio', { name: /review inbox/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /iterative batch/i })).toHaveAttribute('aria-checked', 'false');
  });

  // Switching to iterative shows batch size input
  it('switching to Iterative Batch shows batch size input', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: /iterative batch/i }));
    expect(screen.getByLabelText(/pages per batch/i)).toBeInTheDocument();
    expect(screen.getByText('Batch size')).toBeInTheDocument();
  });

  // Mode description changes
  it('shows iterative mode description after switching mode', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: /iterative batch/i }));
    expect(screen.getByText(/pausing for review and steering/i)).toBeInTheDocument();
  });

  // Batch progress panel hidden initially
  it('does not show batch progress panel when no batch is active', () => {
    renderPanel();
    expect(screen.queryByText('Batch Progress')).not.toBeInTheDocument();
  });

  // Clicking generate calls startBatch.mutate
  it('clicking generate calls startBatch.mutate with selected entry ids', () => {
    const mutateMock = vi.fn();
    mockStartBatch.mockReturnValue({ mutate: mutateMock, isPending: false });
    renderPanel([makeEntry({ id: 'entry-1' })]);
    fireEvent.click(screen.getByRole('button', { name: /generate copy for 1 selected page/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ entryIds: ['entry-1'], mode: 'review_inbox' }),
      expect.any(Object),
    );
  });
});
