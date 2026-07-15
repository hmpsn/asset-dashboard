import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lazyPanel = vi.hoisted(() => {
  let resolve = () => undefined;
  const ready = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { ready, resolve };
});

const mockGetIntelligence = vi.hoisted(() => vi.fn());

vi.mock('../../src/components/ChatPanel', async () => {
  await lazyPanel.ready;
  return {
    ChatPanel: () => 'Loaded Admin Insights conversation',
  };
});

vi.mock('../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: (...args: unknown[]) => mockGetIntelligence(...args),
  },
}));

import { AdminChat } from '../../src/components/AdminChat';

describe('AdminChat closed-state loading', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('defers the panel module and smart context until the chat opens', async () => {
    mockGetIntelligence.mockResolvedValue({
      version: 1,
      workspaceId: 'ws-test',
      assembledAt: new Date().toISOString(),
      seoContext: {
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: '',
        personas: [],
        knowledgeBase: '',
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AdminChat workspaceId="ws-test" workspaceName="Test Workspace" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: /admin insights/i })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading admin insights conversation/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Loaded Admin Insights conversation')).not.toBeInTheDocument();
    expect(mockGetIntelligence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /admin insights/i }));

    expect(await screen.findByRole('status', { name: /loading admin insights conversation/i })).toBeInTheDocument();
    await waitFor(() => expect(mockGetIntelligence).toHaveBeenCalledTimes(1));

    await act(async () => {
      lazyPanel.resolve();
    });

    expect(await screen.findByText('Loaded Admin Insights conversation')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading admin insights conversation/i })).not.toBeInTheDocument();
  });
});
