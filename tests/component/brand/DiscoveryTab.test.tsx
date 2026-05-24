import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DiscoveryTab } from '../../../src/components/brand/DiscoveryTab';
import type { DiscoverySource, DiscoveryExtraction } from '../../../shared/types/brand-engine';

// ─── Mock dependencies ─────────────────────────────────────────────────────

const mockListSources = vi.fn();
const mockListExtractionsBySource = vi.fn();
const mockUpdateExtraction = vi.fn();
const mockProcess = vi.fn();
const mockDeleteSource = vi.fn();
const mockUploadText = vi.fn();
const mockUploadFiles = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockToast = vi.fn();

vi.mock('../../../src/api/brand-engine', () => ({
  discovery: {
    listSources: (...args: unknown[]) => mockListSources(...args),
    listExtractionsBySource: (...args: unknown[]) => mockListExtractionsBySource(...args),
    updateExtraction: (...args: unknown[]) => mockUpdateExtraction(...args),
    process: (...args: unknown[]) => mockProcess(...args),
    deleteSource: (...args: unknown[]) => mockDeleteSource(...args),
    uploadText: (...args: unknown[]) => mockUploadText(...args),
    uploadFiles: (...args: unknown[]) => mockUploadFiles(...args),
  },
}));

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderDiscoveryTab(workspaceId = 'ws-1') {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DiscoveryTab workspaceId={workspaceId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeSource(overrides: Partial<DiscoverySource> = {}): DiscoverySource {
  return {
    id: 'src-1',
    workspaceId: 'ws-1',
    filename: 'Sales Call Transcript.txt',
    sourceType: 'transcript',
    rawContent: 'We help small businesses grow online.',
    processedAt: undefined,
    createdAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

function makeExtraction(overrides: Partial<DiscoveryExtraction> = {}): DiscoveryExtraction {
  return {
    id: 'ext-1',
    sourceId: 'src-1',
    workspaceId: 'ws-1',
    extractionType: 'voice_pattern',
    category: 'signature_phrase',
    content: 'We make complexity simple',
    sourceQuote: 'Our motto has always been: make complexity simple.',
    confidence: 'high',
    status: 'pending',
    routedTo: undefined,
    createdAt: '2026-01-15T13:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('DiscoveryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: loading state
    mockListSources.mockReturnValue(new Promise(() => {}));
    mockListExtractionsBySource.mockReturnValue(new Promise(() => {}));
  });

  // ─── Smoke test ───────────────────────────────────────────────────────────

  it('renders without crashing', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    expect(screen.getByText('Discovery Ingestion')).toBeInTheDocument();
  });

  // ─── Loading state ────────────────────────────────────────────────────────

  it('shows skeleton loading state while sources are fetching', () => {
    mockListSources.mockReturnValue(new Promise(() => {}));
    const { container } = renderDiscoveryTab();
    // Skeletons render as animated divs — check the section card heading is present
    expect(screen.getByText('Discovery Ingestion')).toBeInTheDocument();
    // Three skeleton rows should be in the DOM
    const skeletons = container.querySelectorAll('.animate-pulse, [class*="skeleton"], [class*="animate"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('does not show empty state during loading', () => {
    mockListSources.mockReturnValue(new Promise(() => {}));
    renderDiscoveryTab();
    expect(screen.queryByText('No sources yet')).not.toBeInTheDocument();
  });

  // ─── Empty state ──────────────────────────────────────────────────────────

  it('shows empty state with Add Source CTA when no sources exist', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(screen.getByText('No sources yet')).toBeInTheDocument();
    });
    expect(screen.getByText('Add Source')).toBeInTheDocument();
  });

  it('empty state description mentions uploading sources', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(
        screen.getByText(/Upload transcripts, brand documents, or competitor copy/i),
      ).toBeInTheDocument();
    });
  });

  // ─── Sources list ─────────────────────────────────────────────────────────

  it('renders source filename when sources exist', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(screen.getByText('Sales Call Transcript.txt')).toBeInTheDocument();
    });
  });

  it('shows source type badge for transcript sources', async () => {
    mockListSources.mockResolvedValue([makeSource({ sourceType: 'transcript' })]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(screen.getByText('Transcript')).toBeInTheDocument();
    });
  });

  it('shows source type badge for brand_doc sources', async () => {
    mockListSources.mockResolvedValue([makeSource({ sourceType: 'brand_doc' })]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(screen.getByText('Brand Doc')).toBeInTheDocument();
    });
  });

  it('shows Process button for unprocessed sources', async () => {
    mockListSources.mockResolvedValue([makeSource({ processedAt: undefined })]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /process/i })).toBeInTheDocument();
    });
  });

  it('shows Processed badge and Extractions button for processed sources', async () => {
    mockListSources.mockResolvedValue([
      makeSource({ processedAt: '2026-01-15T14:00:00.000Z' }),
    ]);
    renderDiscoveryTab();
    await waitFor(() => {
      expect(screen.getByText('Processed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /extractions/i })).toBeInTheDocument();
    });
  });

  it('shows Add Source toolbar button when sources exist', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    renderDiscoveryTab();
    await waitFor(() => {
      // There's an Add Source button in the toolbar (for the list view)
      expect(screen.getByRole('button', { name: /add source/i })).toBeInTheDocument();
    });
  });

  // ─── Upload panel ─────────────────────────────────────────────────────────

  it('clicking Add Source in empty state opens upload panel', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => {
      expect(screen.getByText('Upload file')).toBeInTheDocument();
      expect(screen.getByText('Paste text')).toBeInTheDocument();
    });
  });

  it('clicking Add Source toolbar button shows upload panel', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('Sales Call Transcript.txt'));
    // Get the toolbar Add Source button (not the one in empty state)
    const addBtn = screen.getByRole('button', { name: /add source/i });
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(screen.getByText('Upload file')).toBeInTheDocument();
    });
  });

  it('upload panel defaults to file mode showing drop zone', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => {
      expect(screen.getByText('Drop files here')).toBeInTheDocument();
    });
  });

  it('switching upload mode to Paste text shows TextPasteForm', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => screen.getByText('Paste text'));
    fireEvent.click(screen.getByText('Paste text'));
    await waitFor(() => {
      expect(screen.getByText('Paste Text Source')).toBeInTheDocument();
    });
  });

  it('TextPasteForm has Name, Source type, Content fields', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => screen.getByText('Paste text'));
    fireEvent.click(screen.getByText('Paste text'));
    await waitFor(() => screen.getByText('Paste Text Source'));
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/source type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/content/i)).toBeInTheDocument();
  });

  it('TextPasteForm submits and calls uploadText API', async () => {
    mockListSources.mockResolvedValue([]);
    mockUploadText.mockResolvedValue(makeSource());
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => screen.getByText('Paste text'));
    fireEvent.click(screen.getByText('Paste text'));
    await waitFor(() => screen.getByText('Paste Text Source'));

    const textarea = screen.getByLabelText(/content/i);
    fireEvent.change(textarea, { target: { value: 'This is a brand document.' } });
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));

    await waitFor(() => {
      expect(mockUploadText).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ rawContent: 'This is a brand document.' }),
      );
    });
  });

  it('TextPasteForm Cancel button hides the panel', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => screen.getByText('Paste text'));
    fireEvent.click(screen.getByText('Paste text'));
    await waitFor(() => screen.getByText('Paste Text Source'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText('Paste Text Source')).not.toBeInTheDocument();
    });
  });

  it('TextPasteForm shows error toast when upload fails', async () => {
    mockListSources.mockResolvedValue([]);
    mockUploadText.mockRejectedValue(new Error('Network error'));
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => screen.getByText('Paste text'));
    fireEvent.click(screen.getByText('Paste text'));
    await waitFor(() => screen.getByText('Paste Text Source'));
    const textarea = screen.getByLabelText(/content/i);
    fireEvent.change(textarea, { target: { value: 'Some content' } });
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Failed to add text source', 'error');
    });
  });

  // ─── Processing ───────────────────────────────────────────────────────────

  it('clicking Process calls discovery.process API', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    mockProcess.mockResolvedValue({ extractions: [makeExtraction()] });
    mockListExtractionsBySource.mockResolvedValue([makeExtraction()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /^process$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));
    await waitFor(() => {
      expect(mockProcess).toHaveBeenCalledWith('ws-1', 'src-1');
    });
  });

  it('shows toast after successful processing', async () => {
    const extraction = makeExtraction();
    mockListSources.mockResolvedValue([makeSource()]);
    mockProcess.mockResolvedValue({ extractions: [extraction] });
    mockListExtractionsBySource.mockResolvedValue([extraction]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /^process$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Extracted 1 insight');
    });
  });

  it('shows error toast when processing fails', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    mockProcess.mockRejectedValue(new Error('Processing failed'));
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /^process$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^process$/i }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Processing failed', 'error');
    });
  });

  // ─── Delete source ────────────────────────────────────────────────────────

  it('clicking delete icon opens confirm dialog', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('Sales Call Transcript.txt'));
    fireEvent.click(screen.getByRole('button', { name: /delete source/i }));
    await waitFor(() => {
      expect(screen.getByText('Delete Source')).toBeInTheDocument();
    });
  });

  it('confirming delete calls discovery.deleteSource and shows toast', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    mockDeleteSource.mockResolvedValue(undefined);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('Sales Call Transcript.txt'));
    fireEvent.click(screen.getByRole('button', { name: /delete source/i }));
    await waitFor(() => screen.getByText('Delete Source'));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      expect(mockDeleteSource).toHaveBeenCalledWith('ws-1', 'src-1');
      expect(mockToast).toHaveBeenCalledWith('Source deleted');
    });
  });

  it('cancelling delete dialog does not call deleteSource', async () => {
    mockListSources.mockResolvedValue([makeSource()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('Sales Call Transcript.txt'));
    fireEvent.click(screen.getByRole('button', { name: /delete source/i }));
    await waitFor(() => screen.getByText('Delete Source'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText('Delete Source')).not.toBeInTheDocument();
    });
    expect(mockDeleteSource).not.toHaveBeenCalled();
  });

  // ─── Extractions panel ────────────────────────────────────────────────────

  it('clicking Extractions button navigates to extractions panel', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByText('← All sources')).toBeInTheDocument();
    });
  });

  it('extractions panel shows the source filename in breadcrumb', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByText('Sales Call Transcript.txt')).toBeInTheDocument();
    });
  });

  it('extractions panel shows pending extraction content', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    const extraction = makeExtraction({ status: 'pending' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([extraction]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByText('We make complexity simple')).toBeInTheDocument();
    });
  });

  it('extractions panel shows source quote when present', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction()]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Our motto has always been: make complexity simple/),
      ).toBeInTheDocument();
    });
  });

  it('pending extraction shows Accept and Dismiss buttons', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction({ status: 'pending' })]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /accept extraction/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dismiss extraction/i })).toBeInTheDocument();
    });
  });

  it('accepted extraction shows Accepted indicator and no Accept/Dismiss buttons', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction({ status: 'accepted' })]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    // Switch to "All" filter to see accepted extractions (default is 'pending')
    await waitFor(() => screen.getByText('All'));
    fireEvent.click(screen.getByText('All'));
    await waitFor(() => {
      // The status indicator text "Accepted" appears on the extraction card
      expect(screen.getAllByText('Accepted').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByRole('button', { name: /accept extraction/i })).not.toBeInTheDocument();
    });
  });

  it('accepting an extraction calls updateExtraction with status=accepted', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction({ status: 'pending' })]);
    mockUpdateExtraction.mockResolvedValue({ updated: true });
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => screen.getByRole('button', { name: /accept extraction/i }));
    fireEvent.click(screen.getByRole('button', { name: /accept extraction/i }));
    await waitFor(() => {
      expect(mockUpdateExtraction).toHaveBeenCalledWith('ws-1', 'ext-1', { status: 'accepted' });
      expect(mockToast).toHaveBeenCalledWith('Extraction accepted');
    });
  });

  it('dismissing an extraction opens confirm dialog', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction({ status: 'pending' })]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => screen.getByRole('button', { name: /dismiss extraction/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss extraction/i }));
    await waitFor(() => {
      expect(screen.getByText('Dismiss Extraction')).toBeInTheDocument();
    });
  });

  it('confirming dismiss calls updateExtraction with status=dismissed', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction({ status: 'pending' })]);
    mockUpdateExtraction.mockResolvedValue({ updated: true });
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => screen.getByRole('button', { name: /dismiss extraction/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss extraction/i }));
    await waitFor(() => screen.getByText('Dismiss Extraction'));
    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    await waitFor(() => {
      expect(mockUpdateExtraction).toHaveBeenCalledWith('ws-1', 'ext-1', { status: 'dismissed' });
      expect(mockToast).toHaveBeenCalledWith('Extraction dismissed');
    });
  });

  it('extraction update failure shows error toast', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([makeExtraction({ status: 'pending' })]);
    mockUpdateExtraction.mockRejectedValue(new Error('Server error'));
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => screen.getByRole('button', { name: /accept extraction/i }));
    fireEvent.click(screen.getByRole('button', { name: /accept extraction/i }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Failed to update extraction', 'error');
    });
  });

  it('status filter tabs filter extractions by status', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([
      makeExtraction({ id: 'ext-1', status: 'pending', content: 'Pending extraction content' }),
      makeExtraction({ id: 'ext-2', status: 'accepted', content: 'Accepted extraction content' }),
    ]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    // Default filter is 'pending' — only pending should show
    await waitFor(() => {
      expect(screen.getByText('Pending extraction content')).toBeInTheDocument();
      expect(screen.queryByText('Accepted extraction content')).not.toBeInTheDocument();
    });
    // Switch to All
    fireEvent.click(screen.getByText('All'));
    await waitFor(() => {
      expect(screen.getByText('Pending extraction content')).toBeInTheDocument();
      expect(screen.getByText('Accepted extraction content')).toBeInTheDocument();
    });
  });

  it('empty extractions panel shows appropriate empty state message', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByText('No pending extractions')).toBeInTheDocument();
    });
  });

  it('clicking All sources back button returns to sources list', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => screen.getByText('← All sources'));
    fireEvent.click(screen.getByRole('button', { name: /back to sources/i }));
    await waitFor(() => {
      expect(screen.queryByText('← All sources')).not.toBeInTheDocument();
      expect(screen.getByText('Sales Call Transcript.txt')).toBeInTheDocument();
    });
  });

  it('pending count badge is shown when extractions have pending items', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([
      makeExtraction({ id: 'ext-1', status: 'pending' }),
      makeExtraction({ id: 'ext-2', status: 'pending' }),
    ]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByText('2 pending')).toBeInTheDocument();
    });
  });

  // ─── Routing destination ──────────────────────────────────────────────────

  it('shows routed destination label when extraction has routedTo', async () => {
    const processedSource = makeSource({ processedAt: '2026-01-15T14:00:00.000Z' });
    mockListSources.mockResolvedValue([processedSource]);
    mockListExtractionsBySource.mockResolvedValue([
      makeExtraction({ status: 'pending', routedTo: 'voice_profile' }),
    ]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByRole('button', { name: /extractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /extractions/i }));
    await waitFor(() => {
      expect(screen.getByText(/Voice Profile/)).toBeInTheDocument();
    });
  });

  // ─── Upload zone ──────────────────────────────────────────────────────────

  it('upload zone has accessible drop zone role and label', async () => {
    mockListSources.mockResolvedValue([]);
    renderDiscoveryTab();
    await waitFor(() => screen.getByText('No sources yet'));
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /drop files here or click to browse/i }),
      ).toBeInTheDocument();
    });
  });
});
