/**
 * SchemaVersionHistory.test.tsx
 *
 * W1.5 real coverage for rollback error surfacing.
 * This test renders the actual component and asserts that a rollback failure
 * surfaces a visible, assertive (role="alert") error banner (not swallowed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SchemaVersionHistory } from '../../src/components/schema/SchemaVersionHistory';

// ── API mock ──────────────────────────────────────────────────────────────────
const getSafeMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  getSafe: (...args: unknown[]) => getSafeMock(...args),
  post: (...args: unknown[]) => postMock(...args),
}));

const HISTORY_ENTRY = {
  id: 'v1',
  publishedAt: '2026-01-15T10:00:00Z',
  schemaJson: { '@type': 'WebSite', name: 'Example' },
};

const OLDER_ENTRY = {
  id: 'v0',
  publishedAt: '2026-01-10T08:00:00Z',
  schemaJson: { '@type': 'WebSite', name: 'OldExample' },
};

function renderHistory() {
  return render(
    <SchemaVersionHistory
      siteId="site-1"
      pageId="page-1"
      workspaceId="ws-1"
      onRestore={vi.fn()}
    />,
  );
}

describe('SchemaVersionHistory — rollback error surfacing (W1.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state then history entries', async () => {
    getSafeMock.mockResolvedValue({ history: [HISTORY_ENTRY] });
    renderHistory();
    // Loading initially
    expect(screen.getByText(/loading history/i)).toBeInTheDocument();
    // History entry appears
    await waitFor(() => expect(screen.queryByText(/loading history/i)).not.toBeInTheDocument());
  });

  it('shows empty state when no history exists', async () => {
    getSafeMock.mockResolvedValue({ history: [] });
    renderHistory();
    await waitFor(() => expect(screen.getByText(/no publish history yet/i)).toBeInTheDocument());
  });

  it('shows rollback error banner when post throws — NOT swallowed', async () => {
    getSafeMock.mockResolvedValue({ history: [HISTORY_ENTRY, OLDER_ENTRY] });
    postMock.mockRejectedValue(new Error('Network timeout — could not rollback'));
    renderHistory();
    await waitFor(() => expect(screen.queryByText(/loading history/i)).not.toBeInTheDocument());

    // Click Restore on the older entry (not the "current" one)
    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText(/network timeout — could not rollback/i)).toBeInTheDocument();
    });
  });

  it('shows rollback error banner when server returns success=false', async () => {
    getSafeMock.mockResolvedValue({ history: [HISTORY_ENTRY, OLDER_ENTRY] });
    postMock.mockResolvedValue({ success: false, restoredSchema: {} });
    renderHistory();
    await waitFor(() => expect(screen.queryByText(/loading history/i)).not.toBeInTheDocument());

    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText(/rollback did not succeed/i)).toBeInTheDocument();
    });
    // The banner is an assertive live region so screen readers announce the failure.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('rollback error has a dismiss button that clears the error', async () => {
    getSafeMock.mockResolvedValue({ history: [HISTORY_ENTRY, OLDER_ENTRY] });
    postMock.mockRejectedValue(new Error('Server error'));
    renderHistory();
    await waitFor(() => expect(screen.queryByText(/loading history/i)).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(screen.getByText(/server error/i)).toBeInTheDocument());

    // Dismiss the error
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText(/server error/i)).not.toBeInTheDocument());
  });
});
