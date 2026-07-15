// tests/component/brand/CopyReviewPanel.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CopyReviewPanel } from '../../../src/components/brand/CopyReviewPanel';
import type { CopySection, EntryCopyStatus } from '../../../shared/types/copy-pipeline';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseCopySections = vi.fn();
const mockUseCopyStatus = vi.fn();
const mockUseCopyMetadata = vi.fn();
const mockUseGenerateCopy = vi.fn();
const mockUseSendEntryToClientReview = vi.fn();
const mockUseUpdateSectionStatus = vi.fn();
const mockUseUpdateSectionText = vi.fn();
const mockUseRegenerateCopySection = vi.fn();

vi.mock('../../../src/hooks/admin/useCopyPipeline', () => ({
  useCopySections: (...args: unknown[]) => mockUseCopySections(...args),
  useCopyStatus: (...args: unknown[]) => mockUseCopyStatus(...args),
  useCopyMetadata: (...args: unknown[]) => mockUseCopyMetadata(...args),
  useGenerateCopy: (...args: unknown[]) => mockUseGenerateCopy(...args),
  useSendEntryToClientReview: (...args: unknown[]) => mockUseSendEntryToClientReview(...args),
  useUpdateSectionStatus: (...args: unknown[]) => mockUseUpdateSectionStatus(...args),
  useUpdateSectionText: (...args: unknown[]) => mockUseUpdateSectionText(...args),
  useRegenerateCopySection: (...args: unknown[]) => mockUseRegenerateCopySection(...args),
}));

