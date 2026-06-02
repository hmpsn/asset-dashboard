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
import { render, screen } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => {},
}));

// Stub the EntrySections fetch path: only the top-level entries query matters for these assertions.
const mockEntries = vi.fn();

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
      return { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
    },
    useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
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
});
