/**
 * Component tests for ISSUE 2b — ClientCopyReview SOLO mode (single-item review).
 *
 * Asserts:
 *  - soloEntryId → only the matching entry renders; header / summary-stats / per-blueprint h3 hidden;
 *  - solo not-found (entries loaded, none match) → contextual "Loading review…" message
 *    (mutually exclusive with the whole-empty EmptyState);
 *  - legacy mode (no soloEntryId) → all entries + chrome render (byte-identical guard).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => {},
}));

// Stub the EntrySections fetch path: only the top-level entries query matters for these assertions.
const mockEntries = vi.fn();
const mockSections = vi.fn();
const publicCopyMocks = vi.hoisted(() => ({
  approveSection: vi.fn(),
  suggestEdit: vi.fn(),
}));

vi.mock('../../src/api/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/content')>();
  return {
    ...actual,
    publicCopyReview: {
      ...actual.publicCopyReview,
      approveSection: publicCopyMocks.approveSection,
      suggestEdit: publicCopyMocks.suggestEdit,
    },
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
    useQuery: (opts: { queryKey: unknown[] }) => {
      // The entries query (key ['client-copy-entries', wsId]) returns our seeded list; the per-entry
      // sections query (only fired when an entry is expanded) returns loading.
      const head = String(opts.queryKey?.[0] ?? '');
      if (head === 'client-copy-entries') {
        return { data: { entries: mockEntries() }, isLoading: false, error: null, refetch: vi.fn() };
      }
      if (head === 'client-copy-sections') {
        return { data: { sections: mockSections() }, isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    },
    useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown> }) => ({
      mutate: vi.fn((variables: unknown) => { void options.mutationFn(variables); }),
      mutateAsync: vi.fn((variables: unknown) => options.mutationFn(variables)),
      isPending: false,
      variables: undefined,
    }),
  };
});

import { ClientCopyReview } from '../../src/components/client/ClientCopyReview';

function makeEntry(id: string, name: string, blueprintId = 'bp-1', blueprintName = 'Homepage Blueprint') {
  return {
    id,
    name,
    pageType: 'landing',
    blueprintId,
    blueprintName,
    copyStatus: {
      entryId: id,
      totalSections: 4,
      pendingSections: 0,
      draftSections: 0,
      clientReviewSections: 2,
      approvedSections: 2,
      revisionSections: 0,
      overallStatus: 'client_review' as const,
      approvalPercentage: 50,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSections.mockReturnValue([]);
  publicCopyMocks.approveSection.mockResolvedValue(undefined);
  publicCopyMocks.suggestEdit.mockResolvedValue(undefined);
});

describe('ClientCopyReview solo mode', () => {
  it('soloEntryId → only the matching entry renders; header/stats/blueprint h3 hidden', () => {
    mockEntries.mockReturnValue([
      makeEntry('entry-1', 'Home hero copy'),
      makeEntry('entry-2', 'About page copy', 'bp-2', 'About Blueprint'),
    ]);
    render(<ClientCopyReview workspaceId="ws-1" soloEntryId="entry-1" />);

    // Only the soloed entry.
    expect(screen.getByText('Home hero copy')).toBeInTheDocument();
    expect(screen.queryByText('About page copy')).not.toBeInTheDocument();

    // Header (h2 "Copy Review"), summary stats, and per-blueprint h3 are hidden.
    expect(screen.queryByRole('heading', { name: 'Copy Review' })).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting your review/)).not.toBeInTheDocument();
    expect(screen.queryByText('Homepage Blueprint')).not.toBeInTheDocument();
  });

  it('solo not-found (entries>0, none match) → contextual message', () => {
    mockEntries.mockReturnValue([makeEntry('entry-2', 'About page copy')]);
    render(<ClientCopyReview workspaceId="ws-1" soloEntryId="entry-1" />);

    expect(screen.getByText('Loading review…')).toBeInTheDocument();
    // Not the whole-empty EmptyState.
    expect(screen.queryByText('No copy ready for review yet')).not.toBeInTheDocument();
  });

  it('legacy mode (no soloEntryId) → all entries + chrome render', () => {
    mockEntries.mockReturnValue([
      makeEntry('entry-1', 'Home hero copy'),
      makeEntry('entry-2', 'About page copy', 'bp-2', 'About Blueprint'),
    ]);
    render(<ClientCopyReview workspaceId="ws-1" />);

    // Header + both blueprint h3s + both entries.
    expect(screen.getByRole('heading', { name: 'Copy Review' })).toBeInTheDocument();
    expect(screen.getByText('Homepage Blueprint')).toBeInTheDocument();
    expect(screen.getByText('About Blueprint')).toBeInTheDocument();
    expect(screen.getByText('Home hero copy')).toBeInTheDocument();
    expect(screen.getByText('About page copy')).toBeInTheDocument();
    // Summary stats row present.
    expect(screen.getByText(/awaiting your review/)).toBeInTheDocument();
  });

  it('keeps a rejected client suggestion open for an explicit retry', async () => {
    mockEntries.mockReturnValue([makeEntry('entry-1', 'Home hero copy')]);
    mockSections.mockReturnValue([{
      id: 'section-1',
      entryId: 'entry-1',
      sectionPlanItemId: 'sp_home_hero',
      generatedCopy: 'Canonical hero copy.',
      status: 'client_review',
      aiAnnotation: null,
      clientSuggestions: null,
      version: 1,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }]);
    publicCopyMocks.suggestEdit.mockRejectedValue(new Error('review token conflict'));
    render(<ClientCopyReview workspaceId="ws-1" soloEntryId="entry-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Suggest Changes' }));
    const suggestion = screen.getByPlaceholderText('Type your suggested version here...');
    fireEvent.change(suggestion, { target: { value: 'Keep this client-authored revision.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Suggestion' }));

    await waitFor(() => {
      expect(publicCopyMocks.suggestEdit).toHaveBeenCalledWith(
        'ws-1',
        'section-1',
        {
          originalText: 'Canonical hero copy.',
          suggestedText: 'Keep this client-authored revision.',
          expectedUpdatedAt: '2026-07-14T00:00:00.000Z',
        },
      );
    });
    expect(screen.getByPlaceholderText('Type your suggested version here...')).toHaveValue(
      'Keep this client-authored revision.',
    );
  });

  it('does not reattribute an open suggestion after the canonical section refetches', () => {
    mockEntries.mockReturnValue([makeEntry('entry-1', 'Home hero copy')]);
    mockSections.mockReturnValue([{
      id: 'section-1',
      entryId: 'entry-1',
      sectionPlanItemId: 'sp_home_hero',
      generatedCopy: 'Revision one hero copy.',
      status: 'client_review',
      aiAnnotation: null,
      clientSuggestions: null,
      version: 1,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }]);
    const view = render(<ClientCopyReview workspaceId="ws-1" soloEntryId="entry-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Suggest Changes' }));
    fireEvent.change(screen.getByPlaceholderText('Type your suggested version here...'), {
      target: { value: 'Keep this suggestion tied to revision one.' },
    });

    mockSections.mockReturnValue([{
      id: 'section-1',
      entryId: 'entry-1',
      sectionPlanItemId: 'sp_home_hero',
      generatedCopy: 'Revision two hero copy.',
      status: 'client_review',
      aiAnnotation: null,
      clientSuggestions: null,
      version: 2,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T01:00:00.000Z',
    }]);
    view.rerender(<ClientCopyReview workspaceId="ws-1" soloEntryId="entry-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/changed while you were preparing your suggestion/i);
    expect(screen.getByPlaceholderText('Type your suggested version here...')).toHaveValue(
      'Keep this suggestion tied to revision one.',
    );
    const submitButton = screen.getByRole('button', { name: 'Submit Suggestion' });
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);
    expect(publicCopyMocks.suggestEdit).not.toHaveBeenCalled();
  });
});