vi.mock('../../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSection(overrides: Partial<CopySection> = {}): CopySection {
  return {
    id: 'section-1',
    workspaceId: 'ws-1',
    entryId: 'entry-1',
    sectionPlanItemId: 'hero-headline',
    generatedCopy: 'Our platform helps you grow faster.',
    status: 'draft',
    aiAnnotation: null,
    aiReasoning: null,
    steeringHistory: [],
    clientSuggestions: null,
    qualityFlags: null,
    version: 1,
    generationRevision: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCopyStatus(overrides: Partial<EntryCopyStatus> = {}): EntryCopyStatus {
  return {
    entryId: 'entry-1',
    totalSections: 1,
    pendingSections: 0,
    draftSections: 1,
    clientReviewSections: 0,
    approvedSections: 0,
    revisionSections: 0,
    overallStatus: 'draft',
    approvalPercentage: 0,
    ...overrides,
  };
}

const defaultMutateFn = vi.fn();
const defaultMutateAsyncFn = vi.fn().mockResolvedValue(undefined);

function setupMocks() {
  mockUseCopySections.mockReturnValue({ data: [], isLoading: false, isError: false });
  mockUseCopyStatus.mockReturnValue({ data: null });
  mockUseCopyMetadata.mockReturnValue({ data: null });
  // useGenerateCopy is job-based (C2): it exposes startGenerate/isRunning, not mutate/isPending.
  mockUseGenerateCopy.mockReturnValue({ startGenerate: defaultMutateFn, isRunning: false });
  mockUseSendEntryToClientReview.mockReturnValue({ mutate: defaultMutateFn, isPending: false });
  mockUseUpdateSectionStatus.mockReturnValue({ mutate: defaultMutateFn, isPending: false, variables: undefined });
  mockUseUpdateSectionText.mockReturnValue({ mutateAsync: defaultMutateAsyncFn, isPending: false });
  mockUseRegenerateCopySection.mockReturnValue({ mutateAsync: defaultMutateAsyncFn, isPending: false });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPanel(props: { workspaceId?: string; blueprintId?: string; entryId?: string } = {}) {
  return render(
    <CopyReviewPanel
      workspaceId={props.workspaceId ?? 'ws-1'}
      blueprintId={props.blueprintId ?? 'bp-1'}
      entryId={props.entryId ?? 'entry-1'}
    />,
    { wrapper },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CopyReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  // Loading state
  it('shows loading state with spinner text while fetching sections', () => {
    mockUseCopySections.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPanel();
    expect(screen.getByText(/loading copy sections/i)).toBeInTheDocument();
  });

  // Error state
  it('shows error state when sections query fails', () => {
    mockUseCopySections.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPanel();
    expect(screen.getByText(/failed to load copy sections/i)).toBeInTheDocument();
  });

  // Empty state
  it('shows empty state with Generate Copy button when no sections exist', () => {
    mockUseCopySections.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderPanel();
    expect(screen.getByText('No copy sections yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate copy/i })).toBeInTheDocument();
  });

  // Calls generate in empty state
  it('calls startGenerate when Generate Copy button is clicked in empty state', () => {
    const startGenerateMock = vi.fn();
    mockUseCopySections.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseGenerateCopy.mockReturnValue({ startGenerate: startGenerateMock, isRunning: false });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /generate copy/i }));
    // entryId is bound at the hook call site (useGenerateCopy(wsId, blueprintId, entryId)),
    // so the click handler invokes startGenerate with no per-call args.
    expect(startGenerateMock).toHaveBeenCalledWith();
  });

  // Renders without crash with sections
  it('renders without crash when copy sections are provided', () => {
    mockUseCopySections.mockReturnValue({ data: [makeSection()], isLoading: false, isError: false });
    renderPanel();
    expect(screen.getByText('Copy Review')).toBeInTheDocument();
  });

  // Section label formatting (sectionPlanItemId → title case)
  it('renders section label in title case from sectionPlanItemId', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ sectionPlanItemId: 'hero-headline' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Hero Headline')).toBeInTheDocument();
  });

  // Underscore conversion in label
  it('converts underscores in sectionPlanItemId to spaces', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ sectionPlanItemId: 'value_proposition' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Value Proposition')).toBeInTheDocument();
  });

  // Generated copy shown
  it('displays generated copy text in section card', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ generatedCopy: 'Our platform helps you grow faster.' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Our platform helps you grow faster.')).toBeInTheDocument();
  });

  // No copy message
  it('shows "No copy generated yet" when generatedCopy is null', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ generatedCopy: null })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText(/no copy generated yet/i)).toBeInTheDocument();
  });

  // Approve button
  it('shows Approve button for each section', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByRole('button', { name: /approve section hero headline/i })).toBeInTheDocument();
  });

  // Approve button calls updateStatus mutation
  it('clicking Approve calls updateStatus.mutate with approved status', () => {
    const mutateMock = vi.fn();
    mockUseUpdateSectionStatus.mockReturnValue({ mutate: mutateMock, isPending: false, variables: undefined });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-1' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /approve section hero headline/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 'sec-1', status: 'approved', expectedRevision: 7 }),
    );
  });

  // Approved section — approve button disabled
  it('Approve button is disabled when section is already approved', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ status: 'approved' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByRole('button', { name: /approve section hero headline/i })).toBeDisabled();
  });

  // Send to Client Review button
  it('shows Send to Client Review button for each section', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(
      screen.getByRole('button', { name: /send section hero headline to client review/i }),
    ).toBeInTheDocument();
  });

  // Send to Client Review calls updateStatus mutation
  it('clicking Send to Client Review calls updateStatus.mutate with client_review', () => {
    const mutateMock = vi.fn();
    mockUseUpdateSectionStatus.mockReturnValue({ mutate: mutateMock, isPending: false, variables: undefined });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-1' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: /send section hero headline to client review/i }),
    );
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 'sec-1', status: 'client_review', expectedRevision: 7 }),
    );
  });

  it('sends the exact observed draft-section revision census', () => {
    const mutateMock = vi.fn();
    mockUseSendEntryToClientReview.mockReturnValue({ mutate: mutateMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [
        makeSection({ id: 'sec-1', status: 'draft', generationRevision: 3 }),
        makeSection({ id: 'sec-2', status: 'draft', generationRevision: 8 }),
        makeSection({ id: 'sec-3', status: 'approved', generationRevision: 12 }),
      ],
      isLoading: false,
      isError: false,
    });
    mockUseCopyStatus.mockReturnValue({
      data: makeCopyStatus({ draftSections: 2, totalSections: 3 }),
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /send all draft sections to client review/i }));

    expect(mutateMock).toHaveBeenCalledWith({
      entryId: 'entry-1',
      sectionRevisions: [
        { sectionId: 'sec-1', expectedRevision: 3 },
        { sectionId: 'sec-2', expectedRevision: 8 },
      ],
    });
  });

  it('disables edits when an internal revision token is absent', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ generationRevision: undefined })],
      isLoading: false,
      isError: false,
    });
    renderPanel();

    expect(screen.getByRole('button', { name: /approve section hero headline/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send section hero headline to client review/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /regenerate section hero headline/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send all draft sections to client review/i })).toBeDisabled();
  });

  // Regenerate button
  it('shows Regenerate button for each section', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(
      screen.getByRole('button', { name: /regenerate section hero headline with steering note/i }),
    ).toBeInTheDocument();
  });

  // Clicking Regenerate shows regen input form
  it('clicking Regenerate button reveals steering note input', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: /regenerate section hero headline with steering note/i }),
    );
    expect(screen.getByText(/steering note for regeneration/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/make it more concise/i)).toBeInTheDocument();
  });

  it('threads the observed revision through text edits', async () => {
    const mutateAsyncMock = vi.fn().mockResolvedValue(undefined);
    mockUseUpdateSectionText.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-edit', generationRevision: 11 })],
      isLoading: false,
      isError: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /edit copy for hero headline/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /edit copy for hero headline/i }), {
      target: { value: 'Operator-authored replacement copy.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save edits for hero headline/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        sectionId: 'sec-edit',
        copy: 'Operator-authored replacement copy.',
        expectedRevision: 11,
      });
    });
  });

  it('keeps rejected operator copy open for an explicit retry', async () => {
    const mutateAsyncMock = vi.fn().mockRejectedValue(new Error('revision conflict'));
    mockUseUpdateSectionText.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-edit', generationRevision: 11 })],
      isLoading: false,
      isError: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /edit copy for hero headline/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /edit copy for hero headline/i }), {
      target: { value: 'Keep this operator-authored copy.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save edits for hero headline/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: /edit copy for hero headline/i })).toHaveValue(
      'Keep this operator-authored copy.',
    );
  });

  it('does not rebase an open copy buffer onto a refetched section revision', () => {
    const mutateAsyncMock = vi.fn().mockResolvedValue(undefined);
    mockUseUpdateSectionText.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-edit', generatedCopy: 'Revision eleven copy.', generationRevision: 11 })],
      isLoading: false,
      isError: false,
    });
    const view = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /edit copy for hero headline/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /edit copy for hero headline/i }), {
      target: { value: 'Operator buffer opened at revision eleven.' },
    });

    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-edit', generatedCopy: 'External revision twelve copy.', generationRevision: 12 })],
      isLoading: false,
      isError: false,
    });
    view.rerender(
      <CopyReviewPanel workspaceId="ws-1" blueprintId="bp-1" entryId="entry-1" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/changed while you were editing/i);
    const saveButton = screen.getByRole('button', { name: /save edits for hero headline/i });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /edit copy for hero headline/i })).toHaveValue(
      'Operator buffer opened at revision eleven.',
    );
  });

  it('threads the observed revision through section regeneration', async () => {
    const mutateAsyncMock = vi.fn().mockResolvedValue(undefined);
    mockUseRegenerateCopySection.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-regen', generationRevision: 13 })],
      isLoading: false,
      isError: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /regenerate section hero headline with steering note/i }));
    fireEvent.change(screen.getByPlaceholderText(/make it more concise/i), {
      target: { value: 'Lead with the strongest verified benefit.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit regeneration note for hero headline/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        entryId: 'entry-1',
        sectionId: 'sec-regen',
        note: 'Lead with the strongest verified benefit.',
        expectedRevision: 13,
      });
    });
  });

  it('does not rebase an open regeneration note onto a refetched section revision', () => {
    const mutateAsyncMock = vi.fn().mockResolvedValue(undefined);
    mockUseRegenerateCopySection.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-regen', generationRevision: 13 })],
      isLoading: false,
      isError: false,
    });
    const view = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /regenerate section hero headline with steering note/i }));
    fireEvent.change(screen.getByPlaceholderText(/make it more concise/i), {
      target: { value: 'Keep this note bound to revision thirteen.' },
    });

    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-regen', generationRevision: 14 })],
      isLoading: false,
      isError: false,
    });
    view.rerender(
      <CopyReviewPanel workspaceId="ws-1" blueprintId="bp-1" entryId="entry-1" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/changed while you were preparing the regeneration note/i);
    expect(screen.getByPlaceholderText(/make it more concise/i)).toHaveValue(
      'Keep this note bound to revision thirteen.',
    );
    const submitButton = screen.getByRole('button', { name: /submit regeneration note for hero headline/i });
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('keeps a rejected regeneration steering note open for retry', async () => {
    const mutateAsyncMock = vi.fn().mockRejectedValue(new Error('revision conflict'));
    mockUseRegenerateCopySection.mockReturnValue({ mutateAsync: mutateAsyncMock, isPending: false });
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ id: 'sec-regen', generationRevision: 13 })],
      isLoading: false,
      isError: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /regenerate section hero headline with steering note/i }));
    const note = screen.getByPlaceholderText(/make it more concise/i);
    fireEvent.change(note, { target: { value: 'Preserve this steering note.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit regeneration note for hero headline/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(screen.getByPlaceholderText(/make it more concise/i)).toHaveValue('Preserve this steering note.');
  });

  // Progress bar shown when sections exist
  it('renders progress bar showing approval progress', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ status: 'draft' })],
      isLoading: false,
      isError: false,
    });
    mockUseCopyStatus.mockReturnValue({
      data: makeCopyStatus({ approvedSections: 0, totalSections: 1, approvalPercentage: 0 }),
    });
    renderPanel();
    expect(screen.getByRole('progressbar', { name: /approval progress/i })).toBeInTheDocument();
  });

  // Approved count in progress bar
  it('displays approved / total sections count in progress bar', () => {
    mockUseCopySections.mockReturnValue({
      data: [
        makeSection({ id: 's1', status: 'approved' }),
        makeSection({ id: 's2', status: 'draft' }),
      ],
      isLoading: false,
      isError: false,
    });
    mockUseCopyStatus.mockReturnValue({
      data: makeCopyStatus({ approvedSections: 1, totalSections: 2 }),
    });
    renderPanel();
    expect(screen.getByText(/1\/2 sections approved/i)).toBeInTheDocument();
  });

  // Regenerate All button
  it('shows Regenerate All button in the Copy Review header', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByRole('button', { name: /regenerate all/i })).toBeInTheDocument();
  });

  // Send for Client Review header button shown when draft sections exist
  it('shows "Send for Client Review" header button when draft sections exist', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ status: 'draft' })],
      isLoading: false,
      isError: false,
    });
    mockUseCopyStatus.mockReturnValue({
      data: makeCopyStatus({ draftSections: 1 }),
    });
    renderPanel();
    expect(
      screen.getByRole('button', { name: /send all draft sections to client review/i }),
    ).toBeInTheDocument();
  });

  // Quality flag error shown
  it('shows error quality flag badge when section has error-severity flag', () => {
    mockUseCopySections.mockReturnValue({
      data: [
        makeSection({
          qualityFlags: [{ type: 'forbidden_phrase', message: 'Forbidden phrase used', severity: 'error' }],
        }),
      ],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Has errors')).toBeInTheDocument();
    expect(screen.getByText('Forbidden phrase used')).toBeInTheDocument();
  });

  // Quality flag warning shown
  it('shows warning quality flag badge when section has warning-severity flag', () => {
    mockUseCopySections.mockReturnValue({
      data: [
        makeSection({
          qualityFlags: [{ type: 'missing_element', message: 'Missing required element', severity: 'warning' }],
        }),
      ],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Warnings')).toBeInTheDocument();
    expect(screen.getByText('Missing required element')).toBeInTheDocument();
  });

  // AI annotation shown
  it('displays AI annotation note when aiAnnotation is present', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ aiAnnotation: 'Focused on conversion optimization.' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('AI Note')).toBeInTheDocument();
    expect(screen.getByText('Focused on conversion optimization.')).toBeInTheDocument();
  });

  // Status badge — draft
  it('shows Draft badge for a section with draft status', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ status: 'draft' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  // Status badge — approved
  it('shows Approved badge for an approved section', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection({ status: 'approved' })],
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
  });

  // No purple classes — client-facing safety check
  it('contains no purple color classes (design system compliance)', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    const { container } = renderPanel();
    expect(container.innerHTML).not.toMatch(/purple-/);
  });

  // SEO title from metadata shown
  it('shows seoTitle from copy metadata in the header', () => {
    mockUseCopySections.mockReturnValue({
      data: [makeSection()],
      isLoading: false,
      isError: false,
    });
    mockUseCopyMetadata.mockReturnValue({
      data: {
        id: 'm-1',
        workspaceId: 'ws-1',
        entryId: 'entry-1',
        seoTitle: 'Fast-Growing Platform | Homepage',
        metaDescription: null,
        ogTitle: null,
        ogDescription: null,
        status: 'draft',
        steeringHistory: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    renderPanel();
    expect(screen.getByText('Fast-Growing Platform | Homepage')).toBeInTheDocument();
  });
});
