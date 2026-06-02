/**
 * Component tests for the ContentManager "Send to client" action (POST-C1).
 *
 * Verifies the SEPARATE client-facing action:
 *  - the "Send to client" button renders on a post card (alongside the internal Review button)
 *  - clicking it reveals the optional note input, and confirming calls contentPosts.sendToClient
 *    with the workspace, post id, and (optional) note
 *  - the existing internal "Review" button is untouched (still present for draft posts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { GeneratedPost } from '../../shared/types/content';

// ── Module mocks (hoisted before component import) ────────────────────────────
const listMock = vi.fn();
const sendToClientMock = vi.fn();

vi.mock('../../src/api/content', () => ({
  contentPosts: {
    list: (...args: unknown[]) => listMock(...args),
    sendToClient: (...args: unknown[]) => sendToClientMock(...args),
    update: vi.fn(),
    remove: vi.fn(),
    publishToWebflow: vi.fn(),
    scoreVoice: vi.fn(),
  },
}));

vi.mock('../../src/api/workspaces', () => ({
  workspaces: {
    getById: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'WS', publishTarget: false }),
  },
}));

import { ContentManager } from '../../src/components/ContentManager';
import { ToastProvider } from '../../src/components/Toast';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    briefId: 'brief-1',
    targetKeyword: 'keyword',
    title: 'My Post Title',
    metaDescription: 'meta',
    introduction: '<p>intro</p>',
    sections: [{ index: 0, heading: 'S', content: '<p>b</p>', wordCount: 2, targetWordCount: 100, keywords: [], status: 'done' }],
    conclusion: '<p>c</p>',
    totalWordCount: 50,
    targetWordCount: 1000,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([makePost()]);
  sendToClientMock.mockResolvedValue({ id: 'creq-1', status: 'post_review' });
});

describe('ContentManager — Send to client (POST-C1)', () => {
  it('renders the Send to client button alongside the internal Review button', async () => {
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    expect(await screen.findByText('Send to client')).toBeInTheDocument();
    // The existing internal Review button is untouched (draft post).
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('calls contentPosts.sendToClient with the note when confirmed', async () => {
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    fireEvent.click(await screen.findByText('Send to client'));

    const noteInput = await screen.findByLabelText('Optional note for the client');
    fireEvent.change(noteInput, { target: { value: 'Please review the intro' } });

    // Confirm — the inline note panel's "Send to client" button.
    const confirmButtons = screen.getAllByText('Send to client');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(sendToClientMock).toHaveBeenCalledWith('ws-1', 'post-1', 'Please review the intro');
    });
  });

  it('omits the note when the input is left empty', async () => {
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    fireEvent.click(await screen.findByText('Send to client'));
    await screen.findByLabelText('Optional note for the client');

    const confirmButtons = screen.getAllByText('Send to client');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(sendToClientMock).toHaveBeenCalledWith('ws-1', 'post-1', undefined);
    });
  });
});
