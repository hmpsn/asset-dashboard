/**
 * FM-2 behavioral component tests for ContentManager error paths.
 *
 * Verifies that:
 *  (a) posts query failure renders ErrorState, NOT the "No content generated yet" empty state
 *  (b) list-row publish failure (API reject) surfaces an error toast
 *  (c) list-row publish failure (result.success===false) surfaces an error toast
 *
 * Pattern: mock the API to return an error, then assert the operation shows an error
 * affordance — not a silent success or an empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { GeneratedPost } from '../../shared/types/content';

// ── Module mocks (hoisted before component import) ────────────────────────────
const listMock = vi.fn();
const publishMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();

vi.mock('../../src/api/content', () => ({
  contentPosts: {
    list: (...args: unknown[]) => listMock(...args),
    publishToWebflow: (...args: unknown[]) => publishMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    sendToClient: vi.fn(),
    scoreVoice: vi.fn(),
  },
}));

vi.mock('../../src/api/workspaces', () => ({
  workspaces: {
    getById: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'WS', publishTarget: true }),
  },
}));

import { ContentManager } from '../../src/components/ContentManager';
import { ToastProvider } from '../../src/components/Toast';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
    status: 'approved',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContentManager — FM-2 error paths', () => {
  // (a) Posts query failure → ErrorState, not empty state
  it('renders ErrorState when posts query fails — not "No content generated yet" (FM-2a)', async () => {
    listMock.mockRejectedValue(new Error('Network error'));
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    // Wait for query to fail
    expect(await screen.findByText("Couldn't load content posts")).toBeInTheDocument();
    // Must NOT show the empty state message
    expect(screen.queryByText('No content generated yet')).not.toBeInTheDocument();
  });

  it('ErrorState for posts contains a Retry button (FM-2a)', async () => {
    listMock.mockRejectedValue(new Error('Network error'));
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    expect(await screen.findByText("Couldn't load content posts")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  // (b) Publish failure via thrown error → toast surfaced
  it('shows error toast when publishToWebflow API call throws (FM-2b)', async () => {
    listMock.mockResolvedValue([makePost({ status: 'approved' })]);
    publishMock.mockRejectedValue(new Error('Webflow unreachable'));
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    // Wait for list to render
    const publishBtn = await screen.findByTitle('Publish to Webflow CMS');
    fireEvent.click(publishBtn);

    // Toast with error message must appear
    await waitFor(() => {
      expect(screen.getByText('Webflow unreachable')).toBeInTheDocument();
    });
  });

  // (c) Publish failure via result.success===false → toast surfaced
  it('shows error toast when publishToWebflow returns success:false (FM-2c)', async () => {
    listMock.mockResolvedValue([makePost({ status: 'approved' })]);
    publishMock.mockResolvedValue({ success: false, error: 'Webflow API rate limited' });
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    const publishBtn = await screen.findByTitle('Publish to Webflow CMS');
    fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(screen.getByText('Webflow API rate limited')).toBeInTheDocument();
    });
  });

  // (c-fallback) publish failure via result.success===false with no error message → fallback toast
  it('shows "Publish failed" fallback toast when publishToWebflow returns success:false without error message (FM-2c)', async () => {
    listMock.mockResolvedValue([makePost({ status: 'approved' })]);
    publishMock.mockResolvedValue({ success: false });
    const Wrapper = makeWrapper();
    render(<Wrapper><ContentManager workspaceId="ws-1" /></Wrapper>);

    const publishBtn = await screen.findByTitle('Publish to Webflow CMS');
    fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(screen.getByText('Publish failed')).toBeInTheDocument();
    });
  });
});
