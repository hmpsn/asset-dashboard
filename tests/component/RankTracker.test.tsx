import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock API client before importing the component
vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue([]),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
}));

import { RankTracker } from '../../src/components/RankTracker';

describe('RankTracker — GSC Capture Snapshot button', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows Capture Snapshot button disabled with title when GSC is not connected', async () => {
    render(<RankTracker workspaceId="ws-1" hasGsc={false} />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /capture snapshot/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });

    const btn = screen.getByRole('button', { name: /capture snapshot/i });
    expect(btn.getAttribute('title')).toMatch(/connect.*google search console/i);
  });

  it('shows Capture Snapshot button enabled when GSC is connected and keywords exist', async () => {
    const { get } = await import('../../src/api/client');
    const mockGet = vi.mocked(get);
    mockGet
      .mockResolvedValueOnce([{ query: 'seo tips', pinned: false }]) // keywords
      .mockResolvedValueOnce([]); // latest ranks

    render(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /capture snapshot/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });
  });

  it('shows Capture Snapshot button disabled when GSC connected but no keywords', async () => {
    render(<RankTracker workspaceId="ws-1" hasGsc={true} />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /capture snapshot/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });
  });
});
